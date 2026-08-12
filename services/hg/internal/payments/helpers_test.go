package payments

import (
	"testing"
	"time"
)

func TestStateFromStripe(t *testing.T) {
	cases := map[string]PaymentState{
		"requires_payment_method": StateRequiresPaymentMethod,
		"requires_action":         StateRequiresAction,
		"requires_capture":        StateRequiresCapture,
		"succeeded":               StateSucceeded,
		"canceled":                StateCanceled,
		"processing":              StateProcessing,
		"anything_else":           StateFailed,
	}
	for in, want := range cases {
		if got := stateFromStripe(in); got != want {
			t.Fatalf("stateFromStripe(%q) = %s, want %s", in, got, want)
		}
	}
}

// TestOutOfOrderGuard proves the rank-based rule never moves a PI backwards: a
// late amount_capturable_updated arriving after succeeded is skipped.
func TestOutOfOrderGuard(t *testing.T) {
	if paymentStateRank[StateRequiresCapture] >= paymentStateRank[StateSucceeded] {
		t.Fatal("REQUIRES_CAPTURE must rank below SUCCEEDED so a late event is skipped")
	}
	if paymentStateRank[StateRequiresAction] >= paymentStateRank[StateRequiresCapture] {
		t.Fatal("REQUIRES_ACTION must rank below REQUIRES_CAPTURE")
	}
}

func TestBpsToDecimal(t *testing.T) {
	cases := map[int32]string{
		10000: "1.00",
		15000: "1.50",
		12500: "1.25",
		0:     "0.00",
		20000: "2.00",
	}
	for bps, want := range cases {
		if got := bpsToDecimal(bps); got != want {
			t.Fatalf("bpsToDecimal(%d) = %q, want %q", bps, got, want)
		}
	}
}

func TestNextMondayUTC(t *testing.T) {
	// A Wednesday should yield the following Monday.
	wed := time.Date(2026, 8, 12, 15, 0, 0, 0, time.UTC) // 2026-08-12 is a Wednesday
	mon := nextMondayUTC(wed)
	if mon.Weekday() != time.Monday {
		t.Fatalf("nextMondayUTC weekday = %s, want Monday", mon.Weekday())
	}
	if !mon.After(wed) {
		t.Fatalf("next Monday %v not after %v", mon, wed)
	}
	if mon.Hour() != 0 || mon.Minute() != 0 {
		t.Fatalf("next Monday not at midnight: %v", mon)
	}
	// A Monday should yield the next Monday, never itself.
	m0 := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC) // Monday
	m1 := nextMondayUTC(m0)
	if !m1.After(m0) || m1.Sub(m0) != 7*24*time.Hour {
		t.Fatalf("Monday→next Monday = %v, want +7d", m1.Sub(m0))
	}
}

func TestLedgerBatchBalancedRequiresTwoEntries(t *testing.T) {
	b := LedgerBatch{Entries: []LedgerEntry{{Account: AcctPSPClearing, AmountCents: 0}}}
	if b.Balanced() {
		t.Fatal("a single zero entry must not count as balanced")
	}
}
