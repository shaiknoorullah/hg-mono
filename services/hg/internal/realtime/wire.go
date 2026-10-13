package realtime

import (
	"math"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// This file is what goes on the wire: for every event type of
// contracts/websocket.md section 4, the contract's payload as its own Go type,
// and the serializers that build it from the producer's source record
// (events.go). The schema GET /v1/realtime/schema serves is generated from
// these types (schema.go), and catalogue_contract_test.go checks them against
// the contract's tables.
//
// The rules, from contracts/websocket.md section 5 and the security review of
// https://github.com/shaiknoorullah/hg-mono/issues/247:
//
//   - A wire type is never a source type, so a serializer cannot hand the
//     source record on: it must build a new value.
//   - A serializer copies the fields it names, one by one, nested objects
//     included. It never copies a source and then removes fields: a field
//     added to a source later reaches no one until a serializer names it.
//   - A role that may not see a field gets its own type, in which that field
//     is Withheld: it has nowhere to put the value and always encodes null.
//   - Which role gets which serializer is the allow-list in catalogue.go.

// ---------------------------------------------------------------------------
// Section 4.2 — order, on order:{order_id}.
// ---------------------------------------------------------------------------

type orderCreatedWire struct {
	OrderID    string              `json:"order_id"`
	Code       string              `json:"code"`
	State      contract.OrderState `json:"state"`
	Restaurant restaurantRefWire   `json:"restaurant"`
	TotalCents int64               `json:"total_cents"`
	Currency   string              `json:"currency"`
	PlacedAt   Timestamp           `json:"placed_at"`
	DeadlineAt Timestamp           `json:"deadline_at"`
}

type restaurantRefWire struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func orderCreatedPayload(s OrderCreated) orderCreatedWire {
	return orderCreatedWire{
		OrderID: s.OrderID, Code: s.Code, State: s.State,
		Restaurant: restaurantRefWire{ID: s.Restaurant.ID, Name: s.Restaurant.Name},
		TotalCents: s.TotalCents, Currency: s.Currency,
		PlacedAt: s.PlacedAt, DeadlineAt: s.DeadlineAt,
	}
}

type orderStateChangedWire struct {
	OrderID    string                  `json:"order_id"`
	From       *contract.OrderState    `json:"from"`
	To         contract.OrderState     `json:"to"`
	At         Timestamp               `json:"at"`
	Reason     *string                 `json:"reason"`
	ActorKind  contract.OrderActorKind `json:"actor_kind"`
	DeadlineAt *Timestamp              `json:"deadline_at"`
	EtaAt      *Timestamp              `json:"eta_at"`
}

func orderStateChangedPayload(s OrderStateChanged) orderStateChangedWire {
	return orderStateChangedWire{
		OrderID: s.OrderID, From: s.From, To: s.To, At: s.At, Reason: s.Reason,
		ActorKind: s.ActorKind, DeadlineAt: s.DeadlineAt, EtaAt: s.EtaAt,
	}
}

type orderEtaUpdatedWire struct {
	OrderID      string     `json:"order_id"`
	PickupEtaAt  *Timestamp `json:"pickup_eta_at"`
	DropoffEtaAt *Timestamp `json:"dropoff_eta_at"`
	Source       EtaSource  `json:"source"`
}

func orderEtaUpdatedPayload(s OrderEtaUpdated) orderEtaUpdatedWire {
	return orderEtaUpdatedWire{
		OrderID: s.OrderID, PickupEtaAt: s.PickupEtaAt, DropoffEtaAt: s.DropoffEtaAt, Source: s.Source,
	}
}

type orderItemsAdjustedWire struct {
	OrderID       string            `json:"order_id"`
	Removed       []removedLineWire `json:"removed"`
	NewTotalCents int64             `json:"new_total_cents"`
	NewQuoteID    string            `json:"new_quote_id"`
}

type removedLineWire struct {
	LineNo int    `json:"line_no"`
	Name   string `json:"name"`
	Qty    int    `json:"qty"`
}

func orderItemsAdjustedPayload(s OrderItemsAdjusted) orderItemsAdjustedWire {
	removed := make([]removedLineWire, 0, len(s.Removed))
	for _, l := range s.Removed {
		removed = append(removed, removedLineWire{LineNo: l.LineNo, Name: l.Name, Qty: l.Qty})
	}
	return orderItemsAdjustedWire{
		OrderID: s.OrderID, Removed: removed, NewTotalCents: s.NewTotalCents, NewQuoteID: s.NewQuoteID,
	}
}

type orderCancelledWire struct {
	OrderID    string                               `json:"order_id"`
	ReasonCode contract.OrderCancellationReasonCode `json:"reason_code"`
	By         contract.OrderActorKind              `json:"by"`
	Refund     *cancelledRefundWire                 `json:"refund"`
}

type cancelledRefundWire struct {
	Kind        contract.RefundKind  `json:"kind"`
	AmountCents int64                `json:"amount_cents"`
	State       contract.RefundState `json:"state"`
}

func orderCancelledPayload(s OrderCancelled) orderCancelledWire {
	var refund *cancelledRefundWire
	if s.Refund != nil {
		refund = &cancelledRefundWire{Kind: s.Refund.Kind, AmountCents: s.Refund.AmountCents, State: s.Refund.State}
	}
	return orderCancelledWire{OrderID: s.OrderID, ReasonCode: s.ReasonCode, By: s.By, Refund: refund}
}

// orderCancelledRiderWire is order.cancelled for the rider: no refund, because
// the rider is never sent the order's money (section 5, the rider row).
type orderCancelledRiderWire struct {
	OrderID    string                               `json:"order_id"`
	ReasonCode contract.OrderCancellationReasonCode `json:"reason_code"`
	By         contract.OrderActorKind              `json:"by"`
	Refund     Withheld                             `json:"refund"`
}

func orderCancelledForRider(s OrderCancelled) orderCancelledRiderWire {
	return orderCancelledRiderWire{OrderID: s.OrderID, ReasonCode: s.ReasonCode, By: s.By}
}

type orderCompletedWire struct {
	OrderID     string    `json:"order_id"`
	DeliveredAt Timestamp `json:"delivered_at"`
	ReceiptURL  *string   `json:"receipt_url"`
}

func orderCompletedPayload(s OrderCompleted) orderCompletedWire {
	return orderCompletedWire{OrderID: s.OrderID, DeliveredAt: s.DeliveredAt, ReceiptURL: s.ReceiptURL}
}

// orderCompletedNoReceiptWire is order.completed for the restaurant and the
// rider: the receipt prints the order's prices and is the customer's document.
type orderCompletedNoReceiptWire struct {
	OrderID     string    `json:"order_id"`
	DeliveredAt Timestamp `json:"delivered_at"`
	ReceiptURL  Withheld  `json:"receipt_url"`
}

func orderCompletedWithoutReceipt(s OrderCompleted) orderCompletedNoReceiptWire {
	return orderCompletedNoReceiptWire{OrderID: s.OrderID, DeliveredAt: s.DeliveredAt}
}

type orderNoteAddedWire struct {
	OrderID    string                  `json:"order_id"`
	AuthorKind contract.OrderActorKind `json:"author_kind"`
	Text       string                  `json:"text"`
	At         Timestamp               `json:"at"`
}

func orderNoteAddedPayload(s OrderNoteAdded) orderNoteAddedWire {
	return orderNoteAddedWire{OrderID: s.OrderID, AuthorKind: s.AuthorKind, Text: s.Text, At: s.At}
}

type orderRiderArrivedWire struct {
	OrderID string    `json:"order_id"`
	At      Timestamp `json:"at"`
}

func orderRiderArrivedPayload(s OrderRiderArrived) orderRiderArrivedWire {
	return orderRiderArrivedWire{OrderID: s.OrderID, At: s.At}
}

// ---------------------------------------------------------------------------
// Section 4.3 — payment, on order:{order_id}.
// ---------------------------------------------------------------------------

type paymentAuthorizedWire struct {
	OrderID     string       `json:"order_id"`
	AmountCents int64        `json:"amount_cents"`
	Currency    string       `json:"currency"`
	Card        cardMaskWire `json:"card"`
}

type cardMaskWire struct {
	Brand *string `json:"brand"`
	Last4 *string `json:"last4"`
}

func paymentAuthorizedPayload(s PaymentAuthorized) paymentAuthorizedWire {
	return paymentAuthorizedWire{
		OrderID: s.OrderID, AmountCents: s.AmountCents, Currency: s.Currency,
		Card: cardMaskWire{Brand: s.Card.Brand, Last4: s.Card.Last4},
	}
}

type paymentActionRequiredWire struct {
	OrderID      string    `json:"order_id"`
	ClientSecret string    `json:"client_secret"`
	ExpiresAt    Timestamp `json:"expires_at"`
}

func paymentActionRequiredPayload(s PaymentActionRequired) paymentActionRequiredWire {
	return paymentActionRequiredWire{OrderID: s.OrderID, ClientSecret: s.ClientSecret, ExpiresAt: s.ExpiresAt}
}

type paymentCapturedWire struct {
	OrderID     string    `json:"order_id"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	CapturedAt  Timestamp `json:"captured_at"`
}

func paymentCapturedPayload(s PaymentCaptured) paymentCapturedWire {
	return paymentCapturedWire{
		OrderID: s.OrderID, AmountCents: s.AmountCents, Currency: s.Currency, CapturedAt: s.CapturedAt,
	}
}

type paymentFailedWire struct {
	OrderID     string  `json:"order_id"`
	Code        string  `json:"code"`
	DeclineCode *string `json:"decline_code"`
	Message     string  `json:"message"`
	Retryable   bool    `json:"retryable"`
}

func paymentFailedPayload(s PaymentFailed) paymentFailedWire {
	return paymentFailedWire{
		OrderID: s.OrderID, Code: s.Code, DeclineCode: s.DeclineCode, Message: s.Message, Retryable: s.Retryable,
	}
}

type refundCreatedWire struct {
	OrderID     string                    `json:"order_id"`
	RefundID    string                    `json:"refund_id"`
	AmountCents int64                     `json:"amount_cents"`
	Currency    string                    `json:"currency"`
	ReasonCode  contract.RefundReasonCode `json:"reason_code"`
	State       contract.RefundState      `json:"state"`
}

func refundCreatedPayload(s RefundCreated) refundCreatedWire {
	return refundCreatedWire{
		OrderID: s.OrderID, RefundID: s.RefundID, AmountCents: s.AmountCents, Currency: s.Currency,
		ReasonCode: s.ReasonCode, State: s.State,
	}
}

type refundSettledWire struct {
	OrderID     string    `json:"order_id"`
	RefundID    string    `json:"refund_id"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	SettledAt   Timestamp `json:"settled_at"`
}

func refundSettledPayload(s RefundSettled) refundSettledWire {
	return refundSettledWire{
		OrderID: s.OrderID, RefundID: s.RefundID, AmountCents: s.AmountCents, Currency: s.Currency,
		SettledAt: s.SettledAt,
	}
}

type refundFailedWire struct {
	OrderID  string `json:"order_id"`
	RefundID string `json:"refund_id"`
	Message  string `json:"message"`
}

func refundFailedPayload(s RefundFailed) refundFailedWire {
	return refundFailedWire{OrderID: s.OrderID, RefundID: s.RefundID, Message: s.Message}
}

// ---------------------------------------------------------------------------
// Section 4.4 — restaurant, on restaurant:{restaurant_id}.
// ---------------------------------------------------------------------------

type restaurantOrderOfferedWire struct {
	OrderID              string              `json:"order_id"`
	Code                 string              `json:"code"`
	ExpiresAt            Timestamp           `json:"expires_at"`
	DeadlineAt           Timestamp           `json:"deadline_at"`
	CustomerFirstName    string              `json:"customer_first_name"`
	Lines                []offeredLineWire   `json:"lines"`
	SubtotalCents        int64               `json:"subtotal_cents"`
	TotalCents           int64               `json:"total_cents"`
	Currency             string              `json:"currency"`
	PrepEtaSuggestionMin int                 `json:"prep_eta_suggestion_min"`
	Fulfilment           contract.Fulfilment `json:"fulfilment"`
}

type offeredLineWire struct {
	Name    string   `json:"name"`
	Variant *string  `json:"variant"`
	Addons  []string `json:"addons"`
	Qty     int      `json:"qty"`
	Note    *string  `json:"note"`
}

func restaurantOrderOfferedPayload(s RestaurantOrderOffered) restaurantOrderOfferedWire {
	lines := make([]offeredLineWire, 0, len(s.Lines))
	for _, l := range s.Lines {
		lines = append(lines, offeredLineWire{
			Name: l.Name, Variant: l.Variant, Addons: copyStrings(l.Addons), Qty: l.Qty, Note: l.Note,
		})
	}
	return restaurantOrderOfferedWire{
		OrderID: s.OrderID, Code: s.Code, ExpiresAt: s.ExpiresAt, DeadlineAt: s.DeadlineAt,
		CustomerFirstName: s.CustomerFirstName, Lines: lines,
		SubtotalCents: s.SubtotalCents, TotalCents: s.TotalCents, Currency: s.Currency,
		PrepEtaSuggestionMin: s.PrepEtaSuggestionMin, Fulfilment: s.Fulfilment,
	}
}

type restaurantOrderOfferExpiredWire struct {
	OrderID string             `json:"order_id"`
	Reason  OfferExpiredReason `json:"reason"`
}

func restaurantOrderOfferExpiredPayload(s RestaurantOrderOfferExpired) restaurantOrderOfferExpiredWire {
	return restaurantOrderOfferExpiredWire{OrderID: s.OrderID, Reason: s.Reason}
}

type restaurantOrderOfferWithdrawnWire struct {
	OrderID string               `json:"order_id"`
	Reason  OfferWithdrawnReason `json:"reason"`
}

func restaurantOrderOfferWithdrawnPayload(s RestaurantOrderOfferWithdrawn) restaurantOrderOfferWithdrawnWire {
	return restaurantOrderOfferWithdrawnWire{OrderID: s.OrderID, Reason: s.Reason}
}

// restaurantOrderAcceptedWire is restaurant.order_accepted for the restaurant's
// staff. PickupCode is the 4-digit code the kitchen reads to the rider at the
// counter (contracts/websocket.md section 4.4). The source record holds no
// code yet: the backend that issues and stores the codes is
// https://github.com/shaiknoorullah/hg-mono/pull/315, so until it lands this
// is always null and the restaurant reads the code from its own order view
// (OrderRestaurantView.pickup_code), which is null too.
type restaurantOrderAcceptedWire struct {
	OrderID        string  `json:"order_id"`
	AcceptedBy     string  `json:"accepted_by"`
	PrepEtaMinutes int     `json:"prep_eta_minutes"`
	PickupCode     *string `json:"pickup_code"`
}

func restaurantOrderAcceptedPayload(s RestaurantOrderAccepted) restaurantOrderAcceptedWire {
	return restaurantOrderAcceptedWire{OrderID: s.OrderID, AcceptedBy: s.AcceptedBy, PrepEtaMinutes: s.PrepEtaMinutes}
}

// restaurantOrderAcceptedForSupportWire is restaurant.order_accepted for
// support and admin: the pickup code is withheld, so nobody at HalalGoes can
// read a code out to a rider (contracts/websocket.md section 4.4).
type restaurantOrderAcceptedForSupportWire struct {
	OrderID        string   `json:"order_id"`
	AcceptedBy     string   `json:"accepted_by"`
	PrepEtaMinutes int      `json:"prep_eta_minutes"`
	PickupCode     Withheld `json:"pickup_code"`
}

func restaurantOrderAcceptedForSupport(s RestaurantOrderAccepted) restaurantOrderAcceptedForSupportWire {
	return restaurantOrderAcceptedForSupportWire{OrderID: s.OrderID, AcceptedBy: s.AcceptedBy, PrepEtaMinutes: s.PrepEtaMinutes}
}

type restaurantOrderRejectedWire struct {
	OrderID    string                              `json:"order_id"`
	RejectedBy string                              `json:"rejected_by"`
	ReasonCode contract.RestaurantRejectReasonCode `json:"reason_code"`
}

func restaurantOrderRejectedPayload(s RestaurantOrderRejected) restaurantOrderRejectedWire {
	return restaurantOrderRejectedWire{OrderID: s.OrderID, RejectedBy: s.RejectedBy, ReasonCode: s.ReasonCode}
}

type restaurantStatusChangedWire struct {
	RestaurantID      string                       `json:"restaurant_id"`
	IsAcceptingOrders bool                         `json:"is_accepting_orders"`
	OpenState         contract.RestaurantOpenState `json:"open_state"`
	Reason            *string                      `json:"reason"`
	ChangedBy         string                       `json:"changed_by"`
}

func restaurantStatusChangedPayload(s RestaurantStatusChanged) restaurantStatusChangedWire {
	return restaurantStatusChangedWire{
		RestaurantID: s.RestaurantID, IsAcceptingOrders: s.IsAcceptingOrders, OpenState: s.OpenState,
		Reason: s.Reason, ChangedBy: s.ChangedBy,
	}
}

type restaurantPayoutUpdatedWire struct {
	PayoutID    string               `json:"payout_id"`
	State       contract.PayoutState `json:"state"`
	AmountCents int64                `json:"amount_cents"`
	Currency    string               `json:"currency"`
	Period      payoutPeriodWire     `json:"period"`
}

type payoutPeriodWire struct {
	Start Timestamp `json:"start"`
	End   Timestamp `json:"end"`
}

func restaurantPayoutUpdatedPayload(s RestaurantPayoutUpdated) restaurantPayoutUpdatedWire {
	return restaurantPayoutUpdatedWire{
		PayoutID: s.PayoutID, State: s.State, AmountCents: s.AmountCents, Currency: s.Currency,
		Period: payoutPeriodWire{Start: s.Period.Start, End: s.Period.End},
	}
}

// ---------------------------------------------------------------------------
// Section 4.5 — dispatch and rider.
// ---------------------------------------------------------------------------

type dispatchOfferWire struct {
	OrderID          string           `json:"order_id"`
	OfferID          string           `json:"offer_id"`
	ExpiresAt        Timestamp        `json:"expires_at"`
	ServerTime       Timestamp        `json:"server_time"`
	Pickup           offerPickupWire  `json:"pickup"`
	Dropoff          offerDropoffWire `json:"dropoff"`
	DistanceM        int              `json:"distance_m"`
	EstDurationS     int              `json:"est_duration_s"`
	EarningsCents    int64            `json:"earnings_cents"`
	TipCentsEstimate int64            `json:"tip_cents_estimate"`
	ItemsCount       int              `json:"items_count"`
}

type offerPickupWire struct {
	RestaurantName string  `json:"restaurant_name"`
	AddressShort   string  `json:"address_short"`
	Lat            float64 `json:"lat"`
	Lng            float64 `json:"lng"`
}

// offerDropoffWire is the drop-off's approximate area only: no street number,
// no unit, and a point about a kilometre across, never the address's own.
type offerDropoffWire struct {
	Area    string  `json:"area"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	RadiusM int32   `json:"radius_m"`
}

// offerAreaRadiusM is the radius of the circle around the rounded drop-off
// point that is sure to contain the address. areaDegrees moves each
// coordinate by at most 0.005 degrees: about 556 m north–south, and at most
// 414 m east–west south of Canada's southernmost point (41.7° N), so the
// address is within 693 m.
const offerAreaRadiusM = 700

// areaDegrees rounds a coordinate to two decimals: a cell about 1.1 km
// north–south and 0.8 km east–west at Ontario's latitudes. That is a
// neighbourhood, enough for a rider to judge the trip's distance and
// direction, and many streets wide, so it does not point at a home.
func areaDegrees(f float64) float64 { return math.Round(f*100) / 100 }

// ApproximateArea is the drop-off point a rider is shown before accepting an
// offer: the delivery address's coordinates rounded to about a kilometre. The
// exact point identifies the customer's home, and the owner decided a rider
// sees only the approximate area until accepting (the customer's address on a
// rider's offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
// dispatch.offer's producer stores only this point and its serializer rounds
// again, so neither the outbox nor the wire ever holds the exact one.
func ApproximateArea(lat, lng float64) (float64, float64) {
	return areaDegrees(lat), areaDegrees(lng)
}

func dispatchOfferPayload(s DispatchOffer) dispatchOfferWire {
	lat, lng := ApproximateArea(s.Dropoff.Lat, s.Dropoff.Lng)
	return dispatchOfferWire{
		OrderID: s.OrderID, OfferID: s.OfferID, ExpiresAt: s.ExpiresAt, ServerTime: s.ServerTime,
		Pickup: offerPickupWire{
			RestaurantName: s.Pickup.RestaurantName, AddressShort: s.Pickup.AddressShort,
			Lat: s.Pickup.Lat, Lng: s.Pickup.Lng,
		},
		Dropoff:   offerDropoffWire{Area: s.Dropoff.Area, Lat: lat, Lng: lng, RadiusM: offerAreaRadiusM},
		DistanceM: s.DistanceM, EstDurationS: s.EstDurationS,
		EarningsCents: s.EarningsCents, TipCentsEstimate: s.TipCentsEstimate, ItemsCount: s.ItemsCount,
	}
}

type dispatchOfferWithdrawnWire struct {
	OrderID string                  `json:"order_id"`
	OfferID string                  `json:"offer_id"`
	Reason  DispatchWithdrawnReason `json:"reason"`
}

func dispatchOfferWithdrawnPayload(s DispatchOfferWithdrawn) dispatchOfferWithdrawnWire {
	return dispatchOfferWithdrawnWire{OrderID: s.OrderID, OfferID: s.OfferID, Reason: s.Reason}
}

type dispatchAssignedWire struct {
	OrderID     string          `json:"order_id"`
	Rider       riderPublicWire `json:"rider"`
	PickupEtaAt *Timestamp      `json:"pickup_eta_at"`
}

// riderPublicWire is the rider's public profile — never earnings, phone or
// record.
type riderPublicWire struct {
	FirstName   string                `json:"first_name"`
	PhotoURL    *string               `json:"photo_url"`
	VehicleType *contract.VehicleType `json:"vehicle_type"`
	RatingAvg   *float64              `json:"rating_avg"`
}

func dispatchAssignedPayload(s DispatchAssigned) dispatchAssignedWire {
	return dispatchAssignedWire{
		OrderID: s.OrderID,
		Rider: riderPublicWire{
			FirstName: s.Rider.FirstName, PhotoURL: s.Rider.PhotoURL,
			VehicleType: s.Rider.VehicleType, RatingAvg: s.Rider.RatingAvg,
		},
		PickupEtaAt: s.PickupEtaAt,
	}
}

type dispatchUnassignedWire struct {
	OrderID string `json:"order_id"`
	Reason  string `json:"reason"`
}

func dispatchUnassignedPayload(s DispatchUnassigned) dispatchUnassignedWire {
	return dispatchUnassignedWire{OrderID: s.OrderID, Reason: s.Reason}
}

type dispatchStateChangedWire struct {
	OrderID string                 `json:"order_id"`
	From    contract.DispatchState `json:"from"`
	To      contract.DispatchState `json:"to"`
	At      Timestamp              `json:"at"`
}

func dispatchStateChangedPayload(s DispatchStateChanged) dispatchStateChangedWire {
	return dispatchStateChangedWire{OrderID: s.OrderID, From: s.From, To: s.To, At: s.At}
}

// riderLocationWire is rider.location as the contract defines it: the precise
// position, for support always and for the customer after pickup.
type riderLocationWire struct {
	OrderID    string    `json:"order_id"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	HeadingDeg *float64  `json:"heading_deg"`
	SpeedMps   *float64  `json:"speed_mps"`
	AccuracyM  *float64  `json:"accuracy_m"`
	RecordedAt Timestamp `json:"recorded_at"`
}

func riderLocationPrecise(s RiderLocation) riderLocationWire {
	return riderLocationWire{
		OrderID: s.OrderID, Lat: s.Lat, Lng: s.Lng, HeadingDeg: s.HeadingDeg,
		SpeedMps: s.SpeedMps, AccuracyM: s.AccuracyM, RecordedAt: s.RecordedAt,
	}
}

// riderLocationCoarseWire is rider.location at roughly 100 m: enough to know
// the rider is close, not enough to follow them. Heading, speed and accuracy
// would let a viewer recover the fine position, so they are withheld too.
type riderLocationCoarseWire struct {
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

// riderLocationCoarse is the restaurant's view, always, and the customer's
// before pickup.
func riderLocationCoarse(s RiderLocation) riderLocationCoarseWire {
	return riderLocationCoarseWire{
		OrderID: s.OrderID, Lat: coarseDegrees(s.Lat), Lng: coarseDegrees(s.Lng), RecordedAt: s.RecordedAt,
	}
}

// riderPickedUp picks the customer's rider.location serializer: the customer
// never sees the rider's exact position before pickup (section 5, the customer
// row).
func riderPickedUp(s RiderLocation) bool { return s.PickedUp }

type riderAvailabilityChangedWire struct {
	AccountID         string                          `json:"account_id"`
	IsOnline          bool                            `json:"is_online"`
	AvailabilityState contract.RiderAvailabilityState `json:"availability_state"`
	At                Timestamp                       `json:"at"`
}

func riderAvailabilityChangedPayload(s RiderAvailabilityChanged) riderAvailabilityChangedWire {
	return riderAvailabilityChangedWire{
		AccountID: s.AccountID, IsOnline: s.IsOnline, AvailabilityState: s.AvailabilityState, At: s.At,
	}
}

type riderEarningsUpdatedWire struct {
	AccountID     string `json:"account_id"`
	Period        string `json:"period"`
	EarningsCents int64  `json:"earnings_cents"`
	Currency      string `json:"currency"`
	Deliveries    int    `json:"deliveries"`
}

func riderEarningsUpdatedPayload(s RiderEarningsUpdated) riderEarningsUpdatedWire {
	return riderEarningsUpdatedWire{
		AccountID: s.AccountID, Period: s.Period, EarningsCents: s.EarningsCents,
		Currency: s.Currency, Deliveries: s.Deliveries,
	}
}

// ---------------------------------------------------------------------------
// Section 4.6 — account and onboarding, on account:{account_id}.
// ---------------------------------------------------------------------------

type accountSecurityEventWire struct {
	Kind   SecurityEventKind `json:"kind"`
	At     Timestamp         `json:"at"`
	IPCity *string           `json:"ip_city"`
}

func accountSecurityEventPayload(s AccountSecurityEvent) accountSecurityEventWire {
	return accountSecurityEventWire{Kind: s.Kind, At: s.At, IPCity: s.IPCity}
}

type documentReviewStateChangedWire struct {
	DocumentID string                    `json:"document_id"`
	DocType    string                    `json:"doc_type"`
	State      contract.KycDocumentState `json:"state"`
	Reason     *string                   `json:"reason"`
	ReviewedAt Timestamp                 `json:"reviewed_at"`
}

func documentReviewStateChangedPayload(s DocumentReviewStateChanged) documentReviewStateChangedWire {
	return documentReviewStateChangedWire{
		DocumentID: s.DocumentID, DocType: s.DocType, State: s.State, Reason: s.Reason, ReviewedAt: s.ReviewedAt,
	}
}

type onboardingStateChangedWire struct {
	SubjectType OnboardingSubject `json:"subject_type"`
	SubjectID   string            `json:"subject_id"`
	From        *string           `json:"from"`
	To          string            `json:"to"`
	NextAction  *string           `json:"next_action"`
}

func onboardingStateChangedPayload(s OnboardingStateChanged) onboardingStateChangedWire {
	return onboardingStateChangedWire{
		SubjectType: s.SubjectType, SubjectID: s.SubjectID, From: s.From, To: s.To, NextAction: s.NextAction,
	}
}

type connectRequirementsChangedWire struct {
	CurrentlyDue   []string   `json:"currently_due"`
	PastDue        []string   `json:"past_due"`
	PayoutsEnabled bool       `json:"payouts_enabled"`
	Deadline       *Timestamp `json:"deadline"`
}

func connectRequirementsChangedPayload(s ConnectRequirementsChanged) connectRequirementsChangedWire {
	return connectRequirementsChangedWire{
		CurrentlyDue: copyStrings(s.CurrentlyDue), PastDue: copyStrings(s.PastDue),
		PayoutsEnabled: s.PayoutsEnabled, Deadline: s.Deadline,
	}
}

type notificationCreatedWire struct {
	NotificationID string    `json:"notification_id"`
	Kind           string    `json:"kind"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	DeepLink       *string   `json:"deep_link"`
	CreatedAt      Timestamp `json:"created_at"`
}

func notificationCreatedPayload(s NotificationCreated) notificationCreatedWire {
	return notificationCreatedWire{
		NotificationID: s.NotificationID, Kind: s.Kind, Title: s.Title, Body: s.Body,
		DeepLink: s.DeepLink, CreatedAt: s.CreatedAt,
	}
}

type notificationReadWire struct {
	NotificationID string    `json:"notification_id"`
	ReadAt         Timestamp `json:"read_at"`
}

func notificationReadPayload(s NotificationRead) notificationReadWire {
	return notificationReadWire{NotificationID: s.NotificationID, ReadAt: s.ReadAt}
}

// ---------------------------------------------------------------------------
// Section 4.7 — admin, on admin:ops.
// ---------------------------------------------------------------------------

type adminAlertWire struct {
	Severity    string    `json:"severity"`
	Kind        string    `json:"kind"`
	SubjectType string    `json:"subject_type"`
	SubjectID   string    `json:"subject_id"`
	Message     string    `json:"message"`
	At          Timestamp `json:"at"`
}

func adminAlertPayload(s AdminAlert) adminAlertWire {
	return adminAlertWire{
		Severity: s.Severity, Kind: s.Kind, SubjectType: s.SubjectType, SubjectID: s.SubjectID,
		Message: s.Message, At: s.At,
	}
}

type adminDispatchFailureWire struct {
	OrderID       string `json:"order_id"`
	Waves         int    `json:"waves"`
	RidersOffered int    `json:"riders_offered"`
	RadiusM       int    `json:"radius_m"`
}

func adminDispatchFailurePayload(s AdminDispatchFailure) adminDispatchFailureWire {
	return adminDispatchFailureWire{
		OrderID: s.OrderID, Waves: s.Waves, RidersOffered: s.RidersOffered, RadiusM: s.RadiusM,
	}
}

type adminReconciliationExceptionWire struct {
	Kind          string `json:"kind"`
	OrderID       string `json:"order_id"`
	ExpectedCents int64  `json:"expected_cents"`
	ActualCents   int64  `json:"actual_cents"`
}

func adminReconciliationExceptionPayload(s AdminReconciliationException) adminReconciliationExceptionWire {
	return adminReconciliationExceptionWire{
		Kind: s.Kind, OrderID: s.OrderID, ExpectedCents: s.ExpectedCents, ActualCents: s.ActualCents,
	}
}

type adminQueueDepthWire struct {
	PendingRestaurantReviews int `json:"pending_restaurant_reviews"`
	PendingRiderReviews      int `json:"pending_rider_reviews"`
	OpenDisputes             int `json:"open_disputes"`
	FailedRefunds            int `json:"failed_refunds"`
}

func adminQueueDepthPayload(s AdminQueueDepth) adminQueueDepthWire {
	return adminQueueDepthWire{
		PendingRestaurantReviews: s.PendingRestaurantReviews, PendingRiderReviews: s.PendingRiderReviews,
		OpenDisputes: s.OpenDisputes, FailedRefunds: s.FailedRefunds,
	}
}

// copyStrings copies a string list into a new one, never nil: the contract's lists
// are arrays, not nullable.
func copyStrings(in []string) []string { return append(make([]string, 0, len(in)), in...) }
