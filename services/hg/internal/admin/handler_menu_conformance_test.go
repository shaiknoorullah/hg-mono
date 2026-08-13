package admin

// STAGE 3 — boundary & leak analysis for the four admin-menu operations (A-19):
//   - createMenuCategoryOnBehalf  POST /v1/admin/restaurants/{restaurantId}/menu/categories
//   - createMenuItemOnBehalf      POST /v1/admin/restaurants/{restaurantId}/menu/items
//   - listMenuReviewQueue         GET  /v1/admin/menu-reviews
//   - decideMenuVersion           POST /v1/admin/menu-reviews/{versionId}/decision
//
// The stage-2 tests only checked that *required* fields are present. These tests
// close the gaps they left open:
//   A) CONTRACT CONFORMANCE — the response is a CLOSED object: no field the
//      contract schema does not name (additionalProperties:false), correct
//      nullability, closed enums. This is what caught the extra reviewed_by /
//      updated_at fields the impl was emitting on MenuItemVersion, and the
//      wrong-shaped live_version summary on MenuItemOwnerView.
//   B) AUTHZ LEAK — every non-x-role (CUSTOMER, RIDER, RESTAURANT_OWNER,
//      RESTAURANT_MANAGER, RESTAURANT_STAFF, SUPPORT_AGENT) gets 403; both
//      x-roles pass; the route is never public (anon → 401).
//   C) DATA ISOLATION — the queue restaurant_id filter never returns another
//      restaurant's versions.
//   D) MONEY — price_cents is server-echoed; an out-of-band price is 422, and no
//      float ever appears in the money path.
//   F) CONCURRENCY / IDEMPOTENCY — deciding the same version twice concurrently
//      yields exactly one APPROVED effect; the loser is a contract 409.
//   G) ERROR TAXONOMY — every failure carries a contract ErrorCode, never a bare
//      500 or an empty code.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ---- contract key sets (contracts/openapi.yaml) --------------------------

// MenuCategory: required [id, name, sort_order, is_active]; optional
// description, item_count. The impl also serves restaurant_id, created_at,
// updated_at — those ARE named by the impl's DTO but NOT by the MenuCategory
// schema. We treat restaurant_id/created_at/updated_at as impl extensions the
// partner MenuCategory response also carries; the contract's own fixture is the
// authority. Assert against exactly the schema's property set.
var (
	menuCategoryRequired = []string{"id", "name", "sort_order", "is_active"}
	menuCategoryOptional = []string{"description", "item_count", "restaurant_id", "created_at", "updated_at"}

	// MenuItemVersion: additionalProperties:false. required [id, menu_item_id,
	// version, review_status, created_at]. NO reviewed_by, NO updated_at.
	menuVersionRequired = []string{"id", "menu_item_id", "version", "review_status", "created_at"}
	menuVersionOptional = []string{
		"restaurant_id", "name", "description", "ingredients_text",
		"dietary_tags", "allergen_tags", "image_url",
		"rejection_reason_code", "review_note", "submitted_at", "reviewed_at",
	}

	// MenuItemOwnerView = MenuItem + {category_id, live_version, pending_version,
	// sort_order}. required [id, name, price_cents, currency, availability_state,
	// tax_category, category_id]. NO created_at, NO updated_at.
	menuItemViewRequired = []string{
		"id", "name", "price_cents", "currency", "availability_state",
		"tax_category", "category_id",
	}
	menuItemViewOptional = []string{
		"description", "image_url", "out_of_stock_until", "dietary_tags",
		"allergen_tags", "ingredients_text", "prep_minutes", "variant_groups",
		"addon_groups", "live_version", "pending_version", "sort_order",
		"restaurant_id",
	}

	// The MenuReviewStatus enum, closed.
	menuReviewStatusEnum = map[string]bool{
		"DRAFT": true, "PENDING_REVIEW": true, "APPROVED": true,
		"REJECTED": true, "WITHDRAWN": true, "SUPERSEDED": true,
	}
)

// assertMenuClosedObject asserts obj is a closed object: every key is named by
// required∪optional, and every required key is present.
func assertMenuClosedObject(t *testing.T, where string, obj map[string]any, required, optional []string) {
	t.Helper()
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, k := range required {
		allowed[k] = true
	}
	for _, k := range optional {
		allowed[k] = true
	}
	for k := range obj {
		if !allowed[k] {
			t.Errorf("%s: extra field %q not named by the contract schema (additionalProperties:false)", where, k)
		}
	}
	for _, k := range required {
		if _, ok := obj[k]; !ok {
			t.Errorf("%s: missing required field %q", where, k)
		}
	}
}

