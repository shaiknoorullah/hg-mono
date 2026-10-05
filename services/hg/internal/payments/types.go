package payments

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Actions — the P-05 permissions this module owns. Handlers never pass a string
// literal (I-05.2); the auth-sibling's matrix maps roles → these actions.
const (
	ActionPaymentMethodRead   httpx.Action = "payment_method.read"
	ActionPaymentMethodWrite  httpx.Action = "payment_method.write"
	ActionPaymentRead         httpx.Action = "payment.read"
	ActionRefundRequest       httpx.Action = "refund.request"
	ActionRefundRead          httpx.Action = "refund.read"
	ActionRefundIssueGoodwill httpx.Action = "refund.issue_goodwill"
	ActionConnectWrite        httpx.Action = "connect.write"
	ActionConnectRead         httpx.Action = "connect.read"
	ActionEarningsRead        httpx.Action = "earnings.read"
	ActionPayoutRead          httpx.Action = "payout.read"
	// ActionPayoutRunCreate queues a payout run now; ActionPayoutRunRead reads
	// runs and their lines. Both are admin actions (issue #251).
	ActionPayoutRunCreate httpx.Action = "payout_run.create"
	ActionPayoutRunRead   httpx.Action = "payout_run.read"
)

// Error codes this module raises. Each must exist in the contract's ErrorCode
// enum (verified against contracts/openapi.yaml).
const (
	CodePaymentMethodLimit     httpx.ErrorCode = "PAYMENT_METHOD_LIMIT"
	CodePaymentMethodInUse     httpx.ErrorCode = "PAYMENT_METHOD_IN_USE"
	CodeRefundExceedsCaptured  httpx.ErrorCode = "REFUND_EXCEEDS_CAPTURED"
	CodePaymentNotRefundable   httpx.ErrorCode = "PAYMENT_NOT_REFUNDABLE"
	CodeRefundWindowClosed     httpx.ErrorCode = "REFUND_WINDOW_CLOSED"
	CodeRefundAlreadyRequested httpx.ErrorCode = "REFUND_ALREADY_REQUESTED"
	CodeStepNotAvailable       httpx.ErrorCode = "STEP_NOT_AVAILABLE"
	CodeConflict               httpx.ErrorCode = "CONFLICT"
	CodeDailyCapExceeded       httpx.ErrorCode = "DAILY_CAP_EXCEEDED"
	CodeSelfApprovalForbidden  httpx.ErrorCode = "SELF_APPROVAL_FORBIDDEN"
	CodeUnknownField           httpx.ErrorCode = "UNKNOWN_FIELD"
)

// MaxSavedCards is the C-24 cap on saved payment methods.
const MaxSavedCards = 5

// GoodwillApprovalThresholdCents — a GOODWILL refund above this needs a second
// admin approval (P-18 / decision O-04, launch default CAD 50.00).
const GoodwillApprovalThresholdCents int64 = 5000

// Rolling-24h authority caps per staff role (A-33). A request that would push
// the operator's trailing-24h issued total over their cap is not rejected — it
// creates an approval request and escalates to the next role up, so a customer's
// refund is never lost. Support agents have the tightest window; a super admin
// is the terminal approver (their above-cap path escalates to nobody).
const (
	CapSupportAgentCents int64 = 20000  // CAD 200.00 trailing 24h
	CapAdminCents        int64 = 200000 // CAD 2000.00 trailing 24h
)

// PaymentState mirrors the contract PaymentState enum.
type PaymentState string

const (
	StateRequiresPaymentMethod PaymentState = "REQUIRES_PAYMENT_METHOD"
	StateRequiresConfirmation  PaymentState = "REQUIRES_CONFIRMATION"
	StateRequiresAction        PaymentState = "REQUIRES_ACTION"
	StateProcessing            PaymentState = "PROCESSING"
	StateRequiresCapture       PaymentState = "REQUIRES_CAPTURE"
	StateSucceeded             PaymentState = "SUCCEEDED"
	StateCanceled              PaymentState = "CANCELED"
	StateFailed                PaymentState = "FAILED"
)

