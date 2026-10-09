package realtime

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// The catalogue is the one place that says, for every event type in
// contracts/websocket.md section 4, which channel family carries it, the
// source record a producer emits (events.go) and the contract payload it
// becomes on the wire (wire.go).
//
// Who receives it is not here: that is the allow-list below, keyed role first
// (section 5, "Per-role projection rules": one serializer per (event, role),
// never a shared struct with conditional blanking). An event type is sent to a
// role only if that role's list names a serializer for it. Anything not in
// the list is dropped: an unknown role, a role with no serializer for the
// event, and an event type added to the catalogue later without serializers
// (projection.go; security review of
// https://github.com/shaiknoorullah/hg-mono/issues/247).

// spec is one catalogue entry.
type spec struct {
	typ  string
	kind ChannelKind
	// source is the type Emit accepts and realtime_event.payload stores. It is
	// never sent.
	source reflect.Type
	// wire is the contract's payload, which the schema bundle describes. Every
	// role's serializer output validates against it.
	wire reflect.Type
}

// entry builds a catalogue entry from its source and wire types.
func entry[S, W any](typ string, kind ChannelKind) spec {
	return spec{typ: typ, kind: kind, source: reflect.TypeFor[S](), wire: reflect.TypeFor[W]()}
}

// catalogue is every event type of contracts/websocket.md sections 4.2 to 4.7,
// in the contract's order. Control frames (section 4.1) are connection-scoped
// and live in frames.go.
var catalogue = []spec{
	// 4.2 Order — order:{order_id}
	entry[OrderCreated, orderCreatedWire]("order.created", KindOrder),
	entry[OrderStateChanged, orderStateChangedWire]("order.state_changed", KindOrder),
	entry[OrderEtaUpdated, orderEtaUpdatedWire]("order.eta_updated", KindOrder),
	entry[OrderItemsAdjusted, orderItemsAdjustedWire]("order.items_adjusted", KindOrder),
	entry[OrderCancelled, orderCancelledWire]("order.cancelled", KindOrder),
	entry[OrderCompleted, orderCompletedWire]("order.completed", KindOrder),
	entry[OrderNoteAdded, orderNoteAddedWire]("order.note_added", KindOrder),
	entry[OrderRiderArrived, orderRiderArrivedWire]("order.rider_arrived", KindOrder),

	// 4.3 Payment — order:{order_id}
	entry[PaymentAuthorized, paymentAuthorizedWire]("payment.authorized", KindOrder),
	entry[PaymentActionRequired, paymentActionRequiredWire]("payment.action_required", KindOrder),
	entry[PaymentCaptured, paymentCapturedWire]("payment.captured", KindOrder),
	entry[PaymentFailed, paymentFailedWire]("payment.failed", KindOrder),
	entry[RefundCreated, refundCreatedWire]("refund.created", KindOrder),
	entry[RefundSettled, refundSettledWire]("refund.settled", KindOrder),
	entry[RefundFailed, refundFailedWire]("refund.failed", KindOrder),

	// 4.4 Restaurant — restaurant:{restaurant_id}
	entry[RestaurantOrderOffered, restaurantOrderOfferedWire]("restaurant.order_offered", KindRestaurant),
	entry[RestaurantOrderOfferExpired, restaurantOrderOfferExpiredWire]("restaurant.order_offer_expired", KindRestaurant),
	entry[RestaurantOrderOfferWithdrawn, restaurantOrderOfferWithdrawnWire]("restaurant.order_offer_withdrawn", KindRestaurant),
	entry[RestaurantOrderAccepted, restaurantOrderAcceptedWire]("restaurant.order_accepted", KindRestaurant),
	entry[RestaurantOrderRejected, restaurantOrderRejectedWire]("restaurant.order_rejected", KindRestaurant),
	entry[RestaurantStatusChanged, restaurantStatusChangedWire]("restaurant.status_changed", KindRestaurant),
	entry[RestaurantPayoutUpdated, restaurantPayoutUpdatedWire]("restaurant.payout_updated", KindRestaurant),

	// 4.5 Dispatch and rider — offers on rider:{account_id}, progress on order:{order_id}
	entry[DispatchOffer, dispatchOfferWire]("dispatch.offer", KindRider),
	entry[DispatchOfferWithdrawn, dispatchOfferWithdrawnWire]("dispatch.offer_withdrawn", KindRider),
	entry[DispatchAssigned, dispatchAssignedWire]("dispatch.assigned", KindOrder),
	entry[DispatchUnassigned, dispatchUnassignedWire]("dispatch.unassigned", KindOrder),
	entry[DispatchStateChanged, dispatchStateChangedWire]("dispatch.state_changed", KindOrder),
	entry[RiderLocation, riderLocationWire]("rider.location", KindOrder),
	entry[RiderAvailabilityChanged, riderAvailabilityChangedWire]("rider.availability_changed", KindRider),
	entry[RiderEarningsUpdated, riderEarningsUpdatedWire]("rider.earnings_updated", KindRider),

	// 4.6 Account and onboarding — account:{account_id}, the owner only
	entry[AccountSecurityEvent, accountSecurityEventWire]("account.security_event", KindAccount),
	entry[DocumentReviewStateChanged, documentReviewStateChangedWire]("document.review_state_changed", KindAccount),
	entry[OnboardingStateChanged, onboardingStateChangedWire]("onboarding.state_changed", KindAccount),
	entry[ConnectRequirementsChanged, connectRequirementsChangedWire]("connect.requirements_changed", KindAccount),
	entry[NotificationCreated, notificationCreatedWire]("notification.created", KindAccount),
	entry[NotificationRead, notificationReadWire]("notification.read", KindAccount),

	// 4.7 Admin — admin:ops
	entry[AdminAlert, adminAlertWire]("admin.alert", KindAdminOps),
	entry[AdminDispatchFailure, adminDispatchFailureWire]("admin.dispatch_failure", KindAdminOps),
	entry[AdminReconciliationException, adminReconciliationExceptionWire]("admin.reconciliation_exception", KindAdminOps),
	entry[AdminQueueDepth, adminQueueDepthWire]("admin.queue_depth", KindAdminOps),
}