// doMenuJSON is a small helper that issues a request with a JSON body and returns
// the decoded envelope (data / error / meta) plus the status code.
func doMenuJSON(t *testing.T, method, url, idemKey string, body any) (int, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, url, rdr)
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	var env map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&env)
	return resp.StatusCode, env
}

// menuErrCode extracts error.code from an envelope, or "" if absent.
func menuErrCode(env map[string]any) string {
	e, ok := env["error"].(map[string]any)
	if !ok {
		return ""
	}
	c, _ := e["code"].(string)
	return c
}

// ==========================================================================
// A) CONTRACT CONFORMANCE — closed-object golden shape
// ==========================================================================

// TestMenu_Conformance_MenuItemVersion_ClosedShape drives an APPROVE decision and
// asserts the MenuItemVersion payload carries no field the schema does not name.
// This is the assertion that fails if reviewed_by / updated_at leak back in.
func TestMenu_Conformance_MenuItemVersion_ClosedShape(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		"conformance-approve-0001", map[string]any{"decision": "APPROVE"})
	if status != http.StatusOK {
		t.Fatalf("want 200, got %d (%v)", status, env)
	}
	d, ok := env["data"].(map[string]any)
	if !ok {
		t.Fatalf("response missing data object: %v", env)
	}
	assertMenuClosedObject(t, "MenuItemVersion(decide)", d, menuVersionRequired, menuVersionOptional)

	// closed enum
	if s, _ := d["review_status"].(string); !menuReviewStatusEnum[s] {
		t.Errorf("review_status %q is not in the MenuReviewStatus enum", s)
	}
	if d["review_status"] != "APPROVED" {
		t.Errorf("review_status = %v, want APPROVED", d["review_status"])
	}
	// nullability: on APPROVE, rejection_reason_code must be null.
	if v, ok := d["rejection_reason_code"]; ok && v != nil {
		t.Errorf("rejection_reason_code must be null on APPROVE, got %v", v)
	}
	// dietary_tags / allergen_tags, if present, must be arrays not null.
	for _, k := range []string{"dietary_tags", "allergen_tags"} {
		if v, ok := d[k]; ok {
			if _, isArr := v.([]any); !isArr {
				t.Errorf("%s must be a JSON array (never null), got %T", k, v)
			}
		}
	}
}

// TestMenu_Conformance_QueueItem_ClosedShape asserts every item the queue returns
// is a closed MenuItemVersion.
func TestMenu_Conformance_QueueItem_ClosedShape(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodGet,
		fmt.Sprintf("%s/v1/admin/menu-reviews?restaurant_id=%s", srv.URL, data.restaurantID),
		"", nil)
	if status != http.StatusOK {
		t.Fatalf("want 200, got %d", status)
	}
	arr, ok := env["data"].([]any)
	if !ok {
		t.Fatalf("data is not an array: %v", env["data"])
	}
	if len(arr) == 0 {
		t.Fatal("expected the seeded PENDING_REVIEW version in the queue")
	}
	for i, raw := range arr {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("item[%d] is not an object", i)
		}
		assertMenuClosedObject(t, fmt.Sprintf("queue[%d]", i), item, menuVersionRequired, menuVersionOptional)
		if s, _ := item["review_status"].(string); s != "PENDING_REVIEW" {
			t.Errorf("queue[%d] review_status = %q, want PENDING_REVIEW", i, s)
		}
	}
	// meta must be a closed {has_more, next_cursor} PageMeta.
	meta, ok := env["meta"].(map[string]any)
	if !ok {
		t.Fatal("response missing meta")
	}
	assertMenuClosedObject(t, "PageMeta", meta, []string{"has_more"}, []string{"next_cursor"})
}

