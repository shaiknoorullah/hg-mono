// Package pricing is the single function that turns a cart into money (P-09).
// It is deliberately pure: Compute takes an Inputs value assembled entirely from
// Postgres rows read inside the quote transaction and returns a Result. It reads
// nothing from the request body except tip_cents (the sole customer-chosen
// monetary input) and the item identifiers and quantities.
//
// The computation follows P-09 steps 1..9 in order, and every rounding operation
// appends to the rounding log (I-09.6, I-12.5) so the log's replay reproduces the
// stored totals exactly. Money is money.Amount throughout; no float appears.
package pricing

import (
	"errors"
	"fmt"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
)

// TaxCategory mirrors the contract's TaxCategory enum for the categories the
// pricing path handles at V1. BEVERAGE_ALCOHOL is rejected at menu publish, so
// it never reaches here.
type TaxCategory string

const (
	CategoryPreparedFood     TaxCategory = "PREPARED_FOOD"
	CategoryZeroRatedGrocery TaxCategory = "ZERO_RATED_GROCERY"
	CategoryDelivery         TaxCategory = "DELIVERY"
	CategoryServiceFee       TaxCategory = "SERVICE_FEE"
	CategoryBeverageAlcohol  TaxCategory = "BEVERAGE_ALCOHOL"
)

// Fulfilment mirrors the contract's Fulfilment enum.
type Fulfilment string

const (
	FulfilmentDelivery Fulfilment = "DELIVERY"
	FulfilmentPickup   Fulfilment = "PICKUP"
)

// Config is the effective pricing_config row the quote binds to (P-09 step 4/5).
// Every parameter is data, never a constant in code.
type Config struct {
	ID                       string
	BaseDeliveryFeeCents     money.Amount
	IncludedKM               int
	PerKMCents               money.Amount
	MinDeliveryFeeCents      money.Amount
	MaxDeliveryFeeCents      money.Amount
	SmallOrderThresholdCents money.Amount
	SmallOrderSurchargeCents money.Amount
	ServiceFeeRate           money.Rate
	ServiceFeeMinCents       money.Amount
	ServiceFeeMaxCents       money.Amount
	DefaultCommissionRate    money.Rate
	RiderBaseCents           money.Amount
	RiderPerKMCents          money.Amount
	RiderMinimumCents        money.Amount
	MaxTipCents              money.Amount
	QuoteTTLSeconds          int
}

// TaxRate is one effective tax_rate row keyed by (kind, category) for the
// resolved jurisdiction (P-11). The rate is exact (money.Rate), never a float.
type TaxRate struct {
	JurisdictionCode string
	TaxKind          string // GST | HST | QST | PST | RST | HST_FEDERAL_PART
	Category         TaxCategory
	Rate             money.Rate
	StatutoryLabel   string
	RemittableBy     string // PLATFORM | RESTAURANT
}

// LineInput is one cart line resolved to prices read from the menu inside the
// quote transaction (P-09 step 1). The server computes every cents value here;
// the client supplied only the identifiers and the quantity.
type LineInput struct {
	MenuItemID         string
	MenuItemVersionID  *string
	MenuItemName       string
	VariantID          *string // set only for a line with exactly one variant
	VariantName        *string // every chosen name, joined (VariantSummary)
	VariantPricingMode *string // ABSOLUTE | DELTA | nil; only for exactly one variant
	Variants           []VariantChoice
	Quantity           int
	BasePriceCents     money.Amount
	VariantPartCents   money.Amount // VariantPart(BasePriceCents, Variants)
	SpecialRequest     *string
	TaxCategory        TaxCategory
	Addons             []AddonInput
}

// Variant pricing modes (the contract's VariantPricingMode).
const (
	PricingAbsolute = "ABSOLUTE"
	PricingDelta    = "DELTA"
)

// VariantChoice is one chosen variant with the menu values it is priced from,
// one per variant group of the item.
type VariantChoice struct {
	VariantID      string
	VariantGroupID string
	GroupName      string
	Name           string
	PricingMode    string        // ABSOLUTE | DELTA
	PriceCents     *money.Amount // ABSOLUTE: replaces the base price
	DeltaCents     *money.Amount // DELTA: adjusts the base price
}

