package admin

// Wire DTOs. Every shape here is the contract's schema verbatim
// (contracts/openapi.yaml) with additionalProperties:false honoured by not
// emitting fields the schema does not name. Money is never present in an admin
// request body; the server computes every price.

// --- Staff (A-01) ---

// staffUser is the contract's StaffUser.
type staffUser struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	FullName    string  `json:"full_name"`
	Role        string  `json:"role"`
	Status      string  `json:"status"`
	MFAEnrolled bool    `json:"mfa_enrolled"`
	LastLoginAt *string `json:"last_login_at"`
	CreatedAt   string  `json:"created_at"`
}

// staffUserInput is the contract's StaffUserInput.
type staffUserInput struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

// --- Halal issuing bodies (A-16) ---

// halalIssuingBody is the contract's HalalIssuingBody.
type halalIssuingBody struct {
	ID                         string   `json:"id"`
	Name                       string   `json:"name"`
	Aliases                    []string `json:"aliases,omitempty"`
	Country                    *string  `json:"country"`
	Region                     *string  `json:"region"`
	Website                    *string  `json:"website"`
	AccreditationRef           *string  `json:"accreditation_ref"`
	RequiresIssuerConfirmation bool     `json:"requires_issuer_confirmation"`
	Status                     string   `json:"status"`
	Notes                      *string  `json:"notes"`
}

// halalIssuingBodyInput is the contract's HalalIssuingBodyInput.
type halalIssuingBodyInput struct {
	Name             string   `json:"name"`
	Aliases          []string `json:"aliases"`
	Country          string   `json:"country"`
	Region           string   `json:"region"`
	Website          string   `json:"website"`
	AccreditationRef string   `json:"accreditation_ref"`
	Justification    string   `json:"justification"`
}

// halalIssuingBodyStatusInput is the contract's HalalIssuingBodyStatusInput.
type halalIssuingBodyStatusInput struct {
	Status                     string `json:"status"`
	RequiresIssuerConfirmation *bool  `json:"requires_issuer_confirmation"`
	Justification              string `json:"justification"`
}

// --- Halal certificate (A-15) ---

// halalCheck is the contract's HalalCheck.
type halalCheck struct {
	CheckKey       string  `json:"check_key"`
	Result         string  `json:"result"`
	ComputedResult *string `json:"computed_result"`
	Overridable    bool    `json:"overridable"`
	Note           *string `json:"note"`
	CheckedAt      *string `json:"checked_at"`
}

// halalCertificate is the contract's HalalCertificate.
type halalCertificate struct {
	ID                  string            `json:"id"`
	RestaurantID        string            `json:"restaurant_id"`
	DocumentID          *string           `json:"document_id"`
	CertificateNumber   *string           `json:"certificate_number"`
	IssuingBody         *halalIssuingBody `json:"issuing_body"`
	CertifiedLegalName  *string           `json:"certified_legal_name"`
	CertifiedAddress    *string           `json:"certified_address"`
	Scope               *string           `json:"scope"`
	IssuedOn            *string           `json:"issued_on"`
	ExpiresOn           *string           `json:"expires_on"`
	Status              string            `json:"status"`
	ChecklistVersion    int               `json:"checklist_version"`
	Checks              []halalCheck      `json:"checks"`
	RejectionReasonCode *string           `json:"rejection_reason_code"`
	RejectionReasonText *string           `json:"rejection_reason_text"`
	VerifiedBy          *string           `json:"verified_by"`
	VerifiedAt          *string           `json:"verified_at"`
}

// halalTranscriptionInput is the contract's HalalTranscriptionInput.
type halalTranscriptionInput struct {
	CertificateNumber  string `json:"certificate_number"`
	IssuingBodyID      string `json:"issuing_body_id"`
	CertifiedLegalName string `json:"certified_legal_name"`
	CertifiedAddress   string `json:"certified_address"`
	Scope              string `json:"scope"`
	IssuedOn           string `json:"issued_on"`
	ExpiresOn          string `json:"expires_on"`
}

// halalChecksInput is the contract's HalalChecksInput.
type halalChecksInput struct {
	Checks []halalCheckInput `json:"checks"`
}

