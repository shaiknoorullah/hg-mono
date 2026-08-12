package dispatch

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Domain error codes this module raises. Each must exist in the contract's
// ErrorCode enum (contracts/openapi.yaml) — contract first, then code.
const (
	CodeOfferAlreadyTaken       httpx.ErrorCode = "OFFER_ALREADY_TAKEN"
	CodeOfferExpired            httpx.ErrorCode = "OFFER_EXPIRED"
	CodeOfferWithdrawn          httpx.ErrorCode = "OFFER_WITHDRAWN"
	CodeOrderCancelled          httpx.ErrorCode = "ORDER_CANCELLED"
	CodeRiderNotAvailable       httpx.ErrorCode = "RIDER_NOT_AVAILABLE"
	CodeActiveDeliveryInProgres httpx.ErrorCode = "ACTIVE_DELIVERY_IN_PROGRESS"
	CodeCannotGoOnline          httpx.ErrorCode = "CANNOT_GO_ONLINE"
	CodeOnboardingIncomplete    httpx.ErrorCode = "ONBOARDING_INCOMPLETE"
	CodeAccountNotActive        httpx.ErrorCode = "ACCOUNT_NOT_ACTIVE"
	CodePayoutAccountIncomplete httpx.ErrorCode = "PAYOUT_ACCOUNT_INCOMPLETE"
	CodeInvalidTransition       httpx.ErrorCode = "INVALID_TRANSITION"
	CodeGeofenceRequired        httpx.ErrorCode = "GEOFENCE_REQUIRED"
	CodePodRequired             httpx.ErrorCode = "POD_REQUIRED"
	CodePodMethodMismatch       httpx.ErrorCode = "POD_METHOD_MISMATCH"
	CodeOtpIncorrect            httpx.ErrorCode = "OTP_INCORRECT"
	CodeOtpLocked               httpx.ErrorCode = "OTP_LOCKED"
	CodeStalePoint              httpx.ErrorCode = "STALE_POINT"
)

// Actions this module owns. P-05: constants live beside the module that owns the
// noun; handlers never pass a string literal.
const (
	ActionRiderAvailabilityWrite httpx.Action = "rider.availability.write"
	ActionRiderDashboardRead     httpx.Action = "rider.dashboard.read"
	ActionRiderPositionWrite     httpx.Action = "rider.position.write"
	ActionOfferRead              httpx.Action = "offer.read"
	ActionOfferAccept            httpx.Action = "offer.accept"
	ActionOfferReject            httpx.Action = "offer.reject"
	ActionAssignmentRead         httpx.Action = "assignment.read"
	ActionAssignmentTransition   httpx.Action = "assignment.transition"
	ActionPodSubmit              httpx.Action = "assignment.pod.submit"
)

// Dispatch reference constants (D-0.5). Admin-configurable in a later version;
// seeded with these values here so the module is self-contained and deterministic.
const (
	waveSize          = 3
	offerTTL          = 30 * time.Second
	maxWaves          = 5
	interWaveGap      = 2 * time.Second
	locationFreshness = 90 * time.Second
	geoArrivalRadiusM = 150
	otpMaxFailures    = 5
	candidateLimit    = 50
)

// radiusLadderM is the widening search ladder in metres (D-13).
var radiusLadderM = []int{3000, 6000, 10000}

// OfferEarnings is the OfferEarningsEstimate contract shape. Money is int64 cents.
type OfferEarnings struct {
	BaseCents           int64  `json:"base_cents"`
	DistanceCents       int64  `json:"distance_cents"`
	SurgeCents          int64  `json:"surge_cents"`
	TipSoFarCents       int64  `json:"tip_so_far_cents"`
	EstimatedTotalCents int64  `json:"estimated_total_cents"`
	Currency            string `json:"currency"`
}

