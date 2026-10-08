package catalog

import (
	"testing"
	"time"
)

// TestCardOpenStateFromHours pins the customer card's open state against the
// restaurant's real hours in its own timezone, its toggle, pause and heartbeat
// (C-14 in docs/spec/02-customer.md;
// https://github.com/shaiknoorullah/hg-mono/issues/645).
func TestCardOpenStateFromHours(t *testing.T) {
	toronto, err := time.LoadLocation("America/Toronto")
	if err != nil {
		t.Fatal(err)
	}
	at := func(day, hour, min int) time.Time { // October 2026: the 5th is a Monday
		return time.Date(2026, 10, day, hour, min, 0, 0, toronto).UTC()
	}
	everyDay := func(opens, closes string, crosses bool) []weeklySlot {
		out := make([]weeklySlot, 0, 7)
		for d := 0; d < 7; d++ {
			out = append(out, weeklySlot{Day: d, Opens: opens, Closes: closes, CrossesMidnight: crosses})
		}
		return out
	}
	lunchDinner := everyDay("11:00", "22:00", false)
	str := func(s string) *string { return &s }

	tests := []struct {
		name      string
		hours     []weeklySlot
		overrides []hoursOverride
		accepting bool
		pause     time.Duration // pause_until = now + pause, when non-zero
		heartbeat time.Duration // last heartbeat this long before now
		now       time.Time
		want      string
		opensAt   *time.Time
		closesAt  *time.Time
	}{
		{
			name: "inside hours is OPEN until closing", hours: lunchDinner, accepting: true,
			now: at(5, 12, 0), want: availOpen, closesAt: ptrTime(at(5, 22, 0)),
		},
		{
			name: "after closing is CLOSED_HOURS with the next opening", hours: lunchDinner, accepting: true,
			now: at(5, 23, 0), want: availClosedHours, opensAt: ptrTime(at(6, 11, 0)),
		},
		{
			name:  "no hours today opens on the next day that has some",
			hours: []weeklySlot{{Day: int(time.Wednesday), Opens: "11:00", Closes: "22:00"}}, accepting: true,
			now: at(5, 12, 0), want: availClosedHours, opensAt: ptrTime(at(7, 11, 0)),
		},
		{
			name: "overnight 18:00-02:00 is OPEN at 01:30 the next day", hours: everyDay("18:00", "02:00", true),
			accepting: true, now: at(6, 1, 30), want: availOpen, closesAt: ptrTime(at(6, 2, 0)),
		},
		{
			name: "overnight 18:00-02:00 is closed at 02:00", hours: everyDay("18:00", "02:00", true),
			accepting: true, now: at(6, 2, 0), want: availClosedHours, opensAt: ptrTime(at(6, 18, 0)),
		},
		{
			name: "not accepting orders inside hours is PAUSED", hours: lunchDinner, accepting: false,
			now: at(5, 12, 0), want: availPaused,
		},
		{
			name: "a pause inside hours is PAUSED", hours: lunchDinner, accepting: true, pause: time.Hour,
			now: at(5, 12, 0), want: availPaused,
		},
		{
			name: "a stale heartbeat inside hours is PAUSED", hours: lunchDinner, accepting: true,
			heartbeat: 10 * time.Minute, now: at(5, 12, 0), want: availPaused,
		},
		{
			name: "not accepting orders outside hours is CLOSED_HOURS", hours: lunchDinner, accepting: false,
			now: at(5, 23, 0), want: availClosedHours, opensAt: ptrTime(at(6, 11, 0)),
		},
		{
			name: "a closed override closes a day that has weekly hours", hours: lunchDinner, accepting: true,
			overrides: []hoursOverride{{Date: "2026-10-05", Closed: true}},
			now:       at(5, 12, 0), want: availClosedHours, opensAt: ptrTime(at(6, 11, 0)),
		},
		{
			name: "special hours replace the weekly ones", hours: lunchDinner, accepting: true,
			overrides: []hoursOverride{{Date: "2026-10-05", Opens: str("09:00"), Closes: str("13:00")}},
			now:       at(5, 10, 0), want: availOpen, closesAt: ptrTime(at(5, 13, 0)),
		},
		{
			name: "no hours at all is CLOSED_HOURS with no opening", accepting: true,
			now: at(5, 12, 0), want: availClosedHours,
		},
	}
	h := &Handler{media: nilMedia{}}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			hb := tc.now.Add(-30*time.Second - tc.heartbeat)
			rr := restaurantRow{
				timezone: "America/Toronto", deliveryRadiusM: 8000, distanceM: ptrI32(1200), avgPrepMinutes: 20,
				trading:     availabilityRow{accountState: "LIVE", isAcceptingOrders: tc.accepting, lastHeartbeatAt: &hb},
				weeklyHours: tc.hours, hoursOverrides: tc.overrides,
			}
			if tc.pause != 0 {
				p := tc.now.Add(tc.pause)
				rr.trading.pauseUntil = &p
			}
			info := h.cardFor(rr, true, tc.now).Availability
			if info.State != tc.want {
				t.Errorf("state = %q, want %q", info.State, tc.want)
			}
			checkTime(t, "opens_at", info.OpensAt, tc.opensAt)
			checkTime(t, "closes_at", info.ClosesAt, tc.closesAt)
		})
	}
}

// TestCardOpenStateUnknownTimezoneFailsClosed: hours that cannot be placed in
// time never read as open.
func TestCardOpenStateUnknownTimezoneFailsClosed(t *testing.T) {
	now := time.Now()
	hv := evaluateHours([]weeklySlot{{Day: int(now.Weekday()), Opens: "00:00", Closes: "00:00", CrossesMidnight: true}},
		nil, "Not/AZone", now)
	if hv.within {
		t.Fatal("an unknown timezone must not read as within hours")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func checkTime(t *testing.T, field string, got *string, want *time.Time) {
	t.Helper()
	switch {
	case want == nil && got != nil:
		t.Errorf("%s = %s, want null", field, *got)
	case want != nil && got == nil:
		t.Errorf("%s = null, want %s", field, want.UTC().Format(time.RFC3339))
	case want != nil:
		g, err := time.Parse(time.RFC3339, *got)
		if err != nil || !g.Equal(*want) {
			t.Errorf("%s = %s, want %s", field, *got, want.UTC().Format(time.RFC3339))
		}
	}
}
