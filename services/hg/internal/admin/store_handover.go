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

var (
	// errIdempotencyKeyReuse is a retry key sent again with a different body.
	errIdempotencyKeyReuse = errors.New("idempotency key reused with a different body")
	// errStaffNotActive: the caller's staff profile or account is not ACTIVE
	// (suspended, deactivated, or an invitation never accepted), though the
	// session's token still names a staff role.
	errStaffNotActive = errors.New("staff account is not active")
	// errStaffRoleRevoked: the caller no longer holds a support or admin grant,
	// though the session's token still names one.
	errStaffRoleRevoked = errors.New("staff role no longer granted")
	// errPartyToOrder: the caller is the order's customer, one of its riders, or
	// staff of its restaurant.
	errPartyToOrder = errors.New("the caller is a party to the order")
)

// OverrideHandover confirms a pickup or a met handover without its code, for
// overrideHandoverCode (contracts/openapi.yaml;
// https://github.com/shaiknoorullah/hg-mono/issues/310). In one transaction:
//
//  1. Check the caller is still staff (overrideActorTx): the role and the
//     staff account are read from Postgres, not trusted from the token or from
//     actor.roles. The actor kind and the roles the audit row names come from
//     the live grant.
//  2. Lock the order's live assignment, then the order: the lock order every
//     handover-code path uses, so this cannot deadlock with a rider's attempt.
//  3. Refuse a caller who is a party to the order (partyToOrderTx).
//  4. A retry of the request that wrote the record (same actor, order and
//     Idempotency-Key) gets the record back with replayed = true; the same key
//     with a different body is errIdempotencyKeyReuse. This runs under the
//     order's lock, so a retry racing the first request waits for it and then
//     finds its record.
//  5. Check the order is waiting on this handover: PICKUP needs the order
//     READY_FOR_PICKUP and the rider at the counter (ARRIVED_AT_PICKUP);
//     DELIVERY needs the order PICKED_UP or ARRIVED, a met handover, and the
//     rider at the drop-off (ARRIVED_AT_DROPOFF). Anything else is
//     *orders.IllegalTransitionError and nothing is written.
//  6. Move the order through the single Transition function, with the actor
//     SUPPORT or ADMIN and the reason on the timeline. That function also
//     retires the code, so no later attempt can use it, and sends the usual
//     order.state_changed event.
//  7. Move the assignment the same way (dispatch.SupportConfirmTx), whose
//     UPDATE carries the preconditions in its WHERE clause, so it moves only
//     this order's live assignment at the counter or the door. The order's
//     own UPDATE likewise names the state it moves from (internal/orders).
//  8. Write the append-only handover_override record and the hash-chained
//     audit_event, both naming the proven actor and the reason. Neither holds
//     a code.
//
// A second override of a handover that already happened is an
// IllegalTransitionError, and the UNIQUE (order_id, handover) constraint backs
// that up.
func (r *OrdersRepo) OverrideHandover(ctx context.Context, actor auditActor,
	orderID string, kind handover.Kind, in handoverOverrideInput, idemKey string) (rec *handoverOverrideView, replayed bool, err error) {

	to := machine.StatePickedUp
	if kind == handover.Delivery {
		to = machine.StateDelivered
	}

	var out handoverOverrideView
	err = r.inTx(ctx, func(tx pgx.Tx) error {
		actorKind, liveRoles, err := overrideActorTx(ctx, tx, actor.staffID)
		if err != nil {
			return err
		}
		// The audit row names the roles proven in this transaction, not the
		// ones the session's token claimed.
		actor.roles = liveRoles
		asn, err := dispatch.LockLiveAssignmentTx(ctx, tx, orderID)
		if err != nil {
			return err
		}
		var state, restaurantID string
		var customerID *string
		err = tx.QueryRow(ctx, `SELECT state::text, account_id::text, restaurant_id::text FROM "order" WHERE id = $1 FOR UPDATE`,
			orderID).Scan(&state, &customerID, &restaurantID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if err := partyToOrderTx(ctx, tx, actor.staffID, orderID, restaurantID, customerID); err != nil {
			return err
		}

		prior, err := overrideByKey(ctx, tx, orderID, actor.staffID, idemKey)
		if err != nil {
			return err
		}
		if prior != nil {
			if prior.Handover != string(kind) || prior.Reason != in.Reason || prior.CaseID != in.CaseID {
				return errIdempotencyKeyReuse
			}
			out, replayed = *prior, true
			return nil
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
		if err := dispatch.SupportConfirmTx(ctx, tx, orderID, asn, kind, string(actorKind), actor.staffID, in.Reason, time.Now().UTC()); err != nil {
			if errors.Is(err, dispatch.ErrNotAwaitingHandover) {
				return &orders.IllegalTransitionError{From: from, To: to, Allowed: machine.AllowedFrom(from)}
			}
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
	return &out, replayed, nil
}

// overrideActorTx checks, inside the override's transaction, that the caller
// is still staff who may confirm a handover, and returns the actor kind the
// record and the timeline carry (ADMIN for a live ADMIN or SUPER_ADMIN grant,
// SUPPORT for SUPPORT_AGENT) and the live staff grants the audit row names.
//
// The session's token is not enough on its own. It names the roles the account
// held when it was issued and stays valid until it expires, and the revocation
// list it is checked against is held in each replica's memory and knows only
// account-level suspensions (internal/session, DenySet). A staff member's role
// change takes effect on their next request
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-01--staff-account-provisioning),
// and suspending or deactivating a staff member ends their sessions
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-03--staff-authentication-mfa-and-session-policy),
// so both are read from Postgres here. The account and staff_profile rows are
// held FOR SHARE, so a suspension waits for the override to commit rather than
// racing it.
//
// An account with a staff grant but no staff_profile row is allowed: today
// only seeds and `make dev-admin` create one, with no profile, and the API
// cannot (createStaffUser always writes the profile). Whether a profile should
// be required is an open question on
// https://github.com/shaiknoorullah/hg-mono/pull/315.
func overrideActorTx(ctx context.Context, tx pgx.Tx, accountID string) (machine.ActorKind, []string, error) {
	if !isUUID(accountID) {
		// No proven caller: never recorded as a SYSTEM override.
		return "", nil, errStaffNotActive
	}
	var accountStatus string
	err := tx.QueryRow(ctx, `SELECT status::text FROM account WHERE id = $1 FOR SHARE`, accountID).Scan(&accountStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, errStaffNotActive
	}
	if err != nil {
		return "", nil, fmt.Errorf("read the caller's account: %w", err)
	}
	if accountStatus != "ACTIVE" {
		return "", nil, errStaffNotActive
	}
	// A soft-deleted profile counts as deactivated.
	var staffStatus string
	var deleted bool
	err = tx.QueryRow(ctx, `SELECT status::text, deleted_at IS NOT NULL FROM staff_profile WHERE account_id = $1 FOR SHARE`,
		accountID).Scan(&staffStatus, &deleted)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// No profile: see above.
	case err != nil:
		return "", nil, fmt.Errorf("read the caller's staff profile: %w", err)
	case staffStatus != "ACTIVE" || deleted:
		return "", nil, errStaffNotActive
	}

	var roles []string
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(array_agg(role::text ORDER BY role::text), '{}')
  FROM account_role
 WHERE account_id = $1 AND scope_type = 'GLOBAL' AND revoked_at IS NULL
   AND role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')`, accountID).Scan(&roles); err != nil {
		return "", nil, fmt.Errorf("read the caller's staff roles: %w", err)
	}
	if len(roles) == 0 {
		return "", nil, errStaffRoleRevoked
	}
	for _, role := range roles {
		if role == "ADMIN" || role == "SUPER_ADMIN" {
			return machine.ActorAdmin, roles, nil
		}
	}
	return machine.ActorSupport, roles, nil
}

// partyToOrderTx refuses a caller who is a party to the order: its customer,
// any rider it was ever assigned to, or staff of its restaurant (a live
// restaurant-scoped grant). One person is one account whatever roles it holds
// (contracts/openapi.yaml, Role), so any of them can also be support or an
// admin. The override is support confirming a handover "after checking with
// the people involved" (contracts/openapi.yaml, overrideHandoverCode), so the
// one who confirms is never one of them; above all the rider, who has no
// override of their own (contracts/README.md, "Neither code can be
// bypassed").
func partyToOrderTx(ctx context.Context, tx pgx.Tx, accountID, orderID, restaurantID string, customerID *string) error {
	if customerID != nil && *customerID == accountID {
		return errPartyToOrder
	}
	var party bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM assignment WHERE order_id = $1 AND rider_account_id = $2)
    OR EXISTS (SELECT 1 FROM account_role
                WHERE account_id = $2 AND scope_type = 'RESTAURANT' AND scope_id = $3
                  AND revoked_at IS NULL)`, orderID, accountID, restaurantID).Scan(&party); err != nil {
		return fmt.Errorf("check the caller is not a party to the order: %w", err)
	}
	if party {
		return errPartyToOrder
	}
	return nil
}

// overrideByKey finds the record an earlier request with this key wrote.
func overrideByKey(ctx context.Context, tx pgx.Tx, orderID, actorID, idemKey string) (*handoverOverrideView, error) {
	if idemKey == "" || actorID == "" {
		return nil, nil
	}
	var v handoverOverrideView
	var createdAt time.Time
	err := tx.QueryRow(ctx, `
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