// ErrVariantPricing is returned by VariantPart for a combination it cannot
// price: two ABSOLUTE variants (each claims to be the price), or a result
// below zero. The menu is wrong, not the customer's choice, so callers refuse
// the line as unavailable rather than guess a price.
var ErrVariantPricing = errors.New("pricing: the chosen variants cannot be priced together")

// VariantPart is P-09 step 1 for any number of chosen variants: the chosen
// ABSOLUTE variant's price, else the base price, plus every chosen DELTA
// variant's delta. With one variant it is exactly the one-variant rule
// (ABSOLUTE replaces the base, DELTA adjusts it); with none it is the base.
// The cart's indicative price, the quote and the order all come from here.
func VariantPart(base money.Amount, chosen []VariantChoice) (money.Amount, error) {
	part := base
	var deltas money.Amount
	absolutes := 0
	for _, v := range chosen {
		switch v.PricingMode {
		case PricingAbsolute:
			if v.PriceCents == nil {
				return 0, fmt.Errorf("%w: variant %s has no price", ErrVariantPricing, v.VariantID)
			}
			absolutes++
			part = *v.PriceCents
		case PricingDelta:
			if v.DeltaCents == nil {
				return 0, fmt.Errorf("%w: variant %s has no delta", ErrVariantPricing, v.VariantID)
			}
			deltas = deltas.Add(*v.DeltaCents)
		default:
			return 0, fmt.Errorf("%w: variant %s has pricing mode %q", ErrVariantPricing, v.VariantID, v.PricingMode)
		}
	}
	if absolutes > 1 {
		return 0, fmt.Errorf("%w: %d variants each replace the base price", ErrVariantPricing, absolutes)
	}
	part = part.Add(deltas)
	if part < 0 {
		return 0, fmt.Errorf("%w: the variants take the price below zero", ErrVariantPricing)
	}
	return part, nil
}

// VariantSummary returns the legacy one-variant fields for a line: the id and
// pricing mode when there is exactly one variant, and every chosen name joined
// with ", " (nil when there is none). The restaurant ticket, the rider and the
// admin read the joined name, so they see every choice.
func VariantSummary(chosen []VariantChoice) (id, name, mode *string) {
	if len(chosen) == 0 {
		return nil, nil, nil
	}
	names := make([]string, 0, len(chosen))
	for _, v := range chosen {
		names = append(names, v.Name)
	}
	joined := strings.Join(names, ", ")
	if len(chosen) == 1 {
		vid, vmode := chosen[0].VariantID, chosen[0].PricingMode
		return &vid, &joined, &vmode
	}
	return nil, &joined, nil
}

// AddonInput is one chosen add-on with its snapshotted price.
type AddonInput struct {
	AddonID       string
	AddonName     string
	AddonQuantity int
	PriceCents    money.Amount // per-unit price
}

// Discount is the at-most-one discount the promo engine returned (P-09 step 3).
type Discount struct {
	Code         *string
	AmountCents  money.Amount
	Target       string // ITEMS | DELIVERY_FEE | SERVICE_FEE
	FundedBy     string // PLATFORM | RESTAURANT
	Reimbursable bool
}

// Inputs is the complete, DB-derived input to Compute. Nothing money-shaped in
// it came from the request body except TipCents.
type Inputs struct {
	Fulfilment       Fulfilment
	Config           Config
	JurisdictionCode string
	// Rates is the effective tax rate table for the resolved jurisdiction,
	// keyed by category. GST+QST provinces carry two kinds for one category.
	Rates                []TaxRate
	Lines                []LineInput
	Discount             *Discount
	TipCents             money.Amount
	BillableKM           int
	RouteMeters          int
	CommissionRate       money.Rate // the restaurant's own rate (bps → Rate)
	RestaurantIsSupplier bool       // tax_role == RESTAURANT_IS_SUPPLIER
}

// ResultLine is a priced quote line (P-09 step 1/2).
type ResultLine struct {
	LineNo             int
	MenuItemID         string
	MenuItemVersionID  *string
	MenuItemName       string
	VariantID          *string
	VariantName        *string
	VariantPricingMode *string
	Variants           []VariantChoice
	Quantity           int
	BasePriceCents     money.Amount
	VariantPartCents   money.Amount
	AddonsPartCents    money.Amount
	LineUnitCents      money.Amount
	LineTotalCents     money.Amount
	SpecialRequest     *string
	TaxCategory        TaxCategory
	Addons             []AddonInput
}

