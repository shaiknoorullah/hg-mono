package realtime

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// This file is the event catalogue of contracts/websocket.md, section 4 ("Event
// catalogue"), as the records producers emit: one struct per event type. A
// producer (the orders, dispatch and catalog modules) builds one of these
// inside the transaction that changes the state, and Emit writes it to the
// transactional outbox (emit.go).
//
// What a producer builds is the event's SOURCE record. It is what
// realtime_event.payload stores, and it is never sent. At send time the
// gateway runs the one serializer the allow-list in catalogue.go names for
// (role, event type), which builds that role's payload, a separate wire type
// in wire.go, field by field (contracts/websocket.md section 5, "Per-role
// projection rules"). A field added here reaches no one until a serializer
// names it.
//
// The schema GET /v1/realtime/schema serves is generated from the wire types
// (schema.go), and catalogue_contract_test.go checks every field name against
// the tables in contracts/websocket.md and every enum against
// contracts/openapi.yaml, so a rename on either side fails the build.

// tsLayout is the contract's Timestamp: RFC 3339 with milliseconds, UTC, Z.
const tsLayout = "2006-01-02T15:04:05.000Z"

// Timestamp is a contract Timestamp. It always encodes as RFC 3339 with
// milliseconds in UTC ("2026-08-10T14:03:11.412Z"), whatever zone the
// time.Time it was built from carried.
type Timestamp struct{ t time.Time }

// At wraps a time as a contract Timestamp.
func At(t time.Time) Timestamp { return Timestamp{t: t.UTC()} }

// AtPtr wraps an optional time; nil stays nil (a JSON null).
func AtPtr(t *time.Time) *Timestamp {
	if t == nil {
		return nil
	}
	ts := At(*t)
	return &ts
}

// Time returns the wrapped time in UTC.
func (ts Timestamp) Time() time.Time { return ts.t }

// MarshalJSON encodes the contract's Timestamp form.
func (ts Timestamp) MarshalJSON() ([]byte, error) {
	return json.Marshal(ts.t.UTC().Format(tsLayout))
}

// UnmarshalJSON accepts any RFC 3339 time.
func (ts *Timestamp) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return fmt.Errorf("timestamp %q: %w", s, err)
	}
	ts.t = t.UTC()
	return nil
}

// Withheld is a field a role's serializer may not fill (contracts/websocket.md
// section 5). It has no value to set and always encodes as JSON null, so a
// withheld field cannot leak by a forgotten branch: the role's wire type
// (wire.go) has nowhere to put the value.
type Withheld struct{}

// MarshalJSON always writes null.
func (Withheld) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

// Closed string sets the contract spells out inline, in the event table, rather
// than as an openapi.yaml enum. Each has Valid so Emit refuses a value outside
// the set (emit.go).

// EtaSource is order.eta_updated's source: "ROUTED" | "CACHED" | "FALLBACK".
type EtaSource string

const (
	// EtaRouted: the routes came from the routing engine.
	EtaRouted EtaSource = "ROUTED"
	// EtaCached: the routes came from a stored route estimate between the same
	// two places.
	EtaCached EtaSource = "CACHED"
	// EtaFallback: the routing engine was unavailable, so the distances are
	// straight-line ones with a detour factor.
	EtaFallback EtaSource = "FALLBACK"
)

// Valid reports membership of the closed set.
func (e EtaSource) Valid() bool { return e == EtaRouted || e == EtaCached || e == EtaFallback }

// OfferExpiredReason is restaurant.order_offer_expired's reason: "timeout".
type OfferExpiredReason string

// OfferExpiredTimeout: the restaurant did not answer within its window.
const OfferExpiredTimeout OfferExpiredReason = "timeout"

// Valid reports membership of the closed set.
func (r OfferExpiredReason) Valid() bool { return r == OfferExpiredTimeout }

// OfferWithdrawnReason is restaurant.order_offer_withdrawn's reason:
// "customer_cancelled" | "payment_failed".
type OfferWithdrawnReason string