// paymentStateRank orders the lifecycle so an out-of-order webhook never moves a
// PI backwards (P-17 §out-of-order safety).
var paymentStateRank = map[PaymentState]int{
	StateRequiresPaymentMethod: 0,
	StateRequiresConfirmation:  1,
	StateRequiresAction:        2,
	StateProcessing:            3,
	StateRequiresCapture:       4,
	StateSucceeded:             5,
	StateCanceled:              5,
	StateFailed:                5,
}

// stateFromStripe maps a Stripe PaymentIntent status to the contract enum.
func stateFromStripe(s string) PaymentState {
	switch s {
	case "requires_payment_method":
		return StateRequiresPaymentMethod
	case "requires_confirmation":
		return StateRequiresConfirmation
	case "requires_action":
		return StateRequiresAction
	case "processing":
		return StateProcessing
	case "requires_capture":
		return StateRequiresCapture
	case "succeeded":
		return StateSucceeded
	case "canceled":
		return StateCanceled
	default:
		return StateFailed
	}
}

// RefundKind mirrors the contract RefundKind enum.
type RefundKind string

const (
	RefundFull         RefundKind = "FULL"
	RefundPartialItems RefundKind = "PARTIAL_ITEMS"
	RefundFeesOnly     RefundKind = "FEES_ONLY"
	RefundGoodwill     RefundKind = "GOODWILL"
)

// RefundScope mirrors the contract RefundScope enum.
type RefundScope string

const (
	ScopeFull          RefundScope = "FULL"
	ScopePartialItems  RefundScope = "PARTIAL_ITEMS"
	ScopePartialAmount RefundScope = "PARTIAL_AMOUNT"
)

// RefundState mirrors the contract RefundState enum.
type RefundState string

const (
	RefundRequested       RefundState = "REQUESTED"
	RefundPendingApproval RefundState = "PENDING_APPROVAL"
	RefundApproved        RefundState = "APPROVED"
	RefundAuthorised      RefundState = "AUTHORISED"
	RefundSubmitted       RefundState = "SUBMITTED"
	RefundSucceeded       RefundState = "SUCCEEDED"
	RefundSettled         RefundState = "SETTLED"
	RefundFailed          RefundState = "FAILED"
	RefundDeclined        RefundState = "DECLINED"
	RefundCancelled       RefundState = "CANCELLED"
)

// ---------------------------------------------------------------------------
// Wire DTOs — the exact contract response shapes.
// ---------------------------------------------------------------------------

// PaymentMethodDTO is the contract PaymentMethod schema.
type PaymentMethodDTO struct {
	ID        string `json:"id"`
	Brand     string `json:"brand"`
	Last4     string `json:"last4"`
	ExpMonth  int32  `json:"exp_month"`
	ExpYear   int32  `json:"exp_year"`
	IsDefault bool   `json:"is_default"`
}

// SetupIntentDTO is the contract SetupIntent schema.
type SetupIntentDTO struct {
	ClientSecret string `json:"client_secret"`
}

// OrderPaymentDTO is the contract OrderPayment schema.
type OrderPaymentDTO struct {
	OrderID               string  `json:"order_id"`
	State                 string  `json:"state"`
	Kind                  string  `json:"kind,omitempty"`
	AmountAuthorizedCents int64   `json:"amount_authorized_cents"`
	AmountCapturedCents   int64   `json:"amount_captured_cents"`
	AmountRefundedCents   int64   `json:"amount_refunded_cents"`
	Currency              string  `json:"currency"`
	CardBrand             *string `json:"card_brand"`
	CardLast4             *string `json:"card_last4"`
	Wallet                *string `json:"wallet"`
	FailureCode           *string `json:"failure_code"`
	DeclineCode           *string `json:"decline_code"`
	ClientSecret          *string `json:"client_secret"`
	AuthorizedAt          *string `json:"authorized_at"`
	CapturedAt            *string `json:"captured_at"`
}

