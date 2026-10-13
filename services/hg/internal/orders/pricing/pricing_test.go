package pricing

import (
	"errors"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
)

func mustRate(t *testing.T, s string) money.Rate {
	t.Helper()
	r, err := money.RateFromDecimalString(s)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func strptr(s string) *string { return &s }

// ontarioRates returns the CA-ON prepared-food/delivery/service rate rows,
// mirroring migrations/seed/001_tax.sql.
func ontarioRates(t *testing.T) []TaxRate {
	r13 := mustRate(t, "0.13")
	r05 := mustRate(t, "0.05")
	return []TaxRate{
		{JurisdictionCode: "CA-ON", TaxKind: "HST", Category: CategoryPreparedFood, Rate: r13, StatutoryLabel: "HST", RemittableBy: "RESTAURANT"},
		{JurisdictionCode: "CA-ON", TaxKind: "HST_FEDERAL_PART", Category: CategoryPreparedFood, Rate: r05, StatutoryLabel: "HST", RemittableBy: "RESTAURANT"},
		{JurisdictionCode: "CA-ON", TaxKind: "HST", Category: CategoryDelivery, Rate: r13, StatutoryLabel: "HST", RemittableBy: "PLATFORM"},
		{JurisdictionCode: "CA-ON", TaxKind: "HST", Category: CategoryServiceFee, Rate: r13, StatutoryLabel: "HST", RemittableBy: "PLATFORM"},
	}
}

func fixtureConfig() Config {
	// A config that reproduces the quote_standard fixture's 449 delivery / 399
	// service without a small-order surcharge: fee params here are chosen to
	// match the fixture rather than the launch seed, since the fixture pins a
	// non-zero service fee the launch config sets to zero.
	return Config{
		ID:                       "cfg",
		BaseDeliveryFeeCents:     449,
		IncludedKM:               99, // no per-km on top for this fixture
		PerKMCents:               0,
		MinDeliveryFeeCents:      0,
		MaxDeliveryFeeCents:      100000,
		SmallOrderThresholdCents: 0,
		SmallOrderSurchargeCents: 0,
		ServiceFeeRate:           money.Rate{Num: 399, Den: 7987}, // yields exactly 399 on this subtotal
		ServiceFeeMinCents:       0,
		ServiceFeeMaxCents:       100000,
		DefaultCommissionRate:    money.Rate{Num: 0, Den: 1},
		RiderBaseCents:           449,
		RiderPerKMCents:          0,
		QuoteTTLSeconds:          600,
	}
}

func fixtureLines() []LineInput {
	return []LineInput{
		{MenuItemID: "e3723319-f51b-42f0-a693-8c9eb954bb0f", MenuItemName: "Chicken Biryani",
			Quantity: 1, BasePriceCents: 1695, VariantPartCents: 1695, TaxCategory: CategoryPreparedFood},
		{MenuItemID: "260778de-cee3-4a79-ad10-f79f5e9ab98e", MenuItemName: "Beef Nihari",
			VariantID: strptr("c93380c3-631b-4080-a35b-b7e7a657e2d6"), VariantName: strptr("Full"), VariantPricingMode: strptr("ABSOLUTE"),
			Quantity: 1, BasePriceCents: 2145, VariantPartCents: 3695, SpecialRequest: strptr("Extra gravy on the side"), TaxCategory: CategoryPreparedFood},
		{MenuItemID: "456616ee-e1fc-4a94-aa83-3b1c726ff23d", MenuItemName: "Chicken Karahi (Half)",
			Quantity: 1, BasePriceCents: 1899, VariantPartCents: 1899, TaxCategory: CategoryPreparedFood,
			Addons: []AddonInput{{AddonID: "8e05bcf1-8b4f-4578-ac6d-92f90d1cdf6f", AddonName: "Garlic naan", AddonQuantity: 2, PriceCents: 349}}},
	}
}

func TestComputeQuoteStandardFixture(t *testing.T) {
	in := Inputs{
		Fulfilment:           FulfilmentDelivery,
		Config:               fixtureConfig(),
		JurisdictionCode:     "CA-ON",
		Rates:                ontarioRates(t),
		Lines:                fixtureLines(),
		TipCents:             700,
		BillableKM:           4,
		RouteMeters:          3180,
		CommissionRate:       money.Rate{Num: 0, Den: 1},
		RestaurantIsSupplier: true,
	}
	res, err := Compute(in)
	if err != nil {
		t.Fatal(err)
	}
	// Fixture pins these exact integers.
	assertAmount(t, "subtotal", res.SubtotalCents, 7987)
	assertAmount(t, "line1 unit", res.Lines[0].LineUnitCents, 1695)
	assertAmount(t, "line3 addons", res.Lines[2].AddonsPartCents, 698)
	assertAmount(t, "line3 unit", res.Lines[2].LineUnitCents, 2597)
	assertAmount(t, "delivery", res.DeliveryFeeCents, 449)
	assertAmount(t, "service", res.ServiceFeeCents, 399)
	assertAmount(t, "tax_total", res.TaxTotalCents, 1149)
	assertAmount(t, "tip", res.TipCents, 700)
	assertAmount(t, "total", res.TotalCents, 10684)

	if len(res.TaxLines) != 1 {
		t.Fatalf("want 1 tax line, got %d: %+v", len(res.TaxLines), res.TaxLines)
	}
	// Base = 7987 (food) + 449 (delivery) + 399 (service) = 8835; 8835×0.13=1148.55→1149.
	assertAmount(t, "tax base", res.TaxLines[0].BaseCents, 8835)
	assertAmount(t, "tax amount", res.TaxLines[0].AmountCents, 1149)
}

func TestConservationIdentity(t *testing.T) {
	// I-09.4: total = subtotal − discounts + delivery − dd + service − ds + tax + tip.
	in := Inputs{
		Fulfilment: FulfilmentDelivery, Config: fixtureConfig(), JurisdictionCode: "CA-ON",
		Rates: ontarioRates(t), Lines: fixtureLines(), TipCents: 700, BillableKM: 4,
		CommissionRate: money.Rate{Num: 0, Den: 1},
	}
	res, _ := Compute(in)
	want := res.SubtotalCents - res.DiscountItemsCents +
		res.DeliveryFeeCents - res.DiscountDeliveryCents +
		res.ServiceFeeCents - res.DiscountServiceCents +
		res.TaxTotalCents + res.TipCents
	if res.TotalCents != want {
		t.Fatalf("conservation broke: total=%d want=%d", res.TotalCents, want)
	}
}

func TestTipNeverTaxed(t *testing.T) {
	// I-11.2: setting a tip changes total by exactly the tip and leaves tax unchanged.
	base := Inputs{
		Fulfilment: FulfilmentDelivery, Config: fixtureConfig(), JurisdictionCode: "CA-ON",
		Rates: ontarioRates(t), Lines: fixtureLines(), TipCents: 0, BillableKM: 4,
		CommissionRate: money.Rate{Num: 0, Den: 1},
	}
	noTip, _ := Compute(base)
	base.TipCents = 700
	withTip, _ := Compute(base)
	if withTip.TaxTotalCents != noTip.TaxTotalCents {
		t.Errorf("tip changed tax: %d vs %d", withTip.TaxTotalCents, noTip.TaxTotalCents)
	}
	if withTip.TotalCents-noTip.TotalCents != 700 {
		t.Errorf("tip did not change total by exactly 700: delta=%d", withTip.TotalCents-noTip.TotalCents)
	}
}

func TestDiscountIsNotThePayable(t *testing.T) {
	// P-09 acceptance 2 shape: 10% off $50 items → discount 500, not a $5 total.
	cfg := fixtureConfig()
	cfg.ServiceFeeRate = money.Rate{Num: 0, Den: 1}
	cfg.BaseDeliveryFeeCents = 0
	in := Inputs{
		Fulfilment: FulfilmentPickup, Config: cfg, JurisdictionCode: "CA-ON",
		Rates: ontarioRates(t),
		Lines: []LineInput{{MenuItemID: "x", MenuItemName: "Combo", Quantity: 1,
			BasePriceCents: 5000, VariantPartCents: 5000, TaxCategory: CategoryPreparedFood}},
		Discount:       &Discount{Code: strptr("SAVE10"), AmountCents: 500, Target: "ITEMS", FundedBy: "RESTAURANT", Reimbursable: false},
		CommissionRate: money.Rate{Num: 0, Den: 1},
	}
	res, err := Compute(in)
	if err != nil {
		t.Fatal(err)
	}
	assertAmount(t, "discount_items", res.DiscountItemsCents, 500)
	// Pickup: no delivery. Tax on (5000−500)=4500 × 13% = 585.
	assertAmount(t, "tax", res.TaxTotalCents, 585)
	// Total = 5000 − 500 + 585 = 5085 (never 500).
	assertAmount(t, "total", res.TotalCents, 5085)
}

func TestOntarioPOSRebate(t *testing.T) {
	// P-11: a qualifying prepared-food order ≤ $4.00 is taxed at the 5% federal
	// part with the 8% provincial part rebated.
	cfg := fixtureConfig()
	cfg.ServiceFeeRate = money.Rate{Num: 0, Den: 1}
	cfg.BaseDeliveryFeeCents = 0
	in := Inputs{
		Fulfilment: FulfilmentPickup, Config: cfg, JurisdictionCode: "CA-ON", Rates: ontarioRates(t),
		Lines: []LineInput{{MenuItemID: "x", MenuItemName: "Samosa", Quantity: 1,
			BasePriceCents: 350, VariantPartCents: 350, TaxCategory: CategoryPreparedFood}},
		CommissionRate: money.Rate{Num: 0, Den: 1},
	}
	res, err := Compute(in)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.TaxLines) != 1 || !res.TaxLines[0].RebateApplied {
		t.Fatalf("expected one rebated tax line, got %+v", res.TaxLines)
	}
	// 350 × 5% = 17.5 → 18 half-up.
	assertAmount(t, "rebated tax", res.TaxLines[0].AmountCents, 18)
}

