package restaurant_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// A menu item's photo must belong to the restaurant: uploaded by the caller or
// a colleague, or already one of its menu photos. Another account's upload, or
// a file uploaded for another purpose, is 404 and no item is written
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func TestMenuItemImage_MustBelongToTheRestaurant(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()
	h := newHandler(pool)
	admin := seedAccount(t, pool)

	call := func(method, itemID string, body map[string]any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		path := "/v1/restaurant/menu/items"
		if itemID != "" {
			path += "/" + itemID
		}
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		if itemID != "" {
			req = withChiParam(req, "itemId", itemID)
		}
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		if method == http.MethodPost {
			h.CreateMenuItem(rec, req)
		} else {
			h.UpdateMenuItem(rec, req)
		}
		return rec
	}
	createWith := func(imageID string) *httptest.ResponseRecorder {
		return call(http.MethodPost, "", map[string]any{
			"name": "Photo Test", "category_id": f.categoryID, "price_cents": 1500, "image_object_id": imageID,
		})
	}
	versionsWith := func(imageID string) int {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM menu_item_version WHERE image_object_id=$1`, imageID).Scan(&n)
		return n
	}

	for name, id := range map[string]string{
		"another restaurant owner's menu photo": seedUpload(t, pool, f.otherAccountID, "MENU_IMAGE", "READY"),
		"the caller's own compliance file":      seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "READY"),
		"the caller's unconfirmed menu photo":   seedUpload(t, pool, f.ownerAccountID, "MENU_IMAGE", "PENDING"),
	} {
		if rec := createWith(id); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status=%d, want 404 (body: %s)", name, rec.Code, rec.Body.String())
		}
		if n := versionsWith(id); n != 0 {
			t.Errorf("%s: %d menu versions carry it, want 0", name, n)
		}
	}

	// A colleague's photo is the restaurant's photo.
	colleagues := seedUpload(t, pool, f.managerAccountID, "MENU_IMAGE", "READY")
	if rec := createWith(colleagues); rec.Code != http.StatusCreated {
		t.Fatalf("the manager's menu photo: status=%d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}

	// An update re-sends the item's current photo, which an admin uploaded.
	adminPhoto := seedUpload(t, pool, admin, "MENU_IMAGE", "READY")
	if _, err := pool.Exec(ctx, `UPDATE menu_item_version SET image_object_id=$1 WHERE id=$2`, adminPhoto, f.menuVersionID); err != nil {
		t.Fatalf("set the admin's photo on the item: %v", err)
	}
	if rec := call(http.MethodPatch, f.menuItemID, map[string]any{"name": "Renamed", "image_object_id": adminPhoto}); rec.Code != http.StatusOK {
		t.Fatalf("re-sending the item's current photo: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	t.Cleanup(func() {
		c := context.Background()
		for _, id := range []string{colleagues, adminPhoto} {
			_, _ = pool.Exec(c, `UPDATE menu_item SET live_version_id=NULL, pending_version_id=NULL
			                      WHERE restaurant_id=$1`, f.restaurantID)
			_, _ = pool.Exec(c, `DELETE FROM menu_item_version WHERE image_object_id=$1`, id)
		}
	})
}
