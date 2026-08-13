package restaurant_test

// STAGE-4 adversarial regression tests. Each test corresponds to a concrete
// defect found by trying to break the feature; each would fail against the
// pre-fix code.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── F1: complete document pack must succeed (enum drift + can-never-submit) ──
//
// Pre-fix, CheckDocumentPack required FOOD_HANDLER_CERTIFICATE (not a valid
// restaurant_doc_type enum member) and LIABILITY_INSURANCE, so a restaurant that
// attached the four real contract-required documents got a 500 (SQLSTATE 22P02)
// and could NEVER submit. The pack now requires the contract set
// {BUSINESS_LICENCE, HALAL_CERTIFICATE, FOOD_SAFETY, OWNER_ID}.
func TestStage4_SubmitDocuments_CompletePack_Succeeds(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	for _, dt := range []string{"BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY", "OWNER_ID"} {
		var objID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
			VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now())
			RETURNING id`, f.ownerAccountID).Scan(&objID); err != nil {
			t.Fatalf("seed stored_object: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
			VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'SUBMITTED', now()+interval '72h', 'ESCALATE')`,
			f.restaurantID, dt, objID); err != nil {
			t.Fatalf("attach %s: %v", dt, err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM kyc_document WHERE subject_id=$1`, f.restaurantID) })

	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/documents/submit", nil)
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantDocuments(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("complete pack submit: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// A pack missing OWNER_ID (a contract-required type) must still be 422 — proving
// the required set is genuinely the contract's four, not something looser.
func TestStage4_SubmitDocuments_MissingOneRequired_422(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()
	for _, dt := range []string{"BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY"} { // OWNER_ID omitted
		var objID string
		_ = pool.QueryRow(ctx, `
			INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
			VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now())
			RETURNING id`, f.ownerAccountID).Scan(&objID)
		_, _ = pool.Exec(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
			VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'SUBMITTED', now()+interval '72h', 'ESCALATE')`,
			f.restaurantID, dt, objID)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM kyc_document WHERE subject_id=$1`, f.restaurantID) })

	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/documents/submit", nil)
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantDocuments(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("pack missing OWNER_ID: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── F2: rejectOrder with an unknown reason must be 422, not a 500 crash ──────
func TestStage4_RejectOrder_UnknownReason_422NotCrash(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")

	for _, bad := range []string{`{"reason":"TOTALLY_BOGUS"}`, `{"reason":""}`, `{"reason":"item_unavailable"}`, `{"reason":"DROP TABLE order"}`, `{"reason":"OTHER; --"}`} {
		req := httptest.NewRequest(http.MethodPost,
			fmt.Sprintf("/v1/restaurant/orders/%s/reject", orderID), strings.NewReader(bad))
		req = withChiParam(req, "orderId", orderID)
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.RejectOrder(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("reject %s: status=%d, want 422 (body: %s)", bad, rec.Code, rec.Body.String())
		}
	}
	// The order must be untouched by any of the rejected attempts.
	var state string
	_ = pool.QueryRow(context.Background(), `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state)
	if state != "RESTAURANT_PENDING" {
		t.Errorf("bad-reason reject mutated order: state=%q", state)
	}
}

// A valid reason on a real pending order still rejects (200) — proves the guard
// does not over-reject.
func TestStage4_RejectOrder_ValidReason_Succeeds(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")

	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/v1/restaurant/orders/%s/reject", orderID),
		strings.NewReader(`{"reason":"KITCHEN_AT_CAPACITY"}`))
	req = withChiParam(req, "orderId", orderID)
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.RejectOrder(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid reject: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── F3: delayOrder must enforce the +45 minute cumulative cap (R-26) ─────────
//
// Pre-fix, the code only counted delays (<3) and let three 20-minute delays (60
// min > 45) all succeed. Now the running total is capped at 45.
func TestStage4_DelayOrder_CumulativeCap45(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "PREPARING", "now() + interval '30 minutes'")
	// Make it look accepted so DelayOrder proceeds past the accepted_at guard.
	_, _ = pool.Exec(context.Background(), `UPDATE "order" SET accepted_at=now() WHERE id=$1`, orderID)

	delay := func(mins int) int {
		req := httptest.NewRequest(http.MethodPost,
			fmt.Sprintf("/v1/restaurant/orders/%s/delay", orderID),
			strings.NewReader(fmt.Sprintf(`{"delay_minutes":%d,"reason":"HIGH_VOLUME"}`, mins)))
		req = withChiParam(req, "orderId", orderID)
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.DelayOrder(rec, req)
		return rec.Code
	}

	if c := delay(20); c != http.StatusOK { // cumulative 20
		t.Fatalf("delay #1 (20): status=%d, want 200", c)
	}
	if c := delay(20); c != http.StatusOK { // cumulative 40
		t.Fatalf("delay #2 (20): status=%d, want 200", c)
	}
	if c := delay(20); c != http.StatusConflict { // would be 60 > 45 → blocked
		t.Fatalf("delay #3 (20 → 60 total): status=%d, want 409 DELAY_LIMIT_REACHED", c)
	}
	// A smaller increment that keeps the total at exactly 45 is allowed.
	if c := delay(5); c != http.StatusOK { // 40 + 5 = 45
		t.Fatalf("delay (5 → 45 total): status=%d, want 200 (at the cap boundary)", c)
	}
}