type halalCheckInput struct {
	CheckKey string  `json:"check_key"`
	Result   string  `json:"result"`
	Note     *string `json:"note"`
}

// halalDecisionInput is the contract's HalalDecisionInput.
type halalDecisionInput struct {
	Decision   string  `json:"decision"`
	ReasonCode *string `json:"reason_code"`
	ReasonText *string `json:"reason_text"`
}

// --- Document review (A-14) ---

// kycDocument is the contract's KycDocument.
type kycDocument struct {
	ID                  string  `json:"id"`
	SubjectType         string  `json:"subject_type"`
	SubjectID           string  `json:"subject_id"`
	DocType             string  `json:"doc_type"`
	State               string  `json:"state"`
	Issuer              *string `json:"issuer"`
	CertificateNumber   *string `json:"certificate_number"`
	IssuedOn            *string `json:"issued_on"`
	ValidUntil          *string `json:"valid_until"`
	Version             int     `json:"version"`
	RejectionReasonCode *string `json:"rejection_reason_code"`
	ReviewNote          *string `json:"review_note"`
	ReviewedAt          *string `json:"reviewed_at"`
	CreatedAt           string  `json:"created_at"`
}

// documentReviewInput is the contract's DocumentReviewInput.
type documentReviewInput struct {
	Decision            string              `json:"decision"`
	RejectionReasonCode *string             `json:"rejection_reason_code"`
	ReviewNote          *string             `json:"review_note"`
	Checks              []documentCheckItem `json:"checks"`
}

type documentCheckItem struct {
	CheckKey string  `json:"check_key"`
	Result   string  `json:"result"`
	Note     *string `json:"note"`
}

// --- Onboarding queue summaries (A-13, A-23) ---

// restaurantApplicationSummary is the contract's RestaurantApplicationSummary.
type restaurantApplicationSummary struct {
	RestaurantID        string  `json:"restaurant_id"`
	DisplayName         string  `json:"display_name"`
	City                *string `json:"city,omitempty"`
	Province            *string `json:"province,omitempty"`
	OnboardingState     string  `json:"onboarding_state"`
	SubmissionCount     *int    `json:"submission_count,omitempty"`
	AssignedAdminID     *string `json:"assigned_admin_id,omitempty"`
	ReviewLockExpiresAt *string `json:"review_lock_expires_at,omitempty"`
	SubmittedAt         string  `json:"submitted_at"`
	SLADueAt            string  `json:"sla_due_at"`
}

// riderApplicationSummary is the contract's RiderApplicationSummary.
type riderApplicationSummary struct {
	RiderAccountID      string  `json:"rider_account_id"`
	DisplayName         string  `json:"display_name"`
	VehicleType         *string `json:"vehicle_type,omitempty"`
	OnboardingState     string  `json:"onboarding_state"`
	AttemptNumber       *int    `json:"attempt_number,omitempty"`
	AssignedAdminID     *string `json:"assigned_admin_id,omitempty"`
	ReviewLockExpiresAt *string `json:"review_lock_expires_at,omitempty"`
	SubmittedAt         string  `json:"submitted_at"`
	SLADueAt            string  `json:"sla_due_at"`
}

// --- Application detail (A-13, A-18, A-23) ---