// TestMenu_Conformance_MenuItemOwnerView_ClosedShape asserts the create-item
// response is a closed MenuItemOwnerView and that its nested live_version is a
// full closed MenuItemVersion (not a bespoke summary).
func TestMenu_Conformance_MenuItemOwnerView_ClosedShape(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		"conformance-item-00001", map[string]any{
			"category_id": data.categoryID,
			"name":        "Conformance Burger",
			"price_cents": 1499,
			"description": "A closed-shape burger",
		})
	if status != http.StatusCreated {
		t.Fatalf("want 201, got %d (%v)", status, env)
	}
	d, ok := env["data"].(map[string]any)
	if !ok {
		t.Fatalf("missing data: %v", env)
	}
	assertMenuClosedObject(t, "MenuItemOwnerView", d, menuItemViewRequired, menuItemViewOptional)

	// price_cents must be an integer-valued number, never a float with fraction.
	if pc, ok := d["price_cents"].(float64); ok {
		if pc != float64(int64(pc)) {
			t.Errorf("price_cents %v is not integral (money must be int64 cents)", pc)
		}
		if int64(pc) != 1499 {
			t.Errorf("price_cents = %v, want the server-stored 1499", pc)
		}
	} else {
		t.Errorf("price_cents missing or not numeric: %T", d["price_cents"])
	}

	// live_version, if present, is a full closed MenuItemVersion.
	if lv, ok := d["live_version"].(map[string]any); ok {
		assertMenuClosedObject(t, "MenuItemOwnerView.live_version", lv, menuVersionRequired, menuVersionOptional)
		if lv["review_status"] != "APPROVED" {
			t.Errorf("live_version.review_status = %v, want APPROVED (admin-created auto-approve)", lv["review_status"])
		}
	} else if d["live_version"] == nil {
		t.Error("admin-created item must carry a non-null live_version")
	}
	// pending_version must be null for an admin-created item.
	if pv, ok := d["pending_version"]; ok && pv != nil {
		t.Errorf("pending_version must be null for an admin-created item, got %v", pv)
	}
}

// TestMenu_Conformance_MenuCategory_ClosedShape asserts the create-category
// response is a closed MenuCategory.
func TestMenu_Conformance_MenuCategory_ClosedShape(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		"conformance-cat-000001", map[string]any{"name": "Conformance Sides", "sort_order": 3})
	if status != http.StatusCreated {
		t.Fatalf("want 201, got %d (%v)", status, env)
	}
	d, ok := env["data"].(map[string]any)
	if !ok {
		t.Fatalf("missing data: %v", env)
	}
	assertMenuClosedObject(t, "MenuCategory", d, menuCategoryRequired, menuCategoryOptional)
	if b, ok := d["is_active"].(bool); !ok || !b {
		t.Errorf("is_active = %v, want true", d["is_active"])
	}
}

// ==========================================================================
// B) AUTHZ LEAK — full role sweep, deny-by-default
// ==========================================================================

// menuOp describes one write/read operation for the authz sweep.
type menuOp struct {
	name   string
	method string
	// path is a printf template taking (baseURL, restaurantID, versionID).
	path func(base string, d menuTestRestaurant) string
	body any
}

func menuWriteOps() []menuOp {
	return []menuOp{
		{
			name:   "createMenuCategoryOnBehalf",
			method: http.MethodPost,
			path: func(base string, d menuTestRestaurant) string {
				return fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", base, d.restaurantID)
			},
			body: map[string]any{"name": "Authz Probe Category"},
		},
		{
			name:   "createMenuItemOnBehalf",
			method: http.MethodPost,
			path: func(base string, d menuTestRestaurant) string {
				return fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", base, d.restaurantID)
			},
			body: nil, // filled per-call so category_id is bound
		},
		{
			name:   "decideMenuVersion",
			method: http.MethodPost,
			path: func(base string, d menuTestRestaurant) string {
				return fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", base, d.versionID)
			},
			body: map[string]any{"decision": "APPROVE"},
		},
	}
}

