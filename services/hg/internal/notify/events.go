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

// NotifyPickupDelayed tells the customer their ready order has waited too long
// for pickup, and when they will hear next. The deadline runner sends it on
// every lapse of the order's pickup deadline, so the dedupe key carries the
// lapse: one notice per lapse, however often the lapse is retried. It follows
// the no-rider notice in docs/spec/04-rider.md, "D-15 — Offer expiry, wave
// escalation, and the no-rider-found path", in words that also fit a rider
// who is assigned but late. Whether the customer is offered to collect the
// order is still open (docs/spec/01-platform.md, "P-15 — Deadlines and
// timeout actions"; https://github.com/shaiknoorullah/hg-mono/issues/336), so
// it offers nothing.
func NotifyPickupDelayed(e OrderEvent, lapse int, nextUpdateWithin time.Duration) New {
	minutes := int(nextUpdateWithin / time.Minute)
	if minutes < 1 {
		minutes = 1
	}
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderPickupDelayed,
		Title:       "Your order is waiting for pickup",
		Body: fmt.Sprintf("Order %s is ready at %s, but its pickup is running late. We're on it, "+
			"and you'll hear from us again within %d minutes.", e.OrderShortCode, e.RestaurantName, minutes),
		Priority:  PriorityHigh,
		Channels:  standardChannels(),
		DedupeKey: fmt.Sprintf("order_pickup_delayed:%s:%d", e.OrderID, lapse),
		GroupKey:  "order:" + e.OrderID.String(),
		OrderID:   uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
}

// NotifyPrepDelayed tells the customer the restaurant added time to their
// order's preparation. Every delay notifies the customer; the restaurant
// cannot delay silently (docs/spec/03-restaurant.md, "R-26 — Delay handling
// and rider communication", rule 3). delayNo is the order's delay count from
// 1, so each delay is one notice however often its enqueue is retried.
func NotifyPrepDelayed(e OrderEvent, delayNo, addedMinutes int) New {
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderPrepDelayed,
		Title:       "Your order is running late",
		Body: fmt.Sprintf("%s needs about %d more minutes to prepare order %s.",
			e.RestaurantName, addedMinutes, e.OrderShortCode),
		Priority:  PriorityHigh,
		Channels:  standardChannels(),
		DedupeKey: fmt.Sprintf("order_prep_delayed:%s:%d", e.OrderID, delayNo),
		GroupKey:  "order:" + e.OrderID.String(),
		OrderID:   uuid.NullUUID{UUID: e.OrderID, Valid: true},
	}
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
func NotifyOrderCancelled(e OrderEvent, reason string) New {
	body := fmt.Sprintf("Order %s was cancelled.", e.OrderShortCode)
	if reason != "" {
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

// RefundEvent is the input of the refund builders. Like OrderEvent it carries
// display strings the caller already has; it never restates an amount.
type RefundEvent struct {
	RefundID       string
	OrderID        uuid.UUID
	OrderShortCode string
	AccountID      uuid.UUID // the customer who asked for the refund
}

// NotifyRefundDeclined tells a customer that staff declined their refund
// request (https://github.com/shaiknoorullah/hg-mono/issues/172). message is
// what staff chose to tell them; when it is empty they get a plain sentence.
// The staff reason for the decline is never sent: it is internal.
func NotifyRefundDeclined(e RefundEvent, message string) New {
	body := fmt.Sprintf("We reviewed your refund request for order %s and could not approve it. "+
		"Contact support if you have questions.", e.OrderShortCode)
	if message != "" {
		body = fmt.Sprintf("Your refund request for order %s was not approved: %s", e.OrderShortCode, message)
	}
	return New{
		AccountID:   e.AccountID,
		RoleContext: RoleCustomer,
		Kind:        KindRefundDeclined,
		Title:       "Refund request not approved",
		Body:        body,
		Priority:    PriorityNormal,
		Channels:    standardChannels(),
		DedupeKey:   "refund_declined:" + e.RefundID,
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
