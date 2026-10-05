package restaurant

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// The restaurant's order moves. Each runs inside the caller's transaction,
// after the caller's ownership lock, through the orders module's one
// transition function: it checks the move against the transition table, arms
// the next deadline from the deadline table, writes the order_transition row
// and emits the realtime event and notification, all in tx
// (docs/spec/01-platform.md, "P-14 — Order lifecycle states and transitions";
// https://github.com/shaiknoorullah/hg-mono/issues/337). The actor is the
// restaurant, with the acting staff account.

// acceptTx moves RESTAURANT_PENDING → PREPARING. The deadline is accepted_at +
// prepEtaMinutes + 10 minutes (PREP_OVERDUE). effects commit in the same
// transaction, after the state change.
func (r *Repo) acceptTx(ctx context.Context, tx pgx.Tx, orderID, actorAccountID string, prepEtaMinutes int, effects ...func(pgx.Tx) error) error {
	return r.transition(ctx, tx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StatePreparing,
		Actor:          machine.ActorRestaurant,
		ActorAccountID: actorAccountID,
		Reason:         "restaurant accepted",
		PrepEtaMinutes: prepEtaMinutes,
	}, effects...)
}

// rejectTx moves RESTAURANT_PENDING → REJECTED with the restaurant's reason;
// REJECTED is terminal, so the deadline is cleared.
func (r *Repo) rejectTx(ctx context.Context, tx pgx.Tx, orderID, actorAccountID, reason string, note *string) error {
	return r.transition(ctx, tx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateRejected,
		Actor:          machine.ActorRestaurant,
		ActorAccountID: actorAccountID,
		Reason:         "restaurant rejected",
		RejectReason:   &reason,
		RejectNote:     note,
	})
}

// readyTx moves PREPARING → READY_FOR_PICKUP. The deadline and its action
// come from the deadline table the runner handles (PICKUP_OVERDUE, 15
// minutes); a hand-written action once had no handler
// (https://github.com/shaiknoorullah/hg-mono/issues/293).
func (r *Repo) readyTx(ctx context.Context, tx pgx.Tx, orderID, actorAccountID string) error {
	return r.transition(ctx, tx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateReadyForPickup,
		Actor:          machine.ActorRestaurant,
		ActorAccountID: actorAccountID,
		Reason:         "order ready",
	})
}

// transition runs the move and maps the orders module's errors onto this
// package's.
func (r *Repo) transition(ctx context.Context, tx pgx.Tx, req orders.TransitionRequest, effects ...func(pgx.Tx) error) error {
	err := r.orders.TransitionInTx(ctx, tx, req, effects...)
	var illegal *orders.IllegalTransitionError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &illegal):
		return ErrIllegalTransition
	case errors.Is(err, orders.ErrOrderNotFound):
		return ErrNotFound
	}
	return fmt.Errorf("move order to %s: %w", req.To, err)
}
