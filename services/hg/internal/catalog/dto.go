package catalog

// dto.go holds the wire shapes for the catalogue and discovery surface. Every
// struct here mirrors a schema in contracts/openapi.yaml exactly — field names,
// nullability and enum membership. Nothing is invented; where the contract says
// a field is nullable ([string, 'null']) it is a pointer here so `null` is
// distinguishable from the empty string.

// HalalBadge is the contract's HalalBadge schema (C-12). When absent from a
// payload the client renders no badge; it is never optional on a visible card.
type HalalBadge struct {
	DisplayState       string  `json:"display_state"`
	CertifyingBodyName *string `json:"certifying_body_name,omitempty"`
	ExpiresOn          *string `json:"expires_on,omitempty"`
}

// RestaurantAvailabilityInfo is the contract's RestaurantAvailabilityInfo (C-14):
// the server-computed serviceability verdict for one restaurant against one
// address. distance_m is geodesic metres from ST_Distance, never degrees×111.
type RestaurantAvailabilityInfo struct {
	State                      string  `json:"state"`
	OpensAt                    *string `json:"opens_at"`
	ClosesAt                   *string `json:"closes_at"`
	ETAMinMinutes              *int32  `json:"eta_min_minutes"`
	ETAMaxMinutes              *int32  `json:"eta_max_minutes"`
	IndicativeDeliveryFeeCents *int64  `json:"indicative_delivery_fee_cents"`
	MinimumOrderCents          *int64  `json:"minimum_order_cents"`
	DistanceM                  *int32  `json:"distance_m"`
	OutOfRangeReason           *string `json:"out_of_range_reason"`
}

// RestaurantCard is the contract's RestaurantCard: the browse/search card. It is
// the allOf base for RestaurantDetail, so the detail fields are added by
// embedding this struct.
type RestaurantCard struct {
	ID           string                     `json:"id"`
	Name         string                     `json:"name"`
	Slug         string                     `json:"slug,omitempty"`
	HeroImageURL *string                    `json:"hero_image_url"`
	LogoImageURL *string                    `json:"logo_image_url"`
	Cuisines     []string                   `json:"cuisines"`
	RatingAvg    *float64                   `json:"rating_avg"`
	RatingCount  int32                      `json:"rating_count"`
	PriceBand    *string                    `json:"price_band"`
	Halal        HalalBadge                 `json:"halal"`
	Availability RestaurantAvailabilityInfo `json:"availability"`
}

