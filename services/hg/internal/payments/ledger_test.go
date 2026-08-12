package payments

import "testing"

// worked example order money (P-13 style): a delivery order with tip and tax.
func exampleMoney() OrderMoney {
	return OrderMoney{
		OrderID:            "ord-1",
		RestaurantID:       "rest-1",
		RiderID:            "rider-1",
		SubtotalCents:      3600,
		DiscountCents:      0,
		DeliveryFeeCents:   399, // S-02: $2.99 base + $1/km
		ServiceFeeCents:    0,   // launch: $0
		TaxTotalCents:      468, // 13% HST on 3600
		TipCents:           500,
		TotalCents:         3600 + 399 + 0 + 468 + 500,
		CommissionCents:    0, // S-01: 0%
		RestaurantNetCents: 3600,
		RiderEarningsCents: 399, // S-03: 100% of delivery fee
		PlatformGrossCents: 0,
	}
}

func TestBuildCaptureBatch_BalancesToZero(t *testing.T) {
	m := exampleMoney()
	b := BuildCaptureBatch(m, "capture:ord-1", "system:capture")
	if !b.Balanced() {
		t.Fatalf("capture batch not balanced: residual=%d entries=%d", b.Residual(), len(b.Entries))
	}
	if b.Residual() != 0 {
		t.Fatalf("residual = %d, want 0", b.Residual())
	}
}

func TestBuildCaptureBatch_CustomerChargedTotal(t *testing.T) {
	m := exampleMoney()
	b := BuildCaptureBatch(m, "capture:ord-1", "system:capture")
	var customer int64
	for _, e := range b.Entries {
		if e.Account == AcctCustomerCharges {
			customer += e.AmountCents
		}
	}
	// -SUM(CUSTOMER_CHARGES) must equal the total (charge identity, I-13.3).
	if -customer != m.TotalCents {
		t.Fatalf("customer charged %d, want %d", -customer, m.TotalCents)
	}
}

func TestBuildCaptureBatch_TipPassesThroughToRider(t *testing.T) {
	m := exampleMoney()
	b := BuildCaptureBatch(m, "capture:ord-1", "system:capture")
	var riderTip int64
	for _, e := range b.Entries {
		if e.Account == AcctRiderPayable && e.Component == CompTip {
			riderTip += e.AmountCents
		}
	}
	// I-13.5: 100% of the tip reaches the rider.
	if riderTip != m.TipCents {
		t.Fatalf("rider tip = %d, want %d", riderTip, m.TipCents)
	}
}

func TestBuildCaptureBatch_NoRiderYet(t *testing.T) {
	m := exampleMoney()
	m.RiderID = "" // not yet assigned at capture time
	b := BuildCaptureBatch(m, "capture:ord-1", "system:capture")
	if !b.Balanced() {
		t.Fatalf("capture batch with no rider not balanced: residual=%d", b.Residual())
	}
}

func TestBuildRefundBatch_BalancesForEverySplit(t *testing.T) {
	m := exampleMoney()
	cases := []struct {
		name  string
		split LiabilitySplit
		amt   int64
	}{
		{"restaurant", LiabilitySplit{RestaurantChargebackCents: 1200}, 1200},
		{"rider", LiabilitySplit{RiderChargebackCents: 399}, 399},
		{"platform", LiabilitySplit{PlatformAbsorbedCents: 500}, 500},
		{"mixed", LiabilitySplit{RestaurantChargebackCents: 800, PlatformAbsorbedCents: 200}, 1000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b := BuildRefundBatch(m, c.split, c.amt, "refund:x", "system:refund")
			if !b.Balanced() {
				t.Fatalf("refund batch not balanced: residual=%d entries=%d", b.Residual(), len(b.Entries))
			}
			if c.split.Sum() != c.amt {
				t.Fatalf("split sum %d != amount %d", c.split.Sum(), c.amt)
			}
		})
	}
}
