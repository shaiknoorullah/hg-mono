package admin

// STAGE 4 — adversarial regression tests for the four admin-menu operations.
//
// Each test here reproduces a concrete bug found during the stage-4 adversarial
// review and would have FAILED before the fix in the same commit:
//
//   BUG A  invalid dietary/allergen enum member 22P02'd into a bare 500
//   BUG B  a valid contract MenuItemInput body (ingredients_text, allergens_declared,
//          prep_minutes, sort_order) was rejected 422 "unknown field"; the non-contract
//          tax_category field was accepted
//   BUG C  item name minLength(2)/maxLength(80) and category name maxLength(60) unenforced
//   BUG D  review_note "at least 20 chars when reason_code is OTHER" unenforced
//   BUG E  dietary_tags maxItems(6) unenforced
//
// Every case asserts a clean 4xx with a contract ErrorCode — never a 500, never a
// silent accept of an out-of-contract value.

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// itemURL / catURL / decideURL build the three write endpoints for a fixture.
func itemURL(base, restaurantID string) string {
	return fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", base, restaurantID)
}
func catURL(base, restaurantID string) string {
	return fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", base, restaurantID)
}
func decideURL(base, versionID string) string {
	return fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", base, versionID)
}

// ---- BUG A: enum drift — unknown tag must be 422 INVALID_ENUM_VALUE, not 500 --

func TestStage4_CreateItem_UnknownDietaryTagIs422(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	cases := []struct {
		name string
		body map[string]any
	}{
		{"bad_dietary", map[string]any{"category_id": data.categoryID, "name": "Bad D", "price_cents": 1000, "dietary_tags": []string{"NOT_A_TAG"}}},
		{"bad_allergen", map[string]any{"category_id": data.categoryID, "name": "Bad A", "price_cents": 1000, "allergen_tags": []string{"URANIUM"}}},
		{"sql_inject_tag", map[string]any{"category_id": data.categoryID, "name": "Inj", "price_cents": 1000, "dietary_tags": []string{"VEGAN'); DROP TABLE menu_item;--"}}},
		{"empty_string_tag", map[string]any{"category_id": data.categoryID, "name": "Empty", "price_cents": 1000, "dietary_tags": []string{""}}},
		{"lowercase_tag", map[string]any{"category_id": data.categoryID, "name": "Lower", "price_cents": 1000, "dietary_tags": []string{"vegan"}}},
	}
	for i, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
				fmt.Sprintf("s4-bad-tag-key-%02d", i), tc.body)
			if status == http.StatusInternalServerError {
				t.Fatalf("%s: got 500 (enum drift leaked as INTERNAL_ERROR); env=%v", tc.name, env)
			}
			if status != http.StatusUnprocessableEntity {
				t.Fatalf("%s: want 422, got %d; env=%v", tc.name, status, env)
			}
			if code := menuErrCode(env); code != "INVALID_ENUM_VALUE" {
				t.Fatalf("%s: want INVALID_ENUM_VALUE, got %q", tc.name, code)
			}
		})
	}
}

// ---- BUG B: DTO must equal contract MenuItemInput ------------------------------

// A well-formed partner body carrying the full set of contract MenuItemInput
// fields must be accepted and its operational fields persisted.
func TestStage4_CreateItem_FullContractBodyAccepted(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
		"s4-full-body-0001", map[string]any{
			"category_id":        data.categoryID,
			"name":               "Full Contract Item",
			"description":        "with everything",
			"ingredients_text":   "chicken, spices, oil",
			"price_cents":        2500,
			"dietary_tags":       []string{"GLUTEN_FREE"},
			"allergen_tags":      []string{"MILK", "EGGS"},
			"allergens_declared": true,
			"prep_minutes":       25,
			"sort_order":         7,
		})
	if status != http.StatusCreated {
		t.Fatalf("want 201, got %d; env=%v", status, env)
	}
	d := env["data"].(map[string]any)
	itemID := d["id"].(string)
	if int(d["sort_order"].(float64)) != 7 {
		t.Errorf("sort_order not echoed: %v", d["sort_order"])
	}

	// The operational fields must have actually persisted, not been dropped.
	var prep, sort int
	if err := pool.QueryRow(ctx, `SELECT prep_minutes, sort_order FROM menu_item WHERE id=$1`, itemID).Scan(&prep, &sort); err != nil {
		t.Fatalf("read back item: %v", err)
	}
	if prep != 25 || sort != 7 {
		t.Errorf("persisted prep=%d sort=%d, want 25/7", prep, sort)
	}
	var declared bool
	var ingredients *string
	if err := pool.QueryRow(ctx,
		`SELECT allergens_declared, ingredients_text FROM menu_item_version WHERE menu_item_id=$1`, itemID,
	).Scan(&declared, &ingredients); err != nil {
		t.Fatalf("read back version: %v", err)
	}
	if !declared {
		t.Error("allergens_declared not persisted")
	}
	if ingredients == nil || *ingredients != "chicken, spices, oil" {
		t.Errorf("ingredients_text not persisted: %v", ingredients)
	}
}

