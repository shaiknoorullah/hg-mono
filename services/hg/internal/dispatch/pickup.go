package dispatch

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// The rider's PICKED_UP step and the order's move to PICKED_UP commit in one
// transaction (https://github.com/shaiknoorullah/hg-mono/issues/317). Before,
// the assignment committed first and the order was asked afterwards; when the
// kitchen had not tapped ready yet, the orders module refused, the refusal was
// only logged, and the rider carried food for an order that still said it was
// being prepared. Now the order moves inside the step's transaction, and a
// refused order move refuses the pickup: the assignment stays where it was.

// OrderNotCollectableError is what OrderLifecycle.ConfirmPickupTx returns when
// the order is in a state a rider's pickup cannot move it out of: still being
// prepared, cancelled, disputed, not yet accepted. The pickup is refused with 409
// INVALID_TRANSITION, the contract's answer for a step that is not allowed
// (contracts/openapi.yaml, createAssignmentTransition).
type OrderNotCollectableError struct {
	OrderState string
}

func (e *OrderNotCollectableError) Error() string {
	return fmt.Sprintf("the order cannot be picked up in state %s", e.OrderState)
}

// ErrRiderDoesNotHoldOrder is what OrderLifecycle.ConfirmPickupTx returns
// when the rider does not hold the order's delivery: the order's dispatch row
// names another rider, or none. The orders module checks it in the statement
// that locks the order, so the step is refused even if the assignment row
// says otherwise. The rider gets the same 404 as for an assignment that is not
// theirs (pickupRefusal).
var ErrRiderDoesNotHoldOrder = errors.New("dispatch: the rider does not hold this order's delivery")

// pickupStep moves the order for a PICKED_UP step inside the step's
// transaction. It is nil when the service has no OrderLifecycle wired.
type pickupStep func(ctx context.Context, tx pgx.Tx, orderID string) error

// pickupStepFor binds the service's OrderLifecycle to one rider's step.
func (s *Service) pickupStepFor(riderAccountID string) pickupStep {
	if s.lifecycle == nil {
		return nil
	}
	return func(ctx context.Context, tx pgx.Tx, orderID string) error {
		return s.lifecycle.ConfirmPickupTx(ctx, tx, orderID, riderAccountID)
	}
}

// pickupRefusal turns a refused order move into the rider's answer. The
// assignment's state is the contract's details.current_state; the order's
// state is named in the message, in words the rider app can show.
func pickupRefusal(err error, assignmentState string) error {
	if errors.Is(err, ErrRiderDoesNotHoldOrder) {
		return errAssignmentNotFound
	}
	var nc *OrderNotCollectableError
	if !errors.As(err, &nc) {
		return err
	}
	return newError(http.StatusConflict, CodeInvalidTransition,
		fmt.Sprintf("This order can't be picked up: it is %s.", orderStateWords(nc.OrderState)),
		map[string]any{"current_state": assignmentState})
}

// orderStateWords names an order state a pickup is refused in.
func orderStateWords(state string) string {
	switch state {
	case "PREPARING":
		return "still being prepared; wait for the kitchen to mark it ready"
	case "CANCELLED":
		return "cancelled"
	case "REJECTED":
		return "rejected by the restaurant"
	case "DISPUTED":
		return "with support"
	case "CREATED", "AUTHORIZED", "RESTAURANT_PENDING":
		return "not yet accepted by the restaurant"
	default:
		return "no longer waiting for pickup"
	}
}
