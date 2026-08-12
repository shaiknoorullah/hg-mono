package catalog

// halal.go carries the two rules that are the reason this module exists.

// HalalDisplayState members (contract HalalDisplayState). These are the
// *customer-facing derived* values, computed by the 00009 trigger and stored in
// restaurant.halal_status. There is no SELF_DECLARED on the wire (decision O-06).
const (
	HalalCertified    = "CERTIFIED"
	HalalExpiringSoon = "EXPIRING_SOON"
	HalalExpired      = "EXPIRED"
	HalalUnverified   = "UNVERIFIED"
)

// visibleHalalStates is the halal half of the listing predicate: only CERTIFIED
// and EXPIRING_SOON restaurants are customer-visible anywhere. EXPIRED and
// UNVERIFIED are 404 from every customer read path — not a hidden badge, a 404.
//
// This is expressed once, in SQL, in visiblePredicate below, and this Go copy
// exists only for tests and readers to point at.
var visibleHalalStates = []string{HalalCertified, HalalExpiringSoon}

// IsHalalVisible reports whether a derived halal_display_state makes a restaurant
// customer-visible. The SQL predicate is authoritative; this mirrors it for unit
// tests so the rule cannot silently drift in one place without the other.
func IsHalalVisible(displayState string) bool {
	return displayState == HalalCertified || displayState == HalalExpiringSoon
}

// visiblePredicate is THE shared halal-gated listing predicate (C-09/C-12/P-33).
//
// A restaurant is customer-visible only when it is ACTIVE, not banned, not
// soft-deleted, and its derived halal_display_state is CERTIFIED or
// EXPIRING_SOON. Halal certification is a *precondition for being listed*, not a
// filter. Every customer read path — list, feed, search, detail, menu,
// certification — composes this exact fragment, so the rule lives in one place.
//
// It is written against a `restaurant` alias `r`. The account_state LIVE gate is
// the onboarding-complete, admin-approved, not-suspended state (00008).
const visiblePredicate = `
	r.deleted_at IS NULL
	AND r.account_state = 'LIVE'
	AND r.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')`

// halalDisplayStates is the closed set, for a golden test that pins the trigger's
// vocabulary against the contract enum.
var halalDisplayStates = []string{
	HalalCertified, HalalExpiringSoon, HalalExpired, HalalUnverified,
}

// certificationDisclaimer is the fixed C-12 copy. The verified date is filled in
// per restaurant; the sentence is never reworded by the client.
func certificationDisclaimer(verifiedOn string) string {
	if verifiedOn == "" {
		return "Halal Goes does not itself certify food."
	}
	return "Certification verified by Halal Goes on " + verifiedOn +
		". Halal Goes does not itself certify food."
}
