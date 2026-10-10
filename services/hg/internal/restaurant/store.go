package restaurant

// store.go — domain types returned by the Repo. These are the "view" structs
// that handlers marshal to JSON; they mirror the contract response schemas
// exactly (additionalProperties:false — no extra fields, all required present).

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// HalalBadge is the contract's HalalBadge schema (C-12). When this object is
// absent the client renders no badge and reports an error — there is no
// "assume certified" path. display_state is always present.
type HalalBadge struct {
	DisplayState       string  `json:"display_state"`
	CertifyingBodyName *string `json:"certifying_body_name,omitempty"`
	ExpiresOn          *string `json:"expires_on,omitempty"`
}

// PublicAddress is the contract's PublicAddress schema (nested on the profile).
type PublicAddress struct {
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	Province   string  `json:"province"`
	PostalCode string  `json:"postal_code"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}

// RestaurantProfile is the restaurant's editable metadata (contract RestaurantProfile).
// required: [id, legal_name, display_name, address, timezone, account_state, onboarding_state].
type RestaurantProfile struct {
	ID              string        `json:"id"`
	LegalName       string        `json:"legal_name"`
	DisplayName     string        `json:"display_name"`
	Description     *string       `json:"description"`
	OwnerFirstName  *string       `json:"owner_first_name,omitempty"`
	OwnerLastName   *string       `json:"owner_last_name,omitempty"`
	PhoneE164       *string       `json:"phone_e164"`
	PublicPhoneE164 *string       `json:"public_phone_e164"`
	GstHstNumber    *string       `json:"gst_hst_number"`
	Address         PublicAddress `json:"address"`
	Timezone        string        `json:"timezone"`
	CuisineIDs      []string      `json:"cuisine_ids"`
	AvgPrepMinutes  int           `json:"avg_prep_minutes"`
	DeliveryRadiusM int           `json:"delivery_radius_m"`
	AccountState    string        `json:"account_state"`
	OnboardingState string        `json:"onboarding_state"`
	Halal           *HalalBadge   `json:"halal,omitempty"`
}

// OnboardingSteps is the steps_completed object on RestaurantOnboardingStatus.
type OnboardingSteps struct {
	Profile            bool `json:"profile"`
	DocumentsUploaded  bool `json:"documents_uploaded"`
	DocumentsSubmitted bool `json:"documents_submitted"`
	DocumentsApproved  bool `json:"documents_approved"`
	PayoutAccount      bool `json:"payout_account"`
	MenuPublished      bool `json:"menu_published"`
}

// OnboardingStatus is the response shape for getRestaurantOnboardingStatus
// (contract RestaurantOnboardingStatus).
// required: [onboarding_state, account_state, current_step, progress_percent, steps_completed].
type OnboardingStatus struct {
	OnboardingState string          `json:"onboarding_state"`
	AccountState    string          `json:"account_state"`
	CurrentStep     string          `json:"current_step"`
	ProgressPercent int             `json:"progress_percent"`
	StepsCompleted  OnboardingSteps `json:"steps_completed"`
}

// HoursSlotRow is one trading-hours record (contract TradingInterval).
type HoursSlotRow struct {
	DayOfWeek       int    `json:"day_of_week"`
	OpensAt         string `json:"opens_at"`
	ClosesAt        string `json:"closes_at"`
	CrossesMidnight bool   `json:"crosses_midnight"`
}

// HoursOverrideRow is one date-override record (contract HoursOverride).
type HoursOverrideRow struct {
	Date     string  `json:"date"`
	IsClosed bool    `json:"is_closed"`
	OpensAt  *string `json:"opens_at"`
	ClosesAt *string `json:"closes_at"`
	Reason   *string `json:"reason"`
}

// HoursView is the response shape for getRestaurantHours (contract RestaurantHours).
// required: [timezone, intervals, overrides].
type HoursView struct {
	Timezone  string             `json:"timezone"`
	Intervals []HoursSlotRow     `json:"intervals"`
	Overrides []HoursOverrideRow `json:"overrides"`
}

// DocumentRow is one kyc_document record (contract KycDocument).
// required: [id, subject_type, doc_type, state, version, created_at].
type DocumentRow struct {
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

// MenuCategoryView is a menu category with its items.
type MenuCategoryView struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description *string        `json:"description"`
	SortOrder   int            `json:"sort_order"`
	IsActive    bool           `json:"is_active"`
	Items       []MenuItemView `json:"items"`
}

// MenuItemView is a menu item with its live and pending versions
// (contract MenuItemOwnerView = MenuItem base + category_id/versions/sort_order).
type MenuItemView struct {
	ID                string           `json:"id"`
	Name              string           `json:"name"`
	Description       *string          `json:"description"`
	ImageURL          *string          `json:"image_url"`
	CategoryID        string           `json:"category_id"`
	PriceCents        int64            `json:"price_cents"`
	Currency          string           `json:"currency"`
	AvailabilityState string           `json:"availability_state"`
	OutOfStockUntil   *string          `json:"out_of_stock_until"`
	DietaryTags       []string         `json:"dietary_tags"`
	AllergenTags      []string         `json:"allergen_tags"`
	IngredientsText   *string          `json:"ingredients_text"`
	TaxCategory       string           `json:"tax_category"`
	PrepMinutes       *int             `json:"prep_minutes"`
	LiveVersion       *MenuItemVersion `json:"live_version"`
	PendingVersion    *MenuItemVersion `json:"pending_version"`
	SortOrder         int              `json:"sort_order"`
}

// MenuItemVersion is a version of a menu item (contract MenuItemVersion).
// required: [id, menu_item_id, version, review_status, created_at].
type MenuItemVersion struct {
	ID              string   `json:"id"`
	MenuItemID      string   `json:"menu_item_id"`
	RestaurantID    *string  `json:"restaurant_id,omitempty"`
	Version         int      `json:"version"`
	Name            string   `json:"name"`
	Description     *string  `json:"description"`
	IngredientsText *string  `json:"ingredients_text"`
	DietaryTags     []string `json:"dietary_tags"`
	AllergenTags    []string `json:"allergen_tags"`
	ImageURL        *string  `json:"image_url,omitempty"`
	ReviewStatus    string   `json:"review_status"`
	CreatedAt       string   `json:"created_at"`
}

// MenuView is the response shape for getOwnMenu (contract OwnedMenu).
type MenuView struct {
	RestaurantID string             `json:"restaurant_id"`
	Categories   []MenuCategoryView `json:"categories"`
}

// RestaurantOrderMoney is the nested money object on OrderRestaurantView.
// The restaurant sees what it will be paid, not the customer's rider tip.
// required: [subtotal_cents, total_cents, restaurant_net_cents, commission_cents, currency].
type RestaurantOrderMoney struct {
	SubtotalCents      int64  `json:"subtotal_cents"`
	DiscountCents      *int64 `json:"discount_cents,omitempty"`
	CommissionCents    int64  `json:"commission_cents"`
	RestaurantNetCents int64  `json:"restaurant_net_cents"`
	TotalCents         int64  `json:"total_cents"`
	Currency           string `json:"currency"`
}

// OrderCustomerRef is the minimised customer reference (P-07): first name plus
// last initial, and a masked phone. required: [display_name, phone_masked].
type OrderCustomerRef struct {
	DisplayName string `json:"display_name"`
	PhoneMasked string `json:"phone_masked"`
}

// OrderLineView is one line of an order as seen by the restaurant
// (contract OrderLine). required: [line_no, menu_item_id, name, variants,
// quantity, unit_price_cents, line_total_cents, currency].
type OrderLineView struct {
	LineNo      int     `json:"line_no"`
	MenuItemID  string  `json:"menu_item_id"`
	Name        string  `json:"name"`
	VariantName *string `json:"variant_name,omitempty"`
	// Variants is every chosen variant with its group, so the ticket shows
	// each choice (https://github.com/shaiknoorullah/hg-mono/issues/628).
	Variants       []orders.LineVariantDTO `json:"variants"`
	Quantity       int                     `json:"quantity"`
	SpecialRequest *string                 `json:"special_request,omitempty"`
	UnitPriceCents int64                   `json:"unit_price_cents"`
	LineTotalCents int64                   `json:"line_total_cents"`
	Currency       string                  `json:"currency"`
}

// OrderRestaurantView is the restaurant's view of one order (contract
// OrderRestaurantView). It is the ONE shape returned by get/list/accept/
// reject/ready/delay. required: [id, code, state, lines, money, customer, placed_at].
type OrderRestaurantView struct {
	ID                  string               `json:"id"`
	Code                string               `json:"code"`
	State               string               `json:"state"`
	DeadlineAt          *string              `json:"deadline_at"`
	PromisedReadyAt     *string              `json:"promised_ready_at"`
	Customer            OrderCustomerRef     `json:"customer"`
	DeliveryArea        *string              `json:"delivery_area,omitempty"`
	SpecialInstructions *string              `json:"special_instructions"`
	Lines               []OrderLineView      `json:"lines"`
	Money               RestaurantOrderMoney `json:"money"`
	IsLate              *bool                `json:"is_late,omitempty"`
	PlacedAt            string               `json:"placed_at"`
	AcceptedAt          *string              `json:"accepted_at"`
	ReadyAt             *string              `json:"ready_at"`
}

func tsStrPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format("2006-01-02T15:04:05.000Z")
	return &s
}

func tsStr(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
