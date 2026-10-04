package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// errIdempotencyKeyReuse is a retry key sent again with a different body.
var errIdempotencyKeyReuse = errors.New("idempotency key reused with a different body")

// OverrideHandover confirms a pickup or a met handover without its code, for
// overrideHandoverCode (contracts/openapi.yaml;
// https://github.com/shaiknoorullah/hg-mono/issues/310). In one transaction:
//
//  1. Lock the order's live assignment, then the order: the lock order every
//     handover-code path uses, so this cannot deadlock with a rider's attempt.
//  2. Check the order is waiting on this handover: PICKUP needs the order
//     READY_FOR_PICKUP and the rider at the counter (ARRIVED_AT_PICKUP);
//     DELIVERY needs the order PICKED_UP or ARRIVED, a met handover, and the
//     rider at the drop-off (ARRIVED_AT_DROPOFF). Anything else is
//     *orders.IllegalTransitionError and nothing is written.
//  3. Move the order through the single Transition function, with the actor
//     SUPPORT or ADMIN and the reason on the timeline. That function also
//     retires the code, so no later attempt can use it, and sends the usual
//     order.state_changed event.
//  4. Move the assignment the same way (dispatch.SupportConfirmTx).
//  5. Write the append-only handover_override record and the hash-chained
//     audit_event. Neither holds a code.
//
// A retry of the request that wrote the record (same actor, order and
// Idempotency-Key) gets the record back with replayed = true; the same key with
// a different body is errIdempotencyKeyReuse. A second override of a handover
// that already happened is an IllegalTransitionError, and the UNIQUE
// (order_id, handover) constraint backs that up.
func (r *OrdersRepo) OverrideHandover(ctx context.Context, actor auditActor, actorKind machine.ActorKind,
	orderID string, kind handover.Kind, in handoverOverrideInput, idemKey string) (rec *handoverOverrideView, replayed bool, err error) {

	prior, err := r.overrideByKey(ctx, orderID, actor.staffID, idemKey)
	if err != nil {
		return nil, false, err
	}
	if prior != nil {
		if prior.Handover != string(kind) || prior.Reason != in.Reason || prior.CaseID != in.CaseID {
			return nil, false, errIdempotencyKeyReuse
		}
		return prior, true, nil
	}

	to := machine.StatePickedUp
	if kind == handover.Delivery {
		to = machine.StateDelivered
	}

	var out handoverOverrideView
	err = r.inTx(ctx, func(tx pgx.Tx) error {
		asn, err := dispatch.LockLiveAssignmentTx(ctx, tx, orderID)
		if err != nil {
			return err
		}
		var state string
		err = tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id = $1 FOR UPDATE`, orderID).Scan(&state)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		from := machine.State(state)
		waiting := from == machine.StateReadyForPickup
		if kind == handover.Delivery {
			waiting = from == machine.StatePickedUp || from == machine.StateArrived
		}
		if !waiting || !asn.AwaitsHandover(kind) {
			return &orders.IllegalTransitionError{From: from, To: to, Allowed: machine.AllowedFrom(from)}
		}

		attempts, err := handover.WrongAttemptsTx(ctx, tx, orderID, kind)
		if err != nil {
			return err
		}

		if err := r.st.TransitionInTx(ctx, tx, orders.TransitionRequest{
			OrderID:        orderID,
			To:             to,
			Actor:          actorKind,
			ActorAccountID: actor.staffID,
			Reason:         in.Reason,
			RequestID:      actor.requestID,
		}); err != nil {
			return err
		}
		if err := dispatch.SupportConfirmTx(ctx, tx, asn, kind, string(actorKind), actor.staffID, in.Reason, time.Now().UTC()); err != nil {
			return err
		}

		var createdAt time.Time
		if err := tx.QueryRow(ctx, `
INSERT INTO handover_override
  (order_id, handover, reason, case_id, actor_account_id, actor_kind,
   wrong_code_attempts, order_state, idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id::text, created_at`,
			orderID, string(kind), in.Reason, in.CaseID, actor.staffID, string(actorKind),
			attempts, string(to), idemKey).Scan(&out.ID, &createdAt); err != nil {
			return fmt.Errorf("insert handover_override: %w", err)
		}
		out = handoverOverrideView{
			ID: out.ID, OrderID: orderID, Handover: string(kind), Reason: in.Reason,
			CaseID: in.CaseID, ActorAccountID: actor.staffID, ActorKind: string(actorKind),
			WrongCodeAttempts: attempts, OrderState: string(to), CreatedAt: httpx.Timestamp(createdAt),
		}

		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      string(ActionOrderHandoverOverride),
			subjectType: "ORDER",
			subjectID:   &orderID,
			outcome:     "SUCCESS",
			reason:      &in.Reason,
			before:      map[string]any{"state": string(from)},
			after: map[string]any{
				"state":                string(to),
				"handover":             string(kind),
				"case_id":              in.CaseID,
				"wrong_code_attempts":  attempts,
				"handover_override_id": out.ID,
			},
		})
	})
	if err != nil {
		return nil, false, err
	}
	return &out, false, nil
}

// overrideByKey finds the record an earlier request with this key wrote.
func (r *OrdersRepo) overrideByKey(ctx context.Context, orderID, actorID, idemKey string) (*handoverOverrideView, error) {
	if idemKey == "" || actorID == "" {
		return nil, nil
	}
	var v handoverOverrideView
	var createdAt time.Time
	err := r.pool.QueryRow(ctx, `
SELECT id::text, order_id::text, handover::text, reason, case_id::text, actor_account_id::text,
       actor_kind::text, wrong_code_attempts, order_state::text, created_at
  FROM handover_override
 WHERE order_id = $1 AND actor_account_id = $2 AND idempotency_key = $3`,
		orderID, actorID, idemKey).Scan(&v.ID, &v.OrderID, &v.Handover, &v.Reason, &v.CaseID,
		&v.ActorAccountID, &v.ActorKind, &v.WrongCodeAttempts, &v.OrderState, &createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find handover override by key: %w", err)
	}
	v.CreatedAt = httpx.Timestamp(createdAt)
	return &v, nil
}
