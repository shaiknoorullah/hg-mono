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