// RefundInput is the contract RefundInput schema. It carries NO amount field —
// the server computes every amount except GOODWILL (which the admin-only
// issueRefund path handles). G-3: no price-shaped field is accepted here.
type RefundInput struct {
	OrderID           string            `json:"order_id"`
	Kind              RefundKind        `json:"kind"`
	ReasonCode        string            `json:"reason_code"`
	Lines             []RefundLineInput `json:"lines"`
	Note              string            `json:"note"`
	EvidenceObjectIDs []string          `json:"evidence_object_ids"`
}

// RefundLineInput is one quantity-only line of a PARTIAL_ITEMS refund.
type RefundLineInput struct {
	OrderLineNo int32 `json:"order_line_no"`
	Quantity    int32 `json:"quantity"`
}

// RefundLiabilitySplitDTO is the contract RefundLiabilitySplit schema.
type RefundLiabilitySplitDTO struct {
	PlatformCents   int64 `json:"platform_cents"`
	RestaurantCents int64 `json:"restaurant_cents"`
	RiderCents      int64 `json:"rider_cents"`
}

// RefundDTO is the contract Refund schema.
type RefundDTO struct {
	ID             string                   `json:"id"`
	OrderID        string                   `json:"order_id"`
	Kind           string                   `json:"kind"`
	Scope          *string                  `json:"scope"`
	ReasonCode     string                   `json:"reason_code"`
	AmountCents    int64                    `json:"amount_cents"`
	TaxCents       int64                    `json:"tax_cents"`
	Currency       string                   `json:"currency"`
	State          string                   `json:"state"`
	LiabilitySplit *RefundLiabilitySplitDTO `json:"liability_split"`
	Note           *string                  `json:"note"`
	RequestedAt    string                   `json:"requested_at"`
	SettledAt      *string                  `json:"settled_at"`
	FailureMessage *string                  `json:"failure_message"`
}

// ConnectRequirementsDTO is the nested requirements object of ConnectStatus.
type ConnectRequirementsDTO struct {
	CurrentlyDue   []string `json:"currently_due"`
	EventuallyDue  []string `json:"eventually_due"`
	PastDue        []string `json:"past_due"`
	DisabledReason *string  `json:"disabled_reason"`
	Deadline       *string  `json:"deadline"`
}

// ConnectStatusDTO is the contract ConnectStatus schema.
type ConnectStatusDTO struct {
	StripeAccountID  *string                `json:"stripe_account_id"`
	ChargesEnabled   bool                   `json:"charges_enabled"`
	PayoutsEnabled   bool                   `json:"payouts_enabled"`
	DetailsSubmitted bool                   `json:"details_submitted"`
	Requirements     ConnectRequirementsDTO `json:"requirements"`
	BankLast4        *string                `json:"bank_last4"`
	PayoutInterval   string                 `json:"payout_interval"`
}

// ConnectOnboardingLinkDTO is the contract ConnectOnboardingLink schema.
type ConnectOnboardingLinkDTO struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

// PayoutDTO is the contract Payout schema.
type PayoutDTO struct {
	ID             string  `json:"id"`
	PeriodStart    string  `json:"period_start"`
	PeriodEnd      string  `json:"period_end"`
	AmountCents    int64   `json:"amount_cents"`
	Currency       string  `json:"currency"`
	State          string  `json:"state"`
	HoldReason     *string `json:"hold_reason"`
	EntryCount     int32   `json:"entry_count"`
	PaidAt         *string `json:"paid_at"`
	FailureMessage *string `json:"failure_message"`
}

// PayoutDetailDTO is the contract PayoutDetail schema (Payout + entries).
type PayoutDetailDTO struct {
	PayoutDTO
	Entries []EarningEntryDTO `json:"entries"`
}