// PublicAddress is the contract's PublicAddress schema.
type PublicAddress struct {
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	Province   string  `json:"province"`
	PostalCode string  `json:"postal_code"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}

// TradingInterval is the contract's TradingInterval schema.
type TradingInterval struct {
	DayOfWeek       int32  `json:"day_of_week"`
	OpensAt         string `json:"opens_at"`
	ClosesAt        string `json:"closes_at"`
	CrossesMidnight bool   `json:"crosses_midnight,omitempty"`
}

// CertificationPanel is the contract's CertificationPanel (C-12) — the halal
// promise made inspectable.
type CertificationPanel struct {
	DisplayState        string  `json:"display_state"`
	CertifyingBodyName  *string `json:"certifying_body_name"`
	CertificateNumber   *string `json:"certificate_number"`
	Scope               *string `json:"scope"`
	IssuedOn            *string `json:"issued_on"`
	ExpiresOn           *string `json:"expires_on"`
	VerifiedAt          *string `json:"verified_at"`
	CertificateViewable bool    `json:"certificate_viewable"`
	Disclaimer          string  `json:"disclaimer"`
}

// RestaurantDetail is the contract's RestaurantDetail (allOf RestaurantCard).
// The embedded card is inlined by encoding/json because it has no json tag.
type RestaurantDetail struct {
	RestaurantCard
	Description     *string            `json:"description"`
	Address         PublicAddress      `json:"address"`
	Timezone        string             `json:"timezone"`
	PublicPhoneE164 *string            `json:"public_phone_e164"`
	Certification   CertificationPanel `json:"certification"`
	Hours           []TradingInterval  `json:"hours"`
}

// Variant is the contract's Variant schema. price_cents/delta_cents are pointers
// so exactly one is present per pricing_mode.
type Variant struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PricingMode string `json:"pricing_mode"`
	PriceCents  *int64 `json:"price_cents,omitempty"`
	DeltaCents  *int64 `json:"delta_cents,omitempty"`
	IsDefault   bool   `json:"is_default,omitempty"`
	IsAvailable bool   `json:"is_available"`
}

// VariantGroup is the contract's VariantGroup schema (C-16). Single-select.
type VariantGroup struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Required bool      `json:"required"`
	Variants []Variant `json:"variants"`
}

// Addon is the contract's Addon schema.
type Addon struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	PriceCents  int64  `json:"price_cents"`
	IsAvailable bool   `json:"is_available"`
}

// AddonGroup is the contract's AddonGroup schema.
type AddonGroup struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	MinSelect int32   `json:"min_select"`
	MaxSelect int32   `json:"max_select"`
	Addons    []Addon `json:"addons"`
}

// MenuItem is the customer projection of a menu item (live_version content only).
type MenuItem struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Description       *string        `json:"description"`
	ImageURL          *string        `json:"image_url"`
	PriceCents        int64          `json:"price_cents"`
	Currency          string         `json:"currency"`
	AvailabilityState string         `json:"availability_state"`
	OutOfStockUntil   *string        `json:"out_of_stock_until"`
	DietaryTags       []string       `json:"dietary_tags"`
	AllergenTags      []string       `json:"allergen_tags"`
	IngredientsText   *string        `json:"ingredients_text"`
	TaxCategory       string         `json:"tax_category"`
	PrepMinutes       *int32         `json:"prep_minutes"`
	VariantGroups     []VariantGroup `json:"variant_groups"`
	AddonGroups       []AddonGroup   `json:"addon_groups"`
}

// MenuCategoryWithItems is the contract's MenuCategoryWithItems (allOf).
type MenuCategoryWithItems struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description *string    `json:"description"`
	SortOrder   int32      `json:"sort_order"`
	IsActive    bool       `json:"is_active"`
	ItemCount   *int32     `json:"item_count,omitempty"`
	Items       []MenuItem `json:"items"`
}

// Menu is the contract's Menu schema.
type Menu struct {
	RestaurantID string                  `json:"restaurant_id"`
	Categories   []MenuCategoryWithItems `json:"categories"`
}

// DishResult is the contract's DishResult schema (search dishes group).
type DishResult struct {
	MenuItemID  string         `json:"menu_item_id"`
	Name        string         `json:"name"`
	Description *string        `json:"description"`
	ImageURL    *string        `json:"image_url"`
	PriceCents  int64          `json:"price_cents"`
	Currency    string         `json:"currency"`
	Restaurant  RestaurantCard `json:"restaurant"`
}

// SearchResults is the contract's SearchResults schema.
type SearchResults struct {
	Restaurants []RestaurantCard `json:"restaurants"`
	Dishes      []DishResult     `json:"dishes"`
}

// pageMeta mirrors the contract's PageMeta schema. It is emitted inside SearchMeta
// where httpx.Meta cannot be reused because it must nest twice.
type pageMeta struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
	Total      *int64  `json:"total,omitempty"`
}

// SearchMeta is the contract's SearchMeta schema: each group paginates
// independently.
type SearchMeta struct {
	Restaurants    pageMeta `json:"restaurants"`
	Dishes         pageMeta `json:"dishes"`
	RelaxationHint *string  `json:"relaxation_hint"`
}

// FeedSection is the contract's FeedSection schema. An empty section is omitted
// entirely by the handler, never emitted as an empty shell.
type FeedSection struct {
	Key         string           `json:"key"`
	Title       string           `json:"title"`
	Restaurants []RestaurantCard `json:"restaurants"`
}

// PresignedDownload is the contract's PresignedDownload schema.
type PresignedDownload struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

// RestaurantAvailability is the contract's RestaurantAvailability schema (R-22) —
// the restaurant-facing open-state verdict.
type RestaurantAvailability struct {
	OpenState         string  `json:"open_state"`
	IsAcceptingOrders bool    `json:"is_accepting_orders"`
	PauseUntil        *string `json:"pause_until"`
	LastHeartbeatAt   *string `json:"last_heartbeat_at"`
	MissedOrderCount  int32   `json:"missed_order_count"`
	Reason            string  `json:"reason"`
	ResolvableBy      string  `json:"resolvable_by,omitempty"`
}

// RestaurantHeartbeat is the contract's RestaurantHeartbeat schema.
type RestaurantHeartbeat struct {
	OpenState  string `json:"open_state"`
	ReceivedAt string `json:"received_at"`
}
