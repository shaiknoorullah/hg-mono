package catalog

import "testing"

// TestHalalVisibilityPredicateIsTwoStatesOnly pins the single most important
// rule in this module: only CERTIFIED and EXPIRING_SOON are customer-visible.
// EXPIRED and UNVERIFIED are invisible — a 404, never a hidden badge.
func TestHalalVisibilityPredicateIsTwoStatesOnly(t *testing.T) {
	cases := map[string]bool{
		HalalCertified:    true,
		HalalExpiringSoon: true,
		HalalExpired:      false,
		HalalUnverified:   false,
		"SELF_DECLARED":   false, // never on the wire (O-06); certainly never visible
		"":                false,
	}
	for state, want := range cases {
		if got := IsHalalVisible(state); got != want {
			t.Errorf("IsHalalVisible(%q) = %v, want %v", state, got, want)
		}
	}
}

// TestVisiblePredicateMentionsOnlyTheTwoVisibleStates guards against a drift in
// the shared SQL fragment: it must gate on exactly CERTIFIED and EXPIRING_SOON,
// and on deleted_at IS NULL and account_state LIVE.
func TestVisiblePredicateShape(t *testing.T) {
	for _, needle := range []string{
		"deleted_at IS NULL",
		"account_state = 'LIVE'",
		"'CERTIFIED'",
		"'EXPIRING_SOON'",
	} {
		if !contains(visiblePredicate, needle) {
			t.Errorf("visiblePredicate is missing %q; the shared gate must include it", needle)
		}
	}
	for _, forbidden := range []string{"'EXPIRED'", "'UNVERIFIED'", "SELF_DECLARED"} {
		if contains(visiblePredicate, forbidden) {
			t.Errorf("visiblePredicate must not mention %q — those states are invisible", forbidden)
		}
	}
}

// TestHalalDisplayStatesMatchContractEnum pins the closed set against the four
// contract HalalDisplayState members.
func TestHalalDisplayStatesMatchContractEnum(t *testing.T) {
	want := map[string]bool{"CERTIFIED": true, "EXPIRING_SOON": true, "EXPIRED": true, "UNVERIFIED": true}
	if len(halalDisplayStates) != len(want) {
		t.Fatalf("expected %d display states, got %d", len(want), len(halalDisplayStates))
	}
	for _, s := range halalDisplayStates {
		if !want[s] {
			t.Errorf("unexpected display state %q", s)
		}
	}
}

func TestCertificationDisclaimerIsFixedCopy(t *testing.T) {
	got := certificationDisclaimer("14 March 2027")
	want := "Certification verified by Halal Goes on 14 March 2027. Halal Goes does not itself certify food."
	if got != want {
		t.Errorf("disclaimer = %q, want %q", got, want)
	}
	if empty := certificationDisclaimer(""); !contains(empty, "does not itself certify") {
		t.Errorf("empty-date disclaimer must still carry the standing sentence, got %q", empty)
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