// publicAddress is the contract's PublicAddress.
type publicAddress struct {
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	Province   string  `json:"province"`
	PostalCode string  `json:"postal_code"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}

// halalBadge is the contract's HalalBadge.
type halalBadge struct {
	DisplayState       string  `json:"display_state"`
	CertifyingBodyName *string `json:"certifying_body_name"`
	ExpiresOn          *string `json:"expires_on"`
}

// restaurantProfile is the contract's RestaurantProfile. Only the fields the
// review screen carries are emitted; every one is named by the schema.
type restaurantProfile struct {
	ID              string        `json:"id"`
	LegalName       string        `json:"legal_name"`
	DisplayName     string        `json:"display_name"`
	Description     *string       `json:"description"`
	OwnerFirstName  *string       `json:"owner_first_name"`
	OwnerLastName   *string       `json:"owner_last_name"`
	PhoneE164       *string       `json:"phone_e164"`
	PublicPhoneE164 *string       `json:"public_phone_e164"`
	GSTHSTNumber    *string       `json:"gst_hst_number"`
	Address         publicAddress `json:"address"`
	Timezone        string        `json:"timezone"`
	CuisineIDs      []string      `json:"cuisine_ids"`
	AvgPrepMinutes  int           `json:"avg_prep_minutes"`
	DeliveryRadiusM int           `json:"delivery_radius_m"`
	AccountState    string        `json:"account_state"`
	OnboardingState string        `json:"onboarding_state"`
	Halal           *halalBadge   `json:"halal,omitempty"`
	CommissionBps   int           `json:"commission_rate_bps"`
}

// restaurantApplication is the contract's RestaurantApplication (summary + detail).
type restaurantApplication struct {
	restaurantApplicationSummary
	Profile           restaurantProfile `json:"profile"`
	Documents         []kycDocument     `json:"documents"`
	HalalCertificate  *halalCertificate `json:"halal_certificate"`
	Blockers          []string          `json:"blockers"`
	AddressPinWarning *string           `json:"address_pin_warning"`
}

// restaurantDecisionInput is the contract's RestaurantDecisionInput. No admin_id
// is ever present: the decider is the authenticated principal.
type restaurantDecisionInput struct {
	Decision        string   `json:"decision"`
	ReasonCode      string   `json:"reason_code"`
	ReasonText      string   `json:"reason_text"`
	InternalNote    *string  `json:"internal_note"`
	DocumentsToRedo []string `json:"documents_to_redo"`
}

// riderProfile is the contract's RiderProfile.
type riderProfile struct {
	AccountID   string  `json:"account_id"`
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	Email       *string `json:"email"`
	DateOfBirth string  `json:"date_of_birth"`
	Timezone    string  `json:"timezone"`
}

// riderVehicle is the contract's RiderVehicle.
type riderVehicle struct {
	ID           string  `json:"id"`
	VehicleType  string  `json:"vehicle_type"`
	Make         *string `json:"make"`
	Model        *string `json:"model"`
	Year         *int    `json:"year"`
	Colour       *string `json:"colour"`
	LicencePlate *string `json:"licence_plate"`
	IsActive     bool    `json:"is_active"`
}

// riderApplication is the contract's RiderApplication (summary + detail).
type riderApplication struct {
	riderApplicationSummary
	Profile          riderProfile  `json:"profile"`
	Vehicle          *riderVehicle `json:"vehicle"`
	Documents        []kycDocument `json:"documents"`
	ComputedAgeYears *int          `json:"computed_age_years"`
	Blockers         []string      `json:"blockers"`
}

// riderDecisionInput is the contract's RiderDecisionInput.
type riderDecisionInput struct {
	Decision        string   `json:"decision"`
	ReasonCode      string   `json:"reason_code"`
	ReasonText      string   `json:"reason_text"`
	DocumentsToRedo []string `json:"documents_to_redo"`
}

// --- Order oversight (A-38) ---

// adminOrderRestaurant is the nested restaurant in OrderSummary / admin views.
type adminOrderRestaurant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// adminOrderSummary is the contract's OrderSummary (admin variant: no customer
// ownership filter; includes restaurant object).
type adminOrderSummary struct {
	ID         string               `json:"id"`
	Code       string               `json:"code"`
	State      string               `json:"state"`
	Restaurant adminOrderRestaurant `json:"restaurant"`
	TotalCents int64                `json:"total_cents"`
	Currency   string               `json:"currency"`
	PlacedAt   string               `json:"placed_at"`
}

// adminOrderLine is one line in the admin order view.
type adminOrderLine struct {
	LineNo         int     `json:"line_no"`
	MenuItemID     string  `json:"menu_item_id"`
	Name           string  `json:"name"`
	VariantName    *string `json:"variant_name"`
	Quantity       int     `json:"quantity"`
	SpecialRequest *string `json:"special_request"`
	UnitPriceCents int64   `json:"unit_price_cents"`
	LineTotalCents int64   `json:"line_total_cents"`
	Currency       string  `json:"currency"`
}

// adminOrderMoney is the customer-visible money breakdown.
type adminOrderMoney struct {
	SubtotalCents    int64  `json:"subtotal_cents"`
	DiscountCents    int64  `json:"discount_cents"`
	DeliveryFeeCents int64  `json:"delivery_fee_cents"`
	ServiceFeeCents  int64  `json:"service_fee_cents"`
	TaxTotalCents    int64  `json:"tax_total_cents"`
	TipCents         int64  `json:"tip_cents"`
	TotalCents       int64  `json:"total_cents"`
	Currency         string `json:"currency"`
}

// adminOrderInternalMoney is the internal split exposed only to staff.
type adminOrderInternalMoney struct {
	CommissionCents    int64  `json:"commission_cents"`
	RestaurantNetCents int64  `json:"restaurant_net_cents"`
	RiderEarningsCents int64  `json:"rider_earnings_cents"`
	PlatformGrossCents int64  `json:"platform_gross_cents"`
	Currency           string `json:"currency"`
}

// adminTransitionEntry is one entry in the order timeline (contract: OrderTransition).
// The contract names the timestamp field "at" (not "occurred_at").
type adminTransitionEntry struct {
	FromState *string `json:"from_state"`
	ToState   string  `json:"to_state"`
	ActorKind string  `json:"actor_kind"`
	Reason    *string `json:"reason"`
	At        string  `json:"at"`
}

// adminOrderPayment is the contract's OrderPayment, projected for the admin view.
// Required by OrderAdminView; all six required fields are always present.
type adminOrderPayment struct {
	OrderID               string  `json:"order_id"`
	State                 string  `json:"state"`
	Kind                  *string `json:"kind,omitempty"`
	AmountAuthorizedCents int64   `json:"amount_authorized_cents"`
	AmountCapturedCents   int64   `json:"amount_captured_cents"`
	AmountRefundedCents   int64   `json:"amount_refunded_cents"`
	Currency              string  `json:"currency"`
	CardBrand             *string `json:"card_brand"`
	CardLast4             *string `json:"card_last4"`
	Wallet                *string `json:"wallet"`
	FailureCode           *string `json:"failure_code"`
	DeclineCode           *string `json:"decline_code"`
	AuthorizedAt          *string `json:"authorized_at"`
	CapturedAt            *string `json:"captured_at"`
}

// adminRefund is the contract's Refund, projected for the admin view.
type adminRefund struct {
	ID          string  `json:"id"`
	OrderID     string  `json:"order_id"`
	Kind        string  `json:"kind"`
	Scope       *string `json:"scope"`
	ReasonCode  string  `json:"reason_code"`
	AmountCents int64   `json:"amount_cents"`
	TaxCents    int64   `json:"tax_cents"`
	Currency    string  `json:"currency"`
	State       string  `json:"state"`
	Note        *string `json:"note"`
	RequestedAt string  `json:"requested_at"`
	SettledAt   *string `json:"settled_at"`
}

// adminOrderView is the contract's OrderAdminView (OrderCustomerView + admin fields).
// Only fields named by the contract are emitted (additionalProperties:false is
// honoured by never adding a field the schema does not name).
type adminOrderView struct {
	ID            string                  `json:"id"`
	Code          string                  `json:"code"`
	State         string                  `json:"state"`
	Restaurant    adminOrderRestaurant    `json:"restaurant"`
	Lines         []adminOrderLine        `json:"lines"`
	Money         adminOrderMoney         `json:"money"`
	InternalMoney adminOrderInternalMoney `json:"internal_money"`
	Timeline      []adminTransitionEntry  `json:"timeline"`
	Payment       adminOrderPayment       `json:"payment"`
	Refunds       []adminRefund           `json:"refunds"`
	CancelReason  *string                 `json:"cancel_reason,omitempty"`
	RejectReason  *string                 `json:"reject_reason,omitempty"`
	PlacedAt      string                  `json:"placed_at"`
	AcceptedAt    *string                 `json:"accepted_at"`
	PiiRevealed   bool                    `json:"pii_revealed"`
}

// --- Menu (A-19) ---

// menuCategory is the contract's MenuCategory.
type menuCategory struct {
	ID           string  `json:"id"`
	RestaurantID string  `json:"restaurant_id"`
	Name         string  `json:"name"`
	Description  *string `json:"description"`
	SortOrder    int     `json:"sort_order"`
	IsActive     bool    `json:"is_active"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

// menuCategoryInput is the contract's MenuCategoryInput.
type menuCategoryInput struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	SortOrder   *int    `json:"sort_order"`
}

