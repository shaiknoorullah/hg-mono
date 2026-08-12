package payments

import "fmt"

// Refund computation and the P-18 liability matrix. These are pure functions:
// the server computes every amount (I-18.3 — the client sends no amount except
// GOODWILL), and the who-pays split is what makes the ledger balance (I-18.2).

// OrderLine is the subset of an order_line the refund calculator needs.
type OrderLine struct {
	LineNo         int32
	Quantity       int32
	LineTotalCents int64 // line_total_cents for the whole line (unit * quantity)
	TaxCategory    string
}

// LiabilitySplit is the computed who-pays decomposition of a refund.
type LiabilitySplit struct {
	RefundID                  string
	RestaurantChargebackCents int64
	RiderChargebackCents      int64
	PlatformAbsorbedCents     int64
}

// Sum returns the total of the three legs. It must equal the refund amount.
func (s LiabilitySplit) Sum() int64 {
	return s.RestaurantChargebackCents + s.RiderChargebackCents + s.PlatformAbsorbedCents
}

// ComputedRefund is the server-computed amount and split for a refund request.
type ComputedRefund struct {
	AmountCents int64
	TaxCents    int64
	Scope       RefundScope
	Split       LiabilitySplit
	Lines       []RefundLineAmount
}

// RefundLineAmount is the money computed for one refunded line.
type RefundLineAmount struct {
	OrderLineNo int32
	Quantity    int32
	AmountCents int64
}

// ComputeRefundAmount computes the amount, tax and scope for a non-GOODWILL
// refund from the order and (for PARTIAL_ITEMS) the requested lines. It returns
// an error the handler maps to a 422 when the request is incoherent (e.g. a
// PARTIAL_ITEMS refund with no lines, or a line/quantity that does not exist).
//
// FULL           → total minus prior refunds (delivery fee and tip included).
// PARTIAL_ITEMS  → Σ(refunded line totals) + proportional tax.
// FEES_ONLY      → delivery_fee + service_fee + their proportional tax.
//
// Tax on a partial refund is the order's tax allocated in proportion to the
// refunded base against the taxable base, by largest-remainder, so the sum of
// all partial refunds' tax can never exceed the tax originally collected.
func ComputeRefundAmount(m OrderMoney, kind RefundKind, lines []RefundLineInput, orderLines []OrderLine, priorRefundedCents int64) (ComputedRefund, error) {
	switch kind {
	case RefundFull:
		amt := m.TotalCents - priorRefundedCents
		if amt <= 0 {
			return ComputedRefund{}, fmt.Errorf("nothing left to refund: total=%d prior=%d", m.TotalCents, priorRefundedCents)
		}
		// Tax refunded in full is whatever tax remains after prior refunds; for a
		// clean FULL refund with no priors that is the whole tax.
		tax := m.TaxTotalCents
		if tax > amt {
			tax = amt
		}
		return ComputedRefund{AmountCents: amt, TaxCents: tax, Scope: ScopeFull}, nil

	case RefundFeesOnly:
		base := m.DeliveryFeeCents + m.ServiceFeeCents
		if base <= 0 {
			return ComputedRefund{}, fmt.Errorf("no fees to refund")
		}
		tax := allocateTax(m, base)
		return ComputedRefund{AmountCents: base + tax, TaxCents: tax, Scope: ScopePartialAmount}, nil

	case RefundPartialItems:
		if len(lines) == 0 {
			return ComputedRefund{}, fmt.Errorf("PARTIAL_ITEMS requires at least one line")
		}
		byNo := make(map[int32]OrderLine, len(orderLines))
		for _, ol := range orderLines {
			byNo[ol.LineNo] = ol
		}
		var base int64
		out := make([]RefundLineAmount, 0, len(lines))
		for _, l := range lines {
			ol, ok := byNo[l.OrderLineNo]
			if !ok {
				return ComputedRefund{}, fmt.Errorf("order line %d does not exist", l.OrderLineNo)
			}
			if l.Quantity <= 0 || l.Quantity > ol.Quantity {
				return ComputedRefund{}, fmt.Errorf("line %d: quantity %d out of range 1..%d", l.OrderLineNo, l.Quantity, ol.Quantity)
			}
			// Per-unit price is the line total divided by its quantity; the order
			// constraint guarantees line_total = unit * quantity so this is exact.
			unit := ol.LineTotalCents / int64(ol.Quantity)
			lineAmt := unit * int64(l.Quantity)
			base += lineAmt
			out = append(out, RefundLineAmount{OrderLineNo: l.OrderLineNo, Quantity: l.Quantity, AmountCents: lineAmt})
		}
		if base <= 0 {
			return ComputedRefund{}, fmt.Errorf("refunded items total is zero")
		}
		tax := allocateTax(m, base)
		return ComputedRefund{AmountCents: base + tax, TaxCents: tax, Scope: ScopePartialItems, Lines: out}, nil

	default:
		return ComputedRefund{}, fmt.Errorf("kind %q is not server-computed", kind)
	}
}