// projector is one serializer: it decodes the stored source record and builds
// one role's payload from it. src and outs record its types, so init can bind
// it only to the event whose source it reads, and the tests can hold its
// output to the contract.
type projector struct {
	src  reflect.Type
	outs []reflect.Type
	run  func(source json.RawMessage) (any, error)
}

// serializer wraps build, which makes a role's payload W from a source S.
func serializer[S, W any](build func(S) W) projector {
	return projector{
		src:  reflect.TypeFor[S](),
		outs: []reflect.Type{reflect.TypeFor[W]()},
		run: func(raw json.RawMessage) (any, error) {
			var s S
			if err := json.Unmarshal(raw, &s); err != nil {
				return nil, fmt.Errorf("decode %T: %w", s, err)
			}
			return build(s), nil
		},
	}
}

// either picks one of two serializers by a fact the source records. It is how
// a role whose view depends on the order's progress gets two whole payloads,
// never one payload with fields blanked by a branch.
func either[S, A, B any](useA func(S) bool, a func(S) A, b func(S) B) projector {
	return projector{
		src:  reflect.TypeFor[S](),
		outs: []reflect.Type{reflect.TypeFor[A](), reflect.TypeFor[B]()},
		run: func(raw json.RawMessage) (any, error) {
			var s S
			if err := json.Unmarshal(raw, &s); err != nil {
				return nil, fmt.Errorf("decode %T: %w", s, err)
			}
			if useA(s) {
				return a(s), nil
			}
			return b(s), nil
		},
	}
}

