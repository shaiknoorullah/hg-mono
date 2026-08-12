package dispatch

import (
	"testing"
	"time"
)

// TestForwardTransitions pins the assignment state machine (D-20 / §0.4):
// strictly forward, with the terminal set exactly as the contract enumerates.
func TestForwardTransitions(t *testing.T) {
	valid := []struct{ from, to string }{
		{"ASSIGNED", "EN_ROUTE_TO_PICKUP"},
		{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"},
		{"ARRIVED_AT_PICKUP", "PICKED_UP"},
		{"PICKED_UP", "EN_ROUTE_TO_DROPOFF"},
		{"EN_ROUTE_TO_DROPOFF", "ARRIVED_AT_DROPOFF"},
		{"ARRIVED_AT_DROPOFF", "DELIVERED"},
		{"ASSIGNED", "UNDELIVERABLE"},
		{"UNDELIVERABLE", "RETURNING"},
		{"RETURNING", "RETURNED"},
	}
	for _, c := range valid {
		if !isForward(c.from, c.to) {
			t.Errorf("expected %s -> %s to be a valid forward transition", c.from, c.to)
		}
	}

	invalid := []struct{ from, to string }{
		{"EN_ROUTE_TO_DROPOFF", "DELIVERED"}, // skips ARRIVED_AT_DROPOFF
		{"ARRIVED_AT_DROPOFF", "PICKED_UP"},  // backwards
		{"PICKED_UP", "ARRIVED_AT_PICKUP"},   // backwards
		{"DELIVERED", "RETURNED"},            // from terminal
		{"ASSIGNED", "DELIVERED"},            // skips the whole chain
		{"ARRIVED_AT_PICKUP", "ARRIVED_AT_DROPOFF"},
	}
	for _, c := range invalid {
		if isForward(c.from, c.to) {
			t.Errorf("expected %s -> %s to be rejected", c.from, c.to)
		}
	}
}

// TestTerminalAssignment pins the terminal set.
func TestTerminalAssignment(t *testing.T) {
	terminal := []string{"DELIVERED", "RETURNED", "CANCELLED_BY_PLATFORM", "REASSIGNED"}
	for _, s := range terminal {
		if !terminalAssignment(s) {
			t.Errorf("%s should be terminal", s)
		}
	}
	nonTerminal := []string{"ASSIGNED", "EN_ROUTE_TO_PICKUP", "PICKED_UP", "UNDELIVERABLE", "RETURNING"}
	for _, s := range nonTerminal {
		if terminalAssignment(s) {
			t.Errorf("%s should not be terminal", s)
		}
	}
}

// TestGeofenceRequired pins which transitions demand proximity.
func TestGeofenceRequired(t *testing.T) {
	if !requiresGeofence("ARRIVED_AT_PICKUP") || !requiresGeofence("ARRIVED_AT_DROPOFF") {
		t.Fatal("arrival transitions must require a geofence check")
	}
	for _, s := range []string{"EN_ROUTE_TO_PICKUP", "PICKED_UP", "DELIVERED", "ASSIGNED"} {
		if requiresGeofence(s) {
			t.Errorf("%s must not require a geofence check", s)
		}
	}
}

// TestBuildEarnings pins the launch earnings model (S-03 / R-02): delivery fee
// pass-through as base + 100% of the tip, in int64 cents, no floats, no floor.
func TestBuildEarnings(t *testing.T) {
	e := buildEarnings(449, 700)
	if e.BaseCents != 449 {
		t.Errorf("base = %d, want 449", e.BaseCents)
	}
	if e.TipSoFarCents != 700 {
		t.Errorf("tip = %d, want 700", e.TipSoFarCents)
	}
	if e.DistanceCents != 0 || e.SurgeCents != 0 {
		t.Errorf("distance/surge must be zero at launch, got %d/%d", e.DistanceCents, e.SurgeCents)
	}
	if e.EstimatedTotalCents != 1149 {
		t.Errorf("total = %d, want 1149", e.EstimatedTotalCents)
	}
	if e.Currency != "CAD" {
		t.Errorf("currency = %q, want CAD", e.Currency)
	}
	// Negative inputs are clamped to zero, never negative money.
	z := buildEarnings(-5, -5)
	if z.BaseCents != 0 || z.TipSoFarCents != 0 || z.EstimatedTotalCents != 0 {
		t.Errorf("negative inputs must clamp to zero, got %+v", z)
	}
}

// TestScoreIsEtaDominant pins that a nearer rider scores higher (D-13 step 2).
func TestScoreIsEtaDominant(t *testing.T) {
	near := scoreFor(500)
	far := scoreFor(5000)
	if near <= far {
		t.Errorf("nearer rider must score higher: near=%d far=%d", near, far)
	}
}

// TestEtaSeconds pins the haversine fallback ETA is positive and monotonic.
func TestEtaSeconds(t *testing.T) {
	if etaSeconds(0) != 0 {
		t.Error("zero distance must be zero ETA")
	}
	if etaSeconds(1000) >= etaSeconds(2000) {
		t.Error("ETA must increase with distance")
	}
}

// TestValidUUID pins the path-id guard.
func TestValidUUID(t *testing.T) {
	if !validUUID("405ba962-2c5b-488f-abdc-2c5ebb0330c7") {
		t.Error("a canonical UUID must validate")
	}
	for _, bad := range []string{"", "not-a-uuid", "123", "405ba962-2c5b-488f-abdc"} {
		if validUUID(bad) {
			t.Errorf("%q must not validate", bad)
		}
	}
}

// TestRejectReasonTaxonomy pins the closed reason-code set (D-17).
func TestRejectReasonTaxonomy(t *testing.T) {
	for _, r := range []string{"TOO_FAR", "EARNINGS_TOO_LOW", "SAFETY_CONCERN", "OTHER"} {
		if !offerRejectReasons[r] {
			t.Errorf("%s must be an accepted reason code", r)
		}
	}
	if offerRejectReasons["RIDER_DECLINED"] {
		t.Error("free-text 'RIDER_DECLINED' must not be accepted")
	}
}

// TestParseTimestamp pins RFC3339 parsing and UTC normalisation.
func TestParseTimestamp(t *testing.T) {
	got, err := parseTimestamp("2026-08-10T18:42:11.412Z")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Location() != time.UTC {
		t.Errorf("timestamp must be normalised to UTC, got %v", got.Location())
	}
	if _, err := parseTimestamp("not-a-time"); err == nil {
		t.Error("a malformed timestamp must error")
	}
	if _, err := parseTimestamp(""); err == nil {
		t.Error("an empty timestamp must error")
	}
}

// TestTimestampColumn pins which assignment column each state stamps.
func TestTimestampColumn(t *testing.T) {
	cases := map[string]string{
		"ARRIVED_AT_PICKUP":  "arrived_pickup_at",
		"PICKED_UP":          "picked_up_at",
		"ARRIVED_AT_DROPOFF": "arrived_dropoff_at",
		"DELIVERED":          "delivered_at",
		"EN_ROUTE_TO_PICKUP": "",
	}
	for state, col := range cases {
		if got := timestampColumn(state); got != col {
			t.Errorf("timestampColumn(%s) = %q, want %q", state, got, col)
		}
	}
}

// TestRadiusLadder pins the widening search ladder (D-13).
func TestRadiusLadder(t *testing.T) {
	want := []int{3000, 6000, 10000}
	if len(radiusLadderM) != len(want) {
		t.Fatalf("radius ladder length = %d, want %d", len(radiusLadderM), len(want))
	}
	for i, r := range want {
		if radiusLadderM[i] != r {
			t.Errorf("radiusLadderM[%d] = %d, want %d", i, radiusLadderM[i], r)
		}
	}
}
