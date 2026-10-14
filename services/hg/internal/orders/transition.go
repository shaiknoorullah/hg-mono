package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// TransitionRequest is a request to move an order between states through the one
// function that owns every transition (P-14). There is no other writer of
// order.state.
type TransitionRequest struct {
	OrderID        string
	To             machine.State
	Actor          machine.ActorKind
	ActorAccountID string
	Reason         string
	RequestID      string
	// PrepEtaMinutes anchors the PREPARING deadline (accepted_at + prep + 10m).
	PrepEtaMinutes int
	// CancelReason / RejectReason set the reason columns the CHECKs require.
	CancelReason         *string
	CustomerCancelReason *string
	RejectReason         *string
	RejectNote           *string
}

// IllegalTransitionError carries the allowed destinations so the handler can
// render 409 illegal_transition{from,to,allowed}.
type IllegalTransitionError struct {
	From    machine.State
	To      machine.State
	Allowed []machine.State
}

func (e *IllegalTransitionError) Error() string {
	return fmt.Sprintf("illegal_transition from %s to %s", e.From, e.To)
}

// Transition moves an order to a new state inside one transaction: it locks the
// order FOR UPDATE, checks the compile-time table for the pair and the actor,
// rejects illegal pairs, writes the new state, the new deadline (NULL for
// terminal), the state_since and reason columns, and appends exactly one
// order_transition row (I-14.1/2). Money effects (capture, void, settle, refund)
// are the caller's responsibility via effects; this function owns the state.
//
// effects run inside the same transaction after the state write, so a failed
// effect rolls back the transition — there is no state change without its money
// effect and vice versa (I-15.6).
func (s *Store) Transition(ctx context.Context, req TransitionRequest, effects ...func(pgx.Tx) error) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		return s.transitionTx(ctx, tx, req, effects...)
	})
}

// TransitionInTx is Transition inside a transaction the caller already holds.
// It is for a caller that must lock its own rows first and commit its own
// records with the state change: the restaurant's accept, reject and
// mark-ready lock the order under the restaurant's ownership predicate, then
// move it here (https://github.com/shaiknoorullah/hg-mono/issues/337); the
// support override of a handover code locks the assignment, then moves the
// order here, then writes its audit record (contracts/openapi.yaml,
// overrideHandoverCode; https://github.com/shaiknoorullah/hg-mono/issues/310).
// It is the same single function as Transition, not a second writer of
// order.state (docs/spec/01-platform.md, "P-14 — Order lifecycle states and
// transitions"). The caller commits or rolls back tx.
func (s *Store) TransitionInTx(ctx context.Context, tx pgx.Tx, req TransitionRequest, effects ...func(pgx.Tx) error) error {
	return s.transitionTx(ctx, tx, req, effects...)
}

func (s *Store) transitionTx(ctx context.Context, tx pgx.Tx, req TransitionRequest, effects ...func(pgx.Tx) error) error {
	var fromStr, fulfilment string
	var acceptedAt *time.Time
	var instructions []string
	err := tx.QueryRow(ctx, `
		SELECT state::text, accepted_at, fulfilment::text, delivery_instructions::text[]
		  FROM "order" WHERE id = $1 FOR UPDATE`,
		req.OrderID).Scan(&fromStr, &acceptedAt, &fulfilment, &instructions)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOrderNotFound
	}
	if err != nil {
		return fmt.Errorf("lock order: %w", err)
	}
	from := machine.State(fromStr)

	if machine.IsTerminal(from) && !(from == machine.StateCompleted && req.To == machine.StateDisputed) {
		return &IllegalTransitionError{From: from, To: req.To, Allowed: machine.AllowedFrom(from)}
	}

	tr, ok := machine.Lookup(from, req.To)
	if !ok {
		return &IllegalTransitionError{From: from, To: req.To, Allowed: machine.AllowedFrom(from)}
	}
	if !tr.ActorPermitted(req.Actor) {
		return &IllegalTransitionError{From: from, To: req.To, Allowed: machine.AllowedFrom(from)}
	}

	now := time.Now().UTC()

	// Compute the destination deadline. PREPARING anchors on accepted_at.
	var deadlineAt *time.Time
	var deadlineAction *string
	if !machine.IsTerminal(req.To) {
		anchor := now
		prep := req.PrepEtaMinutes
		if req.To == machine.StatePreparing {
			// accepted_at is being set now; anchor on now.
			anchor = now
		}
		d, action, has := machine.ComputeDeadline(req.To, anchor, prep)
		if !has {
			return fmt.Errorf("internal: non-terminal %s has no deadline", req.To)
		}
		deadlineAt = &d
		deadlineAction = &action
	}

	// Timestamp columns per state.
	setClause, args := buildStateUpdate(req, now)
	// args are appended after the fixed leading args.
	query := fmt.Sprintf(`
		UPDATE "order"
		   SET state = $1, state_since = $2, deadline_at = $3, deadline_action = $4,
		       deadline_escalations = 0, lease_until = NULL, lease_owner = NULL%s
		 WHERE id = $%d AND state = $%d`,
		setClause, len(args)+5, len(args)+6)

	full := append([]any{string(req.To), now, deadlineAt, deadlineAction}, args...)
	full = append(full, req.OrderID, string(from))

	ct, err := tx.Exec(ctx, query, full...)
	if err != nil {
		return fmt.Errorf("update state: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// A concurrent transition changed the state under us. The race resolves
		// to a single winner (P-14).
		return &IllegalTransitionError{From: from, To: req.To, Allowed: machine.AllowedFrom(from)}
	}

	fromCopy := from
	if err := insertTransition(ctx, tx, req.OrderID, &fromCopy, req.To, req.Actor, req.ActorAccountID, req.Reason, req.RequestID); err != nil {
		return fmt.Errorf("insert transition: %w", err)
	}

	if err := handoverCodesTx(ctx, tx, req.OrderID, req.To, fulfilment, instructions); err != nil {
		return err
	}

	// The rider who delivered is paid in the same transaction as the
	// delivery, and only by the rider's own DELIVERED transition: no other
	// actor's state change writes earnings, and a failed write rolls the
	// delivery back (https://github.com/shaiknoorullah/hg-mono/issues/306).
	// DELIVERED is reachable once per order, so this runs once.
	if req.To == machine.StateDelivered && req.Actor == machine.ActorRider && s.riderEarnings != nil {
		if err := s.riderEarnings.CreditDeliveryTx(ctx, tx, req.OrderID, req.ActorAccountID); err != nil {
			return fmt.Errorf("rider earnings: %w", err)
		}
	}

	// A cancelled order needs no rider: the dispatch half runs here, in the
	// cancel's transaction, whoever cancelled it.
	if req.To == machine.StateCancelled && s.orderCancelled != nil {
		if err := s.orderCancelled.OrderCancelledTx(ctx, tx, req.OrderID); err != nil {
			return fmt.Errorf("release the cancelled order's rider: %w", err)
		}
	}

	// Emit a realtime outbox event in the same transaction so the customer's
	// tracking, the restaurant's queue and the rider see the change, in the
	// contract's shapes, whoever called this function (events.go; issue #247).
	// The notifier behind s.emitter is optional (nil in unit tests).
	if err := s.emitTransition(ctx, tx, transitionFacts{
		OrderID: req.OrderID, From: &fromCopy, To: req.To, Actor: req.Actor,
		ActorAccountID: req.ActorAccountID, PrepEtaMinutes: req.PrepEtaMinutes,
	}); err != nil {
		return fmt.Errorf("emit order transition: %w", err)
	}

	for _, eff := range effects {
		if err := eff(tx); err != nil {
			return err
		}
	}
	return nil
}