// menuItemOwnerView is the contract's MenuItemOwnerView. live_version and
// pending_version are full MenuItemVersion objects (oneOf MenuItemVersion | null),
// not a subset — the contract references MenuItemVersion directly.
//
// The base MenuItem schema names neither created_at nor updated_at, so neither
// is emitted (additionalProperties:false on MenuItemOwnerView).
type menuItemOwnerView struct {
	ID                string           `json:"id"`
	RestaurantID      string           `json:"restaurant_id"`
	CategoryID        string           `json:"category_id"`
	PriceCents        int64            `json:"price_cents"`
	Currency          string           `json:"currency"`
	AvailabilityState string           `json:"availability_state"`
	TaxCategory       string           `json:"tax_category"`
	SortOrder         int              `json:"sort_order"`
	Name              string           `json:"name"`
	Description       *string          `json:"description"`
	LiveVersion       *menuItemVersion `json:"live_version"`
	PendingVersion    *menuItemVersion `json:"pending_version"`
}

// menuItemInput is the contract's AdminMenuItemInput (admin-on-behalf create).
type menuItemInput struct {
	CategoryID   string   `json:"category_id"`
	Name         string   `json:"name"`
	Description  *string  `json:"description"`
	PriceCents   int64    `json:"price_cents"`
	DietaryTags  []string `json:"dietary_tags"`
	AllergenTags []string `json:"allergen_tags"`
	TaxCategory  *string  `json:"tax_category"`
}