// TaxLine is one emitted quote_tax_line (P-11): one row per rate over the summed
// base, not per line.
type TaxLine struct {
	Seq              int
	JurisdictionCode string
	TaxKind          string
	StatutoryLabel   string
	Rate             money.Rate
	BaseCents        money.Amount
	AmountCents      money.Amount
	RebateApplied    bool
	RemittableBy     string
}

// RoundingEntry is one appended step of the rounding log (I-12.5).
type RoundingEntry struct {
	Step    string `json:"step"`
	Base    int64  `json:"base"`
	Rate    string `json:"rate"`
	Raw     string `json:"raw"`
	Rounded int64  `json:"rounded"`
}

// Result is the computed quote body (money only; the store adds ids and hashes).
type Result struct {
	Lines                 []ResultLine
	SubtotalCents         money.Amount
	DiscountItemsCents    money.Amount
	DiscountDeliveryCents money.Amount
	DiscountServiceCents  money.Amount
	DeliveryFeeCents      money.Amount
	ServiceFeeCents       money.Amount
	TaxLines              []TaxLine
	TaxTotalCents         money.Amount
	TipCents              money.Amount
	TotalCents            money.Amount

	CommissionCents               money.Amount
	RestaurantNetCents            money.Amount
	RiderEarningsCents            money.Amount
	PlatformGrossCents            money.Amount
	RestaurantFundedDiscountCents money.Amount
	PlatformFundedDiscountCents   money.Amount

	Discount    *Discount
	RoundingLog []RoundingEntry
}

