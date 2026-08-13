package addresses

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// validate.go — server-side input validators for the write operations.
//
// STAGE-4 hardening: every value that reaches a Postgres enum cast, a CHECK
// constraint, or a typed column MUST be validated (and normalised) here first.
// Otherwise a hostile or malformed body reaches the DB and one of two things
// happens, both wrong:
//
//   1. A 22P02 (bad enum, e.g. province "ZZ"/"on") or a 23514 (postal CHECK,
//      e.g. "NOPE"/lowercase) trips inside the INSERT/UPDATE and the handler
//      surfaces it as a bare 500 INTERNAL_ERROR — leaking the failure and
//      crashing the endpoint instead of returning the contract's 422.
//
//   2. The DB happily accepts a value the *contract* forbids because the column
//      is looser than the schema: an empty line1/city (DB is NOT NULL only,
//      contract is minLength 1); a postal_code whose letters are outside the
//      contract's restricted alphabet (the DB CHECK allows any [A-Z]); a
//      latitude/longitude outside [-90,90]/[-180,180] (no DB CHECK at all —
//      PostGIS then *wraps* 999 to -81, silently corrupting the stored point).
//      All of these persist bad data and echo it back in every future response.
//
// Deny-by-default: an unknown enum member is rejected, never passed through.
// The postal code is normalised to the contract's canonical form (uppercased,
// single interior space) before it is stored.

// provinceSet is the contract Province enum (ISO 3166-2:CA), identical to the
// migrations/00002_enums.sql `province` type. A value outside this set would
// 22P02 on the ::province cast.
var provinceSet = map[string]bool{
	"AB": true, "BC": true, "MB": true, "NB": true, "NL": true, "NS": true, "NT": true,
	"NU": true, "ON": true, "PE": true, "QC": true, "SK": true, "YT": true,
}

// postalRe mirrors the contract's PostalCode pattern exactly (restricted letter
// classes: no D/F/I/O/Q/U in the FSA first letter, none of D/F/I/O/Q/U in the
// letter positions). This is *stricter* than the DB CHECK
// (`^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$`), so validating here also closes the
// enum/pattern-drift gap where the DB would accept "D0D 0D0" but the contract
// forbids it. The match is done after normalisation (uppercased, single space).
var postalRe = regexp.MustCompile(`^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] ?[0-9][A-CEGHJ-NPR-TV-Z][0-9]$`)

// Field length bounds, mirrored from the contract AddressInput/AddressUpdateInput
// schemas. maxLen is a UTF-8 rune count (the contract's maxLength is characters,
// not bytes).
const (
	maxLabel         = 30
	minLine1         = 1
	maxLine1         = 200
	maxLine2         = 200
	maxUnit          = 32
	maxBuzzer        = 32
	minCity          = 1
	maxCity          = 100
	maxDeliveryNotes = 200
)

// normalizePostal collapses whitespace and uppercases so the value matches the
// contract's canonical "stored uppercased with a single space" form. It accepts
// both "M4J1M4" and "m4j 1m4" and yields "M4J 1M4". Callers must still run
// postalRe against the result.
func normalizePostal(raw string) string {
	up := strings.ToUpper(strings.TrimSpace(raw))
	// Remove all interior spaces, then re-insert a single one after the FSA (3
	// chars) when the total is 6 alphanumerics. If the shape is off we leave it
	// as-is so postalRe rejects it rather than silently "fixing" garbage.
	compact := strings.ReplaceAll(up, " ", "")
	if len(compact) == 6 {
		return compact[:3] + " " + compact[3:]
	}
	return up
}

// runeLen is the contract's notion of length (characters, not bytes).
func runeLen(s string) int { return utf8.RuneCountInString(s) }

// validCoord rejects NaN/±Inf (which would serialise as invalid JSON and, for
// lat, has no meaningful point) and enforces the contract's [-90,90]/[-180,180]
// ranges. PostGIS does not range-check and will wrap an out-of-range value,
// corrupting the stored point, so this must happen before ST_MakePoint.
func validLatitude(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= -90 && v <= 90
}

func validLongitude(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= -180 && v <= 180
}

