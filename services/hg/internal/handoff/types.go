package handoff

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Domain error codes this module raises. Each exists in the contract's
// ErrorCode enum (contracts/openapi.yaml) — contract first, then code.
const (
	CodeSealNotFound      httpx.ErrorCode = "SEAL_NOT_FOUND"
	CodeSealAlreadyBound  httpx.ErrorCode = "SEAL_ALREADY_BOUND"
	CodeSealNotBound      httpx.ErrorCode = "SEAL_NOT_BOUND"
	CodeSealTokenInvalid  httpx.ErrorCode = "SEAL_TOKEN_INVALID"
	CodeSealOrderMismatch httpx.ErrorCode = "SEAL_ORDER_MISMATCH"
	CodeSealNonceReplayed httpx.ErrorCode = "SEAL_NONCE_REPLAYED"
	CodeIllegalTransition httpx.ErrorCode = "ILLEGAL_TRANSITION"
	CodePodRequired       httpx.ErrorCode = "POD_REQUIRED"
)

// Actions this module owns (P-05). Constants live beside the module that owns
// the noun; the auth sibling's matrix maps roles to these.
const (
	ActionSealBind     httpx.Action = "handoff.seal_bind"
	ActionPickupScan   httpx.Action = "handoff.pickup_scan"
	ActionDeliveryScan httpx.Action = "handoff.delivery_scan"
	ActionTamperReport httpx.Action = "handoff.tamper_report"
)

// Event type / actor / method string constants, mirroring the migration's
// Postgres enums exactly (handoff_event_type, handoff_actor, handoff_method).
const (
	EventSeal     = "SEAL"
	EventPickup   = "PICKUP"
	EventDelivery = "DELIVERY"
	EventTamper   = "TAMPER_REPORT"

	ActorRestaurant = "RESTAURANT"
	ActorRider      = "RIDER"
	ActorCustomer   = "CUSTOMER"

	MethodQR    = "QR"
	MethodOTP   = "OTP"
	MethodPhoto = "PHOTO"
)

// Seal status string constants, mirroring package_seal_status.
const (
	StatusIssued           = "ISSUED"
	StatusBound            = "BOUND"
	StatusPickupVerified   = "PICKUP_VERIFIED"
	StatusDeliveryVerified = "DELIVERY_VERIFIED"
	StatusTamperReported   = "TAMPER_REPORTED"
)

// PackageSeal is the contract PackageSeal shape.
type PackageSeal struct {
	ID                 string  `json:"id"`
	SealCode           string  `json:"seal_code"`
	OrderID            *string `json:"order_id"`
	RestaurantID       string  `json:"restaurant_id"`
	Status             string  `json:"status"`
	QRToken            *string `json:"qr_token"`
	BoundAt            *string `json:"bound_at"`
	PickupVerifiedAt   *string `json:"pickup_verified_at"`
	DeliveryVerifiedAt *string `json:"delivery_verified_at"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

// HandoffEvent is the contract HandoffEvent shape.
type HandoffEvent struct {
	ID             string   `json:"id"`
	OrderID        string   `json:"order_id"`
	SealID         *string  `json:"seal_id"`
	Type           string   `json:"type"`
	Actor          string   `json:"actor"`
	ActorAccountID *string  `json:"actor_account_id"`
	Method         string   `json:"method"`
	SealIntact     *bool    `json:"seal_intact"`
	Latitude       *float64 `json:"latitude"`
	Longitude      *float64 `json:"longitude"`
	PhotoObjectID  *string  `json:"photo_object_id"`
	Note           *string  `json:"note"`
	At             string   `json:"at"`
}

// HandoffScanResult is the contract HandoffScanResult shape: the proof and the
// order's state, which a seal scan reports and never changes (the tamper
// report's is the dispute it opened).
type HandoffScanResult struct {
	Seal       PackageSeal  `json:"seal"`
	Event      HandoffEvent `json:"event"`
	OrderState string       `json:"order_state"`
}

// --- wire inputs, matching the contract schemas exactly (additionalProperties:false) ---

type sealBindInput struct {
	SealCode string `json:"seal_code"`
}

type pickupScanInput struct {
	QRToken       string   `json:"qr_token"`
	SealIntact    bool     `json:"seal_intact"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
	PhotoObjectID *string  `json:"photo_object_id"`
}

type deliveryScanInput struct {
	QRToken       string   `json:"qr_token"`
	SealIntact    bool     `json:"seal_intact"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
	PhotoObjectID *string  `json:"photo_object_id"`
}

type tamperReportInput struct {
	PhotoObjectID string `json:"photo_object_id"`
	Note          string `json:"note"`
}