const (
	// OfferWithdrawnCustomerCancelled: the customer cancelled the order.
	OfferWithdrawnCustomerCancelled OfferWithdrawnReason = "customer_cancelled"
	// OfferWithdrawnPaymentFailed: the order's payment failed.
	OfferWithdrawnPaymentFailed OfferWithdrawnReason = "payment_failed"
)

// Valid reports membership of the closed set.
func (r OfferWithdrawnReason) Valid() bool {
	return r == OfferWithdrawnCustomerCancelled || r == OfferWithdrawnPaymentFailed
}

// DispatchWithdrawnReason is dispatch.offer_withdrawn's reason: "taken" |
// "expired" | "cancelled".
type DispatchWithdrawnReason string

const (
	// DispatchWithdrawnTaken: another rider accepted the order first.
	DispatchWithdrawnTaken DispatchWithdrawnReason = "taken"
	// DispatchWithdrawnExpired: the offer's time ran out.
	DispatchWithdrawnExpired DispatchWithdrawnReason = "expired"
	// DispatchWithdrawnCancelled: the order was cancelled.
	DispatchWithdrawnCancelled DispatchWithdrawnReason = "cancelled"
)

// Valid reports membership of the closed set.
func (r DispatchWithdrawnReason) Valid() bool {
	return r == DispatchWithdrawnTaken || r == DispatchWithdrawnExpired || r == DispatchWithdrawnCancelled
}

// SecurityEventKind is account.security_event's kind.
type SecurityEventKind string

const (
	// SecurityNewDeviceLogin: the account signed in on a device it had not
	// used before.
	SecurityNewDeviceLogin SecurityEventKind = "new_device_login"
	// SecurityPasswordChanged: the account's password was changed.
	SecurityPasswordChanged SecurityEventKind = "password_changed"
	// SecuritySessionRevoked: one of the account's sessions was revoked.
	SecuritySessionRevoked SecurityEventKind = "session_revoked"
)

// Valid reports membership of the closed set.
func (k SecurityEventKind) Valid() bool {
	return k == SecurityNewDeviceLogin || k == SecurityPasswordChanged || k == SecuritySessionRevoked
}

// OnboardingSubject is onboarding.state_changed's subject_type.
type OnboardingSubject string

const (
	// OnboardingRestaurant: a restaurant's onboarding changed state.
	OnboardingRestaurant OnboardingSubject = "RESTAURANT"
	// OnboardingRider: a rider's onboarding changed state.
	OnboardingRider OnboardingSubject = "RIDER"
)

// Valid reports membership of the closed set.
func (s OnboardingSubject) Valid() bool { return s == OnboardingRestaurant || s == OnboardingRider }

// ---------------------------------------------------------------------------
// Section 4.2 — order, on order:{order_id}.
// ---------------------------------------------------------------------------

// OrderCreated is order.created, to the customer.
type OrderCreated struct {
	OrderID    string              `json:"order_id"`
	Code       string              `json:"code"`
	State      contract.OrderState `json:"state"`
	Restaurant RestaurantRef       `json:"restaurant"`
	TotalCents int64               `json:"total_cents"`
	Currency   string              `json:"currency"`
	PlacedAt   Timestamp           `json:"placed_at"`
	DeadlineAt Timestamp           `json:"deadline_at"`
}

// RestaurantRef is order.created's restaurant.
type RestaurantRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// OrderStateChanged is order.state_changed, to every participant. From is nil
// only for the order's creation.
type OrderStateChanged struct {
	OrderID    string                  `json:"order_id"`
	From       *contract.OrderState    `json:"from"`
	To         contract.OrderState     `json:"to"`
	At         Timestamp               `json:"at"`
	Reason     *string                 `json:"reason"`
	ActorKind  contract.OrderActorKind `json:"actor_kind"`
	DeadlineAt *Timestamp              `json:"deadline_at"`
	EtaAt      *Timestamp              `json:"eta_at"`
}

