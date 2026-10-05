package restaurant_test

// deleteMenuCategory and deleteMenuItem
// (https://github.com/shaiknoorullah/hg-mono/issues/239): a restaurant deletes its
// own items and empty categories (docs/spec/03-restaurant.md, R-14 "Menu and
// category management" and R-15 "Menu item authoring").

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

func deleteCategory(h *restaurant.Handler, f fixtures, id string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/v1/restaurant/menu/categories/"+id, nil)
	return serveAsOwner(h.DeleteMenuCategory, withChiParam(req, "categoryId", id), f)
}

func deleteItem(h *restaurant.Handler, f fixtures, id string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/v1/restaurant/menu/items/"+id, nil)
	return serveAsOwner(h.DeleteMenuItem, withChiParam(req, "itemId", id), f)
}

// A category holding an item is refused with its item count and nothing changes;
// deleting the item (a soft delete that withdraws its version waiting for
// review) empties it, and then it deletes. Deleting either again, or another
// restaurant's, is 404.
func TestIntegration_DeleteMenuItemAndCategory(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	rec := deleteCategory(h, f, f.categoryID)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete non-empty category: status=%d (%s), want 409", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "CATEGORY_NOT_EMPTY" || env.Error.Details["item_count"] != float64(1) {
		t.Errorf("refusal = %s, want CATEGORY_NOT_EMPTY with item_count 1", rec.Body.String())
	}

	if rec := deleteItem(h, f, f.menuItemID); rec.Code != http.StatusNoContent {
		t.Fatalf("delete item: status=%d (%s), want 204", rec.Code, rec.Body.String())
	}
	// Soft: the row stays for the order lines that point at it.
	var softDeleted bool
	var versionStatus string
	if err := pool.QueryRow(ctx, `
		SELECT mi.deleted_at IS NOT NULL AND mi.pending_version_id IS NULL, v.review_status::text
		  FROM menu_item mi JOIN menu_item_version v ON v.id = $2
		 WHERE mi.id = $1`, f.menuItemID, f.menuVersionID).Scan(&softDeleted, &versionStatus); err != nil {
		t.Fatal(err)
	}
	if !softDeleted || versionStatus != "WITHDRAWN" {
		t.Errorf("after delete: soft-deleted=%v version=%s, want true and WITHDRAWN", softDeleted, versionStatus)
	}

	if rec := deleteCategory(h, f, f.categoryID); rec.Code != http.StatusNoContent {
		t.Fatalf("delete emptied category: status=%d (%s), want 204", rec.Code, rec.Body.String())
	}
	for name, rec := range map[string]*httptest.ResponseRecorder{
		"item again":     deleteItem(h, f, f.menuItemID),
		"category again": deleteCategory(h, f, f.categoryID),
	} {
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status=%d (%s), want 404", name, rec.Code, rec.Body.String())
		}
	}

	var foreignCat, foreignItem string
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name)
		VALUES ($1, 'Theirs') RETURNING id`, f.otherRestID).Scan(&foreignCat); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO menu_item (restaurant_id, category_id, price_cents)
		VALUES ($1, $2, 900) RETURNING id`, f.otherRestID, foreignCat).Scan(&foreignItem); err != nil {
		t.Fatal(err)
	}
	if rec := deleteItem(h, f, foreignItem); rec.Code != http.StatusNotFound {
		t.Errorf("foreign item: status=%d, want 404", rec.Code)
	}
	if rec := deleteCategory(h, f, foreignCat); rec.Code != http.StatusNotFound {
		t.Errorf("foreign category: status=%d, want 404", rec.Code)
	}
	var foreignGone int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM menu_item WHERE id = $1 AND deleted_at IS NOT NULL`,
		foreignItem).Scan(&foreignGone); err != nil {
		t.Fatal(err)
	}
	if foreignGone != 0 {
		t.Error("another restaurant's item was deleted")
	}
}
