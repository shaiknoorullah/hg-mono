package restaurant

import (
	"regexp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// validate.go — server-side input validators for the write operations.
//
// STAGE-4 hardening: every value that reaches a Postgres enum cast, a CHECK
// constraint, or a typed column MUST be validated here first. Otherwise a
// hostile or malformed body reaches the DB, trips a 22P02 / 23514 / 22007, and
// the handler surfaces it as a bare 500 INTERNAL_ERROR — leaking the failure and
// crashing the endpoint instead of returning a clean 422. Deny-by-default: an
// unknown enum member is rejected, never passed through.

// Allowed enum members, mirrored from migrations/00002_enums.sql (the DB) and the
// contract's schemas. Kept as sets for O(1) membership checks.

var dietaryTagSet = map[string]bool{
	"VEGETARIAN": true, "VEGAN": true, "GLUTEN_FREE": true, "DAIRY_FREE": true,
	"NUT_FREE": true, "HALAL_CERTIFIED": true, "SPICY": true, "KETO": true, "LOW_CARB": true,
}

var allergenTagSet = map[string]bool{
	"PEANUTS": true, "TREE_NUTS": true, "SESAME": true, "MILK": true, "EGGS": true,
	"FISH": true, "CRUSTACEANS_MOLLUSCS": true, "SOY": true, "WHEAT_TRITICALE": true,
	"SULPHITES": true, "MUSTARD": true,
}

// restaurantRejectReasonSet is restaurant_reject_reason_code (R-24).
var restaurantRejectReasonSet = map[string]bool{
	"ITEM_UNAVAILABLE": true, "KITCHEN_AT_CAPACITY": true, "CLOSING_SOON": true,
	"EQUIPMENT_FAILURE": true, "ADDRESS_OUT_OF_RANGE": true, "SUSPECTED_FRAUD": true, "OTHER": true,
}

// delayReasonSet is delay_reason_code (R-26).
var delayReasonSet = map[string]bool{
	"HIGH_VOLUME": true, "INGREDIENT_PREP": true, "EQUIPMENT_ISSUE": true,
	"STAFF_SHORTAGE": true, "ORDER_COMPLEXITY": true, "OTHER": true,
}

// restaurantDocTypeSet is the full restaurant_doc_type enum (a superset of the
// required pack — LIABILITY_INSURANCE is attachable but not required at V0).
var restaurantDocTypeSet = map[string]bool{
	"BUSINESS_LICENCE": true, "HALAL_CERTIFICATE": true, "FOOD_SAFETY": true,
	"OWNER_ID": true, "LIABILITY_INSURANCE": true,
}

// provinceSet is the province enum (Canadian provinces/territories).
var provinceSet = map[string]bool{
	"AB": true, "BC": true, "MB": true, "NB": true, "NL": true, "NS": true, "NT": true,
	"NU": true, "ON": true, "PE": true, "QC": true, "SK": true, "YT": true,
}

// hhmmRe matches a 24-hour HH:MM time-of-day, mirroring the contract's
// TradingInterval opens_at/closes_at pattern.
var hhmmRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// uuidRe matches a canonical UUID (used to reject a category_id that would
// otherwise 22P02 on the ::uuid cast).
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// requiredRestaurantDocTypes is the V0 Canadian pack (contract R-07 / R-08,
// RestaurantDocType). These are the four types that must be present before a
// restaurant may submit its document pack. NOTE: the previous implementation
// used FOOD_HANDLER_CERTIFICATE and LIABILITY_INSURANCE — the former is not even
// a valid restaurant_doc_type enum member (a submit with a complete real pack
// therefore 22P02'd into a 500 and could never succeed).
var requiredRestaurantDocTypes = []string{
	"BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY", "OWNER_ID",
}

func isValidTimeOfDay(s string) bool { return hhmmRe.MatchString(s) }
func isValidUUID(s string) bool      { return uuidRe.MatchString(s) }

// validateTags returns field errors for any dietary/allergen tag that is not a
// known enum member, or nil when all tags are recognised. Rejecting unknown
// members keeps them out of the ::dietary_tag[]/::allergen_tag[] casts.
func validateTags(dietary, allergen []string) []httpx.FieldError {
	var fe []httpx.FieldError
	for _, t := range dietary {
		if !dietaryTagSet[t] {
			fe = append(fe, httpx.FieldError{Field: "dietary_tags", Code: "invalid", Message: "unknown dietary tag: " + t})
		}
	}
	for _, t := range allergen {
		if !allergenTagSet[t] {
			fe = append(fe, httpx.FieldError{Field: "allergen_tags", Code: "invalid", Message: "unknown allergen tag: " + t})
		}
	}
	return fe
}

// validateHours returns field errors for an out-of-range day_of_week or a
// malformed HH:MM time in the weekly slots or overrides, or nil when valid.
// This keeps bad values out of the CHECK (day_of_week BETWEEN 0 AND 6) and the
// ::time casts, which would otherwise 23514 / 22007 into a 500.
func validateHours(in hoursInputDTO) []httpx.FieldError {
	var fe []httpx.FieldError
	for i, s := range in.Intervals {
		if s.DayOfWeek < 0 || s.DayOfWeek > 6 {
			fe = append(fe, httpx.FieldError{Field: fieldIdx("intervals", i, "day_of_week"), Code: "invalid", Message: "day_of_week must be 0..6"})
		}
		if !isValidTimeOfDay(s.OpensAt) {
			fe = append(fe, httpx.FieldError{Field: fieldIdx("intervals", i, "opens_at"), Code: "invalid", Message: "opens_at must be HH:MM"})
		}
		if !isValidTimeOfDay(s.ClosesAt) {
			fe = append(fe, httpx.FieldError{Field: fieldIdx("intervals", i, "closes_at"), Code: "invalid", Message: "closes_at must be HH:MM"})
		}
	}
	for i, o := range in.Overrides {
		if o.OpensAt != nil && *o.OpensAt != "" && !isValidTimeOfDay(*o.OpensAt) {
			fe = append(fe, httpx.FieldError{Field: fieldIdx("overrides", i, "opens_at"), Code: "invalid", Message: "opens_at must be HH:MM"})
		}
		if o.ClosesAt != nil && *o.ClosesAt != "" && !isValidTimeOfDay(*o.ClosesAt) {
			fe = append(fe, httpx.FieldError{Field: fieldIdx("overrides", i, "closes_at"), Code: "invalid", Message: "closes_at must be HH:MM"})
		}
	}
	return fe
}

func fieldIdx(arr string, i int, field string) string {
	return arr + "[" + itoa(i) + "]." + field
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	neg := i < 0
	if neg {
		i = -i
	}
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		b[pos] = '-'
	}
	return string(b[pos:])
}