// Compute performs the P-09 computation. It returns an error only for an
// internal inconsistency (a tax category with no rate is TaxProfileMissing —
// resolved by the caller before calling, but re-checked here as a guard).
func Compute(in Inputs) (Result, error) {
	var res Result
	res.TipCents = in.TipCents
	res.Discount = in.Discount
	log := make([]RoundingEntry, 0, 8)

	// Step 1 & 2 — line prices and subtotal.
	for i, l := range in.Lines {
		if l.Quantity <= 0 {
			return Result{}, fmt.Errorf("pricing: line %d has non-positive quantity", i)
		}
		// The variant part comes from the chosen variants whenever the caller
		// supplied them, so the quote cannot carry a part its variants disagree
		// with (the database re-checks it: 00069).
		if len(l.Variants) > 0 {
			vp, err := VariantPart(l.BasePriceCents, l.Variants)
			if err != nil {
				return Result{}, fmt.Errorf("pricing: line %d: %w", i, err)
			}
			l.VariantPartCents = vp
		}
		var addonsPart money.Amount
		for _, a := range l.Addons {
			if a.AddonQuantity <= 0 {
				return Result{}, fmt.Errorf("pricing: addon %s has non-positive quantity", a.AddonID)
			}
			addonsPart = addonsPart.Add(a.PriceCents.Mul(a.AddonQuantity))
		}
		unit := l.VariantPartCents.Add(addonsPart)
		lineTotal := unit.Mul(l.Quantity)
		res.Lines = append(res.Lines, ResultLine{
			LineNo:             i + 1,
			MenuItemID:         l.MenuItemID,
			MenuItemVersionID:  l.MenuItemVersionID,
			MenuItemName:       l.MenuItemName,
			VariantID:          l.VariantID,
			VariantName:        l.VariantName,
			VariantPricingMode: l.VariantPricingMode,
			Variants:           l.Variants,
			Quantity:           l.Quantity,
			BasePriceCents:     l.BasePriceCents,
			VariantPartCents:   l.VariantPartCents,
			AddonsPartCents:    addonsPart,
			LineUnitCents:      unit,
			LineTotalCents:     lineTotal,
			SpecialRequest:     l.SpecialRequest,
			TaxCategory:        l.TaxCategory,
			Addons:             l.Addons,
		})
		res.SubtotalCents = res.SubtotalCents.Add(lineTotal)
	}

	// Step 3 — discount, split by target. A discount is bounded to its
	// applicable base by the caller/promo engine; we clamp defensively here.
	if d := in.Discount; d != nil {
		switch d.Target {
		case "ITEMS":
			res.DiscountItemsCents = money.Clamp(d.AmountCents, 0, res.SubtotalCents)
		case "DELIVERY_FEE":
			res.DiscountDeliveryCents = d.AmountCents // clamped after fee computed
		case "SERVICE_FEE":
			res.DiscountServiceCents = d.AmountCents // clamped after fee computed
		default:
			return Result{}, fmt.Errorf("pricing: unknown discount target %q", d.Target)
		}
		if d.FundedBy == "RESTAURANT" {
			res.RestaurantFundedDiscountCents = d.AmountCents
		} else {
			res.PlatformFundedDiscountCents = d.AmountCents
		}
	}

	// Step 4 — delivery fee (0 for pickup).
	if in.Fulfilment == FulfilmentDelivery {
		extraKM := in.BillableKM - in.Config.IncludedKM
		if extraKM < 0 {
			extraKM = 0
		}
		fee := in.Config.BaseDeliveryFeeCents.
			Add(in.Config.PerKMCents.Mul(extraKM))
		if res.SubtotalCents < in.Config.SmallOrderThresholdCents {
			fee = fee.Add(in.Config.SmallOrderSurchargeCents)
		}
		fee = money.Clamp(fee, in.Config.MinDeliveryFeeCents, in.Config.MaxDeliveryFeeCents)
		res.DeliveryFeeCents = fee
	}
	res.DiscountDeliveryCents = money.Clamp(res.DiscountDeliveryCents, 0, res.DeliveryFeeCents)

	// Step 5 — service fee: clamp(round_half_up(subtotal × rate), min, max).
	rawService := res.SubtotalCents.MulRate(in.Config.ServiceFeeRate)
	log = append(log, RoundingEntry{
		Step: "service_fee", Base: res.SubtotalCents.Cents(),
		Rate: in.Config.ServiceFeeRate.String(), Raw: fmt.Sprintf("%d", rawService.Cents()),
		Rounded: rawService.Cents(),
	})
	res.ServiceFeeCents = money.Clamp(rawService, in.Config.ServiceFeeMinCents, in.Config.ServiceFeeMaxCents)
	res.DiscountServiceCents = money.Clamp(res.DiscountServiceCents, 0, res.ServiceFeeCents)

	// Step 6 — tax. Computed once per rate over the summed base (P-11).
	taxLines, taxLog, err := computeTax(in, res)
	if err != nil {
		return Result{}, err
	}
	res.TaxLines = taxLines
	log = append(log, taxLog...)
	for _, tl := range taxLines {
		res.TaxTotalCents = res.TaxTotalCents.Add(tl.AmountCents)
	}

	// Step 8 — total (step 7 tip is already set).
	res.TotalCents = res.SubtotalCents.
		Sub(res.DiscountItemsCents).
		Add(res.DeliveryFeeCents).Sub(res.DiscountDeliveryCents).
		Add(res.ServiceFeeCents).Sub(res.DiscountServiceCents).
		Add(res.TaxTotalCents).
		Add(res.TipCents)

	// Step 9 — internal split (frozen onto the order at acceptance).
	commissionBase := res.SubtotalCents.Sub(res.RestaurantFundedDiscountCents)
	if commissionBase < 0 {
		commissionBase = 0
	}
	res.CommissionCents = commissionBase.MulRate(in.CommissionRate)
	log = append(log, RoundingEntry{
		Step: "commission", Base: commissionBase.Cents(),
		Rate: in.CommissionRate.String(), Raw: fmt.Sprintf("%d", res.CommissionCents.Cents()),
		Rounded: res.CommissionCents.Cents(),
	})
	res.RestaurantNetCents = commissionBase.Sub(res.CommissionCents)

	riderDistance := in.Config.RiderPerKMCents.Mul(in.BillableKM)
	riderEarnings := in.Config.RiderBaseCents.Add(riderDistance).Add(res.TipCents)
	if riderEarnings < in.Config.RiderMinimumCents {
		riderEarnings = in.Config.RiderMinimumCents
	}
	res.RiderEarningsCents = riderEarnings

	res.PlatformGrossCents = res.CommissionCents.
		Add(res.ServiceFeeCents).
		Add(res.DeliveryFeeCents).
		Sub(in.Config.RiderBaseCents.Add(riderDistance)).
		Sub(res.PlatformFundedDiscountCents)

	res.RoundingLog = log
	return res, nil
}