// menuItemVersion is the contract's MenuItemVersion. The schema is
// additionalProperties:false and names neither reviewed_by nor updated_at, so
// neither is emitted; reviewed_by remains internal to the audit log only.
type menuItemVersion struct {
	ID                  string   `json:"id"`
	MenuItemID          string   `json:"menu_item_id"`
	RestaurantID        string   `json:"restaurant_id"`
	Version             int      `json:"version"`
	Name                string   `json:"name"`
	Description         *string  `json:"description"`
	DietaryTags         []string `json:"dietary_tags"`
	AllergenTags        []string `json:"allergen_tags"`
	ReviewStatus        string   `json:"review_status"`
	RejectionReasonCode *string  `json:"rejection_reason_code"`
	ReviewNote          *string  `json:"review_note"`
	SubmittedAt         *string  `json:"submitted_at"`
	ReviewedAt          *string  `json:"reviewed_at"`
	CreatedAt           string   `json:"created_at"`
}

// menuDecisionInput is the contract's MenuDecisionInput.
type menuDecisionInput struct {
	Decision   string  `json:"decision"`
	ReasonCode *string `json:"reason_code"`
	ReviewNote *string `json:"review_note"`
}

// cancelOrderAdminInput is the body for cancelOrderAdmin (contract:
// AdminOrderCancellationInput). additionalProperties:false is enforced by
// decodeJSON/DisallowUnknownFields; every field the contract names is present
// here so a valid body is never rejected as "unknown field".
//
//   - reason_code  is OrderCancellationReasonCode (a closed enum); the server
//     validates it and writes it to order.cancel_reason verbatim (never a
//     hard-coded substitute).
//   - refund_kind  is optional and applies only post-capture; pre-capture the
//     auth is voided and refund_kind is ignored.
type cancelOrderAdminInput struct {
	ReasonCode string  `json:"reason_code"`
	ReasonText string  `json:"reason_text"`
	CaseID     string  `json:"case_id"`
	RefundKind *string `json:"refund_kind"`
}
