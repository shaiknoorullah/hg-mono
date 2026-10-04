package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The realtime events an order's state change produces
// (https://github.com/shaiknoorullah/hg-mono/issues/247). They are written
// here, inside the transaction that moves the order — every path through
// transitionTx and the order's creation — so no caller can move an order
// without the customer's tracking screen, the restaurant's queue and the
// rider hearing about it, and a rolled-back transition leaves no event
// (contracts/websocket.md section 6.1, "Publish path — the transactional
// outbox").
//
// Per state change:
//
//   - every change: order.state_changed on order:{id};
//   - creation: order.created first;
//   - AUTHORIZED: payment.authorized, when the payment intent is recorded;
//   - RESTAURANT_PENDING: restaurant.order_offered on restaurant:{id};
//   - RESTAURANT_PENDING to PREPARING: restaurant.order_accepted;
//   - RESTAURANT_PENDING to REJECTED: restaurant.order_rejected;
//   - CANCELLED: order.cancelled, and from RESTAURANT_PENDING the restaurant's
//     restaurant.order_offer_expired (the 180-second timeout) or
//     restaurant.order_offer_withdrawn (the customer cancelled, or payment
//     failed), so the offer leaves every tablet;
//   - COMPLETED: order.completed.
//
// Who receives which field is decided at send time by the realtime catalogue
// (internal/realtime/catalogue.go), not here.

// transitionFacts is what the transition knows that the order row does not.
type transitionFacts struct {
	OrderID        string
	From           *machine.State // nil for the order's creation
	To             machine.State
	Actor          machine.ActorKind
	ActorAccountID string
	PrepEtaMinutes int
}

// emitTransition writes the realtime events for a transition, then hands the
// change to the optional notifier (EventEmitter), all inside tx.
func (s *Store) emitTransition(ctx context.Context, tx pgx.Tx, f transitionFacts) error {
	if err := emitOrderEvents(ctx, tx, f); err != nil {
		return err
	}
	if s.emitter != nil {
		return s.emitter.EmitOrderTransition(ctx, tx, f.OrderID, string(f.To))
	}
	return nil
}

// orderFacts is the order row as the transaction sees it after the change.
type orderFacts struct {
	code           string
	restaurantID   string
	restaurantName string
	stateSince     time.Time
	deadlineAt     *time.Time
	etaAt          *time.Time
	cancelReason   *string
	rejectReason   *string
	totalCents     int64
	subtotalCents  int64
	currency       string
	placedAt       time.Time
	deliveredAt    *time.Time
	fulfilment     string
	prepEtaMinutes *int
	avgPrepMinutes int
	firstName      string
}

func loadOrderFacts(ctx context.Context, tx pgx.Tx, orderID string) (orderFacts, error) {
	var o orderFacts
	err := tx.QueryRow(ctx, `
		SELECT o.code, o.restaurant_id::text, r.display_name, o.state_since, o.deadline_at, o.eta_at,
		       o.cancel_reason::text, o.reject_reason::text, o.total_cents, o.subtotal_cents,
		       o.currency::text, o.placed_at, o.delivered_at, o.fulfilment::text,
		       o.prep_eta_minutes, r.avg_prep_minutes, COALESCE(cp.first_name, '')
		  FROM "order" o
		  JOIN restaurant r ON r.id = o.restaurant_id
		  LEFT JOIN customer_profile cp ON cp.account_id = o.account_id
		 WHERE o.id = $1`, orderID).Scan(
		&o.code, &o.restaurantID, &o.restaurantName, &o.stateSince, &o.deadlineAt, &o.etaAt,
		&o.cancelReason, &o.rejectReason, &o.totalCents, &o.subtotalCents,
		&o.currency, &o.placedAt, &o.deliveredAt, &o.fulfilment,
		&o.prepEtaMinutes, &o.avgPrepMinutes, &o.firstName)
	if err != nil {
		return o, fmt.Errorf("load order for events: %w", err)
	}
	return o, nil
}