// tax_category is NOT a member of the contract's MenuItemInput; sending it is an
// unknown field and must be rejected, not silently accepted.
func TestStage4_CreateItem_TaxCategoryFieldRejected(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
		"s4-taxcat-reject-1", map[string]any{
			"category_id": data.categoryID, "name": "Tax Item", "price_cents": 1000,
			"tax_category": "ZERO_RATED_GROCERY",
		})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for unknown field tax_category, got %d; env=%v", status, env)
	}
}

// ---- BUG C: name/description length bounds ------------------------------------

func TestStage4_CreateItem_NameLengthBounds(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	cases := []struct {
		name string
		body map[string]any
	}{
		{"name_1_char", map[string]any{"category_id": data.categoryID, "name": "X", "price_cents": 1000}},
		{"name_81_char", map[string]any{"category_id": data.categoryID, "name": strings.Repeat("A", 81), "price_cents": 1000}},
		{"desc_601_char", map[string]any{"category_id": data.categoryID, "name": "OK Name", "price_cents": 1000, "description": strings.Repeat("d", 601)}},
		{"ingredients_1001", map[string]any{"category_id": data.categoryID, "name": "OK Name", "price_cents": 1000, "ingredients_text": strings.Repeat("i", 1001)}},
	}
	for i, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
				fmt.Sprintf("s4-item-len-key-%02d", i), tc.body)
			if status != http.StatusUnprocessableEntity {
				t.Fatalf("%s: want 422, got %d; env=%v", tc.name, status, env)
			}
			if menuErrCode(env) == "" {
				t.Fatalf("%s: empty error code", tc.name)
			}
		})
	}
}

func TestStage4_CreateCategory_NameLengthBounds(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	cases := []struct {
		name string
		body map[string]any
	}{
		{"name_61_char", map[string]any{"name": strings.Repeat("C", 61)}},
		{"desc_501_char", map[string]any{"name": "Sides", "description": strings.Repeat("d", 501)}},
	}
	for i, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			status, env := doMenuJSON(t, http.MethodPost, catURL(srv.URL, data.restaurantID),
				fmt.Sprintf("s4-cat-len-key-%02d", i), tc.body)
			if status != http.StatusUnprocessableEntity {
				t.Fatalf("%s: want 422, got %d; env=%v", tc.name, status, env)
			}
		})
	}
}

// ---- BUG D: review_note >= 20 chars when reason_code is OTHER ------------------

func TestStage4_Decide_RejectOtherRequiresLongNote(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// Short note with OTHER — must be 422, and the version must stay PENDING_REVIEW.
	status, env := doMenuJSON(t, http.MethodPost, decideURL(srv.URL, data.versionID),
		"s4-other-short-01", map[string]any{
			"decision": "REJECT", "reason_code": "OTHER", "review_note": "too short",
		})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for OTHER+short note, got %d; env=%v", status, env)
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT review_status::text FROM menu_item_version WHERE id=$1`, data.versionID).Scan(&st); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if st != "PENDING_REVIEW" {
		t.Fatalf("rejected-but-invalid decision leaked a state change: %s", st)
	}
}

func TestStage4_Decide_RejectOtherWithLongNoteSucceeds(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, decideURL(srv.URL, data.versionID),
		"s4-other-long-01", map[string]any{
			"decision": "REJECT", "reason_code": "OTHER",
			"review_note": "This description overstates the health claim materially.",
		})
	if status != http.StatusOK {
		t.Fatalf("want 200 for OTHER+long note, got %d; env=%v", status, env)
	}
}

// review_note over 1000 chars is rejected regardless of decision.
func TestStage4_Decide_ReviewNoteMaxLength(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, decideURL(srv.URL, data.versionID),
		"s4-note-max-0001", map[string]any{
			"decision": "APPROVE", "review_note": strings.Repeat("n", 1001),
		})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for over-long review_note, got %d; env=%v", status, env)
	}
}

// ---- BUG E: dietary_tags maxItems(6) -----------------------------------------

func TestStage4_CreateItem_TooManyDietaryTags(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
		"s4-many-tags-0001", map[string]any{
			"category_id": data.categoryID, "name": "Too Many Tags", "price_cents": 1000,
			"dietary_tags": []string{"VEGAN", "VEGETARIAN", "KETO", "LOW_CARB", "GLUTEN_FREE", "DAIRY_FREE", "NUT_FREE"},
		})
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for 7 dietary tags, got %d; env=%v", status, env)
	}
}

// ---- hostile category_id that is not a UUID must be a clean 4xx, not a 500 ----

func TestStage4_CreateItem_MalformedCategoryIDNo500(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost, itemURL(srv.URL, data.restaurantID),
		"s4-bad-catid-0001", map[string]any{
			"category_id": "not-a-uuid", "name": "Bad Cat", "price_cents": 1000,
		})
	if status >= 500 {
		t.Fatalf("malformed category_id leaked a 5xx: %d; env=%v", status, env)
	}
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d; env=%v", status, env)
	}
}