// allowList is the whole of who receives what: role → event type → the
// serializer that builds that role's payload. It is the only path from a
// stored event to a socket (projection.go). Support and admin get every
// event on the channels they may subscribe to except payment.action_required,
// whose client secret is a token no one but the paying customer needs; the
// account channel is its owner's alone.
var allowList = map[Viewer]map[string]projector{
	ViewCustomer: {
		"order.created":           serializer(orderCreatedPayload),
		"order.state_changed":     serializer(orderStateChangedPayload),
		"order.eta_updated":       serializer(orderEtaUpdatedPayload),
		"order.items_adjusted":    serializer(orderItemsAdjustedPayload),
		"order.cancelled":         serializer(orderCancelledPayload),
		"order.completed":         serializer(orderCompletedPayload),
		"order.rider_arrived":     serializer(orderRiderArrivedPayload),
		"payment.authorized":      serializer(paymentAuthorizedPayload),
		"payment.action_required": serializer(paymentActionRequiredPayload),
		"payment.captured":        serializer(paymentCapturedPayload),
		"payment.failed":          serializer(paymentFailedPayload),
		"refund.created":          serializer(refundCreatedPayload),
		"refund.settled":          serializer(refundSettledPayload),
		"refund.failed":           serializer(refundFailedPayload),
		"dispatch.assigned":       serializer(dispatchAssignedPayload),
		"dispatch.unassigned":     serializer(dispatchUnassignedPayload),
		"dispatch.state_changed":  serializer(dispatchStateChangedPayload),
		// Precise once the order is picked up, coarse before.
		"rider.location": either(riderPickedUp, riderLocationPrecise, riderLocationCoarse),
	},
	ViewRestaurant: {
		"order.state_changed":  serializer(orderStateChangedPayload),
		"order.eta_updated":    serializer(orderEtaUpdatedPayload),
		"order.items_adjusted": serializer(orderItemsAdjustedPayload),
		"order.cancelled":      serializer(orderCancelledPayload),
		"order.completed":      serializer(orderCompletedWithoutReceipt),
		"order.note_added":     serializer(orderNoteAddedPayload),

		"restaurant.order_offered":         serializer(restaurantOrderOfferedPayload),
		"restaurant.order_offer_expired":   serializer(restaurantOrderOfferExpiredPayload),
		"restaurant.order_offer_withdrawn": serializer(restaurantOrderOfferWithdrawnPayload),
		"restaurant.order_accepted":        serializer(restaurantOrderAcceptedPayload),
		"restaurant.order_rejected":        serializer(restaurantOrderRejectedPayload),
		"restaurant.status_changed":        serializer(restaurantStatusChangedPayload),
		// restaurant.payout_updated is for the restaurant OWNER, and
		// restaurant:{id} cannot yet tell an owner from other staff, so no
		// staff member gets it (support does).

		"dispatch.assigned":      serializer(dispatchAssignedPayload),
		"dispatch.unassigned":    serializer(dispatchUnassignedPayload),
		"dispatch.state_changed": serializer(dispatchStateChangedPayload),
		"rider.location":         serializer(riderLocationCoarse),
	},
	// The rider on order:{id}: no money, no receipt, no rider.location (their
	// own position), and never a handover code — the rider types those in.
	ViewRider: {
		"order.state_changed":    serializer(orderStateChangedPayload),
		"order.cancelled":        serializer(orderCancelledForRider),
		"order.completed":        serializer(orderCompletedWithoutReceipt),
		"order.note_added":       serializer(orderNoteAddedPayload),
		"dispatch.assigned":      serializer(dispatchAssignedPayload),
		"dispatch.unassigned":    serializer(dispatchUnassignedPayload),
		"dispatch.state_changed": serializer(dispatchStateChangedPayload),
	},
	// The rider on their own rider:{id}.
	ViewRiderSelf: {
		"dispatch.offer":             serializer(dispatchOfferPayload),
		"dispatch.offer_withdrawn":   serializer(dispatchOfferWithdrawnPayload),
		"rider.availability_changed": serializer(riderAvailabilityChangedPayload),
		"rider.earnings_updated":     serializer(riderEarningsUpdatedPayload),
	},
	ViewAccountOwner: {
		"account.security_event":        serializer(accountSecurityEventPayload),
		"document.review_state_changed": serializer(documentReviewStateChangedPayload),
		"onboarding.state_changed":      serializer(onboardingStateChangedPayload),
		"connect.requirements_changed":  serializer(connectRequirementsChangedPayload),
		"notification.created":          serializer(notificationCreatedPayload),
		"notification.read":             serializer(notificationReadPayload),
	},
	ViewSupport: {
		"order.created":        serializer(orderCreatedPayload),
		"order.state_changed":  serializer(orderStateChangedPayload),
		"order.eta_updated":    serializer(orderEtaUpdatedPayload),
		"order.items_adjusted": serializer(orderItemsAdjustedPayload),
		"order.cancelled":      serializer(orderCancelledPayload),
		"order.completed":      serializer(orderCompletedPayload),
		"order.note_added":     serializer(orderNoteAddedPayload),
		"order.rider_arrived":  serializer(orderRiderArrivedPayload),

		"payment.authorized": serializer(paymentAuthorizedPayload),
		"payment.captured":   serializer(paymentCapturedPayload),
		"payment.failed":     serializer(paymentFailedPayload),
		"refund.created":     serializer(refundCreatedPayload),
		"refund.settled":     serializer(refundSettledPayload),
		"refund.failed":      serializer(refundFailedPayload),

		"restaurant.order_offered":         serializer(restaurantOrderOfferedPayload),
		"restaurant.order_offer_expired":   serializer(restaurantOrderOfferExpiredPayload),
		"restaurant.order_offer_withdrawn": serializer(restaurantOrderOfferWithdrawnPayload),
		"restaurant.order_accepted":        serializer(restaurantOrderAcceptedForSupport),
		"restaurant.order_rejected":        serializer(restaurantOrderRejectedPayload),
		"restaurant.status_changed":        serializer(restaurantStatusChangedPayload),
		"restaurant.payout_updated":        serializer(restaurantPayoutUpdatedPayload),

		"dispatch.offer":             serializer(dispatchOfferPayload),
		"dispatch.offer_withdrawn":   serializer(dispatchOfferWithdrawnPayload),
		"dispatch.assigned":          serializer(dispatchAssignedPayload),
		"dispatch.unassigned":        serializer(dispatchUnassignedPayload),
		"dispatch.state_changed":     serializer(dispatchStateChangedPayload),
		"rider.location":             serializer(riderLocationPrecise),
		"rider.availability_changed": serializer(riderAvailabilityChangedPayload),
		"rider.earnings_updated":     serializer(riderEarningsUpdatedPayload),

		"admin.alert":                    serializer(adminAlertPayload),
		"admin.dispatch_failure":         serializer(adminDispatchFailurePayload),
		"admin.reconciliation_exception": serializer(adminReconciliationExceptionPayload),
		"admin.queue_depth":              serializer(adminQueueDepthPayload),
	},
}