func TestTaxProfileMissing(t *testing.T) {
	in := Inputs{
		Fulfilment: FulfilmentPickup, Config: fixtureConfig(), JurisdictionCode: "CA-BC", Rates: nil,
		Lines: []LineInput{{MenuItemID: "x", MenuItemName: "Dish", Quantity: 1,
			BasePriceCents: 1000, VariantPartCents: 1000, TaxCategory: CategoryPreparedFood}},
		CommissionRate: money.Rate{Num: 0, Den: 1},
	}
	_, err := Compute(in)
	if _, ok := err.(*TaxProfileMissing); !ok {
		t.Fatalf("want TaxProfileMissing, got %v", err)
	}
}

func assertAmount(t *testing.T, name string, got, want money.Amount) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %d, want %d", name, got, want)
	}
}

// TestVariantPart pins P-09 step 1 for any number of chosen variants: the
// ABSOLUTE variant replaces the base, every DELTA adjusts it, and a
// combination that cannot be priced is refused rather than guessed.
// https://github.com/shaiknoorullah/hg-mono/issues/628
func TestVariantPart(t *testing.T) {
	amt := func(c int64) *money.Amount { a := money.Amount(c); return &a }
	abs := func(id string, c int64) VariantChoice {
		return VariantChoice{VariantID: id, PricingMode: PricingAbsolute, PriceCents: amt(c)}
	}
	delta := func(id string, c int64) VariantChoice {
		return VariantChoice{VariantID: id, PricingMode: PricingDelta, DeltaCents: amt(c)}
	}
	for _, tc := range []struct {
		name    string
		chosen  []VariantChoice
		want    money.Amount
		wantErr bool
	}{
		{"no variant is the base", nil, 2499, false},
		{"one ABSOLUTE replaces the base", []VariantChoice{abs("two", 4299)}, 4299, false},
		{"one DELTA adjusts the base", []VariantChoice{delta("pulao", 300)}, 2799, false},
		{"ABSOLUTE plus DELTAs", []VariantChoice{delta("pulao", 300), abs("two", 4299), delta("hot", 0)}, 4599, false},
		{"a negative DELTA", []VariantChoice{abs("two", 4299), delta("no-rice", -200)}, 4099, false},
		{"two ABSOLUTE variants cannot be priced", []VariantChoice{abs("two", 4299), abs("gift", 500)}, 0, true},
		{"below zero cannot be priced", []VariantChoice{abs("taste", 100), delta("no-rice", -200)}, 0, true},
		{"an ABSOLUTE with no price", []VariantChoice{{VariantID: "x", PricingMode: PricingAbsolute}}, 0, true},
		{"a DELTA with no delta", []VariantChoice{{VariantID: "x", PricingMode: PricingDelta}}, 0, true},
		{"an unknown pricing mode", []VariantChoice{{VariantID: "x", PricingMode: "PERCENT"}}, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := VariantPart(2499, tc.chosen)
			if tc.wantErr {
				if !errors.Is(err, ErrVariantPricing) {
					t.Fatalf("err = %v, want ErrVariantPricing", err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("VariantPart = %d, %v; want %d", got, err, tc.want)
			}
		})
	}

	// Compute prices a line from its variants, whatever part the caller passed,
	// and refuses a line whose variants cannot be priced.
	line := LineInput{MenuItemID: "platter", Quantity: 2, BasePriceCents: 2499, VariantPartCents: 1,
		TaxCategory: CategoryPreparedFood, Variants: []VariantChoice{abs("two", 4299), delta("pulao", 300)}}
	res, err := Compute(Inputs{Fulfilment: FulfilmentPickup, Config: fixtureConfig(), Rates: ontarioRates(t), Lines: []LineInput{line}, CommissionRate: money.Rate{Num: 0, Den: 1}})
	if err != nil {
		t.Fatalf("compute: %v", err)
	}
	assertAmount(t, "variant part", res.Lines[0].VariantPartCents, 4599)
	assertAmount(t, "line total", res.Lines[0].LineTotalCents, 9198)
	line.Variants = append(line.Variants, abs("gift", 500))
	if _, err := Compute(Inputs{Fulfilment: FulfilmentPickup, Config: fixtureConfig(), Rates: ontarioRates(t), Lines: []LineInput{line}, CommissionRate: money.Rate{Num: 0, Den: 1}}); !errors.Is(err, ErrVariantPricing) {
		t.Errorf("compute with two ABSOLUTE variants: err = %v, want ErrVariantPricing", err)
	}

	// The legacy one-variant fields: id and mode for exactly one, names joined.
	id, name, mode := VariantSummary([]VariantChoice{{VariantID: "two", Name: "For two", PricingMode: PricingAbsolute}})
	if id == nil || *id != "two" || *name != "For two" || *mode != PricingAbsolute {
		t.Errorf("one variant: %v %v %v", id, name, mode)
	}
	id, name, mode = VariantSummary([]VariantChoice{{Name: "For two"}, {Name: "Kabuli pulao"}})
	if id != nil || mode != nil || *name != "For two, Kabuli pulao" {
		t.Errorf("two variants: %v %v %v", id, name, mode)
	}
}