// emitOrderEvents writes every event one state change produces.
func emitOrderEvents(ctx context.Context, tx pgx.Tx, f transitionFacts) error {
	o, err := loadOrderFacts(ctx, tx, f.OrderID)
	if err != nil {
		return err
	}
	to := contract.OrderState(f.To)

	if f.From == nil {
		if o.deadlineAt == nil {
			return fmt.Errorf("order %s was created without a deadline", f.OrderID)
		}
		if err := realtime.EmitOrder(ctx, tx, f.OrderID, realtime.OrderCreated{
			OrderID: f.OrderID, Code: o.code, State: to,
			Restaurant: realtime.RestaurantRef{ID: o.restaurantID, Name: o.restaurantName},
			TotalCents: o.totalCents, Currency: o.currency,
			PlacedAt: realtime.At(o.placedAt), DeadlineAt: realtime.At(*o.deadlineAt),
		}); err != nil {
			return err
		}
	}

	var from *contract.OrderState
	if f.From != nil {
		v := contract.OrderState(*f.From)
		from = &v
	}
	if err := realtime.EmitOrder(ctx, tx, f.OrderID, realtime.OrderStateChanged{
		OrderID: f.OrderID, From: from, To: to,
		At:         realtime.At(o.stateSince),
		Reason:     stateReason(f.To, o),
		ActorKind:  contract.OrderActorKind(f.Actor),
		DeadlineAt: realtime.AtPtr(o.deadlineAt),
		EtaAt:      realtime.AtPtr(o.etaAt),
	}); err != nil {
		return err
	}

	fromPending := f.From != nil && *f.From == machine.StateRestaurantPending
	oid := f.OrderID
	switch {
	case f.To == machine.StateAuthorized:
		return emitPaymentAuthorized(ctx, tx, f.OrderID)

	case f.To == machine.StateRestaurantPending:
		return emitOrderOffered(ctx, tx, f.OrderID, o)

	case f.To == machine.StatePreparing && fromPending:
		prep := f.PrepEtaMinutes
		if prep <= 0 && o.prepEtaMinutes != nil {
			prep = *o.prepEtaMinutes
		}
		if prep <= 0 {
			prep = o.avgPrepMinutes
		}
		by, err := realtime.StaffName(ctx, tx, f.ActorAccountID)
		if err != nil {
			return err
		}
		return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderAccepted{
			OrderID: f.OrderID, AcceptedBy: by, PrepEtaMinutes: prep,
		})

	case f.To == machine.StateRejected && fromPending:
		if o.rejectReason == nil {
			return fmt.Errorf("order %s rejected without a reason", f.OrderID)
		}
		by, err := realtime.StaffName(ctx, tx, f.ActorAccountID)
		if err != nil {
			return err
		}
		return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderRejected{
			OrderID: f.OrderID, RejectedBy: by,
			ReasonCode: contract.RestaurantRejectReasonCode(*o.rejectReason),
		})

	case f.To == machine.StateCancelled:
		if err := emitOrderCancelled(ctx, tx, f, o); err != nil {
			return err
		}
		if fromPending {
			return emitOfferEnded(ctx, tx, f, o)
		}

	case f.To == machine.StateCompleted:
		delivered := o.stateSince
		if o.deliveredAt != nil {
			delivered = *o.deliveredAt
		}
		receipt := "/v1/orders/" + f.OrderID + "/receipt"
		return realtime.EmitOrder(ctx, tx, f.OrderID, realtime.OrderCompleted{
			OrderID: f.OrderID, DeliveredAt: realtime.At(delivered), ReceiptURL: &receipt,
		})
	}
	return nil
}

// stateReason is order.state_changed's reason: the reason code the order row
// carries for the state it entered, or null. The free-text reason a caller
// passes to Transition is an internal note for order_transition and is never
// sent.
func stateReason(to machine.State, o orderFacts) *string {
	switch to {
	case machine.StateCancelled, machine.StateFailed:
		return o.cancelReason
	case machine.StateRejected:
		return o.rejectReason
	}
	return nil
}

// emitPaymentAuthorized sends the held amount and the card's brand and last
// four, from the order's payment intent. A build without the payments module
// wired records no intent, and then there is nothing to say.
func emitPaymentAuthorized(ctx context.Context, tx pgx.Tx, orderID string) error {
	var amount int64
	var currency string
	var brand, last4 *string
	err := tx.QueryRow(ctx, `
		SELECT amount_authorized_cents, currency::text, card_brand, card_last4
		  FROM payment_intent
		 WHERE order_id = $1 AND kind = 'ORDER'
		 ORDER BY created_at DESC
		 LIMIT 1`, orderID).Scan(&amount, &currency, &brand, &last4)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("load payment intent for events: %w", err)
	}
	return realtime.EmitOrder(ctx, tx, orderID, realtime.PaymentAuthorized{
		OrderID: orderID, AmountCents: amount, Currency: currency,
		Card: realtime.CardMask{Brand: brand, Last4: last4},
	})
}

