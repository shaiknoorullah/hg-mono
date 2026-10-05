package payments

import (
	"testing"
	"time"
)

// The payout calendar: weeks run Monday 00:00 to Monday 00:00 in Toronto, and
// the automatic run is due Monday 09:00 Toronto, including in the weeks the
// clocks change.
func TestPayoutCalendar(t *testing.T) {
	at := func(y int, m time.Month, d, h, min int) time.Time {
		return time.Date(y, m, d, h, min, 0, 0, payoutZone)
	}
	cases := []struct {
		name       string
		asOf       time.Time
		start, end time.Time
		hours      float64
	}{
		{"midweek", at(2026, 8, 12, 15, 0), at(2026, 8, 3, 0, 0), at(2026, 8, 10, 0, 0), 168},
		{"Sunday one minute before the cutoff", at(2026, 8, 16, 23, 59), at(2026, 8, 3, 0, 0), at(2026, 8, 10, 0, 0), 168},
		{"Monday at the cutoff", at(2026, 8, 17, 0, 0), at(2026, 8, 10, 0, 0), at(2026, 8, 17, 0, 0), 168},
		{"clocks go back on 1 November", at(2026, 11, 2, 10, 0), at(2026, 10, 26, 0, 0), at(2026, 11, 2, 0, 0), 169},
		{"clocks go forward on 8 March", at(2026, 3, 9, 10, 0), at(2026, 3, 2, 0, 0), at(2026, 3, 9, 0, 0), 167},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := closedPeriodAt(c.asOf.UTC())
			if !p.Start.Equal(c.start) || !p.End.Equal(c.end) {
				t.Fatalf("closedPeriodAt(%s) = [%s, %s), want [%s, %s)", c.asOf, p.Start, p.End, c.start, c.end)
			}
			if got := p.End.Sub(p.Start).Hours(); got != c.hours {
				t.Fatalf("period is %v hours, want %v", got, c.hours)
			}
			if due := scheduledRunAt(p.End); !due.Equal(time.Date(c.end.Year(), c.end.Month(), c.end.Day(), 9, 0, 0, 0, payoutZone)) {
				t.Fatalf("scheduledRunAt(%s) = %s, want 09:00 Toronto that Monday", p.End, due)
			}
		})
	}

	// The next run: later the same Monday until 09:00, then the Monday after.
	if got, want := nextScheduledRun(at(2026, 8, 17, 8, 59)), at(2026, 8, 17, 9, 0); !got.Equal(want) {
		t.Fatalf("nextScheduledRun(Mon 08:59) = %s, want %s", got, want)
	}
	if got, want := nextScheduledRun(at(2026, 8, 17, 9, 0)), at(2026, 8, 24, 9, 0); !got.Equal(want) {
		t.Fatalf("nextScheduledRun(Mon 09:00) = %s, want %s", got, want)
	}
}
