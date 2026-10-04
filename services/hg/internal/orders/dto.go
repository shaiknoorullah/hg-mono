package orders

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// This file holds the wire DTOs — the exact shapes from contracts/openapi.yaml.
// Money is int64 cents everywhere; no inbound DTO carries a price (G-3), enforced
// by the unknown-field decoder plus the absence of any price field on the input
// structs.

// ---- Halal ----

// halalBadgeDTO is the contract's HalalBadge schema (C-12). It is the product's
// single claim: a HalalBadge object with display_state, never a flat string. When
// the object is absent from a payload the client renders no badge — there is no
// "assume certified" path (invariant #8).
type halalBadgeDTO struct {
	DisplayState       string  `json:"display_state"`
	CertifyingBodyName *string `json:"certifying_body_name,omitempty"`
	ExpiresOn          *string `json:"expires_on,omitempty"`
}

// halalAvailabilityDTO is the contract's RestaurantAvailabilityInfo (C-14): the
// server-computed serviceability verdict surfaced on a RestaurantCard.
type restaurantAvailabilityInfoDTO struct {
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

// restaurantCardDTO is the contract's RestaurantCard: the browse/search card,
// reused on the cart to re-assert the chosen restaurant's halal seal before
// checkout. required: [id, name, halal, availability].
type restaurantCardDTO struct {
	ID           string                        `json:"id"`
	Name         string                        `json:"name"`
	Slug         string                        `json:"slug,omitempty"`
	HeroImageURL *string                       `json:"hero_image_url"`
	LogoImageURL *string                       `json:"logo_image_url"`
	Cuisines     []string                      `json:"cuisines"`
	RatingAvg    *float64                      `json:"rating_avg"`
	RatingCount  int32                         `json:"rating_count"`
	PriceBand    *string                       `json:"price_band"`
	Halal        halalBadgeDTO                 `json:"halal"`
	Availability restaurantAvailabilityInfoDTO `json:"availability"`
}

// ---- Cart ----

type cartDTO struct {
	ID                      string             `json:"id"`
	Restaurant              *restaurantCardDTO `json:"restaurant"`
	DeliveryAddressID       *string            `json:"delivery_address_id"`
	Lines                   []cartLineDTO      `json:"lines"`
	ItemCount               int                `json:"item_count"`
	IndicativeSubtotalCents int64              `json:"indicative_subtotal_cents"`
	Currency                string             `json:"currency"`
	IsQuotable              bool               `json:"is_quotable"`
	BlockingReasons         []string           `json:"blocking_reasons,omitempty"`
}

type cartLineDTO struct {
	ID             string              `json:"id"`
	MenuItemID     string              `json:"menu_item_id"`
	Name           string              `json:"name"`
	ImageURL       *string             `json:"image_url"`
	Variant        *selectedVariantDTO `json:"variant"`
	Addons         []selectedAddonDTO  `json:"addons"`
	Quantity       int                 `json:"quantity"`
	SpecialRequest *string             `json:"special_request"`
	UnitPriceCents int64               `json:"unit_price_cents"`
	LineTotalCents int64               `json:"line_total_cents"`
	Currency       string              `json:"currency"`
	Availability   cartAvailabilityDTO `json:"availability"`
}

type selectedVariantDTO struct {
	VariantID   string `json:"variant_id"`
	Name        string `json:"name"`
	PricingMode string `json:"pricing_mode"`
}

type selectedAddonDTO struct {
	AddonID  string `json:"addon_id"`
	Name     string `json:"name"`
	Quantity int    `json:"quantity"`
}

type cartAvailabilityDTO struct {
	IsAvailable       bool    `json:"is_available"`
	Reason            *string `json:"reason"`
	CurrentPriceCents *int64  `json:"current_price_cents"`
}

// cartLineInputDTO is the addCartLine body — identifiers and quantities only.
type cartLineInputDTO struct {
	MenuItemID     string              `json:"menu_item_id"`
	VariantID      *string             `json:"variant_id"`
	Addons         []cartAddonInputDTO `json:"addons"`
	Quantity       int                 `json:"quantity"`
	SpecialRequest *string             `json:"special_request"`
}

type cartAddonInputDTO struct {
	AddonID  string `json:"addon_id"`
	Quantity *int   `json:"quantity"`
}

type updateCartLineDTO struct {
	Quantity int `json:"quantity"`
}

// ---- Quote ----

// quoteInputDTO is the createQuote body. It carries tip_cents (the sole allowed
// monetary input) and no other price field.
type quoteInputDTO struct {
	CartID            string  `json:"cart_id"`
	DeliveryAddressID *string `json:"delivery_address_id"`
	Fulfilment        string  `json:"fulfilment"`
	TipCents          *int64  `json:"tip_cents"`
	PromoCode         *string `json:"promo_code"`
	ScheduledFor      *string `json:"scheduled_for"`
}

type quoteDTO struct {
	ID                    string            `json:"id"`
	CartID                string            `json:"cart_id"`
	RestaurantID          string            `json:"restaurant_id"`
	DeliveryAddressID     *string           `json:"delivery_address_id"`
	Fulfilment            string            `json:"fulfilment"`
	Currency              string            `json:"currency"`
	Lines                 []quoteLineDTO    `json:"lines"`
	SubtotalCents         int64             `json:"subtotal_cents"`
	DiscountItemsCents    int64             `json:"discount_items_cents"`
	DiscountDeliveryCents int64             `json:"discount_delivery_cents"`
	DiscountServiceCents  int64             `json:"discount_service_cents"`
	Discount              *quoteDiscountDTO `json:"discount"`
	DeliveryFeeCents      int64             `json:"delivery_fee_cents"`
	ServiceFeeCents       int64             `json:"service_fee_cents"`
	TaxLines              []quoteTaxLineDTO `json:"tax_lines"`
	TaxTotalCents         int64             `json:"tax_total_cents"`
	TipCents              int64             `json:"tip_cents"`
	TotalCents            int64             `json:"total_cents"`
	BillableKM            int               `json:"billable_km"`
	RouteMeters           int               `json:"route_meters"`
	RouteSource           string            `json:"route_source"`
	ExpiresAt             string            `json:"expires_at"`
	CreatedAt             string            `json:"created_at"`
}

type quoteLineDTO struct {
	LineNo             int                 `json:"line_no"`
	MenuItemID         string              `json:"menu_item_id"`
	MenuItemName       string              `json:"menu_item_name"`
	VariantID          *string             `json:"variant_id"`
	VariantName        *string             `json:"variant_name"`
	VariantPricingMode *string             `json:"variant_pricing_mode"`
	Addons             []quoteLineAddonDTO `json:"addons"`
	Quantity           int                 `json:"quantity"`
	BasePriceCents     int64               `json:"base_price_cents"`
	VariantPartCents   int64               `json:"variant_part_cents"`
	AddonsPartCents    int64               `json:"addons_part_cents"`
	LineUnitCents      int64               `json:"line_unit_cents"`
	LineTotalCents     int64               `json:"line_total_cents"`
	SpecialRequest     *string             `json:"special_request"`
	TaxCategory        string              `json:"tax_category"`
}

type quoteLineAddonDTO struct {
	AddonID         string `json:"addon_id"`
	AddonName       string `json:"addon_name"`
	AddonQuantity   int    `json:"addon_quantity"`
	AddonPriceCents int64  `json:"addon_price_cents"`
}

type quoteDiscountDTO struct {
	Code         *string `json:"code"`
	AmountCents  int64   `json:"amount_cents"`
	Target       string  `json:"target"`
	FundedBy     string  `json:"funded_by"`
	Reimbursable bool    `json:"reimbursable"`
}

type quoteTaxLineDTO struct {
	JurisdictionCode string `json:"jurisdiction_code"`
	TaxKind          string `json:"tax_kind"`
	StatutoryLabel   string `json:"statutory_label"`
	Rate             string `json:"rate"`
	BaseCents        int64  `json:"base_cents"`
	AmountCents      int64  `json:"amount_cents"`
	RebateApplied    bool   `json:"rebate_applied"`
	RemittableBy     string `json:"remittable_by"`
}

// ---- Order ----

// orderInputDTO is the createOrder body — quote_id + preferences, no amount.
type orderInputDTO struct {
	QuoteID              string   `json:"quote_id"`
	PaymentMethodID      *string  `json:"payment_method_id"`
	SavePaymentMethod    *bool    `json:"save_payment_method"`
	DeliveryInstructions []string `json:"delivery_instructions"`
	SpecialInstructions  *string  `json:"special_instructions"`
}

type orderCreatedDTO struct {
	Order        orderCustomerViewDTO `json:"order"`
	ClientSecret string               `json:"client_secret"`
}

type orderCustomerViewDTO struct {
	ID                   string                 `json:"id"`
	Code                 string                 `json:"code"`
	State                string                 `json:"state"`
	StateSince           string                 `json:"state_since"`
	DeadlineAt           *string                `json:"deadline_at"`
	QuoteID              string                 `json:"quote_id"`
	Restaurant           orderRestaurantRefDTO  `json:"restaurant"`
	Lines                []orderLineDTO         `json:"lines"`
	Money                orderMoneyDTO          `json:"money"`
	DeliveryAddress      *addressDTO            `json:"delivery_address"`
	DeliveryInstructions []string               `json:"delivery_instructions"`
	SpecialInstructions  *string                `json:"special_instructions"`
	Rider                *riderPublicProfileDTO `json:"rider"`
	DispatchState        *string                `json:"dispatch_state"`
	CancelReason         *string                `json:"cancel_reason"`
	RejectReason         *string                `json:"reject_reason"`
	CanCancel            bool                   `json:"can_cancel"`
	PlacedAt             string                 `json:"placed_at"`
	AcceptedAt           *string                `json:"accepted_at"`
	ReadyAt              *string                `json:"ready_at"`
	PickedUpAt           *string                `json:"picked_up_at"`
	DeliveredAt          *string                `json:"delivered_at"`
	CompletedAt          *string                `json:"completed_at"`
	// DeliveryCode is null except on the customer's own view of a met handover
	// that is out for delivery (handover.DeliveryCodeVisible). This DTO is only
	// ever rendered for the order's customer; the support view has its own
	// type, whose delivery_code is always null (internal/admin).
	DeliveryCode *string `json:"delivery_code"`
}

type orderRestaurantRefDTO struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	LogoImageURL *string        `json:"logo_image_url"`
	Halal        *halalBadgeDTO `json:"halal,omitempty"`
}

