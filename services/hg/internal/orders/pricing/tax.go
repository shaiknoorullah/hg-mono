package pricing

import (
	"fmt"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
)

// computeTax implements P-11: tax is computed **once per rate over the summed
// base**, not per line and summed (this avoids per-line rounding drift). For a
// province like Ontario where prepared food, delivery and service all carry the
// same 13% HST, that means a single customer-facing HST line over the combined
// base — which is exactly what the receipt prints ("one HST line, never GST +
// PST"), and what the quote_standard fixture pins (base 8835, amount 1149).
//
// A category present in the cart with no effective rate is TaxProfileMissing —
// it never defaults to zero (I-11.4). The tip is never in any base (I-11.2).
//
// The remittable_by split (food to the restaurant when it is the supplier,
// delivery/service to the platform) is a ledger concern; on the single grouped
// customer line we report the party that owns the largest constituent base,
// which for a normal food order is the restaurant when it is the supplier.
func computeTax(in Inputs, res Result) ([]TaxLine, []RoundingEntry, error) {
	ratesFor := func(cat TaxCategory) ([]TaxRate, bool) {
		var out []TaxRate
		for _, r := range in.Rates {
			if r.Category == cat {
				out = append(out, r)
			}
		}
		return out, len(out) > 0
	}

	reimbursable := in.Discount != nil && in.Discount.Reimbursable

	// Category bases.
	var preparedBase, groceryBase money.Amount
	for _, l := range res.Lines {
		switch l.TaxCategory {
		case CategoryPreparedFood:
			preparedBase = preparedBase.Add(l.LineTotalCents)
		case CategoryZeroRatedGrocery:
			groceryBase = groceryBase.Add(l.LineTotalCents)
		case CategoryBeverageAlcohol:
			return nil, nil, fmt.Errorf("pricing: BEVERAGE_ALCOHOL is out of scope for V1")
		default:
			return nil, nil, fmt.Errorf("pricing: line %d has non-line tax category %q", l.LineNo, l.TaxCategory)
		}
	}
	if !reimbursable {
		preparedBase = preparedBase.Sub(res.DiscountItemsCents)
		if preparedBase < 0 {
			preparedBase = 0
		}
	}

	deliveryBase := res.DeliveryFeeCents
	serviceBase := res.ServiceFeeCents
	if !reimbursable {
		deliveryBase = deliveryBase.Sub(res.DiscountDeliveryCents)
		serviceBase = serviceBase.Sub(res.DiscountServiceCents)
		if deliveryBase < 0 {
			deliveryBase = 0
		}
		if serviceBase < 0 {
			serviceBase = 0
		}
	}

	// Ontario POS rebate: if the whole prepared base qualifies (≤ $4.00 after
	// non-reimbursable discount) and the province offers HST_FEDERAL_PART, the
	// food is taxed at 5% (8% provincial part rebated) and does NOT join the
	// combined 13% base. Detect that up front.
	const posRebateThreshold = money.Amount(400)
	var foodRebated bool
	if preparedBase > 0 {
		if foodRates, ok := ratesFor(CategoryPreparedFood); ok {
			for _, r := range foodRates {
				if r.TaxKind == "HST_FEDERAL_PART" && preparedBase <= posRebateThreshold {
					foodRebated = true
				}
			}
		}
	}

	// A contribution is a (base, its category's rate rows) that will be grouped.
	type contribution struct {
		base money.Amount
		cat  TaxCategory
	}
	var contributions []contribution
	if preparedBase > 0 && !foodRebated {
		contributions = append(contributions, contribution{preparedBase, CategoryPreparedFood})
	}
	if deliveryBase > 0 {
		contributions = append(contributions, contribution{deliveryBase, CategoryDelivery})
	}
	if serviceBase > 0 {
		contributions = append(contributions, contribution{serviceBase, CategoryServiceFee})
	}

	// Group by (jurisdiction, tax_kind, rate). Sum the bases, then apply the
	// rate once. Skip zero rates (they add no line). Group order follows first
	// appearance, which is prepared → delivery → service → grocery.
	type groupKey struct {
		jur  string
		kind string
		num  int64
		den  int64
	}
	type group struct {
		key       groupKey
		label     string
		rate      money.Rate
		base      money.Amount
		remit     string
		remitBase money.Amount // largest constituent base owns remittable_by
	}
	var order []groupKey
	groups := map[groupKey]*group{}

	addToGroups := func(base money.Amount, rows []TaxRate) error {
		for _, r := range rows {
			if r.Rate.IsZero() {
				continue
			}
			k := groupKey{jur: r.JurisdictionCode, kind: r.TaxKind, num: r.Rate.Num, den: r.Rate.Den}
			g, ok := groups[k]
			if !ok {
				g = &group{key: k, label: r.StatutoryLabel, rate: r.Rate, remit: r.RemittableBy}
				groups[k] = g
				order = append(order, k)
			}
			g.base = g.base.Add(base)
			if base > g.remitBase {
				g.remitBase = base
				g.remit = r.RemittableBy
			}
		}
		return nil
	}

	for _, c := range contributions {
		rows, ok := ratesFor(c.cat)
		if !ok {
			return nil, nil, &TaxProfileMissing{Category: c.cat, Jurisdiction: in.JurisdictionCode}
		}
		// For prepared food skip the federal-part row when not rebating.
		var applicable []TaxRate
		for _, r := range rows {
			if c.cat == CategoryPreparedFood && r.TaxKind == "HST_FEDERAL_PART" {
				continue
			}
			applicable = append(applicable, r)
		}
		if err := addToGroups(c.base, applicable); err != nil {
			return nil, nil, err
		}
	}

	var lines []TaxLine
	var log []RoundingEntry
	seq := 1

	// Rebated food is its own line (5% federal part), emitted first.
	if foodRebated {
		foodRates, _ := ratesFor(CategoryPreparedFood)
		for _, r := range foodRates {
			if r.TaxKind != "HST_FEDERAL_PART" {
				continue
			}
			amt := preparedBase.MulRate(r.Rate)
			log = append(log, RoundingEntry{Step: "tax:PREPARED_FOOD:HST_FEDERAL_PART",
				Base: preparedBase.Cents(), Rate: r.Rate.String(),
				Raw: fmt.Sprintf("%d", amt.Cents()), Rounded: amt.Cents()})
			lines = append(lines, TaxLine{Seq: seq, JurisdictionCode: r.JurisdictionCode, TaxKind: r.TaxKind,
				StatutoryLabel: r.StatutoryLabel, Rate: r.Rate, BaseCents: preparedBase,
				AmountCents: amt, RebateApplied: true, RemittableBy: r.RemittableBy})
			seq++
		}
	}

	for _, k := range order {
		g := groups[k]
		amt := g.base.MulRate(g.rate)
		log = append(log, RoundingEntry{Step: "tax:" + g.key.kind,
			Base: g.base.Cents(), Rate: g.rate.String(),
			Raw: fmt.Sprintf("%d", amt.Cents()), Rounded: amt.Cents()})
		lines = append(lines, TaxLine{Seq: seq, JurisdictionCode: g.key.jur, TaxKind: g.key.kind,
			StatutoryLabel: g.label, Rate: g.rate, BaseCents: g.base,
			AmountCents: amt, RebateApplied: false, RemittableBy: g.remit})
		seq++
	}

	// Zero-rated grocery: emit a 0 line so the base shows on the receipt.
	if groceryBase > 0 {
		if gr, ok := ratesFor(CategoryZeroRatedGrocery); ok {
			for _, r := range gr {
				lines = append(lines, TaxLine{Seq: seq, JurisdictionCode: r.JurisdictionCode, TaxKind: r.TaxKind,
					StatutoryLabel: r.StatutoryLabel, Rate: r.Rate, BaseCents: groceryBase,
					AmountCents: 0, RebateApplied: false, RemittableBy: r.RemittableBy})
				seq++
			}
		}
	}

	return lines, log, nil
}

// TaxProfileMissing is the typed failure for a category with no effective rate
// (I-11.4). The handler maps it to 422 TAX_PROFILE_MISSING.
type TaxProfileMissing struct {
	Category     TaxCategory
	Jurisdiction string
}

func (e *TaxProfileMissing) Error() string {
	return fmt.Sprintf("tax_profile_missing: no effective rate for category %s in %s", e.Category, e.Jurisdiction)
}