// OrderEtaUpdated is order.eta_updated, to the customer and the restaurant.
type OrderEtaUpdated struct {
	OrderID      string     `json:"order_id"`
	PickupEtaAt  *Timestamp `json:"pickup_eta_at"`
	DropoffEtaAt *Timestamp `json:"dropoff_eta_at"`
	Source       EtaSource  `json:"source"`
}

// OrderItemsAdjusted is order.items_adjusted, to the customer and the restaurant.
type OrderItemsAdjusted struct {
	OrderID       string        `json:"order_id"`
	Removed       []RemovedLine `json:"removed"`
	NewTotalCents int64         `json:"new_total_cents"`
	NewQuoteID    string        `json:"new_quote_id"`
}

// RemovedLine is one line order.items_adjusted removed.
type RemovedLine struct {
	LineNo int    `json:"line_no"`
	Name   string `json:"name"`
	Qty    int    `json:"qty"`
}

// OrderCancelled is order.cancelled, to every participant. The rider's copy
// withholds the refund: the rider is never sent the order's money
// (contracts/websocket.md section 5, the rider row).
type OrderCancelled struct {
	OrderID    string                               `json:"order_id"`
	ReasonCode contract.OrderCancellationReasonCode `json:"reason_code"`
	By         contract.OrderActorKind              `json:"by"`
	Refund     *CancelledRefund                     `json:"refund"`
}

// CancelledRefund is order.cancelled's refund.
type CancelledRefund struct {
	Kind        contract.RefundKind  `json:"kind"`
	AmountCents int64                `json:"amount_cents"`
	State       contract.RefundState `json:"state"`
}

// OrderCompleted is order.completed. Only the customer (and support) get the
// receipt: it prints every price, which the rider must never see, and it is
// the customer's document, not the restaurant's.
type OrderCompleted struct {
	OrderID     string    `json:"order_id"`
	DeliveredAt Timestamp `json:"delivered_at"`
	ReceiptURL  *string   `json:"receipt_url"`
}

// OrderNoteAdded is order.note_added, to the restaurant, the rider and support.
type OrderNoteAdded struct {
	OrderID    string                  `json:"order_id"`
	AuthorKind contract.OrderActorKind `json:"author_kind"`
	Text       string                  `json:"text"`
	At         Timestamp               `json:"at"`
}

// OrderRiderArrived is order.rider_arrived, to the customer: the rider is at
// the drop-off. It never carries a handover code; on it the customer app
// fetches delivery_code from its own authenticated order view
// (contracts/websocket.md section 4.2; security review on
// https://github.com/shaiknoorullah/hg-mono/issues/183).
type OrderRiderArrived struct {
	OrderID string    `json:"order_id"`
	At      Timestamp `json:"at"`
}

// ---------------------------------------------------------------------------
// Section 4.3 — payment, on order:{order_id}.
// ---------------------------------------------------------------------------

// PaymentAuthorized is payment.authorized, to the customer.
type PaymentAuthorized struct {
	OrderID     string   `json:"order_id"`
	AmountCents int64    `json:"amount_cents"`
	Currency    string   `json:"currency"`
	Card        CardMask `json:"card"`
}

// CardMask is the brand and last four digits — never more of a card.
type CardMask struct {
	Brand *string `json:"brand"`
	Last4 *string `json:"last4"`
}

// PaymentActionRequired is payment.action_required, to the customer only: the
// client secret is a token, so not even support is sent it.
type PaymentActionRequired struct {
	OrderID      string    `json:"order_id"`
	ClientSecret string    `json:"client_secret"`
	ExpiresAt    Timestamp `json:"expires_at"`
}