// delayOrder must also reject non-canned increments and unknown reason codes.
func TestStage4_DelayOrder_BadIncrementOrReason_422(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "PREPARING", "now() + interval '30 minutes'")
	_, _ = pool.Exec(context.Background(), `UPDATE "order" SET accepted_at=now() WHERE id=$1`, orderID)

	for _, bad := range []string{
		`{"delay_minutes":7,"reason":"HIGH_VOLUME"}`,   // 7 not in {5,10,15,20}
		`{"delay_minutes":0,"reason":"HIGH_VOLUME"}`,   // zero
		`{"delay_minutes":-5,"reason":"HIGH_VOLUME"}`,  // negative
		`{"delay_minutes":10000,"reason":"HIGH_VOLUME"}`, // absurd
		`{"delay_minutes":15,"reason":"NONSENSE"}`,     // bad reason enum
	} {
		req := httptest.NewRequest(http.MethodPost,
			fmt.Sprintf("/v1/restaurant/orders/%s/delay", orderID), strings.NewReader(bad))
		req = withChiParam(req, "orderId", orderID)
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.DelayOrder(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("delay %s: status=%d, want 422 (body: %s)", bad, rec.Code, rec.Body.String())
		}
	}
}

// ─── F4: createMenuItem/updateMenuItem must reject a foreign category (IDOR) ──
//
// Pre-fix, a caller could create an item pointing at ANOTHER restaurant's
// category (FK is global, no ownership check) and got a 201. The item now
// returns 404 because a foreign/nonexistent category is invisible.
func TestStage4_CreateMenuItem_ForeignCategory_404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	var otherCat string
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name) VALUES ($1,'Foreign') RETURNING id`, f.otherRestID).Scan(&otherCat); err != nil {
		t.Fatalf("seed foreign category: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM menu_item_version WHERE restaurant_id=$1`, f.restaurantID)
		_, _ = pool.Exec(c, `DELETE FROM menu_item WHERE category_id=$1`, otherCat)
		_, _ = pool.Exec(c, `DELETE FROM menu_category WHERE id=$1`, otherCat)
	})

	body := fmt.Sprintf(`{"name":"Sneaky","category_id":"%s","price_cents":1500}`, otherCat)
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", strings.NewReader(body))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.CreateMenuItem(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("create item in foreign category: status=%d, want 404 (IDOR write leak) (body: %s)", rec.Code, rec.Body.String())
	}
	// Nothing must have been written for the caller pointing at the foreign category.
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM menu_item WHERE category_id=$1`, otherCat).Scan(&n)
	if n != 0 {
		t.Errorf("foreign category gained %d item(s) from another tenant — IDOR write occurred", n)
	}
}

func TestStage4_UpdateMenuItem_MoveToForeignCategory_404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	var otherCat string
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name) VALUES ($1,'Foreign') RETURNING id`, f.otherRestID).Scan(&otherCat); err != nil {
		t.Fatalf("seed foreign category: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM menu_category WHERE id=$1`, otherCat) })

	body := fmt.Sprintf(`{"category_id":"%s"}`, otherCat)
	req := httptest.NewRequest(http.MethodPatch,
		fmt.Sprintf("/v1/restaurant/menu/items/%s", f.menuItemID), strings.NewReader(body))
	req = withChiParam(req, "itemId", f.menuItemID)
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.UpdateMenuItem(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("move item to foreign category: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	// The item must not have been re-parented into the foreign category.
	var cat string
	_ = pool.QueryRow(ctx, `SELECT category_id::text FROM menu_item WHERE id=$1`, f.menuItemID).Scan(&cat)
	if cat == otherCat {
		t.Errorf("item was re-parented into a foreign category — IDOR write occurred")
	}
}

// ─── F5: hostile bodies must be a clean 422, never a 500 ──────────────────────
func TestStage4_WriteOps_HostileInputs_422NotCrash(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	type probe struct {
		name string
		call func(body string) int
		bad  []string
	}

	hours := func(body string) int {
		req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/hours", strings.NewReader(body))
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.SetRestaurantHours(rec, req)
		return rec.Code
	}
	menuItem := func(body string) int {
		req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", strings.NewReader(body))
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.CreateMenuItem(rec, req)
		return rec.Code
	}
	profile := func(body string) int {
		req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.SubmitRestaurantProfile(rec, req)
		return rec.Code
	}
	doc := func(body string) int {
		req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/documents", strings.NewReader(body))
		req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
		rec := httptest.NewRecorder()
		h.AttachRestaurantDocument(rec, req)
		return rec.Code
	}

	probes := []probe{
		{"hours", hours, []string{
			`{"hours":[{"day_of_week":1,"opens_at":"not-a-time","closes_at":"25:99"}],"overrides":[]}`,
			`{"hours":[{"day_of_week":99,"opens_at":"09:00","closes_at":"17:00"}],"overrides":[]}`,
			`{"hours":[{"day_of_week":-1,"opens_at":"09:00","closes_at":"17:00"}],"overrides":[]}`,
			`{"hours":[],"overrides":[{"on_date":"2026-01-01","is_closed":false,"opens_at":"99:99","closes_at":"17:00"}]}`,
		}},
		{"menuItem", menuItem, []string{
			fmt.Sprintf(`{"name":"X","category_id":"%s","price_cents":1500,"dietary_tags":["NOT_A_REAL_TAG"]}`, f.categoryID),
			fmt.Sprintf(`{"name":"X","category_id":"%s","price_cents":1500,"allergen_tags":["ZZZ"]}`, f.categoryID),
			`{"name":"X","category_id":"not-a-uuid","price_cents":1500}`,
			`{"name":"X","category_id":"' OR 1=1 --","price_cents":1500}`,
		}},
		{"profile", profile, []string{
			`{"legal_name":"A","display_name":"B","description":"d","line1":"l","city":"c","province":"XX","postal_code":"K1A0B1","latitude":45,"longitude":-75,"cuisine_ids":[],"avg_prep_minutes":10}`,
		}},
		{"doc", doc, []string{
			`{"stored_object_id":"obj-1","doc_type":"FOOD_HANDLER_CERTIFICATE"}`,
			`{"stored_object_id":"obj-1","doc_type":"BOGUS"}`,
		}},
	}

	for _, pr := range probes {
		for _, b := range pr.bad {
			code := pr.call(b)
			if code == http.StatusInternalServerError {
				t.Errorf("%s hostile body produced a 500 (should be 422): %s", pr.name, b)
			}
			if code != http.StatusUnprocessableEntity {
				t.Errorf("%s body %s: status=%d, want 422", pr.name, b, code)
			}
		}
	}
}

// updateMenuItem must reject a HALAL_CERTIFIED assertion (halal gate on update).
func TestStage4_UpdateMenuItem_HalalCertified_403(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	body := `{"dietary_tags":["HALAL_CERTIFIED"]}`
	req := httptest.NewRequest(http.MethodPatch,
		fmt.Sprintf("/v1/restaurant/menu/items/%s", f.menuItemID), strings.NewReader(body))
	req = withChiParam(req, "itemId", f.menuItemID)
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	h.UpdateMenuItem(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("update asserting HALAL_CERTIFIED: status=%d, want 403 FIELD_NOT_WRITABLE (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "FIELD_NOT_WRITABLE" {
		t.Errorf("code=%q, want FIELD_NOT_WRITABLE", env.Error.Code)
	}
}
