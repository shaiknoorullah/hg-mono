package admin

// updateMenuItemOnBehalf and deleteMenuItemOnBehalf
// (https://github.com/shaiknoorullah/hg-mono/issues/502), through the real router
// and role matrix as an ADMIN. The menu lock on both is in menu_lock_test.go.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant/menulocktest"
)

// menuEditTest is two seeded restaurants, each with an item and a version
// waiting for review, and a server acting as a fresh ADMIN.
type menuEditTest struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	sa       string
	d, other menuTestRestaurant
	admin    httpx.Principal
	srv      *httptest.Server
	itemURL  string // d's item, on d's path
}

func newMenuEditTest(t *testing.T) menuEditTest {
	t.Helper()
	e := menuEditTest{ctx: context.Background(), pool: dialTestPool(t)}
	e.sa = seedSuperAdmin(t, e.ctx, e.pool)
	e.d = seedMenuRestaurantFull(t, e.ctx, e.pool, e.sa)
	e.other = seedMenuRestaurantFull(t, e.ctx, e.pool, e.sa)
	e.admin = principalFor(t, e.pool, httpx.RoleAdmin)
	e.srv = buildAdminTestServer(t, e.pool, e.admin)
	t.Cleanup(e.srv.Close)
	e.itemURL = e.srv.URL + "/v1/admin/restaurants/" + e.d.restaurantID + "/menu/items/" + e.d.menuItemID
	return e
}

func sendJSON(t *testing.T, method, url string, body any) (int, string) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, url, rd)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out)
}

// An admin's edit applies operational fields at once and approves claim-bearing
// ones on save, with the admin as reviewer and an audit row; a restaurant edit
// waiting for review is a 409 and stays; HALAL_CERTIFIED, another account's photo
// and another restaurant's item are refused and write nothing.
func TestUpdateMenuItemOnBehalf(t *testing.T) {
	e := newMenuEditTest(t)
	ctx, pool, sa, d, other, admin, srv, itemURL := e.ctx, e.pool, e.sa, e.d, e.other, e.admin, e.srv, e.itemURL

	// The restaurant's version is waiting for review: a claim-bearing edit is refused.
	before := menulocktest.Fingerprint(t, pool, d.restaurantID)
	if status, body := sendJSON(t, http.MethodPatch, itemURL, map[string]any{"name": "Admin Name"}); status != http.StatusConflict ||
		!strings.Contains(body, "MENU_VERSION_PENDING") {
		t.Fatalf("edit over a pending version: status=%d (%s), want 409 MENU_VERSION_PENDING", status, body)
	}
	if after := menulocktest.Fingerprint(t, pool, d.restaurantID); after != before {
		t.Fatal("a refused edit changed the menu")
	}

	// Decide it, then edit: price at once, name and tag approved on save, the
	// description carried over from the live version.
	if _, err := NewRepo(pool).DecideMenuVersion(ctx, auditActor{staffID: sa}, d.versionID, "APPROVE", nil, nil); err != nil {
		t.Fatalf("approve the restaurant's version: %v", err)
	}
	status, body := sendJSON(t, http.MethodPatch, itemURL,
		map[string]any{"name": "Chicken Shawarma", "price_cents": 1650, "dietary_tags": []string{"SPICY"}})
	if status != http.StatusOK {
		t.Fatalf("edit: status=%d (%s), want 200", status, body)
	}
	var got struct {
		Data menuItemOwnerView `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	lv := got.Data.LiveVersion
	if got.Data.PriceCents != 1650 || got.Data.Name != "Chicken Shawarma" || lv == nil ||
		lv.ReviewStatus != "APPROVED" || lv.Version != 2 || got.Data.PendingVersion != nil {
		t.Fatalf("edit response = %s", body)
	}
	if lv.Description == nil || *lv.Description != "Tender and juicy" {
		t.Errorf("description = %v, want it carried over from the live version", lv.Description)
	}
	var reviewer string
	if err := pool.QueryRow(ctx, `SELECT reviewed_by::text FROM menu_item_version WHERE id = $1`, lv.ID).Scan(&reviewer); err != nil {
		t.Fatal(err)
	}
	if reviewer != admin.AccountID {
		t.Errorf("reviewed_by = %s, want the acting admin %s", reviewer, admin.AccountID)
	}
	var audited int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_event
		WHERE action = 'menu.update_on_behalf' AND subject_id = $1 AND actor_account_id = $2`,
		d.menuItemID, admin.AccountID).Scan(&audited); err != nil {
		t.Fatal(err)
	}
	if audited != 1 {
		t.Errorf("audit rows = %d, want 1", audited)
	}

	// Refusals that write nothing.
	var stranger, strangerPhoto string
	if err := pool.QueryRow(ctx, `INSERT INTO account (email, status)
		VALUES ('me-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&stranger); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-media', 'me/'||md5(random()::text), 'MENU_IMAGE', 'image/jpeg', 2048, decode(repeat('e1',32),'hex'), 'READY', $1, now())
RETURNING id`, stranger).Scan(&strangerPhoto); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM stored_object WHERE id = $1`, strangerPhoto)
		_, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1`, stranger)
	})
	before = menulocktest.Fingerprint(t, pool, d.restaurantID)
	otherBefore := menulocktest.Fingerprint(t, pool, other.restaurantID)
	for _, c := range []struct {
		name   string
		url    string
		body   map[string]any
		status int
	}{
		{"HALAL_CERTIFIED", itemURL, map[string]any{"dietary_tags": []string{"HALAL_CERTIFIED"}}, http.StatusForbidden},
		{"another account's photo", itemURL, map[string]any{"image_object_id": strangerPhoto}, http.StatusNotFound},
		{"price out of range", itemURL, map[string]any{"price_cents": 49}, http.StatusUnprocessableEntity},
		{"another restaurant's item", srv.URL + "/v1/admin/restaurants/" + d.restaurantID + "/menu/items/" + other.menuItemID,
			map[string]any{"price_cents": 999}, http.StatusNotFound},
	} {
		if status, body := sendJSON(t, http.MethodPatch, c.url, c.body); status != c.status {
			t.Errorf("%s: status=%d (%s), want %d", c.name, status, body, c.status)
		}
	}
	if after := menulocktest.Fingerprint(t, pool, d.restaurantID); after != before {
		t.Error("a refused edit changed the menu")
	}
	if after := menulocktest.Fingerprint(t, pool, other.restaurantID); after != otherBefore {
		t.Error("an edit through another restaurant's path changed this one's menu")
	}
}