// OfferPickup is the pre-accept pickup projection (street-level, no phone alias).
type OfferPickup struct {
	RestaurantName string  `json:"restaurant_name"`
	AddressShort   string  `json:"address_short"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
}

// OfferDropoff is the pre-accept dropoff projection (street + neighbourhood only).
type OfferDropoff struct {
	Area      string  `json:"area"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// DispatchOffer is the contract DispatchOffer (pre-accept projection, D-14).
type DispatchOffer struct {
	OfferID     string        `json:"offer_id"`
	OrderID     string        `json:"order_id"`
	State       string        `json:"state,omitempty"`
	Wave        int32         `json:"wave"`
	ExpiresAt   string        `json:"expires_at"`
	ServerTime  string        `json:"server_time"`
	Pickup      OfferPickup   `json:"pickup"`
	Dropoff     OfferDropoff  `json:"dropoff"`
	DistanceM   *int32        `json:"distance_m,omitempty"`
	EstDuration *int32        `json:"est_duration_s,omitempty"`
	Earnings    OfferEarnings `json:"earnings"`
	ItemsCount  int32         `json:"items_count"`
}

// RiderAvailability is the contract RiderAvailability (D-10).
type RiderAvailability struct {
	AvailabilityState      string   `json:"availability_state"`
	Since                  string   `json:"since"`
	CanReceiveOffers       bool     `json:"can_receive_offers"`
	GoOfflineAfterDelivery bool     `json:"go_offline_after_delivery"`
	BlockingReasons        []string `json:"blocking_reasons"`
}

// AssignmentPickup is the post-accept pickup projection.
type AssignmentPickup struct {
	RestaurantName string  `json:"restaurant_name"`
	Address        string  `json:"address"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	PhoneAlias     *string `json:"phone_alias"`
	PickupNotes    *string `json:"pickup_notes"`
	OrderState     string  `json:"order_state"`
}

// AssignmentDropoff is the post-accept dropoff projection (unmasked after accept).
type AssignmentDropoff struct {
	Address              string   `json:"address"`
	Unit                 *string  `json:"unit"`
	Buzzer               *string  `json:"buzzer"`
	Latitude             float64  `json:"latitude"`
	Longitude            float64  `json:"longitude"`
	CustomerDisplayName  string   `json:"customer_display_name"`
	PhoneAlias           *string  `json:"phone_alias"`
	DeliveryInstructions []string `json:"delivery_instructions"`
	SpecialInstructions  *string  `json:"special_instructions"`
}

// AssignmentItem is one line of the order, with no prices (D-19).
type AssignmentItem struct {
	Name         string   `json:"name"`
	Quantity     int32    `json:"quantity"`
	VariantName  *string  `json:"variant_name"`
	AddonNames   []string `json:"addon_names"`
	Note         *string  `json:"note"`
	AllergenTags []string `json:"allergen_tags"`
}

// Assignment is the contract Assignment (post-accept projection, D-19).
type Assignment struct {
	ID                string            `json:"id"`
	OrderID           string            `json:"order_id"`
	OrderCode         string            `json:"order_code,omitempty"`
	State             string            `json:"state"`
	Pickup            AssignmentPickup  `json:"pickup"`
	Dropoff           AssignmentDropoff `json:"dropoff"`
	Items             []AssignmentItem  `json:"items"`
	PaymentStatus     string            `json:"payment_status,omitempty"`
	Earnings          *OfferEarnings    `json:"earnings,omitempty"`
	RequiredPodMethod string            `json:"required_pod_method"`
	PodRecorded       bool              `json:"pod_recorded"`
	HandoverMethod    *string           `json:"handover_method"`
	TrackingHealth    string            `json:"tracking_health,omitempty"`
	BillableDistanceM *int32            `json:"billable_distance_m"`
	PickupWaitSeconds *int32            `json:"pickup_wait_seconds"`
	AssignedAt        string            `json:"assigned_at"`
	ArrivedPickupAt   *string           `json:"arrived_pickup_at"`
	PickedUpAt        *string           `json:"picked_up_at"`
	ArrivedDropoffAt  *string           `json:"arrived_dropoff_at"`
	DeliveredAt       *string           `json:"delivered_at"`
}

// RejectedPoint is one rejected entry in a position batch acknowledgement.
type RejectedPoint struct {
	Index int32  `json:"index"`
	Code  string `json:"code"`
}

// RiderPositionAck is the contract RiderPositionAck (D-11/D-12).
type RiderPositionAck struct {
	Accepted                  int32           `json:"accepted"`
	Rejected                  []RejectedPoint `json:"rejected"`
	CurrentPositionRecordedAt *string         `json:"current_position_recorded_at"`
}
