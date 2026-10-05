package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The two ways a ready order used to get stuck, bridged between modules here:
// the rider's pickup moves the order inside the dispatch step's transaction
// (https://github.com/shaiknoorullah/hg-mono/issues/317), and a lapsed pickup
// deadline is escalated instead of failing on every pass
// (https://github.com/shaiknoorullah/hg-mono/issues/293).

// ConfirmPickupTx implements dispatch.OrderLifecycle: the order moves to
// PICKED_UP in the rider's step's own transaction (orders.Store.PickUpTx). An
// order in a state the pickup cannot move it out of comes back as
// dispatch.OrderNotCollectableError, and a rider who does not hold the
// order's delivery as dispatch.ErrRiderDoesNotHoldOrder; both refuse the step.
func (a *orderLifecycleAdapter) ConfirmPickupTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error {
	err := a.store.PickUpTx(ctx, tx, orderID, riderAccountID)
	var illegal *orders.IllegalTransitionError
	switch {
	case errors.As(err, &illegal):
		return &dispatch.OrderNotCollectableError{OrderState: string(illegal.From)}
	case errors.Is(err, orders.ErrRiderDoesNotHoldOrder):
		return dispatch.ErrRiderDoesNotHoldOrder
	}
	return err
}

// pickupEscalator implements orders.PickupEscalator: what happens each time a
// ready order's pickup deadline lapses with nobody collecting it
// (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions", the
// READY_FOR_PICKUP row). It runs inside the deadline runner's transaction, so
// all three effects commit with the audit row and the re-armed deadline, once
// per lapse:
//
//  1. Re-dispatch. A search that ended with no rider found is re-opened
//     (dispatch.ResumeSearchTx); a running search or an assigned rider is left
//     alone.
//  2. Alert ops: an admin.alert on admin:ops (contracts/websocket.md, "Admin —
//     channel admin:ops"), critical from the escalation cap on, when the order
//     needs a person (https://github.com/shaiknoorullah/hg-mono/issues/336).
//  3. Tell the customer (notify.NotifyPickupDelayed).
type pickupEscalator struct {
	notify *notify.Enqueuer // nil skips the customer notice, as orderRealtimeEmitter does
}

func (p *pickupEscalator) EscalatePickup(ctx context.Context, tx pgx.Tx, e orders.PickupEscalation) error {
	search, err := dispatch.ResumeSearchTx(ctx, tx, e.OrderID)
	if err != nil {
		return err
	}

	var code, restaurantName string
	var accountID uuid.UUID
	if err := tx.QueryRow(ctx, `
		SELECT o.code, o.account_id, r.display_name
		  FROM "order" o JOIN restaurant r ON r.id = o.restaurant_id
		 WHERE o.id = $1`, e.OrderID).Scan(&code, &accountID, &restaurantName); err != nil {
		return fmt.Errorf("load order %s for the pickup escalation: %w", e.OrderID, err)
	}

	if err := alertPickupOverdue(ctx, tx, e, code, search); err != nil {
		return err
	}
	if p.notify == nil {
		return nil
	}
	oid, err := uuid.Parse(e.OrderID)
	if err != nil {
		return fmt.Errorf("parse order id %q: %w", e.OrderID, err)
	}
	spec, _ := machine.DeadlineFor(machine.StateReadyForPickup)
	_, err = p.notify.Enqueue(ctx, tx, notify.NotifyPickupDelayed(notify.OrderEvent{
		OrderID:        oid,
		OrderShortCode: code,
		AccountID:      accountID,
		RestaurantName: restaurantName,
	}, e.Lapse, spec.ReArm))
	return err
}

// alertPickupOverdue writes the admin.alert for one lapse. It names the order
// and what dispatch found, never the customer.
func alertPickupOverdue(ctx context.Context, tx pgx.Tx, e orders.PickupEscalation, code string, search dispatch.SearchStatus) error {
	var found string
	switch search {
	case dispatch.SearchReopened:
		found = "The search had found no rider; it has been re-opened."
	case dispatch.SearchAssigned:
		found = "A rider is assigned but has not picked it up."
	case dispatch.SearchNotStarted:
		found = "No search for a rider has started yet."
	default:
		found = "Dispatch is still searching for a rider."
	}
	severity := "WARNING"
	message := fmt.Sprintf("Order %s is ready and has not been picked up (lapse %d). %s", code, e.Lapse, found)
	if e.CapReached {
		severity = "CRITICAL"
		message += " The escalation cap is reached but a rider holds the order, so it is not cancelled " +
			"automatically: reach the rider, or reassign or cancel the order."
	}
	payload, err := json.Marshal(map[string]any{
		"severity":     severity,
		"kind":         machine.ActionPickupOverdue,
		"subject_type": "ORDER",
		"subject_id":   e.OrderID,
		"message":      message,
		"at":           httpx.Timestamp(time.Now()),
	})
	if err != nil {
		return err
	}
	oid := e.OrderID
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.AdminOpsChannel, "admin.alert", 1, nil, payload, &oid, nil); err != nil {
		return fmt.Errorf("alert ops about the pickup: %w", err)
	}
	return nil
}

// uncollectedCanceller implements orders.UncollectedCanceller: at the pickup
// escalation cap, a ready order no rider holds is cancelled with a full refund
// (https://github.com/shaiknoorullah/hg-mono/issues/336). In the deadline
// runner's transaction, before the order moves to CANCELLED, it closes the
// search for a rider (dispatch.EndSearchTx), posts the refund the platform
// absorbs (payments.RefundSystemCancelTx) and tells ops. The customer and the
// restaurant hear of it from the cancellation itself: order.cancelled, with
// the refund, and the customer's ORDER_CANCELLED notice.
type uncollectedCanceller struct{}

func (uncollectedCanceller) CancelUncollectedTx(ctx context.Context, tx pgx.Tx, orderID string) (bool, error) {
	ended, err := dispatch.EndSearchTx(ctx, tx, orderID)
	if err != nil || !ended {
		return false, err
	}
	if err := payments.RefundSystemCancelTx(ctx, tx, orderID, "NO_RIDER_FOUND",
		"No rider collected the order by the pickup escalation cap; cancelled and refunded in full."); err != nil {
		return false, err
	}
	var code string
	if err := tx.QueryRow(ctx, `SELECT code FROM "order" WHERE id = $1`, orderID).Scan(&code); err != nil {
		return false, fmt.Errorf("load order %s for the cancel alert: %w", orderID, err)
	}
	payload, err := json.Marshal(map[string]any{
		"severity":     "WARNING",
		"kind":         machine.ActionPickupOverdue,
		"subject_type": "ORDER",
		"subject_id":   orderID,
		"message": fmt.Sprintf("Order %s was never collected: no rider by the escalation cap. "+
			"It is cancelled, the customer is refunded in full and the restaurant is paid.", code),
		"at": httpx.Timestamp(time.Now()),
	})
	if err != nil {
		return false, err
	}
	oid := orderID
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.AdminOpsChannel, "admin.alert", 1, nil, payload, &oid, nil); err != nil {
		return false, fmt.Errorf("alert ops about the cancel: %w", err)
	}
	return true, nil
}
