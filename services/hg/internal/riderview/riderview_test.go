package riderview

import "testing"

func TestAreaOfRoundsToAboutAKilometre(t *testing.T) {
	a := AreaOf(43.6532157, -79.3831846)
	if a.Lat() != 43.65 || a.Lng() != -79.38 {
		t.Fatalf("AreaOf = %v,%v, want 43.65,-79.38", a.Lat(), a.Lng())
	}
	// A point already on the grid stays where it is.
	if a := AreaOf(43.65, -79.38); a.Lat() != 43.65 || a.Lng() != -79.38 {
		t.Fatalf("AreaOf a grid point = %v,%v", a.Lat(), a.Lng())
	}
}

func TestStageOfReleasesTheDoorDetailsOnlyWhileCarrying(t *testing.T) {
	for _, c := range []struct {
		state      string
		terminated bool
		want       Stage
	}{
		{"ASSIGNED", false, Accepted},
		{"EN_ROUTE_TO_PICKUP", false, Accepted},
		{"ARRIVED_AT_PICKUP", false, Accepted},
		{"PICKED_UP", false, Carrying},
		{"EN_ROUTE_TO_DROPOFF", false, Carrying},
		{"ARRIVED_AT_DROPOFF", false, Carrying},
		{"UNDELIVERABLE", false, Accepted},
		{"RETURNING", false, Accepted},
		{"DELIVERED", true, Finished},
		{"RETURNED", true, Finished},
		{"CANCELLED_BY_PLATFORM", true, Finished},
		{"REASSIGNED", true, Finished},
		// Terminated wins over a carrying state, and an unknown state shows
		// the least.
		{"ARRIVED_AT_DROPOFF", true, Finished},
		{"SOME_STATE_ADDED_LATER", false, Finished},
		{"", false, Finished},
	} {
		if got := StageOf(c.state, c.terminated); got != c.want {
			t.Errorf("StageOf(%q, %v) = %d, want %d", c.state, c.terminated, got, c.want)
		}
	}
}
