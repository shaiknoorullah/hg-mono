package restaurant

// store.go — domain types returned by the Repo. These are the "view" structs
// that handlers marshal to JSON; they are never the same as the DTOs, which are
// the exact wire shapes the contract defines.

import "time"

// RestaurantProfile is the restaurant's editable metadata.
type RestaurantProfile struct {
	ID              string   `json:"id"`
	LegalName       string   `json:"legal_name"`
	DisplayName     string   `json:"display_name"`
	Description     *string  `json:"description"`
	PhoneE164       *string  `json:"phone_e164"`
	PublicPhoneE164 *string  `json:"public_phone_e164"`
	GstHstNumber    *string  `json:"gst_hst_number"`
	Province        *string  `json:"province"`
	PostalCode      *string  `json:"postal_code"`
	City            *string  `json:"city"`
	Line1           *string  `json:"line1"`
	Line2           *string  `json:"line2"`
	Latitude        *float64 `json:"latitude"`
	Longitude       *float64 `json:"longitude"`
	Timezone        string   `json:"timezone"`
	CuisineIDs      []string `json:"cuisine_ids"`
	AvgPrepMinutes  int      `json:"avg_prep_minutes"`
	DeliveryRadiusM int      `json:"delivery_radius_m"`
	HalalStatus     string   `json:"halal_status"`
	OnboardingState string   `json:"onboarding_state"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

// OnboardingStatus is the response shape for getRestaurantOnboardingStatus.
type OnboardingStatus struct {
	OnboardingState string `json:"onboarding_state"`
	ProgressPercent int    `json:"progress_percent"`
	ProfileComplete bool   `json:"profile_complete"`
	HoursComplete   bool   `json:"hours_complete"`
	DocumentsReady  bool   `json:"documents_ready"`
	HalalVerified   bool   `json:"halal_verified"`
}

// HoursSlotRow is one trading-hours record read from the database.
type HoursSlotRow struct {
	DayOfWeek       int    `json:"day_of_week"`
	OpensAt         string `json:"opens_at"`
	ClosesAt        string `json:"closes_at"`
	CrossesMidnight bool   `json:"crosses_midnight"`
}

// HoursOverrideRow is one date-override record from the database.
type HoursOverrideRow struct {
	OnDate   string  `json:"on_date"`
	IsClosed bool    `json:"is_closed"`
	OpensAt  *string `json:"opens_at"`
	ClosesAt *string `json:"closes_at"`
	Reason   *string `json:"reason"`
}

// HoursView is the response shape for getRestaurantHours.
type HoursView struct {
	Hours     []HoursSlotRow     `json:"hours"`
	Overrides []HoursOverrideRow `json:"overrides"`
}

// DocumentRow is one kyc_document record.
type DocumentRow struct {
	ID          string  `json:"id"`
	SubjectID   string  `json:"subject_id"`
	DocType     string  `json:"doc_type"`
	State       string  `json:"state"`
	StoredObjID string  `json:"stored_object_id"`
	ExpiresOn   *string `json:"expires_on"`
	IssuerName  *string `json:"issuer_name"`
	CreatedAt   string  `json:"created_at"`
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

// MenuItemView is a menu item with its live and pending versions.
type MenuItemView struct {
	ID                string           `json:"id"`
	CategoryID        string           `json:"category_id"`
	PriceCents        int64            `json:"price_cents"`
	Currency          string           `json:"currency"`
	AvailabilityState string           `json:"availability_state"`
	OutOfStockUntil   *string          `json:"out_of_stock_until"`
	SortOrder         int              `json:"sort_order"`
	LiveVersion       *MenuItemVersion `json:"live_version"`
	PendingVersion    *MenuItemVersion `json:"pending_version"`
	CreatedAt         string           `json:"created_at"`
	UpdatedAt         string           `json:"updated_at"`
}

// MenuItemVersion is a version of a menu item.
type MenuItemVersion struct {
	ID              string   `json:"id"`
	Version         int      `json:"version"`
	Name            string   `json:"name"`
	Description     *string  `json:"description"`
	IngredientsText *string  `json:"ingredients_text"`
	DietaryTags     []string `json:"dietary_tags"`
	AllergenTags    []string `json:"allergen_tags"`
	ReviewStatus    string   `json:"review_status"`
	CreatedAt       string   `json:"created_at"`
}

// MenuView is the response shape for getOwnMenu.
type MenuView struct {
	RestaurantID string             `json:"restaurant_id"`
	Categories   []MenuCategoryView `json:"categories"`
}

// OrderSummaryView is one order in the restaurant's order list.
type OrderSummaryView struct {
	ID         string  `json:"id"`
	Code       string  `json:"code"`
	State      string  `json:"state"`
	TotalCents int64   `json:"total_cents"`
	Currency   string  `json:"currency"`
	ItemCount  int     `json:"item_count"`
	PlacedAt   string  `json:"placed_at"`
	DeadlineAt *string `json:"deadline_at"`
}

// OrderDetailView is the restaurant's view of one order.
type OrderDetailView struct {
	ID                  string          `json:"id"`
	Code                string          `json:"code"`
	State               string          `json:"state"`
	StateSince          string          `json:"state_since"`
	DeadlineAt          *string         `json:"deadline_at"`
	TotalCents          int64           `json:"total_cents"`
	SubtotalCents       int64           `json:"subtotal_cents"`
	Currency            string          `json:"currency"`
	Lines               []OrderLineView `json:"lines"`
	PlacedAt            string          `json:"placed_at"`
	AcceptedAt          *string         `json:"accepted_at"`
	ReadyAt             *string         `json:"ready_at"`
	RejectReason        *string         `json:"reject_reason"`
	SpecialInstructions *string         `json:"special_instructions"`
}

// OrderLineView is one line of an order as seen by the restaurant.
type OrderLineView struct {
	LineNo         int    `json:"line_no"`
	Name           string `json:"name"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unit_price_cents"`
	LineTotalCents int64  `json:"line_total_cents"`
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
