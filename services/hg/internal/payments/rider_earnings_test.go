package payments

import (
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// TestRiderPay pins the rider pay rules and the batch that pays them: the
// order's priced delivery fee and tip, exactly; a lowered tip made up only
// when the owner turns it on; and each earning its own balanced pair, with
// every tip cent on RIDER_PAYABLE and none in platform revenue.
func TestRiderPay(t *testing.T) {
	launch := config.DefaultRiderPay()
	makeUp := launch
	makeUp.TipMakeUp = true

	cases := []struct {
		name   string
		in     RiderPayInput
		policy config.RiderPay
		want   RiderPay
		lines  []string
	}{
		{"delivery fee plus tip (spec: 799 + 200 = 999)",
			RiderPayInput{DeliveryFeeCents: 799, TipCents: 200, OfferedTipCents: 200},
			launch, RiderPay{DeliveryCents: 799, TipCents: 200}, []string{EarningDelivery, EarningTip}},
		{"no tip writes no tip line",
			RiderPayInput{DeliveryFeeCents: 399},
			launch, RiderPay{DeliveryCents: 399}, []string{EarningDelivery}},
		{"tip lowered after accept: pure pass-through by default",
			RiderPayInput{DeliveryFeeCents: 599, TipCents: 100, OfferedTipCents: 500},
			launch, RiderPay{DeliveryCents: 599, TipCents: 100}, []string{EarningDelivery, EarningTip}},
		{"tip lowered after accept: made up when turned on",
			RiderPayInput{DeliveryFeeCents: 599, TipCents: 100, OfferedTipCents: 500},
			makeUp, RiderPay{DeliveryCents: 599, TipCents: 100, TipMakeUpCents: 400},
			[]string{EarningDelivery, EarningTip, EarningAdjustment}},
		{"tip raised after accept: the rider gets the higher tip",
			RiderPayInput{DeliveryFeeCents: 599, TipCents: 700, OfferedTipCents: 500},
			makeUp, RiderPay{DeliveryCents: 599, TipCents: 700}, []string{EarningDelivery, EarningTip}},
		{"nothing priced, nothing paid",
			RiderPayInput{}, launch, RiderPay{}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ComputeRiderPay(c.in, c.policy)
			if got != c.want {
				t.Fatalf("pay = %+v, want %+v", got, c.want)
			}
			b, lines := BuildRiderEarningsBatch("ord-1", "rider-1", got, "rider-earnings:ord-1", "system:test")
			if len(lines) != len(c.lines) {
				t.Fatalf("lines = %+v, want types %v", lines, c.lines)
			}
			if len(lines) == 0 {
				if len(b.Entries) != 0 {
					t.Fatalf("nothing to pay, but the batch has %d entries", len(b.Entries))
				}
				return
			}
			if !b.Balanced() {
				t.Fatalf("batch does not balance: residual %d over %d entries", b.Residual(), len(b.Entries))
			}
			for i, l := range lines {
				credit, debit := b.Entries[l.EntryIndex], b.Entries[l.EntryIndex+1]
				if l.Type != c.lines[i] || credit.Account != AcctRiderPayable || credit.CounterpartyID != "rider-1" ||
					credit.AmountCents != l.Cents {
					t.Fatalf("line %d %+v does not mirror its posting %+v", i, l, credit)
				}
				// Each earning is its own balanced double entry.
				if debit.Account == AcctRiderPayable || credit.AmountCents+debit.AmountCents != 0 {
					t.Fatalf("line %d is not a balanced pair: %+v / %+v", i, credit, debit)
				}
			}
			var rider, riderTip, platformTip int64
			for _, e := range b.Entries {
				switch {
				case e.Account == AcctRiderPayable:
					rider += e.AmountCents
					if e.Component == CompTip {
						riderTip += e.AmountCents
					}
				case e.Account == AcctPlatformRevenue && e.Component == CompTip:
					platformTip += e.AmountCents
				}
			}
			if want := got.DeliveryCents + got.TipCents + got.TipMakeUpCents; rider != want {
				t.Fatalf("rider is credited %d, want %d", rider, want)
			}
			// Every tip cent the customer paid, and only that, is the rider's
			// tip (docs/spec/01-platform.md, "P-13 — The ledger and the
			// zero-residual invariant", tip pass-through).
			if riderTip != got.TipCents || platformTip != 0 {
				t.Fatalf("rider tip %d (want %d), platform tip rows %d (want 0)", riderTip, got.TipCents, platformTip)
			}
		})
	}
}
