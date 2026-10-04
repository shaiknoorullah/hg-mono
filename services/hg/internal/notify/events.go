package notify

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// OrderEvent is the input every order-lifecycle builder below takes. It is
// deliberately decoupled from the orders package's own Order type — notify
// must not import orders (no cross-module coupling in this isolated build),
// and it must never compute or restate a price or a halal state itself (see
// doc.go and CLAUDE.md invariants 1, 8-10). Callers pass display strings they
// already computed.
type OrderEvent struct {
	OrderID        uuid.UUID
	OrderShortCode string // customer-facing short id, e.g. "HG-2841"
	AccountID      uuid.UUID
	RoleContext    RoleContext
	RestaurantName string
	DeadlineAt     time.Time // the order's own deadline_at (CLAUDE.md invariant 4); zero means none
}

// standardChannels is the failover plan for a normal (non-critical) order
// update: try push first (cheap, fast), fall back to SMS if push does not
// land, and always also write the in-app inbox row.
func standardChannels() []Channel {
	return []Channel{ChannelPush, ChannelSMS, ChannelInApp}
}

func criticalChannels() []Channel {
	return []Channel{ChannelPush, ChannelSMS, ChannelInApp}
}

func withDeadline(n New, deadline time.Time, mustReach bool) New {
	n.MustReach = mustReach
	if mustReach {
		if deadline.IsZero() {
			deadline = time.Now().Add(10 * time.Minute)
		}
		n.DeadlineAt = deadline
	}
	return n
}

// NotifyOrderPlaced tells the restaurant a new order needs a response.
// must_reach: yes — an order that nobody at the restaurant sees is exactly
// the "waits forever" state CLAUDE.md invariant 4 makes unrepresentable at
// the order layer; the notification layer must not silently drop the alert
// that keeps a human inside that deadline.
func NotifyOrderPlaced(e OrderEvent) New {
	n := New{
		AccountID:   e.AccountID,
		RoleContext: RoleRestaurant,
		Kind:        KindOrderPlaced,
		Title:       "New order",
		Body:        fmt.Sprintf("Order %s needs your response.", e.OrderShortCode),
		Priority:    PriorityCritical,
		Channels:    criticalChannels(),
		DedupeKey:   "order_placed:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
	return withDeadline(n, e.DeadlineAt, true)
}

// NotifyOrderAccepted tells the customer their order was accepted.
func NotifyOrderAccepted(e OrderEvent) New {
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderAccepted,
		Title:       "Order accepted",
		Body:        fmt.Sprintf("%s accepted your order %s and is preparing it.", e.RestaurantName, e.OrderShortCode),
		Priority:    PriorityHigh,
		Channels:    standardChannels(),
		DedupeKey:   "order_accepted:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyOrderRejected tells the customer their order was rejected. The
// authorisation is void, not refunded (CLAUDE.md invariant 5) — this
// notification does not claim a refund; the payments module's own
// notification (if any) owns that language.
func NotifyOrderRejected(e OrderEvent, reason string) New {
	body := fmt.Sprintf("%s was unable to accept order %s.", e.RestaurantName, e.OrderShortCode)
	if reason != "" {
		body = fmt.Sprintf("%s Reason: %s.", body, reason)
	}
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderRejected,
		Title:       "Order not accepted",
		Body:        body,
		Priority:    PriorityHigh,
		Channels:    standardChannels(),
		DedupeKey:   "order_rejected:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyOrderReady tells the assigned rider the order is ready for pickup.
func NotifyOrderReady(e OrderEvent) New {
	n := New{
		AccountID:   e.AccountID,
		RoleContext: RoleRider,
		Kind:        KindOrderReady,
		Title:       "Order ready for pickup",
		Body:        fmt.Sprintf("Order %s is ready at %s.", e.OrderShortCode, e.RestaurantName),
		Priority:    PriorityCritical,
		Channels:    criticalChannels(),
		DedupeKey:   "order_ready:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
	return withDeadline(n, e.DeadlineAt, true)
}

// NotifyRiderAssigned tells the customer a rider is on the way.
func NotifyRiderAssigned(e OrderEvent) New {
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindRiderAssigned,
		Title:       "Rider assigned",
		Body:        fmt.Sprintf("A rider has been assigned to order %s.", e.OrderShortCode),
		Priority:    PriorityNormal,
		Channels:    standardChannels(),
		DedupeKey:   "rider_assigned:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyOrderPickedUp tells the customer their order is out for delivery.
func NotifyOrderPickedUp(e OrderEvent) New {
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderPickedUp,
		Title:       "Order picked up",
		Body:        fmt.Sprintf("Your order %s is on its way.", e.OrderShortCode),
		Priority:    PriorityNormal,
		Channels:    standardChannels(),
		DedupeKey:   "order_picked_up:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyOrderDelivered tells the customer their order has arrived.
func NotifyOrderDelivered(e OrderEvent) New {
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderDelivered,
		Title:       "Order delivered",
		Body:        fmt.Sprintf("Your order %s has been delivered. Enjoy!", e.OrderShortCode),
		Priority:    PriorityNormal,
		Channels:    standardChannels(),
		DedupeKey:   "order_delivered:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyOrderCancelled tells the customer their order was cancelled.
//
// PLATFORM_ERROR gets its own wording because it is the outage notice: the
// deadline runner cancels an order that was not yet accepted with this reason
// when its deadline fell while the platform was down
// (internal/orders/runner_outage.go). The customer is told it was our fault,
// not the restaurant's.
func NotifyOrderCancelled(e OrderEvent, reason string) New {
	body := fmt.Sprintf("Order %s was cancelled.", e.OrderShortCode)
	if reason == "PLATFORM_ERROR" {
		body = fmt.Sprintf("Order %s was cancelled because of a technical problem on our side, "+
			"not the restaurant's. Sorry about that.", e.OrderShortCode)
	} else if reason != "" {
		body = fmt.Sprintf("%s Reason: %s.", body, reason)
	}
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderCancelled,
		Title:       "Order cancelled",
		Body:        body,
		Priority:    PriorityHigh,
		Channels:    standardChannels(),
		DedupeKey:   "order_cancelled:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyPaymentCaptureFailed alerts the customer that capture failed after
// restaurant acceptance (CLAUDE.md invariant 5: authorise then capture on
// accept — this is that capture's failure path, distinct from a reject/
// timeout void, which never enqueues this notification).
func NotifyPaymentCaptureFailed(e OrderEvent) New {
	n := New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindPaymentCaptureFailed,
		Title:       "Payment issue with your order",
		Body:        fmt.Sprintf("We couldn't complete payment for order %s. Please check your payment method.", e.OrderShortCode),
		Priority:    PriorityCritical,
		Channels:    criticalChannels(),
		DedupeKey:   "payment_capture_failed:" + e.OrderID.String(),
		GroupKey:    "order:" + e.OrderID.String(),
		OrderID:     uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
	return withDeadline(n, e.DeadlineAt, true)
}
