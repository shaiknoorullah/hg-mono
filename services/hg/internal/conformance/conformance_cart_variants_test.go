package conformance

// addCartLine with one variant per variant group, and every answer the server
// gives a line the menu does not allow, validated against the contract
// (https://github.com/shaiknoorullah/hg-mono/issues/628,
// https://github.com/shaiknoorullah/hg-mono/issues/629).

import (
	"fmt"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

func TestConformance_AddCartLine_VariantsAndRefusals(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	b := seedCRBasics(t, pool)
	d := testseed.SeedTwoGroupDish(t, pool, b.menuItemID)
	other := seedCRBasics(t, pool) // another restaurant, for DIFFERENT_RESTAURANT

	n := 0
	post := func(t *testing.T, body map[string]any, wantStatus int) map[string]any {
		t.Helper()
		n++
		rq := Request{
			Method: "POST", Path: "/v1/cart/lines", AccountID: b.accountID,
			Roles: []string{roleCustomer}, Body: body,
			IdemKey: fmt.Sprintf("cr-variants-%d-%s", n, b.accountID),
		}
		if _, verr := ValidateRequest(t, h.Spec, h.Build(t, rq)); verr != nil {
			t.Fatalf("test body not contract-valid: %v", verr)
		}
		req, resp := h.Do(t, rq)
		defer resp.Body.Close()
		m := mustJSONMap(t, resp)
		if resp.StatusCode != wantStatus {
			t.Fatalf("status = %d, want %d (body: %v)", resp.StatusCode, wantStatus, m)
		}
		id, err := ValidateResponse(t, h.Spec, req, resp)
		h.MarkCovered(id)
		if err != nil {
			t.Errorf("CONFORMANCE FAIL: %v", err)
		}
		return m
	}
	errorOf := func(t *testing.T, m map[string]any) (string, any) {
		t.Helper()
		e, _ := m["error"].(map[string]any)
		return fmt.Sprint(e["code"]), e["details"]
	}
	line := func(variants []string, addons ...string) map[string]any {
		as := []any{}
		for _, a := range addons {
			as = append(as, map[string]any{"addon_id": a})
		}
		return map[string]any{"menu_item_id": b.menuItemID, "quantity": 1, "variant_ids": variants, "addons": as}
	}

	t.Run("422 VALIDATION_FAILED: a required group with no choice", func(t *testing.T) {
		code, details := errorOf(t, post(t, line([]string{d.Large}, d.Raita), 422))
		if code != "VALIDATION_FAILED" || fmt.Sprint(details) == "<nil>" {
			t.Errorf("code %s, details %v", code, details)
		}
	})
	t.Run("422 INVALID_ADDON: an add-on that is not the item's", func(t *testing.T) {
		code, _ := errorOf(t, post(t, line([]string{d.Large, d.Plain}, d.Raita, other.menuItemID), 422))
		if code != "INVALID_ADDON" {
			t.Errorf("code = %s, want INVALID_ADDON", code)
		}
	})
	t.Run("409 VARIANT_UNAVAILABLE names the variant", func(t *testing.T) {
		code, details := errorOf(t, post(t, line([]string{d.Large, d.Pulao}, d.Raita), 409))
		if dm, _ := details.(map[string]any); code != "VARIANT_UNAVAILABLE" || dm["variant_id"] != d.Pulao {
			t.Errorf("code %s, details %v", code, details)
		}
	})
	t.Run("409 ADDON_UNAVAILABLE names the add-on", func(t *testing.T) {
		code, details := errorOf(t, post(t, line([]string{d.Large, d.Plain}, d.Chilli), 409))
		if dm, _ := details.(map[string]any); code != "ADDON_UNAVAILABLE" || dm["addon_id"] != d.Chilli {
			t.Errorf("code %s, details %v", code, details)
		}
	})
	t.Run("200 with a variant from each group", func(t *testing.T) {
		m := post(t, line([]string{d.Biryani, d.Large}, d.Raita), 200)
		data, _ := m["data"].(map[string]any)
		lines, _ := data["lines"].([]any)
		if len(lines) != 1 {
			t.Fatalf("lines = %v", lines)
		}
		l, _ := lines[0].(map[string]any)
		vs, _ := l["variants"].([]any)
		if len(vs) != 2 || fmt.Sprint(l["unit_price_cents"]) != "2600" {
			t.Errorf("line variants %v, unit %v; want two, 2600", vs, l["unit_price_cents"])
		}
	})
	t.Run("409 DIFFERENT_RESTAURANT names the cart", func(t *testing.T) {
		m := post(t, map[string]any{"menu_item_id": other.menuItemID, "quantity": 1}, 409)
		code, details := errorOf(t, m)
		dm, _ := details.(map[string]any)
		if code != "DIFFERENT_RESTAURANT" || dm["current_restaurant_id"] != b.restaurantID ||
			dm["current_restaurant_name"] != "CR Kitchen" || fmt.Sprint(dm["current_line_count"]) != "1" ||
			fmt.Sprint(dm["current_item_count"]) != "1" {
			t.Errorf("code %s, details %v", code, details)
		}
	})
}
