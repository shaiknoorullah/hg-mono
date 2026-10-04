package catalog

// halal.go carries the two rules that are the reason this module exists.

// HalalDisplayState members (contract HalalDisplayState). These are the
// *customer-facing derived* values: halal_certification_at computes them as of
// now (halalNowJoin), and the 00009 trigger stores them in restaurant.halal_status.
// There is no SELF_DECLARED on the wire (decision O-06).
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

// halalNowJoin derives the restaurant's halal state as of this statement,
// joined as `hn` beside a `restaurant` aliased `r`: halal_certification_at
// (migration 00033_halal_certified_now.sql) gives the certificate that vouches
// for it now and its display state, from admin-verified data only, counting a
// certificate only while its issuing body is ACCEPTED. Every customer read path
// joins it once (a LATERAL join calls the function once per row) and shows the
// badge and certificate it names, never the stored restaurant.halal_status,
// which is written only when a certificate or a body's status changes and so
// can be stale as dates pass (https://github.com/shaiknoorullah/hg-mono/issues/252).
// One source for the badge, the same one the cart and the order path read.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/346
const halalNowJoin = `
	CROSS JOIN LATERAL halal_certification_at(r.id, now()) AS hn`

// visiblePredicate is THE shared halal-gated listing predicate (C-09/C-12/P-33).
//
// A restaurant is customer-visible only when it is ACTIVE, not banned, not
// soft-deleted, and its halal display state is CERTIFIED or EXPIRING_SOON both
// in the stored row and as of now (halalNowJoin). Halal certification is a
// *precondition for being listed*, not a filter. Every customer read path —
// list, feed, search, detail, menu, certification — composes this exact
// fragment, so the rule lives in one place. The stored state can refuse but
// never admit on its own, as in the order path (orders.LockOrderableRestaurant).
//
// It is written against a `restaurant` alias `r` and needs halalNowJoin in the
// same FROM clause: a query that forgets it fails with "missing FROM-clause
// entry for table hn" rather than showing a badge. The account_state LIVE gate
// is the onboarding-complete, admin-approved, not-suspended state (00008).
const visiblePredicate = `
	r.deleted_at IS NULL
	AND r.account_state = 'LIVE'
	AND r.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')
	AND hn.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')`

// halalDisplayStates is the closed set, for a golden test that pins the trigger's
// vocabulary against the contract enum.
var halalDisplayStates = []string{
	HalalCertified, HalalExpiringSoon, HalalExpired, HalalUnverified,
}

// certificationDisclaimer is the fixed C-12 copy. The verified date is filled in
// per restaurant; the sentence is never reworded by the client.
func certificationDisclaimer(verifiedOn string) string {
	if verifiedOn == "" {
		return "HalalGoes does not itself certify food."
	}
	return "Certification verified by HalalGoes on " + verifiedOn +
		". HalalGoes does not itself certify food."
}