// emitOrderOffered puts the new order on the restaurant's queue: the
// pre-acceptance view, with the customer's first name and the lines, and no
// phone, address or handover code (contracts/websocket.md section 4.4).
func emitOrderOffered(ctx context.Context, tx pgx.Tx, orderID string, o orderFacts) error {
	if o.deadlineAt == nil {
		return fmt.Errorf("order %s offered without a deadline", orderID)
	}
	rows, err := tx.Query(ctx, `
		SELECT ol.name_snapshot, ol.variant_name, ol.quantity, ol.special_request,
		       COALESCE(array_agg(
		         CASE WHEN a.addon_quantity > 1 THEN a.addon_quantity || ' × ' || a.addon_name ELSE a.addon_name END
		         ORDER BY a.addon_name) FILTER (WHERE a.addon_name IS NOT NULL), '{}')
		  FROM order_line ol
		  LEFT JOIN order_line_addon a ON a.order_id = ol.order_id AND a.line_no = ol.line_no
		 WHERE ol.order_id = $1
		 GROUP BY ol.line_no, ol.name_snapshot, ol.variant_name, ol.quantity, ol.special_request
		 ORDER BY ol.line_no`, orderID)
	if err != nil {
		return fmt.Errorf("load order lines for events: %w", err)
	}
	lines := []realtime.OfferedLine{}
	for rows.Next() {
		var l realtime.OfferedLine
		if err := rows.Scan(&l.Name, &l.Variant, &l.Qty, &l.Note, &l.Addons); err != nil {
			rows.Close()
			return fmt.Errorf("scan order line for events: %w", err)
		}
		lines = append(lines, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("order lines for events: %w", err)
	}
	oid := orderID
	return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderOffered{
		OrderID: orderID, Code: o.code,
		ExpiresAt: realtime.At(*o.deadlineAt), DeadlineAt: realtime.At(*o.deadlineAt),
		CustomerFirstName: o.firstName, Lines: lines,
		SubtotalCents: o.subtotalCents, TotalCents: o.totalCents, Currency: o.currency,
		PrepEtaSuggestionMin: o.avgPrepMinutes,
		Fulfilment:           contract.Fulfilment(o.fulfilment),
	})
}

// emitOrderCancelled tells every participant why, and the refund already
// recorded for the order, if any. A refund is created by the cancellation's
// money effect; when that runs after this point the customer hears of it on
// refund.created instead.
func emitOrderCancelled(ctx context.Context, tx pgx.Tx, f transitionFacts, o orderFacts) error {
	if o.cancelReason == nil {
		return fmt.Errorf("order %s cancelled without a reason", f.OrderID)
	}
	var refund *realtime.CancelledRefund
	var kind, state string
	var amount int64
	err := tx.QueryRow(ctx, `
		SELECT kind::text, amount_cents, state::text
		  FROM refund
		 WHERE order_id = $1
		 ORDER BY created_at DESC
		 LIMIT 1`, f.OrderID).Scan(&kind, &amount, &state)
	switch {
	case err == nil:
		refund = &realtime.CancelledRefund{
			Kind: contract.RefundKind(kind), AmountCents: amount, State: contract.RefundState(state),
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("load refund for events: %w", err)
	}
	return realtime.EmitOrder(ctx, tx, f.OrderID, realtime.OrderCancelled{
		OrderID: f.OrderID, ReasonCode: contract.OrderCancellationReasonCode(*o.cancelReason),
		By: contract.OrderActorKind(f.Actor), Refund: refund,
	})
}

// emitOfferEnded takes a cancelled offer off the restaurant's tablets. Only the
// system (the 180-second deadline, a failed payment) and the customer can
// cancel an order the restaurant has not answered (the RESTAURANT_PENDING to
// CANCELLED row of the transition table in machine/machine.go), so the
// three reasons below are every way here; any other reason is not one the
// contract's closed sets can name, and no event is sent for it.
func emitOfferEnded(ctx context.Context, tx pgx.Tx, f transitionFacts, o orderFacts) error {
	oid := f.OrderID
	switch {
	case *o.cancelReason == string(contract.OrderCancellationReasonCodeRESTAURANTTIMEOUT):
		return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderOfferExpired{
			OrderID: f.OrderID, Reason: realtime.OfferExpiredTimeout,
		})
	case *o.cancelReason == string(contract.OrderCancellationReasonCodeCAPTUREFAILED),
		*o.cancelReason == string(contract.OrderCancellationReasonCodePAYMENTEXPIRED):
		return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderOfferWithdrawn{
			OrderID: f.OrderID, Reason: realtime.OfferWithdrawnPaymentFailed,
		})
	case f.Actor == machine.ActorCustomer,
		*o.cancelReason == string(contract.OrderCancellationReasonCodeCUSTOMERCANCELLED):
		return realtime.EmitRestaurant(ctx, tx, o.restaurantID, &oid, realtime.RestaurantOrderOfferWithdrawn{
			OrderID: f.OrderID, Reason: realtime.OfferWithdrawnCustomerCancelled,
		})
	}
	return nil
}
