package payments

import "testing"

func TestComputeRefundAmount_Full(t *testing.T) {
	m := exampleMoney()
	got, err := ComputeRefundAmount(m, RefundFull, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.AmountCents != m.TotalCents {
		t.Fatalf("full refund = %d, want %d", got.AmountCents, m.TotalCents)
	}
	if got.Scope != ScopeFull {
		t.Fatalf("scope = %s, want FULL", got.Scope)
	}
}

func TestComputeRefundAmount_FullMinusPrior(t *testing.T) {
	m := exampleMoney()
	got, err := ComputeRefundAmount(m, RefundFull, nil, nil, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if got.AmountCents != m.TotalCents-1000 {
		t.Fatalf("full refund after prior = %d, want %d", got.AmountCents, m.TotalCents-1000)
	}
}

func TestComputeRefundAmount_FullNothingLeft(t *testing.T) {
	m := exampleMoney()
	if _, err := ComputeRefundAmount(m, RefundFull, nil, nil, m.TotalCents); err == nil {
		t.Fatal("expected error when nothing left to refund")
	}
}

func TestComputeRefundAmount_FeesOnly(t *testing.T) {
	m := exampleMoney()
	m.ServiceFeeCents = 100
	got, err := ComputeRefundAmount(m, RefundFeesOnly, nil, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	base := m.DeliveryFeeCents + m.ServiceFeeCents
	if got.AmountCents < base {
		t.Fatalf("fees refund %d < fee base %d", got.AmountCents, base)
	}
}

func TestComputeRefundAmount_PartialItems(t *testing.T) {
	m := exampleMoney()
	lines := []OrderLine{
		{LineNo: 1, Quantity: 2, LineTotalCents: 2400}, // $12.00 dish x2
		{LineNo: 2, Quantity: 1, LineTotalCents: 1200},
	}
	// Refund one of line 1 (a single $12 dish, acceptance-1 shape).
	got, err := ComputeRefundAmount(m, RefundPartialItems,
		[]RefundLineInput{{OrderLineNo: 1, Quantity: 1}}, lines, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Lines) != 1 || got.Lines[0].AmountCents != 1200 {
		t.Fatalf("partial line amount = %+v, want 1200", got.Lines)
	}
	// Amount includes proportional tax on 1200 of the 3600 subtotal base.
	if got.AmountCents <= 1200 {
		t.Fatalf("partial refund %d should include proportional tax", got.AmountCents)
	}
	if got.TaxCents == 0 {
		t.Fatal("expected non-zero proportional tax")
	}
}

func TestComputeRefundAmount_PartialItemsBadQuantity(t *testing.T) {
	m := exampleMoney()
	lines := []OrderLine{{LineNo: 1, Quantity: 1, LineTotalCents: 1200}}
	if _, err := ComputeRefundAmount(m, RefundPartialItems,
		[]RefundLineInput{{OrderLineNo: 1, Quantity: 5}}, lines, 0); err == nil {
		t.Fatal("expected error for quantity out of range")
	}
	if _, err := ComputeRefundAmount(m, RefundPartialItems,
		[]RefundLineInput{{OrderLineNo: 99, Quantity: 1}}, lines, 0); err == nil {
		t.Fatal("expected error for unknown line")
	}
	if _, err := ComputeRefundAmount(m, RefundPartialItems, nil, lines, 0); err == nil {
		t.Fatal("expected error for empty lines")
	}
}

func TestAllocateTax_NeverExceedsOriginal(t *testing.T) {
	m := exampleMoney()
	full := allocateTax(m, m.SubtotalCents-m.DiscountCents+m.DeliveryFeeCents+m.ServiceFeeCents)
	if full != m.TaxTotalCents {
		t.Fatalf("tax on full taxable base = %d, want %d", full, m.TaxTotalCents)
	}
	// Two halves must not sum to more than the original tax.
	half := m.SubtotalCents / 2
	a := allocateTax(m, half)
	b := allocateTax(m, half)
	if a+b > m.TaxTotalCents {
		t.Fatalf("two half allocations %d+%d exceed original tax %d", a, b, m.TaxTotalCents)
	}
}

func TestComputeLiabilitySplit_SumsToAmount(t *testing.T) {
	reasons := []string{
		"ITEM_MISSING", "MISSING_ITEMS", "WRONG_ITEM", "FOOD_QUALITY", "FOOD_SAFETY",
		"NEVER_DELIVERED", "ORDER_NEVER_ARRIVED", "RESTAURANT_REJECTED", "LATE_DELIVERY",
		"NO_RIDER_FOUND", "CUSTOMER_CHANGED_MIND", "PLATFORM_ERROR", "GOODWILL",
		"HALAL_CONCERN", "DUPLICATE_CHARGE", "OTHER", "UNMAPPED_CODE",
	}
	const amt = 1695
	for _, rc := range reasons {
		split := ComputeLiabilitySplit(rc, amt, 1200, 399)
		if split.Sum() != amt {
			t.Fatalf("reason %s: split legs sum to %d, want %d", rc, split.Sum(), amt)
		}
		if split.RestaurantChargebackCents < 0 || split.RiderChargebackCents < 0 || split.PlatformAbsorbedCents < 0 {
			t.Fatalf("reason %s: negative leg %+v", rc, split)
		}
	}
}

func TestComputeLiabilitySplit_ItemFaultChargesRestaurant(t *testing.T) {
	split := ComputeLiabilitySplit("ITEM_MISSING", 1695, 1200, 399)
	if split.RestaurantChargebackCents != 1200 {
		t.Fatalf("restaurant chargeback = %d, want 1200", split.RestaurantChargebackCents)
	}
	if split.PlatformAbsorbedCents != 495 {
		t.Fatalf("platform absorbed = %d, want 495 (tax/fees)", split.PlatformAbsorbedCents)
	}
}

func TestComputeLiabilitySplit_NeverDeliveredChargesRider(t *testing.T) {
	split := ComputeLiabilitySplit("NEVER_DELIVERED", 4967, 0, 399)
	if split.RiderChargebackCents != 399 {
		t.Fatalf("rider chargeback = %d, want 399", split.RiderChargebackCents)
	}
	if split.PlatformAbsorbedCents != 4967-399 {
		t.Fatalf("platform absorbed = %d, want %d", split.PlatformAbsorbedCents, 4967-399)
	}
}

func TestComputeLiabilitySplit_UnknownReasonFailsSafeToPlatform(t *testing.T) {
	split := ComputeLiabilitySplit("SOMETHING_NEW", 1000, 500, 200)
	if split.PlatformAbsorbedCents != 1000 {
		t.Fatalf("unknown reason should absorb to platform, got %+v", split)
	}
}
