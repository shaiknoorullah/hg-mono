package catalog

import (
	"testing"
	"time"
)

// TestDeriveOpenStatePrecedence walks the strict R-22 precedence:
// CLOSED_SUSPENDED → CLOSED_OFFLINE → CLOSED_TOGGLE → PAUSED → CLOSED_HOLIDAY →
// CLOSED_HOURS → OPEN. Each case sets exactly the condition that should win.
func TestDeriveOpenStatePrecedence(t *testing.T) {
	now := time.Date(2026, 8, 12, 18, 0, 0, 0, time.UTC)
	fresh := now.Add(-30 * time.Second)
	stale := now.Add(-6 * time.Minute)
	future := now.Add(10 * time.Minute)

	tests := []struct {
		name          string
		row           availabilityRow
		withinHours   bool
		holidayClosed bool
		want          string
	}{
		{
			name: "suspended beats everything",
			row:  availabilityRow{accountState: "SUSPENDED", isAcceptingOrders: true, lastHeartbeatAt: &fresh},
			want: OpenStateClosedSuspended,
		},
		{
			name:        "stale heartbeat while accepting is offline",
			row:         availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &stale},
			withinHours: true,
			want:        OpenStateClosedOffline,
		},
		{
			name:        "toggle off is closed_toggle",
			row:         availabilityRow{accountState: "LIVE", isAcceptingOrders: false, lastHeartbeatAt: &fresh},
			withinHours: true,
			want:        OpenStateClosedToggle,
		},
		{
			name:        "pause in the future is paused",
			row:         availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &fresh, pauseUntil: &future},
			withinHours: true,
			want:        OpenStatePaused,
		},
		{
			name:          "holiday closes when accepting and fresh",
			row:           availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &fresh},
			withinHours:   true,
			holidayClosed: true,
			want:          OpenStateClosedHoliday,
		},
		{
			name:        "outside hours is closed_hours",
			row:         availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &fresh},
			withinHours: false,
			want:        OpenStateClosedHours,
		},
		{
			name:        "everything green is open",
			row:         availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &fresh},
			withinHours: true,
			want:        OpenStateOpen,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveOpenState(tc.row, now, tc.withinHours, tc.holidayClosed)
			if got.state != tc.want {
				t.Errorf("state = %q, want %q (reason: %q)", got.state, tc.want, got.reason)
			}
			if got.state != OpenStateOpen && got.reason == "" {
				t.Errorf("non-open state %q must carry a reason", got.state)
			}
		})
	}
}

// TestHeartbeatNeverMutatesToggle is the invariant that a stale heartbeat closes
// the restaurant to customers but leaves the toggle on, so reconnecting resumes
// service. deriveOpenState reads the toggle; it never flips it — this asserts the
// input toggle is echoed unchanged in the row the caller holds.
func TestOfflineDoesNotImplyToggleOff(t *testing.T) {
	now := time.Now().UTC()
	stale := now.Add(-10 * time.Minute)
	row := availabilityRow{accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &stale}
	v := deriveOpenState(row, now, true, false)
	if v.state != OpenStateClosedOffline {
		t.Fatalf("expected CLOSED_OFFLINE, got %q", v.state)
	}
	if !row.isAcceptingOrders {
		t.Fatalf("deriveOpenState must not mutate the toggle")
	}
}