// EarningEntryDTO is the contract EarningEntry schema.
type EarningEntryDTO struct {
	ID                  string  `json:"id"`
	AssignmentID        *string `json:"assignment_id"`
	OrderCode           *string `json:"order_code"`
	Type                string  `json:"type"`
	Status              string  `json:"status"`
	BaseCents           int64   `json:"base_cents"`
	DistanceCents       int64   `json:"distance_cents"`
	WaitCents           int64   `json:"wait_cents"`
	SurgeMultiplier     string  `json:"surge_multiplier"`
	GuaranteeTopupCents int64   `json:"guarantee_topup_cents"`
	TipCents            int64   `json:"tip_cents"`
	AdjustmentCents     int64   `json:"adjustment_cents"`
	GrossCents          int64   `json:"gross_cents"`
	Currency            string  `json:"currency"`
	BillableDistanceM   *int32  `json:"billable_distance_m"`
	DistanceSource      *string `json:"distance_source"`
	FormulaVersion      int32   `json:"formula_version"`
	PayoutID            *string `json:"payout_id"`
	EarnedAt            string  `json:"earned_at"`
}

// EarningsBucketDTO is the contract EarningsBucket schema.
type EarningsBucketDTO struct {
	BucketStart           string `json:"bucket_start"`
	GrossCents            int64  `json:"gross_cents"`
	DeliveryCents         int64  `json:"delivery_cents"`
	TipCents              int64  `json:"tip_cents"`
	BonusCents            int64  `json:"bonus_cents"`
	AdjustmentCents       int64  `json:"adjustment_cents"`
	Trips                 int32  `json:"trips"`
	OnlineSeconds         int64  `json:"online_seconds"`
	DistanceM             int64  `json:"distance_m"`
	EffectiveCentsPerHour *int64 `json:"effective_cents_per_hour"`
}

// EarningsSummaryDTO is the contract EarningsSummary schema.
type EarningsSummaryDTO struct {
	Period             string              `json:"period"`
	Buckets            []EarningsBucketDTO `json:"buckets"`
	Total              EarningsBucketDTO   `json:"total"`
	UnpaidBalanceCents int64               `json:"unpaid_balance_cents"`
	NextPayoutAt       *string             `json:"next_payout_at"`
	Currency           string              `json:"currency"`
}

// AcknowledgementDTO is the inner data of the contract AcknowledgementResponse.
type AcknowledgementDTO struct {
	Acknowledged bool `json:"acknowledged"`
}

// AdminRefundInput is the contract AdminRefundInput schema (issueRefund body).
// `amount_cents` is decoded as a pointer so the handler can tell "absent" from
// "zero" — it is accepted ONLY with scope PARTIAL_AMOUNT and reason_code
// GOODWILL (G-3's single staff-side monetary allowlist entry); any other use is
// 422 UNKNOWN_FIELD. Every other scope's amount is computed from the order.
type AdminRefundInput struct {
	OrderID     string                 `json:"order_id"`
	Scope       RefundScope            `json:"scope"`
	ReasonCode  string                 `json:"reason_code"`
	ReasonText  string                 `json:"reason_text"`
	AmountCents *int64                 `json:"amount_cents"`
	LineItems   []AdminRefundLineInput `json:"line_items"`
	CaseID      *string                `json:"case_id"`
}

// AdminRefundLineInput is one quantity-only line of a PARTIAL_ITEMS admin refund.
type AdminRefundLineInput struct {
	OrderLineNo int32 `json:"order_line_no"`
	Quantity    int32 `json:"quantity"`
}

// RefundApprovalRequestDTO is the contract RefundApprovalRequest schema — the
// 202 body of issueRefund when the request is above the caller's authority cap.
// It is projected from the PENDING_APPROVAL refund row itself (id == refund id),
// so no refund is ever lost: the approval request IS the pending refund.
type RefundApprovalRequestDTO struct {
	ID                  string  `json:"id"`
	OrderID             string  `json:"order_id"`
	ProposedAmountCents int64   `json:"proposed_amount_cents"`
	Currency            string  `json:"currency"`
	RequiredRole        string  `json:"required_role"`
	CaseID              *string `json:"case_id"`
	Status              string  `json:"status"`
	RequestedAt         string  `json:"requested_at"`
}

// strPtr returns a pointer to s, or nil for the empty string.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// tsPtr renders a nullable timestamp.
func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := httpx.Timestamp(*t)
	return &s
}
