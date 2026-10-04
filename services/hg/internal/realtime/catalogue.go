package realtime

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
)

// The registry below is the one place that says, for every event type in
// contracts/websocket.md section 4: which channel family carries it, which
// roles receive it, and the serializer each of those roles gets (section 5,
// "Per-role projection rules": one serializer per (event, role), never a shared
// struct with conditional blanking).
//
// A role with no serializer for an event is not in its audience, and the
// gateway drops the frame for it (projection.go). An event type that is not in
// the registry cannot be emitted (emit.go) and is never delivered.
//
// Support and admin are in the audience of every order-channel event except
// payment.action_required: section 5 gives them "everything", and a client
// secret is a token no one but the paying customer needs.

// projector turns a stored source record into the payload one role may see.
type projector func(source json.RawMessage) (any, error)

// spec is one catalogue entry.
type spec struct {
	typ  string
	kind ChannelKind
	// source is the type Emit accepts and realtime_event.payload stores.
	source reflect.Type
	// wire is the contract's payload shape, which the schema bundle describes.
	// Every role's serializer output validates against it.
	wire  reflect.Type
	views map[Viewer]projector
}

// view decodes the stored source as S and runs f, the serializer for one role.
func view[S any](f func(S) any) projector {
	return func(raw json.RawMessage) (any, error) {
		var s S
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, fmt.Errorf("decode %T: %w", s, err)
		}
		return f(s), nil
	}
}

// asIs is the serializer for a role that sees the contract payload in full —
// used only where the source type IS the contract payload.
func asIs[S any]() projector { return view(func(s S) any { return s }) }

// entry builds a spec whose source type is the contract payload.
func entry[S any](typ string, kind ChannelKind, views map[Viewer]projector) spec {
	t := reflect.TypeFor[S]()
	return spec{typ: typ, kind: kind, source: t, wire: t, views: views}
}

// everyone is the order-channel audience "all participants", plus support.
func everyone[S any]() map[Viewer]projector {
	p := asIs[S]()
	return map[Viewer]projector{ViewCustomer: p, ViewRestaurant: p, ViewRider: p, ViewSupport: p}
}

// only gives the listed roles the full contract payload.
func only[S any](roles ...Viewer) map[Viewer]projector {
	p := asIs[S]()
	m := make(map[Viewer]projector, len(roles))
	for _, r := range roles {
		m[r] = p
	}
	return m
}

