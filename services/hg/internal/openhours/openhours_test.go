package openhours

import (
	"testing"
	"time"
)

// TestRestaurantState pins the one rule the card and the order path share: only
// OPEN takes an order, and what the customer is shown for each closed state.
// https://github.com/shaiknoorullah/hg-mono/issues/648
func TestRestaurantState(t *testing.T) {
	toronto, err := time.LoadLocation("America/Toronto")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 5, 13, 0, 0, 0, toronto) // a Monday, 13:00
	fresh, stale, later := now.Add(-time.Minute), now.Add(-6*time.Minute), now.Add(20*time.Minute)
	lunch := []Slot{{Day: int(time.Monday), Opens: "11:00", Closes: "15:00"}}
	open := Restaurant{
		Trading:  Trading{AccountState: "LIVE", IsAcceptingOrders: true, LastHeartbeatAt: &fresh},
		Timezone: "America/Toronto", Weekly: lunch,
	}

	cases := []struct {
		name           string
		edit           func(*Restaurant)
		state, display string
	}{
		{"inside its hours", func(*Restaurant) {}, StateOpen, CustomerOpen},
		{"outside its hours", func(r *Restaurant) { r.Weekly = []Slot{{Day: int(time.Monday), Opens: "17:00", Closes: "22:00"}} },
			StateClosedHours, CustomerClosedHours},
		{"no hours at all", func(r *Restaurant) { r.Weekly = nil }, StateClosedHours, CustomerClosedHours},
		{"closed today", func(r *Restaurant) { r.Overrides = []Override{{Date: "2026-10-05", Closed: true}} },
			StateClosedHoliday, CustomerClosedHours},
		{"paused", func(r *Restaurant) { r.PauseUntil = &later }, StatePaused, CustomerPaused},
		{"toggle off", func(r *Restaurant) { r.IsAcceptingOrders = false }, StateClosedToggle, CustomerPaused},
		{"order screen offline", func(r *Restaurant) { r.LastHeartbeatAt = &stale }, StateClosedOffline, CustomerPaused},
		{"never checked in", func(r *Restaurant) { r.LastHeartbeatAt = nil }, StateClosedOffline, CustomerPaused},
		{"payout collection open", func(r *Restaurant) { r.CollectionBlock = true }, StateClosedToggle, CustomerPaused},
		{"suspended", func(r *Restaurant) { r.AccountState = "SUSPENDED" }, StateClosedSuspended, CustomerClosedHours},
		{"offline outside hours shows closed", func(r *Restaurant) { r.LastHeartbeatAt = &stale; r.Weekly = nil },
			StateClosedOffline, CustomerClosedHours},
	}
	for _, tc := range cases {
		r := open
		tc.edit(&r)
		state, hv := r.State(now)
		if state != tc.state {
			t.Errorf("%s: state = %s, want %s", tc.name, state, tc.state)
		}
		if got := CustomerState(state, hv); got != tc.display {
			t.Errorf("%s: customer state = %s, want %s", tc.name, got, tc.display)
		}
	}
}
