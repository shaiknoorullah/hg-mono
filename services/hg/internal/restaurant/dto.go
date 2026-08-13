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
	DeliveryRadiusM *int     `json:"delivery_radius_m"`
}

// hoursSlot is one weekly trading slot.
type hoursSlot struct {
	DayOfWeek      int    `json:"day_of_week"`
	OpensAt        string `json:"opens_at"`
	ClosesAt       string `json:"closes_at"`
	CrossesMidnight *bool  `json:"crosses_midnight"`
}

// hoursOverride is one date override.
type hoursOverride struct {
	OnDate   string  `json:"on_date"`
	IsClosed bool    `json:"is_closed"`
	OpensAt  *string `json:"opens_at"`
	ClosesAt *string `json:"closes_at"`
	Reason   *string `json:"reason"`
}

// hoursInputDTO is the RestaurantHoursInput schema.
type hoursInputDTO struct {
	Hours     []hoursSlot     `json:"hours"`
	Overrides []hoursOverride `json:"overrides"`
}

// documentInputDTO is the RestaurantDocumentInput schema.
type documentInputDTO struct {
	StoredObjectID string  `json:"stored_object_id"`
	DocType        string  `json:"doc_type"`
	ExpiresOn      *string `json:"expires_on"`
	IssuerName     *string `json:"issuer_name"`
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
	Name            string   `json:"name"`
	CategoryID      string   `json:"category_id"`
	PriceCents      int64    `json:"price_cents"`
	Description     *string  `json:"description"`
	IngredientsText *string  `json:"ingredients_text"`
	DietaryTags     []string `json:"dietary_tags"`
	AllergenTags    []string `json:"allergen_tags"`
	SortOrder       *int     `json:"sort_order"`
}

// menuItemUpdateDTO is the MenuItemUpdateInput schema (PATCH — all fields optional).
type menuItemUpdateDTO struct {
	Name            *string  `json:"name"`
	CategoryID      *string  `json:"category_id"`
	PriceCents      *int64   `json:"price_cents"`
	Description     *string  `json:"description"`
	IngredientsText *string  `json:"ingredients_text"`
	DietaryTags     []string `json:"dietary_tags"`
	AllergenTags    []string `json:"allergen_tags"`
	SortOrder       *int     `json:"sort_order"`
}

// availabilityInputDTO is the MenuItemAvailabilityInput schema.
// No price field is present (R-18: binary state, not stock count).
type availabilityInputDTO struct {
	IsAvailable      bool    `json:"is_available"`
	OutOfStockUntil  *string `json:"out_of_stock_until"`
}

// acceptInputDTO is the OrderAcceptInput schema.
// No amount field — the server computes prices (invariant #1).
type acceptInputDTO struct {
	PromisedReadyMinutes *int `json:"promised_ready_minutes"`
}

// rejectInputDTO is the OrderRejectInput schema.
type rejectInputDTO struct {
	Reason string  `json:"reason"`
	Note   *string `json:"note"`
}

// delayInputDTO is the OrderDelayInput schema.
// No amount field.
type delayInputDTO struct {
	DelayMinutes int    `json:"delay_minutes"`
	Reason       string `json:"reason"`
}