// catalogue is every event type of contracts/websocket.md sections 4.2 to 4.7,
// in the contract's order. Control frames (section 4.1) are connection-scoped
// and live in frames.go.
var catalogue = []spec{
	// 4.2 Order — order:{order_id}
	entry[OrderCreated]("order.created", KindOrder, only[OrderCreated](ViewCustomer, ViewSupport)),
	entry[OrderStateChanged]("order.state_changed", KindOrder, everyone[OrderStateChanged]()),
	entry[OrderEtaUpdated]("order.eta_updated", KindOrder, only[OrderEtaUpdated](ViewCustomer, ViewRestaurant, ViewSupport)),
	entry[OrderItemsAdjusted]("order.items_adjusted", KindOrder, only[OrderItemsAdjusted](ViewCustomer, ViewRestaurant, ViewSupport)),
	entry[OrderCancelled]("order.cancelled", KindOrder, map[Viewer]projector{
		ViewCustomer:   asIs[OrderCancelled](),
		ViewRestaurant: asIs[OrderCancelled](),
		ViewRider:      view(orderCancelledForRider),
		ViewSupport:    asIs[OrderCancelled](),
	}),
	entry[OrderCompleted]("order.completed", KindOrder, map[Viewer]projector{
		ViewCustomer:   asIs[OrderCompleted](),
		ViewRestaurant: view(orderCompletedWithoutReceipt),
		ViewRider:      view(orderCompletedWithoutReceipt),
		ViewSupport:    asIs[OrderCompleted](),
	}),
	entry[OrderNoteAdded]("order.note_added", KindOrder, only[OrderNoteAdded](ViewRestaurant, ViewRider, ViewSupport)),

	// 4.3 Payment — order:{order_id}
	entry[PaymentAuthorized]("payment.authorized", KindOrder, only[PaymentAuthorized](ViewCustomer, ViewSupport)),
	entry[PaymentActionRequired]("payment.action_required", KindOrder, only[PaymentActionRequired](ViewCustomer)),
	entry[PaymentCaptured]("payment.captured", KindOrder, only[PaymentCaptured](ViewCustomer, ViewSupport)),
	entry[PaymentFailed]("payment.failed", KindOrder, only[PaymentFailed](ViewCustomer, ViewSupport)),
	entry[RefundCreated]("refund.created", KindOrder, only[RefundCreated](ViewCustomer, ViewSupport)),
	entry[RefundSettled]("refund.settled", KindOrder, only[RefundSettled](ViewCustomer, ViewSupport)),
	entry[RefundFailed]("refund.failed", KindOrder, only[RefundFailed](ViewCustomer, ViewSupport)),

	// 4.4 Restaurant — restaurant:{restaurant_id}
	entry[RestaurantOrderOffered]("restaurant.order_offered", KindRestaurant, only[RestaurantOrderOffered](ViewRestaurant, ViewSupport)),
	entry[RestaurantOrderOfferExpired]("restaurant.order_offer_expired", KindRestaurant, only[RestaurantOrderOfferExpired](ViewRestaurant, ViewSupport)),
	entry[RestaurantOrderOfferWithdrawn]("restaurant.order_offer_withdrawn", KindRestaurant, only[RestaurantOrderOfferWithdrawn](ViewRestaurant, ViewSupport)),
	entry[RestaurantOrderAccepted]("restaurant.order_accepted", KindRestaurant, only[RestaurantOrderAccepted](ViewRestaurant, ViewSupport)),
	entry[RestaurantOrderRejected]("restaurant.order_rejected", KindRestaurant, only[RestaurantOrderRejected](ViewRestaurant, ViewSupport)),
	entry[RestaurantStatusChanged]("restaurant.status_changed", KindRestaurant, only[RestaurantStatusChanged](ViewRestaurant, ViewSupport)),
	// The contract's audience is the restaurant OWNER. The socket cannot yet
	// tell an owner from other staff on restaurant:{id}, so until it can, this
	// goes to support only — nothing emits it yet (issue #247 follow-up).
	entry[RestaurantPayoutUpdated]("restaurant.payout_updated", KindRestaurant, only[RestaurantPayoutUpdated](ViewSupport)),

	// 4.5 Dispatch and rider — offers on rider:{account_id}, progress on order:{order_id}
	entry[DispatchOffer]("dispatch.offer", KindRider, only[DispatchOffer](ViewSelf, ViewSupport)),
	entry[DispatchOfferWithdrawn]("dispatch.offer_withdrawn", KindRider, only[DispatchOfferWithdrawn](ViewSelf, ViewSupport)),
	entry[DispatchAssigned]("dispatch.assigned", KindOrder, everyone[DispatchAssigned]()),
	entry[DispatchUnassigned]("dispatch.unassigned", KindOrder, everyone[DispatchUnassigned]()),
	entry[DispatchStateChanged]("dispatch.state_changed", KindOrder, everyone[DispatchStateChanged]()),
	{
		typ: "rider.location", kind: KindOrder,
		source: reflect.TypeFor[RiderLocation](), wire: reflect.TypeFor[riderLocationWire](),
		views: map[Viewer]projector{
			ViewCustomer:   view(riderLocationForCustomer),
			ViewRestaurant: view(riderLocationCoarse),
			ViewSupport:    view(riderLocationPrecise),
		},
	},
	entry[RiderAvailabilityChanged]("rider.availability_changed", KindRider, only[RiderAvailabilityChanged](ViewSelf, ViewSupport)),
	entry[RiderEarningsUpdated]("rider.earnings_updated", KindRider, only[RiderEarningsUpdated](ViewSelf, ViewSupport)),

	// 4.6 Account and onboarding — account:{account_id}, the owner only
	entry[AccountSecurityEvent]("account.security_event", KindAccount, only[AccountSecurityEvent](ViewSelf)),
	entry[DocumentReviewStateChanged]("document.review_state_changed", KindAccount, only[DocumentReviewStateChanged](ViewSelf)),
	entry[OnboardingStateChanged]("onboarding.state_changed", KindAccount, only[OnboardingStateChanged](ViewSelf)),
	entry[ConnectRequirementsChanged]("connect.requirements_changed", KindAccount, only[ConnectRequirementsChanged](ViewSelf)),
	entry[NotificationCreated]("notification.created", KindAccount, only[NotificationCreated](ViewSelf)),
	entry[NotificationRead]("notification.read", KindAccount, only[NotificationRead](ViewSelf)),

	// 4.7 Admin — admin:ops
	entry[AdminAlert]("admin.alert", KindAdminOps, only[AdminAlert](ViewSupport)),
	entry[AdminDispatchFailure]("admin.dispatch_failure", KindAdminOps, only[AdminDispatchFailure](ViewSupport)),
	entry[AdminReconciliationException]("admin.reconciliation_exception", KindAdminOps, only[AdminReconciliationException](ViewSupport)),
	entry[AdminQueueDepth]("admin.queue_depth", KindAdminOps, only[AdminQueueDepth](ViewSupport)),
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
		byType[s.typ] = s
		bySource[s.source] = s
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

// ---------------------------------------------------------------------------
// The serializers that differ by role. Each builds its role's payload field by
// field; a withheld field is the Withheld type.
// ---------------------------------------------------------------------------

// orderCancelledRiderView is order.cancelled for the rider: no refund, because
// the rider is never sent the order's money.
type orderCancelledRiderView struct {
	OrderID    string   `json:"order_id"`
	ReasonCode string   `json:"reason_code"`
	By         string   `json:"by"`
	Refund     Withheld `json:"refund"`
}

func orderCancelledForRider(s OrderCancelled) any {
	return orderCancelledRiderView{OrderID: s.OrderID, ReasonCode: string(s.ReasonCode), By: string(s.By)}
}

// orderCompletedNoReceiptView is order.completed for the restaurant and the
// rider: the receipt prints the order's prices and is the customer's.
type orderCompletedNoReceiptView struct {
	OrderID     string    `json:"order_id"`
	DeliveredAt Timestamp `json:"delivered_at"`
	ReceiptURL  Withheld  `json:"receipt_url"`
}

func orderCompletedWithoutReceipt(s OrderCompleted) any {
	return orderCompletedNoReceiptView{OrderID: s.OrderID, DeliveredAt: s.DeliveredAt}
}

// riderLocationCoarseView is rider.location at roughly 100 m: enough to know the
// rider is close, not enough to follow them. Heading, speed and accuracy would
// let a viewer recover the fine position, so they are withheld too.
type riderLocationCoarseView struct {
	OrderID    string    `json:"order_id"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	HeadingDeg Withheld  `json:"heading_deg"`
	SpeedMps   Withheld  `json:"speed_mps"`
	AccuracyM  Withheld  `json:"accuracy_m"`
	RecordedAt Timestamp `json:"recorded_at"`
}

// coarseDegrees rounds a coordinate to three decimals, about 100 m at these
// latitudes (contracts/websocket.md section 5).
func coarseDegrees(f float64) float64 { return math.Round(f*1000) / 1000 }

// riderLocationCoarse is the restaurant's view, always.
func riderLocationCoarse(s RiderLocation) any {
	return riderLocationCoarseView{
		OrderID: s.OrderID, Lat: coarseDegrees(s.Lat), Lng: coarseDegrees(s.Lng), RecordedAt: s.RecordedAt,
	}
}

// riderLocationPrecise is support's view, and the customer's after pickup.
func riderLocationPrecise(s RiderLocation) any {
	return riderLocationWire{
		OrderID: s.OrderID, Lat: s.Lat, Lng: s.Lng, HeadingDeg: s.HeadingDeg,
		SpeedMps: s.SpeedMps, AccuracyM: s.AccuracyM, RecordedAt: s.RecordedAt,
	}
}

// riderLocationForCustomer withholds the rider's exact position until the
// order is picked up (contracts/websocket.md section 5, the customer row).
func riderLocationForCustomer(s RiderLocation) any {
	if s.PickedUp {
		return riderLocationPrecise(s)
	}
	return riderLocationCoarse(s)
}