// allocateTax returns the tax attributable to a refunded base, as the order's
// total tax scaled by base/subtotal and floored (largest-remainder is not
// needed for a single allocation; flooring guarantees Σ ≤ original tax). It
// never returns more tax than the order collected.
func allocateTax(m OrderMoney, refundedBase int64) int64 {
	taxable := m.SubtotalCents - m.DiscountCents + m.DeliveryFeeCents + m.ServiceFeeCents
	if taxable <= 0 || m.TaxTotalCents <= 0 {
		return 0
	}
	if refundedBase >= taxable {
		return m.TaxTotalCents
	}
	// Floor((tax * base) / taxable).
	return (m.TaxTotalCents * refundedBase) / taxable
}

// ComputeLiabilitySplit applies the P-18 who-pays matrix to a refund of
// `amountCents` for the given reason code. `itemNetCents` is the restaurant net
// portion of the refunded items (subtotal minus commission) for item-fault
// reasons; `riderEarningsCents` is what a rider can be charged back for a
// never-delivered order. Every branch returns a split whose three legs sum to
// exactly `amountCents`, so the ledger batch balances.
func ComputeLiabilitySplit(reasonCode string, amountCents, itemNetCents, riderEarningsCents int64) LiabilitySplit {
	clamp := func(v int64) int64 {
		if v < 0 {
			return 0
		}
		if v > amountCents {
			return amountCents
		}
		return v
	}

	switch reasonCode {
	case "ITEM_MISSING", "MISSING_ITEMS", "WRONG_ITEM", "WRONG_ITEMS":
		// The restaurant bears the item fault; the platform absorbs the tax and
		// anything above the item net (e.g. proportional fees).
		r := clamp(itemNetCents)
		return LiabilitySplit{RestaurantChargebackCents: r, PlatformAbsorbedCents: amountCents - r}

	case "FOOD_QUALITY", "FOOD_SAFETY", "HALAL_CONCERN", "HALAL_INTEGRITY":
		// Restaurant charged back if substantiated (item net), platform absorbs
		// the remainder. Substantiation is enforced upstream (evidence required).
		r := clamp(itemNetCents)
		return LiabilitySplit{RestaurantChargebackCents: r, PlatformAbsorbedCents: amountCents - r}

	case "NEVER_DELIVERED", "ORDER_NEVER_ARRIVED":
		// The rider's earnings are reversed; the platform absorbs the rest
		// (including the restaurant's still-owed food).
		rd := clamp(riderEarningsCents)
		return LiabilitySplit{RiderChargebackCents: rd, PlatformAbsorbedCents: amountCents - rd}

	case "RESTAURANT_REJECTED", "RESTAURANT_CANCELLED":
		return LiabilitySplit{RestaurantChargebackCents: amountCents}

	case "LATE_DELIVERY", "NO_RIDER_FOUND", "CUSTOMER_CHANGED_MIND",
		"PLATFORM_ERROR", "PLATFORM_INITIATED_CANCELLATION", "DUPLICATE_CHARGE",
		"CHARGED_INCORRECTLY", "PRICING_ERROR", "GOODWILL", "DISPUTE_RESOLUTION",
		"CHARGEBACK_PREEMPTIVE", "OTHER":
		return LiabilitySplit{PlatformAbsorbedCents: amountCents}

	default:
		// Unknown reason codes fail safe: the platform absorbs, never a partner.
		return LiabilitySplit{PlatformAbsorbedCents: amountCents}
	}
}
