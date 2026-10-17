package catalog

import (
	"testing"
	"time"
)

// TestRestaurantAvailabilityClosing pins what the restaurant console reads to
// word and enable "Pause until closing" before the owner taps it
// (https://github.com/shaiknoorullah/hg-mono/issues/992): within_hours and
// next_closing_at come from the hours, never from the open state, and the two
// null causes of next_closing_at are told apart by within_hours alone.
func TestRestaurantAvailabilityClosing(t *testing.T) {
	toronto, err := time.LoadLocation("America/Toronto")
	if err != nil {
		t.Fatal(err)
	}
	at := func(day, hour int) time.Time { // October 2026: the 5th is a Monday
		return time.Date(2026, 10, day, hour, 0, 0, 0, toronto).UTC()
	}
	every := func(opens, closes string, crosses bool) []weeklySlot {
		out := make([]weeklySlot, 0, 7)
		for d := 0; d < 7; d++ {
			out = append(out, weeklySlot{Day: d, Opens: opens, Closes: closes, CrossesMidnight: crosses})
		}
		return out
	}
	now := at(5, 12)
	hb := now
	pausedTo := now.Add(30 * time.Minute)

	tests := []struct {
		name       string
		row        availabilityRow
		wantState  string
		wantWithin bool
		wantClose  *time.Time
	}{
		{
			name:       "open inside hours has the closing time",
			row:        availabilityRow{weekly: every("11:00", "22:00", false), isAcceptingOrders: true},
			wantState:  OpenStateOpen,
			wantWithin: true, wantClose: ptrTime(at(5, 22)),
		},
		{
			name:       "paused inside hours still has the closing time",
			row:        availabilityRow{weekly: every("11:00", "22:00", false), isAcceptingOrders: true, pauseUntil: &pausedTo},
			wantState:  OpenStatePaused,
			wantWithin: true, wantClose: ptrTime(at(5, 22)),
		},
		{
			name:       "switched off inside hours still has the closing time",
			row:        availabilityRow{weekly: every("11:00", "22:00", false), isAcceptingOrders: false},
			wantState:  OpenStateClosedToggle,
			wantWithin: true, wantClose: ptrTime(at(5, 22)),
		},
		{
			name:       "switched off outside hours has none and is not within hours",
			row:        availabilityRow{weekly: every("18:00", "22:00", false), isAcceptingOrders: false},
			wantState:  OpenStateClosedToggle,
			wantWithin: false, wantClose: nil,
		},
		{
			name:       "closed by hours has none and is not within hours",
			row:        availabilityRow{weekly: every("18:00", "22:00", false), isAcceptingOrders: true},
			wantState:  OpenStateClosedHours,
			wantWithin: false, wantClose: nil,
		},
		{
			name:       "hours that run past the look-ahead have none but are within hours",
			row:        availabilityRow{weekly: every("00:00", "00:00", true), isAcceptingOrders: true},
			wantState:  OpenStateOpen,
			wantWithin: true, wantClose: nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			row := tc.row
			row.accountState, row.timezone, row.lastHeartbeatAt = "LIVE", "America/Toronto", &hb
			hv := row.hours(now)
			got := toRestaurantAvailability(row, row.openStateAt(hv, now), hv)
			if got.OpenState != tc.wantState {
				t.Errorf("open_state = %q, want %q", got.OpenState, tc.wantState)
			}
			if got.WithinHours != tc.wantWithin {
				t.Errorf("within_hours = %v, want %v", got.WithinHours, tc.wantWithin)
			}
			checkTime(t, "next_closing_at", got.NextClosingAt, tc.wantClose)
		})
	}
}