// addressDTO is the contract's Address schema — the customer's delivery address
// on the order projection.
type addressDTO struct {
	ID            string  `json:"id"`
	Label         *string `json:"label"`
	Line1         string  `json:"line1"`
	Line2         *string `json:"line2"`
	Unit          *string `json:"unit"`
	Buzzer        *string `json:"buzzer"`
	City          string  `json:"city"`
	Province      string  `json:"province"`
	PostalCode    string  `json:"postal_code"`
	Country       string  `json:"country"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	Timezone      string  `json:"timezone"`
	DeliveryNotes *string `json:"delivery_notes"`
	IsDefault     bool    `json:"is_default"`
}

// The rider's public profile on the customer order view reuses the contract's
// RiderPublicProfile DTO defined in ordersread_dto.go (riderPublicProfileDTO).

type orderLineDTO struct {
	LineNo         int                 `json:"line_no"`
	MenuItemID     string              `json:"menu_item_id"`
	Name           string              `json:"name"`
	VariantName    *string             `json:"variant_name"`
	Addons         []quoteLineAddonDTO `json:"addons"`
	Quantity       int                 `json:"quantity"`
	SpecialRequest *string             `json:"special_request"`
	UnitPriceCents int64               `json:"unit_price_cents"`
	LineTotalCents int64               `json:"line_total_cents"`
	Currency       string              `json:"currency"`
}

type orderMoneyDTO struct {
	SubtotalCents    int64             `json:"subtotal_cents"`
	DiscountCents    int64             `json:"discount_cents"`
	DeliveryFeeCents int64             `json:"delivery_fee_cents"`
	ServiceFeeCents  int64             `json:"service_fee_cents"`
	TaxLines         []quoteTaxLineDTO `json:"tax_lines"`
	TaxTotalCents    int64             `json:"tax_total_cents"`
	TipCents         int64             `json:"tip_cents"`
	TotalCents       int64             `json:"total_cents"`
	Currency         string            `json:"currency"`
}

type orderSummaryDTO struct {
	ID             string                `json:"id"`
	Code           string                `json:"code"`
	State          string                `json:"state"`
	Restaurant     orderRestaurantRefDTO `json:"restaurant"`
	ItemCount      int                   `json:"item_count"`
	FirstItemNames []string              `json:"first_item_names"`
	TotalCents     int64                 `json:"total_cents"`
	Currency       string                `json:"currency"`
	PlacedAt       string                `json:"placed_at"`
	DeadlineAt     *string               `json:"deadline_at"`
}

type orderCancellationInputDTO struct {
	ReasonCode string  `json:"reason_code"`
	Note       *string `json:"note"`
}

// tsPtr renders an optional timestamp to the contract's Timestamp scalar.
func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := httpx.Timestamp(*t)
	return &s
}
