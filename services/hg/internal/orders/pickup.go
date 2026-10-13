package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// ErrRiderDoesNotHoldOrder is PickUpTx refusing a rider who does not hold the
// order's delivery: the order's dispatch row names another rider, or none, or
// the delivery is over. It is also the answer for an order that does not
// exist, so a caller learns nothing about orders that are not theirs.
var ErrRiderDoesNotHoldOrder = errors.New("orders: the rider does not hold this order's delivery")

// PickUpTx moves an order to PICKED_UP for a rider's confirmed pickup, inside
// the caller's transaction. The dispatch module calls it from the rider's
// PICKED_UP step, so the assignment and the order commit together or not at
// all: a refused order move refuses the pickup as well, and a rider can no
// longer carry food for an order that still says it is being prepared
// (https://github.com/shaiknoorullah/hg-mono/issues/317).
//
// Who: only the rider who holds the order's live delivery, the dispatch row's
// rider while the delivery is assigned and not yet completed. The check is in
// the statement that locks the order and its dispatch row, so the holder
// cannot change between the check and the move; anyone else gets
// ErrRiderDoesNotHoldOrder.
//
// What, by the order's state, through transitionTx, the one function that
// writes order.state (rows of the transition table in
// docs/spec/01-platform.md, "P-14 — Order lifecycle states and transitions"):
//
//   - READY_FOR_PICKUP: the rider picks it up (T12).
//   - PICKED_UP: already there, moved by the handoff seal scan for this same
//     rider; nothing to do, so the rider's own step can catch up without a
//     second transition or event.
//   - any other state, PREPARING included: *IllegalTransitionError naming the
//     order's state, and the caller refuses the pickup. Marking an order ready
//     is the kitchen's step (T10). The rider spec allows a handover before the
//     kitchen taps ready only with the pickup code the kitchen reads out
//     (docs/spec/04-rider.md, "D-20 — Delivery status updates"), and nothing
//     checks that code yet (https://github.com/shaiknoorullah/hg-mono/pull/315),
//     so a rider's word alone never moves an order out of PREPARING
//     (https://github.com/shaiknoorullah/hg-mono/issues/413).
func (s *Store) PickUpTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error {
	var state string
	err := tx.QueryRow(ctx, `
SELECT o.state::text
  FROM "order" o
  JOIN dispatch d ON d.order_id = o.id
 WHERE o.id = $1
   AND d.rider_account_id = $2
   AND d.state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING')
   FOR UPDATE`, orderID, riderAccountID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRiderDoesNotHoldOrder
	}
	if err != nil {
		return fmt.Errorf("lock order and dispatch: %w", err)
	}

	if machine.State(state) == machine.StatePickedUp {
		return nil
	}
	return s.transitionTx(ctx, tx, TransitionRequest{
		OrderID:        orderID,
		To:             machine.StatePickedUp,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider confirmed pickup",
	})
}
