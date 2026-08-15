package restaurant

// Input DTOs.  They use only the fields the contract's requestBody allows.
// Server-controlled fields (commission_rate_bps, is_approved, halal_status,
// account_state, *_cents except price_cents on the item) MUST NOT appear here:
// DisallowUnknownFields will then 422 any body that asserts them (G-3).

// profileInputDTO is the RestaurantProfileInput schema.
// price / server-controlled fields are intentionally absent.
type profileInputDTO struct {
	LegalName       string   `json:"legal_name"`
	DisplayName     string   `json:"display_name"`
	OwnerFirstName  *string  `json:"owner_first_name"`
	OwnerLastName   *string  `json:"owner_last_name"`
	Description     *string  `json:"description"`
	PhoneE164       *string  `json:"phone_e164"`
	PublicPhoneE164 *string  `json:"public_phone_e164"`
	GstHstNumber    *string  `json:"gst_hst_number"`
	Province        string   `json:"province"`
	PostalCode      string   `json:"postal_code"`
	City            string   `json:"city"`
	Line1           string   `json:"line1"`
	Line2           *string  `json:"line2"`
	Latitude        float64  `json:"latitude"`
	Longitude       float64  `json:"longitude"`
	Timezone        *string  `json:"timezone"`
	CuisineIDs      []string `json:"cuisine_ids"`
	AvgPrepMinutes  *int     `json:"avg_prep_minutes"`
}

// hoursSlot is one weekly trading slot.
type hoursSlot struct {
	DayOfWeek       int    `json:"day_of_week"`
	OpensAt         string `json:"opens_at"`
	ClosesAt        string `json:"closes_at"`
	CrossesMidnight *bool  `json:"crosses_midnight"`
}

// hoursOverride is one date override (contract HoursOverride).
type hoursOverride struct {
	Date     string  `json:"date"`
	IsClosed bool    `json:"is_closed"`
	OpensAt  *string `json:"opens_at"`
	ClosesAt *string `json:"closes_at"`
	Reason   *string `json:"reason"`
}

// hoursInputDTO is the RestaurantHoursInput schema.
type hoursInputDTO struct {
	Intervals []hoursSlot     `json:"intervals"`
	Overrides []hoursOverride `json:"overrides"`
}

// documentInputDTO is the RestaurantDocumentInput schema.
// required: [doc_type, stored_object_id].
type documentInputDTO struct {
	DocType           string  `json:"doc_type"`
	StoredObjectID    string  `json:"stored_object_id"`
	Issuer            *string `json:"issuer"`
	IssuerBodyID      *string `json:"issuer_body_id"`
	CertificateNumber *string `json:"certificate_number"`
	IssuedOn          *string `json:"issued_on"`
	ValidUntil        *string `json:"valid_until"`
}

// categoryInputDTO is the MenuCategoryInput schema.
type categoryInputDTO struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	SortOrder   *int    `json:"sort_order"`
}

// menuItemInputDTO is the MenuItemInput schema.
// price_cents is the ONLY monetary field allowed on an inbound item body (G-3).
// HALAL_CERTIFIED may not appear in dietary_tags — the halal gate checks and 403s.
type menuItemInputDTO struct {
	Name              string   `json:"name"`
	CategoryID        string   `json:"category_id"`
	PriceCents        int64    `json:"price_cents"`
	Description       *string  `json:"description"`
	IngredientsText   *string  `json:"ingredients_text"`
	DietaryTags       []string `json:"dietary_tags"`
	AllergenTags      []string `json:"allergen_tags"`
	AllergensDeclared *bool    `json:"allergens_declared"`
	ImageObjectID     *string  `json:"image_object_id"`
	PrepMinutes       *int     `json:"prep_minutes"`
	SortOrder         *int     `json:"sort_order"`
}

// menuItemUpdateDTO is the MenuItemUpdateInput schema (PATCH — all fields optional).
type menuItemUpdateDTO struct {
	Name              *string  `json:"name"`
	CategoryID        *string  `json:"category_id"`
	PriceCents        *int64   `json:"price_cents"`
	Description       *string  `json:"description"`
	IngredientsText   *string  `json:"ingredients_text"`
	DietaryTags       []string `json:"dietary_tags"`
	AllergenTags      []string `json:"allergen_tags"`
	AllergensDeclared *bool    `json:"allergens_declared"`
	ImageObjectID     *string  `json:"image_object_id"`
	PrepMinutes       *int     `json:"prep_minutes"`
	SortOrder         *int     `json:"sort_order"`
}

// availabilityInputDTO is the MenuItemAvailabilityInput schema.
// No price field is present (R-18: binary state, not stock count).
// required: [availability_state] (enum AVAILABLE|OUT_OF_STOCK).
type availabilityInputDTO struct {
	AvailabilityState string  `json:"availability_state"`
	OutOfStockUntil   *string `json:"out_of_stock_until"`
}

// acceptInputDTO is the OrderAcceptInput schema.
// No amount field — the server computes prices (invariant #1).
type acceptInputDTO struct {
	PrepEtaMinutes *int    `json:"prep_eta_minutes"`
	AcceptedNote   *string `json:"accepted_note"`
}

// rejectInputDTO is the OrderRejectInput schema.
// required: [reason_code].
type rejectInputDTO struct {
	ReasonCode             string   `json:"reason_code"`
	Note                   *string  `json:"note"`
	UnavailableMenuItemIDs []string `json:"unavailable_menu_item_ids"`
}

// delayInputDTO is the OrderDelayInput schema.
// No amount field. required: [added_minutes, reason_code].
type delayInputDTO struct {
	AddedMinutes int    `json:"added_minutes"`
	ReasonCode   string `json:"reason_code"`
}

// staffUserDTO is the contract's RestaurantStaffUser.
type staffUserDTO struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	FullName    string  `json:"full_name"`
	Role        string  `json:"role"`
	Status      string  `json:"status"`
	LastLoginAt *string `json:"last_login_at"`
	CreatedAt   string  `json:"created_at"`
}

// staffUserInputDTO is the contract's RestaurantStaffUserInput.
type staffUserInputDTO struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
}
