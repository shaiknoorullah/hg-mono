package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// PickUpTx moves an order to PICKED_UP for a rider's confirmed pickup, inside
// the caller's transaction. The dispatch module calls it from the rider's
// PICKED_UP step, so the assignment and the order commit together or not at
// all: a refused order move refuses the pickup as well, and a rider can no
// longer carry food for an order that still says it is being prepared
// (https://github.com/shaiknoorullah/hg-mono/issues/317).
//
// Every move goes through transitionTx, the one function that writes
// order.state, and leaves its own order_transition row; the rows named below
// are the transition table in docs/spec/01-platform.md, "P-14 — Order
// lifecycle states and transitions".
//
//   - READY_FOR_PICKUP: the rider picks it up (T12).
//   - PREPARING: the kitchen handed the food over before tapping ready. The
//     confirmed pickup at the counter is the evidence (the pickup code the
//     kitchen reads out, once https://github.com/shaiknoorullah/hg-mono/pull/315
//     lands; that check refuses a wrong code before this function runs). The
//     system marks the order ready on the kitchen's behalf (T10, actor SYSTEM,
//     so the timeline shows it was automatic), then the rider picks it up
//     (T12), in this one transaction.
//   - PICKED_UP: already there; nothing to do.
//   - any other state: *IllegalTransitionError naming the order's state. The
//     caller refuses the pickup: a cancelled, disputed or not-yet-accepted order
//     is never collected.
func (s *Store) PickUpTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error {
	var state string
	err := tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id = $1 FOR UPDATE`, orderID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrOrderNotFound
	}
	if err != nil {
		return fmt.Errorf("lock order: %w", err)
	}

	switch machine.State(state) {
	case machine.StatePickedUp:
		return nil
	case machine.StatePreparing:
		if err := s.transitionTx(ctx, tx, TransitionRequest{
			OrderID: orderID,
			To:      machine.StateReadyForPickup,
			Actor:   machine.ActorSystem,
			Reason:  "kitchen handed the order to the rider before marking it ready",
		}); err != nil {
			return err
		}
	}
	return s.transitionTx(ctx, tx, TransitionRequest{
		OrderID:        orderID,
		To:             machine.StatePickedUp,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider confirmed pickup",
	})
}
