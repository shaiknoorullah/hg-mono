package admin

import "time"

// The closed seven-check list, halal_checklist_version = 1 (A-15). Approval
// requires all seven at PASS. Order is the canonical H1..H7 order the register
// report and the UI render.
const HalalChecklistVersion = 1

const (
	CheckLegibleComplete = "H1_LEGIBLE_COMPLETE"
	CheckIssuerAccepted  = "H2_ISSUER_ACCEPTED"
	CheckNameMatch       = "H3_NAME_MATCH"
	CheckAddressMatch    = "H4_ADDRESS_MATCH"
	CheckDatesValid      = "H5_DATES_VALID"
	CheckScopeSufficient = "H6_SCOPE_SUFFICIENT"
	CheckUniqueNotReused = "H7_UNIQUE_NOT_REUSED"
)

// AllCheckKeys is the canonical H1..H7 ordering.
var AllCheckKeys = []string{
	CheckLegibleComplete, CheckIssuerAccepted, CheckNameMatch, CheckAddressMatch,
	CheckDatesValid, CheckScopeSufficient, CheckUniqueNotReused,
}

// Check results.
const (
	ResultPass        = "PASS"
	ResultFail        = "FAIL"
	ResultNotAssessed = "NOT_ASSESSED"
)

// NonOverridable reports whether a check is server-computed and may never be set
// against the computation by a human (A-15 R1). Exactly H5 and H7.
func NonOverridable(checkKey string) bool {
	return checkKey == CheckDatesValid || checkKey == CheckUniqueNotReused
}

// isValidCheckKey reports whether s is one of the seven closed keys.
func isValidCheckKey(s string) bool {
	for _, k := range AllCheckKeys {
		if k == s {
			return true
		}
	}
	return false
}

// isValidResult reports whether s is a member of HalalCheckResult.
func isValidResult(s string) bool {
	return s == ResultPass || s == ResultFail || s == ResultNotAssessed
}

// Scopes that satisfy H6 at V0. The other two fail it because the platform has
// no item-level halal data model and must not make an item-level claim (A-15).
const (
	ScopeWholeEstablishment = "WHOLE_ESTABLISHMENT"
	ScopeKitchenOnly        = "KITCHEN_ONLY"
	ScopeSpecificMenuItems  = "SPECIFIC_MENU_ITEMS"
	ScopeSupplierChainOnly  = "SUPPLIER_CHAIN_ONLY"
)

// certFacts is everything the server needs to compute the auto-evaluable checks.
// It is derived from the transcribed certificate fields, never from the client's
// assertion of a result.
type certFacts struct {
	// issuedOn / expiresOn are the transcribed dates; zero when not yet recorded.
	issuedOn  *time.Time
	expiresOn *time.Time
	// issuerAccepted is true iff the chosen issuing body is ACCEPTED at review time.
	issuerAccepted bool
	// scope is the transcribed scope; empty when not yet recorded.
	scope string
	// duplicateExists is true iff another APPROVED certificate already exists for
	// this (issuing_body_id, certificate_number). This is H7.
	duplicateExists bool
	// minRemainingDays is halal_cert_min_remaining_days (A-06); a certificate
	// expiring sooner than this fails H5.
	minRemainingDays int
	// now is the evaluation instant (America/Toronto business date in practice;
	// the caller passes the truncated date).
	now time.Time
}

// computeH5 evaluates H5_DATES_VALID: the certificate must not be expired, must
// have issued_on <= expires_on, and must have at least halal_cert_min_remaining_days
// of validity left. Server-computed and non-overridable.
func computeH5(f certFacts) string {
	if f.issuedOn == nil || f.expiresOn == nil {
		return ResultNotAssessed
	}
	if f.expiresOn.Before(*f.issuedOn) {
		return ResultFail
	}
	// The last day the certificate is still acceptable is expires_on minus the
	// minimum-remaining-days guard. If today is on or after that cutoff, it fails.
	cutoff := f.expiresOn.AddDate(0, 0, -f.minRemainingDays)
	if !f.now.Before(cutoff) {
		return ResultFail
	}
	return ResultPass
}

// computeH2 evaluates H2_ISSUER_ACCEPTED at the moment of review (A-16).
func computeH2(f certFacts) string {
	if f.issuerAccepted {
		return ResultPass
	}
	return ResultFail
}

// computeH6 evaluates H6_SCOPE_SUFFICIENT.
func computeH6(f certFacts) string {
	switch f.scope {
	case "":
		return ResultNotAssessed
	case ScopeWholeEstablishment, ScopeKitchenOnly:
		return ResultPass
	default:
		return ResultFail
	}
}

// computeH7 evaluates H7_UNIQUE_NOT_REUSED: one approved certificate number per
// issuing body across the whole platform. Server-computed and non-overridable.
func computeH7(f certFacts) string {
	if f.duplicateExists {
		return ResultFail
	}
	return ResultPass
}

// computedResults returns the server's own evaluation for every check it can
// auto-evaluate. Checks that are purely human judgement (H1, H3, H4) return
// NOT_ASSESSED because the server has nothing to compare against.
func computedResults(f certFacts) map[string]string {
	return map[string]string{
		CheckLegibleComplete: ResultNotAssessed,
		CheckIssuerAccepted:  computeH2(f),
		CheckNameMatch:       ResultNotAssessed,
		CheckAddressMatch:    ResultNotAssessed,
		CheckDatesValid:      computeH5(f),
		CheckScopeSufficient: computeH6(f),
		CheckUniqueNotReused: computeH7(f),
	}
}
