package admin

import (
	"regexp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// menuUUIDRe matches a canonical UUID; a category_id / image_object_id that is
// not one would otherwise 22P02 on the ::uuid cast and surface as a bare 500.
var menuUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isValidUUIDStr reports whether s is a canonical UUID.
func isValidUUIDStr(s string) bool { return menuUUIDRe.MatchString(s) }

// validate_menu.go — server-side validators for the admin-on-behalf menu writes.
//
// STAGE-4 hardening: every value that reaches a Postgres enum cast, a CHECK
// constraint or a bounded column MUST be validated here first. Otherwise a
// hostile or malformed body reaches the DB, trips a 22P02 (bad enum member) or
// stores an out-of-bounds value the contract forbids, and the endpoint either
// 500s or silently accepts a value the wire schema rejects. Deny-by-default: an
// unknown enum member or an out-of-range length is rejected here, never passed
// through.
//
// The sets mirror migrations/00002_enums.sql (the DB) and the contract's
// DietaryTag / AllergenTag / TaxCategory schemas verbatim.

var menuDietaryTagSet = map[string]bool{
	"VEGETARIAN": true, "VEGAN": true, "GLUTEN_FREE": true, "DAIRY_FREE": true,
	"NUT_FREE": true, "HALAL_CERTIFIED": true, "SPICY": true, "KETO": true, "LOW_CARB": true,
}

var menuAllergenTagSet = map[string]bool{
	"PEANUTS": true, "TREE_NUTS": true, "SESAME": true, "MILK": true, "EGGS": true,
	"FISH": true, "CRUSTACEANS_MOLLUSCS": true, "SOY": true, "WHEAT_TRITICALE": true,
	"SULPHITES": true, "MUSTARD": true,
}

const (
	// Contract MenuItemInput bounds.
	menuItemNameMin      = 2
	menuItemNameMax      = 80
	menuItemDescMax      = 600
	menuIngredientsMax   = 1000
	menuDietaryTagsMax   = 6
	menuPrepMinutesMin   = 1
	menuPrepMinutesMax   = 120
	menuCategoryNameMin  = 1
	menuCategoryNameMax  = 60
	menuCategoryDescMax  = 500
	menuReviewNoteMax    = 1000
	menuReviewNoteMinOTH = 20
)

// validateMenuTags rejects any dietary/allergen tag that is not a known enum
// member (which would 22P02 on the ::dietary_tag[] / ::allergen_tag[] cast) and
// enforces the contract's maxItems:6 on dietary_tags. Returns nil when clean.
func validateMenuTags(dietary, allergen []string) []httpx.FieldError {
	var fe []httpx.FieldError
	if len(dietary) > menuDietaryTagsMax {
		fe = append(fe, httpx.FieldError{Field: "dietary_tags", Code: "invalid", Message: "at most 6 dietary tags"})
	}
	for _, t := range dietary {
		if !menuDietaryTagSet[t] {
			fe = append(fe, httpx.FieldError{Field: "dietary_tags", Code: "invalid", Message: "unknown dietary tag: " + t})
		}
	}
	for _, t := range allergen {
		if !menuAllergenTagSet[t] {
			fe = append(fe, httpx.FieldError{Field: "allergen_tags", Code: "invalid", Message: "unknown allergen tag: " + t})
		}
	}
	return fe
}

// runeLen counts characters, not bytes — a maxLength in the contract is a
// character bound, so a multibyte name must be measured by rune.
func runeLen(s string) int { return len([]rune(s)) }
