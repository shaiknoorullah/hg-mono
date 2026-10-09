package devworld

import (
	"testing"
	"time"
)

// order-history waits out the 180-second restaurant deadline and then the
// two-minute delivered-to-completed wait; the usual five minutes cut it short.
func TestOrderHistoryGetsLongerThanFiveMinutes(t *testing.T) {
	if got := ScenarioTimeout("order-history"); got < 8*time.Minute {
		t.Fatalf("order-history timeout %s; it needs the deadline, the journey and the settle wait", got)
	}
	if got := ScenarioTimeout("new-order"); got != 5*time.Minute {
		t.Fatalf("new-order timeout %s, want 5m", got)
	}
}

func TestExpectCodesReportsMissingAndWrongState(t *testing.T) {
	want := []historyEntry{{Code: "HG-A", State: "CANCELLED"}, {Code: "HG-B", State: "COMPLETED"}}
	if errs := expectCodes("list", map[string]string{"HG-A": "CANCELLED", "HG-B": "COMPLETED"}, want); len(errs) != 0 {
		t.Fatalf("all present: %v", errs)
	}
	if errs := expectCodes("list", map[string]string{"HG-A": "REJECTED"}, want); len(errs) != 2 {
		t.Fatalf("one wrong state and one missing, got %v", errs)
	}
}