// byType and bySource index the catalogue.
var (
	byType   = map[string]*spec{}
	bySource = map[reflect.Type]*spec{}
)

func init() {
	for i := range catalogue {
		s := &catalogue[i]
		if _, dup := byType[s.typ]; dup {
			panic("realtime: duplicate catalogue type " + s.typ)
		}
		if _, dup := bySource[s.source]; dup {
			panic("realtime: two catalogue types share the source type " + s.source.String())
		}
		if s.source == s.wire {
			panic("realtime: " + s.typ + " sends its source type; its wire type must be its own")
		}
		byType[s.typ] = s
		bySource[s.source] = s
	}
	// A serializer is bound only to an event in the catalogue, and only to the
	// event whose source it decodes.
	for viewer, serializers := range allowList {
		for typ, p := range serializers {
			s, ok := byType[typ]
			if !ok {
				panic(fmt.Sprintf("realtime: the %s allow-list names %s, which is not in the catalogue", viewer, typ))
			}
			if p.src != s.source {
				panic(fmt.Sprintf("realtime: the %s serializer for %s reads %s, not its source %s", viewer, typ, p.src, s.source))
			}
		}
	}
}

// CatalogueTypes lists every event type in the catalogue, in contract order.
func CatalogueTypes() []string {
	out := make([]string, len(catalogue))
	for i, s := range catalogue {
		out[i] = s.typ
	}
	return out
}