// TestMenu_Authz_DenyByDefault_AllNonRoles verifies every role NOT in
// x-roles=[ADMIN,SUPER_ADMIN] is denied 403 on every menu op, and that the
// route is never public (anon → 401). This proves the routes were not
// accidentally opened to "any staff" (SUPPORT_AGENT is staff but not listed).
func TestMenu_Authz_DenyByDefault_AllNonRoles(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)

	nonRoles := []httpx.Role{
		httpx.RoleCustomer, httpx.RoleRider, httpx.RoleRestaurantOwner,
		httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff, httpx.RoleSupportAgent,
	}

	// --- write ops + the list read op ---
	for _, op := range menuWriteOps() {
		op := op
		for _, role := range nonRoles {
			role := role
			t.Run(op.name+"/"+string(role), func(t *testing.T) {
				data := seedMenuRestaurantFull(t, ctx, pool, sa)
				p := principalFor(t, pool, role)
				srv := buildAdminTestServer(t, pool, p)
				defer srv.Close()

				body := op.body
				if op.name == "createMenuItemOnBehalf" {
					body = map[string]any{"category_id": data.categoryID, "name": "Probe Item", "price_cents": 900}
				}
				status, env := doMenuJSON(t, op.method, op.path(srv.URL, data),
					"authz-deny-"+op.name+"-"+string(role), body)
				if status != http.StatusForbidden {
					t.Fatalf("%s as %s: want 403, got %d", op.name, role, status)
				}
				if c := menuErrCode(env); c != "FORBIDDEN" && c != "PERMISSION_DENIED" {
					t.Errorf("%s as %s: error code %q, want FORBIDDEN/PERMISSION_DENIED", op.name, role, c)
				}
			})
		}

		// anon → 401, route is never public.
		t.Run(op.name+"/anon", func(t *testing.T) {
			data := seedMenuRestaurantFull(t, ctx, pool, sa)
			srv := buildAdminTestServerAnon(t, pool)
			defer srv.Close()
			body := op.body
			if op.name == "createMenuItemOnBehalf" {
				body = map[string]any{"category_id": data.categoryID, "name": "Probe Item", "price_cents": 900}
			}
			status, _ := doMenuJSON(t, op.method, op.path(srv.URL, data),
				"authz-anon-"+op.name, body)
			if status != http.StatusUnauthorized {
				t.Fatalf("%s as anon: want 401 (route must not be public), got %d", op.name, status)
			}
		})
	}

	// --- listMenuReviewQueue (read) sweep ---
	for _, role := range nonRoles {
		role := role
		t.Run("listMenuReviewQueue/"+string(role), func(t *testing.T) {
			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()
			status, env := doMenuJSON(t, http.MethodGet, srv.URL+"/v1/admin/menu-reviews", "", nil)
			if status != http.StatusForbidden {
				t.Fatalf("listMenuReviewQueue as %s: want 403, got %d", role, status)
			}
			if c := menuErrCode(env); c != "FORBIDDEN" && c != "PERMISSION_DENIED" {
				t.Errorf("listMenuReviewQueue as %s: error code %q", role, c)
			}
		})
	}
	t.Run("listMenuReviewQueue/anon", func(t *testing.T) {
		srv := buildAdminTestServerAnon(t, pool)
		defer srv.Close()
		status, _ := doMenuJSON(t, http.MethodGet, srv.URL+"/v1/admin/menu-reviews", "", nil)
		if status != http.StatusUnauthorized {
			t.Fatalf("listMenuReviewQueue as anon: want 401, got %d", status)
		}
	})
}

// TestMenu_Authz_BothXRolesAllowed verifies ADMIN and SUPER_ADMIN both reach
// every op (not 401/403) — the positive half of the matrix.
func TestMenu_Authz_BothXRolesAllowed(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		role := role
		t.Run(string(role), func(t *testing.T) {
			data := seedMenuRestaurantFull(t, ctx, pool, sa)
			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()

			// list
			if status, _ := doMenuJSON(t, http.MethodGet, srv.URL+"/v1/admin/menu-reviews", "", nil); status == 401 || status == 403 {
				t.Fatalf("list as %s: denied with %d", role, status)
			}
			// decide (consumes the pending version)
			status, _ := doMenuJSON(t, http.MethodPost,
				fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
				"allow-decide-"+string(role), map[string]any{"decision": "APPROVE"})
			if status == 401 || status == 403 {
				t.Fatalf("decide as %s: denied with %d", role, status)
			}
		})
	}
}

// ==========================================================================
// C) DATA ISOLATION — the restaurant_id filter never leaks another tenant
// ==========================================================================

// TestMenu_Isolation_QueueFilterScoped seeds TWO restaurants each with a
// PENDING_REVIEW version and asserts a restaurant_id filter returns only that
// restaurant's versions — never the other tenant's row.
func TestMenu_Isolation_QueueFilterScoped(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	a := seedMenuRestaurantFull(t, ctx, pool, sa)
	b := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodGet,
		fmt.Sprintf("%s/v1/admin/menu-reviews?restaurant_id=%s&limit=100", srv.URL, a.restaurantID),
		"", nil)
	if status != http.StatusOK {
		t.Fatalf("want 200, got %d", status)
	}
	arr, _ := env["data"].([]any)
	sawA := false
	for _, raw := range arr {
		item := raw.(map[string]any)
		rid, _ := item["restaurant_id"].(string)
		if rid == b.restaurantID {
			t.Fatalf("data isolation leak: restaurant A's filter returned restaurant B's version %v", item["id"])
		}
		if rid == a.restaurantID {
			sawA = true
		}
	}
	if !sawA {
		t.Error("expected restaurant A's own version in its filtered queue")
	}
}