// Removing an item is a soft delete with an audit row; the version waiting for
// review is withdrawn and deciding it is 409 ITEM_DELETED; removing it again, or
// another restaurant's item, is 404.
func TestDeleteMenuItemOnBehalf(t *testing.T) {
	e := newMenuEditTest(t)
	ctx, pool, sa, d, other, admin, srv, itemURL := e.ctx, e.pool, e.sa, e.d, e.other, e.admin, e.srv, e.itemURL

	if status, body := sendJSON(t, http.MethodDelete, itemURL, nil); status != http.StatusNoContent {
		t.Fatalf("delete: status=%d (%s), want 204", status, body)
	}
	var deleted bool
	var versionStatus string
	if err := pool.QueryRow(ctx, `
SELECT mi.deleted_at IS NOT NULL AND mi.pending_version_id IS NULL, v.review_status::text
  FROM menu_item mi JOIN menu_item_version v ON v.id = $2
 WHERE mi.id = $1`, d.menuItemID, d.versionID).Scan(&deleted, &versionStatus); err != nil {
		t.Fatal(err)
	}
	if !deleted || versionStatus != "WITHDRAWN" {
		t.Errorf("after delete: deleted=%v version=%s, want deleted and WITHDRAWN", deleted, versionStatus)
	}
	var audited int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_event
		WHERE action = 'menu.delete_on_behalf' AND subject_id = $1 AND actor_account_id = $2`,
		d.menuItemID, admin.AccountID).Scan(&audited); err != nil {
		t.Fatal(err)
	}
	if audited != 1 {
		t.Errorf("audit rows = %d, want 1", audited)
	}

	if _, err := NewRepo(pool).DecideMenuVersion(ctx, auditActor{staffID: sa}, d.versionID, "APPROVE", nil, nil); err != ErrItemDeleted {
		t.Errorf("deciding the withdrawn version: err=%v, want ErrItemDeleted", err)
	}
	if status, body := sendJSON(t, http.MethodDelete, itemURL, nil); status != http.StatusNotFound {
		t.Errorf("second delete: status=%d (%s), want 404", status, body)
	}
	otherBefore := menulocktest.Fingerprint(t, pool, other.restaurantID)
	if status, body := sendJSON(t, http.MethodDelete,
		srv.URL+"/v1/admin/restaurants/"+d.restaurantID+"/menu/items/"+other.menuItemID, nil); status != http.StatusNotFound {
		t.Errorf("another restaurant's item: status=%d (%s), want 404", status, body)
	}
	if after := menulocktest.Fingerprint(t, pool, other.restaurantID); after != otherBefore {
		t.Error("a delete through another restaurant's path removed its item")
	}
}
