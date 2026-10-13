package orders

import (
	"encoding/json"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ---- Wire DTOs for the three new read operations ----
// Every struct mirrors the contract schema exactly (additionalProperties:false,
// DisallowUnknownFields on inbound decoders). These are outbound-only so no
// decoder is needed — json.Marshal is the only path.

// ---- getOrderTracking ----

type orderTrackingDTO struct {
	OrderID string `json:"order_id"`
	State   string `json:"state"`
	// The following fields are contract-nullable (type: [..., 'null']) and the
	// reference fixtures always render them — present as null when absent, never
	// omitted. omitempty would drop the key and diverge from the fixture shape.
	DispatchState       *string                `json:"dispatch_state"`
	ETAAt               *string                `json:"eta_at"`
	ETAWindowMinutes    *int                   `json:"eta_window_minutes"`
	RestaurantLocation  geoPointDTO            `json:"restaurant_location"`
	DestinationLocation *geoPointDTO           `json:"destination_location"`
	RiderLocation       *riderLocationDTO      `json:"rider_location"`
	Rider               *riderPublicProfileDTO `json:"rider"`
	Timeline            []orderTransitionDTO   `json:"timeline"`
	// DeliveryCode: see OrderTracking.DeliveryCode. Null unless shown.
	DeliveryCode *string `json:"delivery_code"`
}

type geoPointDTO struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type riderLocationDTO struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	// Kinematic fields are contract-nullable (type: [number, 'null']) and the
	// reference fixtures render them as null when the fix lacks them (e.g.
	// tracking_degraded_gps). Present-as-null, never omitted.
	HeadingDeg *float64 `json:"heading_deg"`
	SpeedMPS   *float64 `json:"speed_mps"`
	AccuracyM  *float64 `json:"accuracy_m"`
	RecordedAt string   `json:"recorded_at"`
	IsCoarse   bool     `json:"is_coarse"`
}

type riderPublicProfileDTO struct {
	FirstName   string   `json:"first_name"`
	LastInitial string   `json:"last_initial"`
	PhotoURL    *string  `json:"photo_url"`
	VehicleType string   `json:"vehicle_type"`
	RatingAvg   *float64 `json:"rating_avg"`
}

type orderTransitionDTO struct {
	FromState *string `json:"from_state"`
	ToState   string  `json:"to_state"`
	ActorKind string  `json:"actor_kind"`
	// reason is contract-nullable and the fixtures render "reason": null, never
	// omit it.
	Reason *string `json:"reason"`
	At     string  `json:"at"`
}

// ---- getOrderReceipt ----
// The receipt is stored as a frozen JSONB snapshot. We unmarshal it into a
// typed struct so the handler can re-marshal it into the contract envelope,
// ensuring no extra fields leak through even if the snapshot has extras. The
// snapshot is written from this same struct at COMPLETED (receipt.go), so the
// stored shape and the served shape are one type.

type receiptSnapshotDTO struct {
	OrderID                         string            `json:"order_id"`
	OrderCode                       string            `json:"order_code"`
	ReceiptNumber                   string            `json:"receipt_number"`
	IssuedAt                        string            `json:"issued_at"`
	PlatformLegalName               string            `json:"platform_legal_name,omitempty"`
	PlatformTaxRegistrationNumber   *string           `json:"platform_tax_registration_number"`
	RestaurantLegalName             string            `json:"restaurant_legal_name"`
	RestaurantTaxRegistrationNumber *string           `json:"restaurant_tax_registration_number"`
	DeliveryAddress                 *publicAddressDTO `json:"delivery_address"`
	Lines                           []receiptLineDTO  `json:"lines"`
	Money                           receiptMoneyDTO   `json:"money"`
	Payment                         receiptPaymentDTO `json:"payment"`
	Refunds                         []json.RawMessage `json:"refunds"`
	PlacedAt                        string            `json:"placed_at"`
	DeliveredAt                     *string           `json:"delivered_at"`
}

type receiptLineDTO struct {
	LineNo         int                 `json:"line_no"`
	MenuItemID     string              `json:"menu_item_id"`
	Name           string              `json:"name"`
	VariantName    *string             `json:"variant_name"`
	Variants       []LineVariantDTO    `json:"variants"`
	Addons         []quoteLineAddonDTO `json:"addons"`
	Quantity       int                 `json:"quantity"`
	SpecialRequest *string             `json:"special_request"`
	UnitPriceCents int64               `json:"unit_price_cents"`
	LineTotalCents int64               `json:"line_total_cents"`
	Currency       string              `json:"currency"`
}

