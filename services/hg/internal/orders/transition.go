package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

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

// TransitionInTx is Transition inside a transaction the caller already holds, for
// a change in another module that must commit or roll back together with the
// order's state, such as an admin suspending a restaurant and cancelling its
// unaccepted orders (https://github.com/shaiknoorullah/hg-mono/issues/253). The
// same table, actor and locking rules apply; this function is still the only
// writer of order.state.
func (s *Store) TransitionInTx(ctx context.Context, tx pgx.Tx, req TransitionRequest, effects ...func(pgx.Tx) error) error {
	return s.transitionTx(ctx, tx, req, effects...)
}

func (s *Store) transitionTx(ctx context.Context, tx pgx.Tx, req TransitionRequest, effects ...func(pgx.Tx) error) error {
	var fromStr string
	var acceptedAt *time.Time
	err := tx.QueryRow(ctx, `SELECT state::text, accepted_at FROM "order" WHERE id = $1 FOR UPDATE`,
		req.OrderID).Scan(&fromStr, &acceptedAt)
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

	// Emit a realtime outbox event in the same transaction so the customer's
	// order channel receives a live update. The emitter is optional (nil when
	// the realtime module is not wired, e.g. in unit tests).
	if s.emitter != nil {
		if err := s.emitter.EmitOrderTransition(ctx, tx, req.OrderID, string(req.To)); err != nil {
			return fmt.Errorf("emit order transition: %w", err)
		}
	}

	for _, eff := range effects {
		if err := eff(tx); err != nil {
			return err
		}
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