// handoverCodesTx mints and retires the two handover codes as the order moves,
// inside the transition's own transaction, so every path through this one
// function gets them right (contracts/README.md, "Neither code can be
// bypassed"; https://github.com/shaiknoorullah/hg-mono/issues/310):
//
//   - PREPARING (the restaurant accepted): mint the pickup code the kitchen
//     reads to the rider, for an order a rider collects.
//   - PICKED_UP: the pickup code is spent, so delete it; mint the delivery code
//     the customer reads to the rider, for a met handover.
//   - DELIVERED, and every terminal state: delete whatever code is left.
//
// The restaurant's accept moves the order to PREPARING through TransitionInTx,
// so this hook mints its pickup code too; accept mints nothing of its own.
func handoverCodesTx(ctx context.Context, tx pgx.Tx, orderID string, to machine.State, fulfilment string, instructions []string) error {
	switch {
	case to == machine.StatePreparing:
		if fulfilment == "DELIVERY" {
			return handover.MintTx(ctx, tx, orderID, handover.Pickup)
		}
	case to == machine.StatePickedUp:
		if err := handover.RetireTx(ctx, tx, orderID, handover.Pickup); err != nil {
			return err
		}
		if handover.MetHandover(instructions) {
			return handover.MintTx(ctx, tx, orderID, handover.Delivery)
		}
	case to == machine.StateDelivered || machine.IsTerminal(to):
		return handover.RetireTx(ctx, tx, orderID, handover.Pickup, handover.Delivery)
	}
	return nil
}

// buildStateUpdate returns the extra SET clause and args for the timestamp and
// reason columns specific to the destination state.
func buildStateUpdate(req TransitionRequest, now time.Time) (string, []any) {
	clause := ""
	var args []any
	add := func(col string, val any) {
		args = append(args, val)
		clause += fmt.Sprintf(", %s = $%d", col, len(args)+4)
	}
	switch req.To {
	case machine.StateAuthorized:
		add("authorized_at", now)
	case machine.StateRestaurantPending:
		add("offered_at", now)
	case machine.StatePreparing:
		add("accepted_at", now)
	case machine.StateReadyForPickup:
		add("ready_at", now)
	case machine.StatePickedUp:
		add("picked_up_at", now)
	case machine.StateArrived:
		add("arrived_at", now)
	case machine.StateDelivered:
		add("delivered_at", now)
	case machine.StateCompleted:
		add("completed_at", now)
	case machine.StateCancelled:
		add("cancelled_at", now)
		if req.CancelReason != nil {
			add("cancel_reason", *req.CancelReason)
		}
		if req.CustomerCancelReason != nil {
			add("customer_cancel_reason", *req.CustomerCancelReason)
		}
	case machine.StateRejected:
		if req.RejectReason != nil {
			add("reject_reason", *req.RejectReason)
		}
		if req.RejectNote != nil {
			add("reject_note", *req.RejectNote)
		}
	}
	return clause, args
}