// PaymentCaptured is payment.captured, to the customer.
type PaymentCaptured struct {
	OrderID     string    `json:"order_id"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	CapturedAt  Timestamp `json:"captured_at"`
}

// PaymentFailed is payment.failed, to the customer.
type PaymentFailed struct {
	OrderID     string  `json:"order_id"`
	Code        string  `json:"code"`
	DeclineCode *string `json:"decline_code"`
	Message     string  `json:"message"`
	Retryable   bool    `json:"retryable"`
}

// RefundCreated is refund.created, to the customer.
type RefundCreated struct {
	OrderID     string                    `json:"order_id"`
	RefundID    string                    `json:"refund_id"`
	AmountCents int64                     `json:"amount_cents"`
	Currency    string                    `json:"currency"`
	ReasonCode  contract.RefundReasonCode `json:"reason_code"`
	State       contract.RefundState      `json:"state"`
}

// RefundSettled is refund.settled, to the customer.
type RefundSettled struct {
	OrderID     string    `json:"order_id"`
	RefundID    string    `json:"refund_id"`
	AmountCents int64     `json:"amount_cents"`
	Currency    string    `json:"currency"`
	SettledAt   Timestamp `json:"settled_at"`
}

// RefundFailed is refund.failed, to the customer and support.
type RefundFailed struct {
	OrderID  string `json:"order_id"`
	RefundID string `json:"refund_id"`
	Message  string `json:"message"`
}

// ---------------------------------------------------------------------------
// Section 4.4 — restaurant, on restaurant:{restaurant_id}.
// ---------------------------------------------------------------------------

// RestaurantOrderOffered is restaurant.order_offered: the pre-acceptance view.
// The customer's first name only — no phone, no address, no handover code.
type RestaurantOrderOffered struct {
	OrderID              string              `json:"order_id"`
	Code                 string              `json:"code"`
	ExpiresAt            Timestamp           `json:"expires_at"`
	DeadlineAt           Timestamp           `json:"deadline_at"`
	CustomerFirstName    string              `json:"customer_first_name"`
	Lines                []OfferedLine       `json:"lines"`
	SubtotalCents        int64               `json:"subtotal_cents"`
	TotalCents           int64               `json:"total_cents"`
	Currency             string              `json:"currency"`
	PrepEtaSuggestionMin int                 `json:"prep_eta_suggestion_min"`
	Fulfilment           contract.Fulfilment `json:"fulfilment"`
}

// OfferedLine is one line of restaurant.order_offered.
type OfferedLine struct {
	Name    string   `json:"name"`
	Variant *string  `json:"variant"`
	Addons  []string `json:"addons"`
	Qty     int      `json:"qty"`
	Note    *string  `json:"note"`
}

// RestaurantOrderOfferExpired is restaurant.order_offer_expired.
type RestaurantOrderOfferExpired struct {
	OrderID string             `json:"order_id"`
	Reason  OfferExpiredReason `json:"reason"`
}

// RestaurantOrderOfferWithdrawn is restaurant.order_offer_withdrawn.
type RestaurantOrderOfferWithdrawn struct {
	OrderID string               `json:"order_id"`
	Reason  OfferWithdrawnReason `json:"reason"`
}

// RestaurantOrderAccepted is restaurant.order_accepted, the fan-out to the
// restaurant's other tablets. AcceptedBy is the staff member's display name.
type RestaurantOrderAccepted struct {
	OrderID        string `json:"order_id"`
	AcceptedBy     string `json:"accepted_by"`
	PrepEtaMinutes int    `json:"prep_eta_minutes"`
}

// RestaurantOrderRejected is restaurant.order_rejected.
type RestaurantOrderRejected struct {
	OrderID    string                              `json:"order_id"`
	RejectedBy string                              `json:"rejected_by"`
	ReasonCode contract.RestaurantRejectReasonCode `json:"reason_code"`
}

// RestaurantStatusChanged is restaurant.status_changed.
type RestaurantStatusChanged struct {
	RestaurantID      string                       `json:"restaurant_id"`
	IsAcceptingOrders bool                         `json:"is_accepting_orders"`
	OpenState         contract.RestaurantOpenState `json:"open_state"`
	Reason            *string                      `json:"reason"`
	ChangedBy         string                       `json:"changed_by"`
}

// RestaurantPayoutUpdated is restaurant.payout_updated.
type RestaurantPayoutUpdated struct {
	PayoutID    string               `json:"payout_id"`
	State       contract.PayoutState `json:"state"`
	AmountCents int64                `json:"amount_cents"`
	Currency    string               `json:"currency"`
	Period      PayoutPeriod         `json:"period"`
}

// PayoutPeriod is restaurant.payout_updated's period.
type PayoutPeriod struct {
	Start Timestamp `json:"start"`
	End   Timestamp `json:"end"`
}

// ---------------------------------------------------------------------------
// Section 4.5 — dispatch and rider. Offers on rider:{account_id}, progress on
// order:{order_id}.
// ---------------------------------------------------------------------------

// DispatchOffer is dispatch.offer, to the offered rider only. It never carries
// the customer's unit, phone alias, the order's prices or a handover code.
type DispatchOffer struct {
	OrderID          string       `json:"order_id"`
	OfferID          string       `json:"offer_id"`
	ExpiresAt        Timestamp    `json:"expires_at"`
	ServerTime       Timestamp    `json:"server_time"`
	Pickup           OfferPickup  `json:"pickup"`
	Dropoff          OfferDropoff `json:"dropoff"`
	DistanceM        int          `json:"distance_m"`
	EstDurationS     int          `json:"est_duration_s"`
	EarningsCents    int64        `json:"earnings_cents"`
	TipCentsEstimate int64        `json:"tip_cents_estimate"`
	ItemsCount       int          `json:"items_count"`
}

// OfferPickup is where the rider collects the order.
type OfferPickup struct {
	RestaurantName string  `json:"restaurant_name"`
	AddressShort   string  `json:"address_short"`
	Lat            float64 `json:"lat"`
	Lng            float64 `json:"lng"`
}

// OfferDropoff is the drop-off's approximate area, for a rider who has not
// accepted: the area's name and a point rounded to about a kilometre
// (ApproximateArea). Never the address's own coordinates, street number or
// unit: the full address comes only once the rider accepts (the owner's
// decision on the customer's address on a rider's offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
type OfferDropoff struct {
	Area string  `json:"area"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

// DispatchOfferWithdrawn is dispatch.offer_withdrawn.
type DispatchOfferWithdrawn struct {
	OrderID string                  `json:"order_id"`
	OfferID string                  `json:"offer_id"`
	Reason  DispatchWithdrawnReason `json:"reason"`
}

// DispatchAssigned is dispatch.assigned: the rider's public profile.
type DispatchAssigned struct {
	OrderID     string      `json:"order_id"`
	Rider       RiderPublic `json:"rider"`
	PickupEtaAt *Timestamp  `json:"pickup_eta_at"`
}

// RiderPublic is the rider's public profile — never earnings, phone or record.
type RiderPublic struct {
	FirstName   string                `json:"first_name"`
	PhotoURL    *string               `json:"photo_url"`
	VehicleType *contract.VehicleType `json:"vehicle_type"`
	RatingAvg   *float64              `json:"rating_avg"`
}

// DispatchUnassigned is dispatch.unassigned.
type DispatchUnassigned struct {
	OrderID string `json:"order_id"`
	Reason  string `json:"reason"`
}

// DispatchStateChanged is dispatch.state_changed.
type DispatchStateChanged struct {
	OrderID string                 `json:"order_id"`
	From    contract.DispatchState `json:"from"`
	To      contract.DispatchState `json:"to"`
	At      Timestamp              `json:"at"`
}

// RiderLocation is rider.location's source. PickedUp is not on the wire: it
// picks the customer's serializer, precise or coarse (the customer never sees
// the rider's exact pre-pickup position; catalogue.go).
type RiderLocation struct {
	OrderID    string    `json:"order_id"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	HeadingDeg *float64  `json:"heading_deg"`
	SpeedMps   *float64  `json:"speed_mps"`
	AccuracyM  *float64  `json:"accuracy_m"`
	RecordedAt Timestamp `json:"recorded_at"`
	PickedUp   bool      `json:"source_picked_up"`
}

// RiderAvailabilityChanged is rider.availability_changed.
type RiderAvailabilityChanged struct {
	AccountID         string                          `json:"account_id"`
	IsOnline          bool                            `json:"is_online"`
	AvailabilityState contract.RiderAvailabilityState `json:"availability_state"`
	At                Timestamp                       `json:"at"`
}

// RiderEarningsUpdated is rider.earnings_updated.
type RiderEarningsUpdated struct {
	AccountID     string `json:"account_id"`
	Period        string `json:"period"`
	EarningsCents int64  `json:"earnings_cents"`
	Currency      string `json:"currency"`
	Deliveries    int    `json:"deliveries"`
}

// ---------------------------------------------------------------------------
// Section 4.6 — account and onboarding, on account:{account_id}.
// ---------------------------------------------------------------------------

// AccountSecurityEvent is account.security_event. ip_city is a coarse place,
// never an IP address.
type AccountSecurityEvent struct {
	Kind   SecurityEventKind `json:"kind"`
	At     Timestamp         `json:"at"`
	IPCity *string           `json:"ip_city"`
}

// DocumentReviewStateChanged is document.review_state_changed.
type DocumentReviewStateChanged struct {
	DocumentID string                    `json:"document_id"`
	DocType    string                    `json:"doc_type"`
	State      contract.KycDocumentState `json:"state"`
	Reason     *string                   `json:"reason"`
	ReviewedAt Timestamp                 `json:"reviewed_at"`
}

// OnboardingStateChanged is onboarding.state_changed.
type OnboardingStateChanged struct {
	SubjectType OnboardingSubject `json:"subject_type"`
	SubjectID   string            `json:"subject_id"`
	From        *string           `json:"from"`
	To          string            `json:"to"`
	NextAction  *string           `json:"next_action"`
}

// ConnectRequirementsChanged is connect.requirements_changed.
type ConnectRequirementsChanged struct {
	CurrentlyDue   []string   `json:"currently_due"`
	PastDue        []string   `json:"past_due"`
	PayoutsEnabled bool       `json:"payouts_enabled"`
	Deadline       *Timestamp `json:"deadline"`
}

// NotificationCreated is notification.created.
type NotificationCreated struct {
	NotificationID string    `json:"notification_id"`
	Kind           string    `json:"kind"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	DeepLink       *string   `json:"deep_link"`
	CreatedAt      Timestamp `json:"created_at"`
}

// NotificationRead is notification.read.
type NotificationRead struct {
	NotificationID string    `json:"notification_id"`
	ReadAt         Timestamp `json:"read_at"`
}

// ---------------------------------------------------------------------------
// Section 4.7 — admin, on admin:ops.
// ---------------------------------------------------------------------------

// AdminAlert is admin.alert.
type AdminAlert struct {
	Severity    string    `json:"severity"`
	Kind        string    `json:"kind"`
	SubjectType string    `json:"subject_type"`
	SubjectID   string    `json:"subject_id"`
	Message     string    `json:"message"`
	At          Timestamp `json:"at"`
}

// AdminDispatchFailure is admin.dispatch_failure: every wave ran and no rider
// accepted.
type AdminDispatchFailure struct {
	OrderID       string `json:"order_id"`
	Waves         int    `json:"waves"`
	RidersOffered int    `json:"riders_offered"`
	RadiusM       int    `json:"radius_m"`
}

// AdminReconciliationException is admin.reconciliation_exception.
type AdminReconciliationException struct {
	Kind          string `json:"kind"`
	OrderID       string `json:"order_id"`
	ExpectedCents int64  `json:"expected_cents"`
	ActualCents   int64  `json:"actual_cents"`
}

// AdminQueueDepth is admin.queue_depth.
type AdminQueueDepth struct {
	PendingRestaurantReviews int `json:"pending_restaurant_reviews"`
	PendingRiderReviews      int `json:"pending_rider_reviews"`
	OpenDisputes             int `json:"open_disputes"`
	FailedRefunds            int `json:"failed_refunds"`
}