// validateCreate validates an AddressInput and, on success, returns the input
// with its postal_code normalised to canonical form. On failure it returns the
// accumulated field errors (non-nil) and the input is not to be used.
func validateCreate(in *addressInputDTO) []httpx.FieldError {
	var fe []httpx.FieldError

	// line1 — required, 1..200.
	if runeLen(in.Line1) < minLine1 {
		fe = append(fe, httpx.FieldError{Field: "line1", Code: "required", Message: "line1 must not be empty"})
	} else if runeLen(in.Line1) > maxLine1 {
		fe = append(fe, httpx.FieldError{Field: "line1", Code: "too_long", Message: "line1 exceeds 200 characters"})
	}

	// city — required, 1..100.
	if runeLen(in.City) < minCity {
		fe = append(fe, httpx.FieldError{Field: "city", Code: "required", Message: "city must not be empty"})
	} else if runeLen(in.City) > maxCity {
		fe = append(fe, httpx.FieldError{Field: "city", Code: "too_long", Message: "city exceeds 100 characters"})
	}

	// province — required, must be a Province enum member.
	if !provinceSet[in.Province] {
		fe = append(fe, httpx.FieldError{Field: "province", Code: "invalid", Message: "province must be an ISO 3166-2:CA code"})
	}

	// postal_code — required, normalise then match the contract pattern.
	in.PostalCode = normalizePostal(in.PostalCode)
	if !postalRe.MatchString(in.PostalCode) {
		fe = append(fe, httpx.FieldError{Field: "postal_code", Code: "invalid", Message: "postal_code must be a valid Canadian postal code"})
	}

	// latitude / longitude — required, finite, in range.
	if !validLatitude(in.Latitude) {
		fe = append(fe, httpx.FieldError{Field: "latitude", Code: "invalid", Message: "latitude must be between -90 and 90"})
	}
	if !validLongitude(in.Longitude) {
		fe = append(fe, httpx.FieldError{Field: "longitude", Code: "invalid", Message: "longitude must be between -180 and 180"})
	}

	fe = append(fe, validateOptionalStrings(in.Label, in.Line2, in.Unit, in.Buzzer, in.DeliveryNotes)...)
	return fe
}

// validateUpdate validates a partial AddressUpdateInput. Only the fields that
// are present (non-nil) are checked; the merged row must still satisfy the
// contract, and each supplied field must be individually valid. postal_code, if
// present, is normalised in place.
func validateUpdate(in *addressUpdateInputDTO) []httpx.FieldError {
	var fe []httpx.FieldError

	if in.Line1 != nil {
		if runeLen(*in.Line1) < minLine1 {
			fe = append(fe, httpx.FieldError{Field: "line1", Code: "required", Message: "line1 must not be empty"})
		} else if runeLen(*in.Line1) > maxLine1 {
			fe = append(fe, httpx.FieldError{Field: "line1", Code: "too_long", Message: "line1 exceeds 200 characters"})
		}
	}
	if in.City != nil {
		if runeLen(*in.City) < minCity {
			fe = append(fe, httpx.FieldError{Field: "city", Code: "required", Message: "city must not be empty"})
		} else if runeLen(*in.City) > maxCity {
			fe = append(fe, httpx.FieldError{Field: "city", Code: "too_long", Message: "city exceeds 100 characters"})
		}
	}
	if in.Province != nil && !provinceSet[*in.Province] {
		fe = append(fe, httpx.FieldError{Field: "province", Code: "invalid", Message: "province must be an ISO 3166-2:CA code"})
	}
	if in.PostalCode != nil {
		norm := normalizePostal(*in.PostalCode)
		in.PostalCode = &norm
		if !postalRe.MatchString(norm) {
			fe = append(fe, httpx.FieldError{Field: "postal_code", Code: "invalid", Message: "postal_code must be a valid Canadian postal code"})
		}
	}
	// A PATCH that moves only one coordinate is incoherent for a point (the repo
	// only rebuilds location when BOTH are present), so require them together.
	if (in.Latitude == nil) != (in.Longitude == nil) {
		fe = append(fe, httpx.FieldError{Field: "latitude", Code: "invalid", Message: "latitude and longitude must be provided together"})
	}
	if in.Latitude != nil && !validLatitude(*in.Latitude) {
		fe = append(fe, httpx.FieldError{Field: "latitude", Code: "invalid", Message: "latitude must be between -90 and 90"})
	}
	if in.Longitude != nil && !validLongitude(*in.Longitude) {
		fe = append(fe, httpx.FieldError{Field: "longitude", Code: "invalid", Message: "longitude must be between -180 and 180"})
	}

	fe = append(fe, validateOptionalStrings(in.Label, in.Line2, in.Unit, in.Buzzer, in.DeliveryNotes)...)
	return fe
}

// validateOptionalStrings enforces the maxLength bounds on the nullable text
// fields shared by create and update. A nil pointer means "field absent" and is
// skipped; an empty non-nil value is allowed (these fields have no minLength).
func validateOptionalStrings(label, line2, unit, buzzer, deliveryNotes *string) []httpx.FieldError {
	var fe []httpx.FieldError
	check := func(v *string, field string, max int) {
		if v != nil && runeLen(*v) > max {
			fe = append(fe, httpx.FieldError{Field: field, Code: "too_long", Message: field + " exceeds the maximum length"})
		}
	}
	check(label, "label", maxLabel)
	check(line2, "line2", maxLine2)
	check(unit, "unit", maxUnit)
	check(buzzer, "buzzer", maxBuzzer)
	check(deliveryNotes, "delivery_notes", maxDeliveryNotes)
	return fe
}