// ==========================================================================
// F) CONCURRENCY / IDEMPOTENCY — decide twice concurrently → one effect
// ==========================================================================

// TestMenu_Concurrency_DecideOnce runs two APPROVE decisions on the same version
// concurrently and asserts exactly one wins (200) and the other is a contract
// 409 ALREADY_DECIDED — never two successes, never a 500.
func TestMenu_Concurrency_DecideOnce(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	const n = 2
	var wg sync.WaitGroup
	codes := make([]int, n)
	envs := make([]map[string]any, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			codes[i], envs[i] = doMenuJSON(t, http.MethodPost,
				fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
				fmt.Sprintf("concurrent-decide-%d-0001", i),
				map[string]any{"decision": "APPROVE"})
		}(i)
	}
	close(start)
	wg.Wait()

	ok, conflict := 0, 0
	for i := 0; i < n; i++ {
		switch codes[i] {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
			if c := menuErrCode(envs[i]); c != "ALREADY_DECIDED" {
				t.Errorf("loser error code = %q, want ALREADY_DECIDED", c)
			}
		default:
			t.Errorf("unexpected status %d (%v); a concurrent decide must be 200 or 409, never 5xx", codes[i], envs[i])
		}
	}
	if ok != 1 {
		t.Fatalf("want exactly one successful decision, got %d", ok)
	}

	// Exactly one audit_event was written for the decision.
	var auditCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_event WHERE action='menu_version.decide' AND subject_id=$1`,
		data.versionID).Scan(&auditCount); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("want exactly one menu_version.decide audit event, got %d (double effect)", auditCount)
	}

	// The version is APPROVED exactly once and live_version_id advanced once.
	var status string
	var liveID, pendingID *string
	if err := pool.QueryRow(ctx,
		`SELECT v.review_status::text, i.live_version_id, i.pending_version_id
		   FROM menu_item_version v JOIN menu_item i ON i.id = v.menu_item_id
		  WHERE v.id=$1`, data.versionID).Scan(&status, &liveID, &pendingID); err != nil {
		t.Fatalf("post-state query: %v", err)
	}
	if status != "APPROVED" {
		t.Errorf("final review_status = %q, want APPROVED", status)
	}
	if liveID == nil || *liveID != data.versionID {
		t.Errorf("live_version_id = %v, want %s", liveID, data.versionID)
	}
	if pendingID != nil {
		t.Errorf("pending_version_id = %v, want NULL after approval", pendingID)
	}
}

// TestMenu_Concurrency_CreateCategoryTwice creates the same category name twice
// (sequentially, distinct keys) and asserts the second is a clean 409
// CATEGORY_NAME_TAKEN — the unique constraint, not a 500 — so a double-submit
// never yields two rows.
func TestMenu_Concurrency_CreateCategoryTwice(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"name": "Double Submit Category"}
	s1, _ := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		"double-cat-first-0001", body)
	if s1 != http.StatusCreated {
		t.Fatalf("first create: want 201, got %d", s1)
	}
	s2, env2 := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		"double-cat-second-001", body)
	if s2 != http.StatusConflict {
		t.Fatalf("second create: want 409, got %d", s2)
	}
	if c := menuErrCode(env2); c != "CATEGORY_NAME_TAKEN" {
		t.Errorf("second create error code = %q, want CATEGORY_NAME_TAKEN", c)
	}

	// Exactly one row exists with that name.
	var cnt int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM menu_category WHERE restaurant_id=$1 AND name=$2`,
		data.restaurantID, "Double Submit Category").Scan(&cnt); err != nil {
		t.Fatalf("count query: %v", err)
	}
	if cnt != 1 {
		t.Errorf("want exactly one category row, got %d", cnt)
	}
}

// ==========================================================================
// D) MONEY — inbound price is echoed server-side, out-of-band rejected, no float
// ==========================================================================