type receiptMoneyDTO struct {
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

type receiptPaymentDTO struct {
	CardBrand          *string `json:"card_brand"`
	CardLast4          *string `json:"card_last4"`
	Wallet             *string `json:"wallet"`
	AmountChargedCents int64   `json:"amount_charged_cents"`
	Currency           string  `json:"currency"`
}

// publicAddressDTO is the contract PublicAddress: where the order went, with
// no buzzer, unit, notes or label.
type publicAddressDTO struct {
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	Province   string  `json:"province"`
	PostalCode string  `json:"postal_code"`
	Latitude   float64 `json:"latitude"`
	Longitude  float64 `json:"longitude"`
}

// normalizeArrays guarantees the contract-required array fields render as `[]`
// and never as JSON `null`. The receipt is re-marshalled from a frozen JSONB
// snapshot written by another module; a snapshot that omits `refunds`,
// `tax_lines` or a line's `addons` (or stores them as null) would otherwise
// unmarshal to a nil slice and re-marshal to `null`, violating the contract's
// non-nullable `type: array` for those fields (Receipt.refunds, OrderMoney.tax_lines,
// OrderLine.addons). We do not trust the snapshot's shape; we enforce the wire shape.
func (r *receiptSnapshotDTO) normalizeArrays() {
	if r.Refunds == nil {
		r.Refunds = []json.RawMessage{}
	}
	if r.Lines == nil {
		r.Lines = []receiptLineDTO{}
	}
	if r.Money.TaxLines == nil {
		r.Money.TaxLines = []quoteTaxLineDTO{}
	}
	for i := range r.Lines {
		if r.Lines[i].Addons == nil {
			r.Lines[i].Addons = []quoteLineAddonDTO{}
		}
		// A receipt frozen before lines carried variants has none to show
		// beyond its variant_name.
		if r.Lines[i].Variants == nil {
			r.Lines[i].Variants = []LineVariantDTO{}
		}
	}
}

// ---- mappers ----

func orderTrackingToDTO(ot *OrderTracking) orderTrackingDTO {
	d := orderTrackingDTO{
		OrderID:            ot.OrderID,
		State:              ot.State,
		DispatchState:      ot.DispatchState,
		RestaurantLocation: geoPointDTO{Latitude: ot.RestaurantLocation.Latitude, Longitude: ot.RestaurantLocation.Longitude},
		Timeline:           make([]orderTransitionDTO, 0, len(ot.Timeline)),
		DeliveryCode:       ot.DeliveryCode,
		// rider_location and rider are always present in the JSON (null when absent).
	}
	if ot.DestinationLocation != nil {
		dl := geoPointDTO{Latitude: ot.DestinationLocation.Latitude, Longitude: ot.DestinationLocation.Longitude}
		d.DestinationLocation = &dl
	}
	if ot.ETAAt != nil {
		s := httpx.Timestamp(*ot.ETAAt)
		d.ETAAt = &s
	}
	d.ETAWindowMinutes = ot.ETAWindowMinutes
	if ot.RiderLocation != nil {
		d.RiderLocation = &riderLocationDTO{
			Latitude:   ot.RiderLocation.Latitude,
			Longitude:  ot.RiderLocation.Longitude,
			HeadingDeg: ot.RiderLocation.HeadingDeg,
			SpeedMPS:   ot.RiderLocation.SpeedMPS,
			AccuracyM:  ot.RiderLocation.AccuracyM,
			RecordedAt: httpx.Timestamp(ot.RiderLocation.RecordedAt),
			IsCoarse:   ot.RiderLocation.IsCoarse,
		}
	}
	if ot.Rider != nil {
		d.Rider = riderPublicProfileToDTO(ot.Rider)
	}
	for _, tr := range ot.Timeline {
		d.Timeline = append(d.Timeline, orderTransitionDTO{
			FromState: tr.FromState,
			ToState:   tr.ToState,
			ActorKind: tr.ActorKind,
			Reason:    tr.Reason,
			At:        httpx.Timestamp(tr.At),
		})
	}
	return d
}

func riderPublicProfileToDTO(rp *RiderPublicProfile) *riderPublicProfileDTO {
	if rp == nil {
		return nil
	}
	r := riderPublicProfileDTO{
		FirstName:   rp.FirstName,
		LastInitial: rp.LastInitial,
		PhotoURL:    rp.PhotoURL,
		VehicleType: rp.VehicleType,
		RatingAvg:   rp.RatingAvg,
	}
	return &r
}

// tsString converts an optional *time.Time to *string using the contract format.
func tsString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := httpx.Timestamp(*t)
	return &s
}