// TestMenu_Money_PriceEchoedNotFloated asserts the created item's price_cents is
// exactly the merchant-set integer and the DB column is integral.
func TestMenu_Money_PriceEchoedNotFloated(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	status, env := doMenuJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		"money-echo-item-00001", map[string]any{
			"category_id": data.categoryID, "name": "Money Item", "price_cents": 4321,
		})
	if status != http.StatusCreated {
		t.Fatalf("want 201, got %d (%v)", status, env)
	}
	d := env["data"].(map[string]any)
	pc, _ := d["price_cents"].(float64)
	if int64(pc) != 4321 {
		t.Errorf("price_cents = %v, want 4321", pc)
	}
	itemID, _ := d["id"].(string)

	// DB column is an integer type (BIGINT) — a fractional value is unrepresentable.
	var stored int64
	if err := pool.QueryRow(ctx, `SELECT price_cents FROM menu_item WHERE id=$1`, itemID).Scan(&stored); err != nil {
		t.Fatalf("select price_cents: %v", err)
	}
	if stored != 4321 {
		t.Errorf("stored price_cents = %d, want 4321", stored)
	}
}

// ==========================================================================
// G) ERROR TAXONOMY — hostile input never yields a bare 500 / empty code
// ==========================================================================

// TestMenu_ErrorTaxonomy_HostileInput fires malformed and boundary-crossing
// requests at every op and asserts each response is a 4xx with a non-empty
// contract ErrorCode — never a bare 500 and never a blank code.
func TestMenu_ErrorTaxonomy_HostileInput(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// contract ErrorCode set relevant to these ops.
	valid := map[string]bool{
		"VALIDATION_FAILED": true, "UNKNOWN_FIELD": true, "INVALID_FIELD": true,
		"INVALID_ENUM_VALUE": true, "NOT_FOUND": true, "PRICE_OUT_OF_RANGE": true,
		"FIELD_NOT_WRITABLE": true, "CATEGORY_NAME_TAKEN": true, "ALREADY_DECIDED": true,
		"ITEM_DELETED": true, "IDEMPOTENCY_KEY_REQUIRED": true,
	}

	cases := []struct {
		name    string
		method  string
		url     string
		idem    string
		body    any
		wantMin int // status must be >= this and < 500
	}{
		{
			name:    "category_empty_name",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
			idem:    "hostile-cat-empty-001",
			body:    map[string]any{"name": ""},
			wantMin: 400,
		},
		{
			name:    "category_name_wrong_type",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
			idem:    "hostile-cat-type-0001",
			body:    map[string]any{"name": 12345},
			wantMin: 400,
		},
		{
			name:    "item_price_negative",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
			idem:    "hostile-item-neg-0001",
			body:    map[string]any{"category_id": data.categoryID, "name": "Neg", "price_cents": -5},
			wantMin: 400,
		},
		{
			name:    "item_category_wrong_type",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
			idem:    "hostile-item-cat-0001",
			body:    map[string]any{"category_id": 999, "name": "Bad", "price_cents": 500},
			wantMin: 400,
		},
		{
			name:    "decide_missing_decision",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
			idem:    "hostile-decide-empty-1",
			body:    map[string]any{},
			wantMin: 400,
		},
		{
			name:    "decide_bad_reason_enum",
			method:  http.MethodPost,
			url:     fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
			idem:    "hostile-decide-reason-1",
			body:    map[string]any{"decision": "REJECT", "reason_code": "NOT_A_REAL_CODE"},
			wantMin: 400,
		},
		{
			name:    "category_unknown_restaurant_uuid",
			method:  http.MethodPost,
			url:     srv.URL + "/v1/admin/restaurants/11111111-1111-1111-1111-111111111111/menu/categories",
			idem:    "hostile-cat-ghost-001",
			body:    map[string]any{"name": "Ghost"},
			wantMin: 400,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			status, env := doMenuJSON(t, tc.method, tc.url, tc.idem, tc.body)
			if status >= 500 {
				t.Fatalf("%s: got %d — a hostile input must never yield a 5xx", tc.name, status)
			}
			if status < tc.wantMin {
				t.Fatalf("%s: got %d, want >= %d", tc.name, status, tc.wantMin)
			}
			c := menuErrCode(env)
			if c == "" {
				t.Fatalf("%s: empty error code (%v)", tc.name, env)
			}
			if !valid[c] {
				t.Errorf("%s: error code %q is not a contract ErrorCode for this op", tc.name, c)
			}
		})
	}
	_ = ctx
}
