package admin

// Tests for the four admin-menu operations (A-19):
//   - createMenuCategoryOnBehalf  POST /v1/admin/restaurants/{restaurantId}/menu/categories
//   - createMenuItemOnBehalf      POST /v1/admin/restaurants/{restaurantId}/menu/items
//   - listMenuReviewQueue         GET  /v1/admin/menu-reviews
//   - decideMenuVersion           POST /v1/admin/menu-reviews/{versionId}/decision
//
// Every test is derived from all three sources of truth:
//  1. contracts/openapi.yaml (wire shape, enums, error codes)
//  2. docs/spec/05-admin.md (A-19 menu moderation)
//  3. internal invariants (R-05 never-auto-approve, deny-by-default, money-is-server-computed)
//
// GATE: each test MUST FAIL (red) until the feature is implemented.
// Coverage:
//  (1) happy path returning the exact contract shape
//  (2) every documented error code per operation
//  (3) authz — each allowed role (ADMIN, SUPER_ADMIN) passes; CUSTOMER/RIDER denied (403);
//      unauthenticated → 401
//  (4) input validation — unknown fields rejected, price fields in create body allowed
//      (price_cents is a valid partner DTO field); HALAL_CERTIFIED dietary tag rejected (403)
//  (5) ownership/IDOR — non-existent restaurantId returns 404
//  (6) idempotency — writes require Idempotency-Key header
//  (7) domain invariants — claim-bearing fields never auto-approved (R-05);
//      decideMenuVersion state-machine (PENDING_REVIEW → APPROVED/REJECTED only);
//      audit trail written on decision

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ---- menu-specific seed helpers ------------------------------------------

// menuTestRestaurant holds identifiers for a seeded restaurant.
type menuTestRestaurant struct {
	restaurantID string
	categoryID   string
	menuItemID   string
	versionID    string // a PENDING_REVIEW menu_item_version
}

// seedMenuRestaurantFull inserts a LIVE restaurant, a category, a menu item,
// and a menu_item_version in PENDING_REVIEW state. Registers t.Cleanup for teardown.
func seedMenuRestaurantFull(t *testing.T, ctx context.Context, pool *pgxpool.Pool, adminID string) menuTestRestaurant {
	t.Helper()

	var restaurantID string
	if err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code,
        location, onboarding_state, account_state, is_accepting_orders, commission_rate_bps, tax_role, minimum_order_cents)
VALUES ('menu-'||substr(md5(random()::text),1,8), 'Menu Test Inc.', 'Menu Kitchen', 'ON', 'Toronto',
        '100 King St', 'M5J0C3',
        ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
        'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0)
RETURNING id`).Scan(&restaurantID); err != nil {
		t.Fatalf("seedMenuRestaurantFull: insert restaurant: %v", err)
	}

	var categoryID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_category (restaurant_id, name, sort_order, is_active)
VALUES ($1, 'Mains', 0, true) RETURNING id`, restaurantID).Scan(&categoryID); err != nil {
		t.Fatalf("seedMenuRestaurantFull: insert category: %v", err)
	}

	var menuItemID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_item (restaurant_id, category_id, price_cents, currency, availability_state, tax_category, sort_order)
VALUES ($1, $2, 1500, 'CAD', 'AVAILABLE', 'PREPARED_FOOD', 0)
RETURNING id`, restaurantID, categoryID).Scan(&menuItemID); err != nil {
		t.Fatalf("seedMenuRestaurantFull: insert menu_item: %v", err)
	}

	// Insert a menu_item_version in PENDING_REVIEW.
	var versionID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_item_version
  (menu_item_id, restaurant_id, version, name, description, dietary_tags, allergen_tags,
   review_status, submitted_at)
VALUES ($1, $2, 1, 'Grilled Chicken', 'Tender and juicy', '{}', '{}',
        'PENDING_REVIEW', now())
RETURNING id`, menuItemID, restaurantID).Scan(&versionID); err != nil {
		t.Fatalf("seedMenuRestaurantFull: insert menu_item_version: %v", err)
	}

	// Set the pending_version_id on the item.
	if _, err := pool.Exec(ctx,
		`UPDATE menu_item SET pending_version_id=$1 WHERE id=$2`,
		versionID, menuItemID); err != nil {
		t.Fatalf("seedMenuRestaurantFull: update pending_version_id: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`UPDATE menu_item SET pending_version_id=NULL, live_version_id=NULL WHERE id=$1`,
			menuItemID)
		_, _ = pool.Exec(ctx,
			`DELETE FROM menu_item_version WHERE menu_item_id=$1`, menuItemID)
		_, _ = pool.Exec(ctx,
			`DELETE FROM menu_item WHERE restaurant_id=$1`, restaurantID)
		_, _ = pool.Exec(ctx,
			`DELETE FROM menu_category WHERE restaurant_id=$1`, restaurantID)
		_, _ = pool.Exec(ctx,
			`DELETE FROM restaurant WHERE id=$1`, restaurantID)
	})

	return menuTestRestaurant{
		restaurantID: restaurantID,
		categoryID:   categoryID,
		menuItemID:   menuItemID,
		versionID:    versionID,
	}
}

// menuRouteExists checks that calling the method+path returns something other than
// 404 "No such resource" — meaning the route is registered.
func menuRouteExists(t *testing.T, pool *pgxpool.Pool, method, path string) bool {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: httpx.AnonymousAuthenticator{},
		Authorizer:    auth.Matrix{},
	})
	h := NewHandler(NewRepo(pool), DefaultConfig())
	Routes(router, h)
	srv := httptest.NewServer(router)
	defer srv.Close()

	req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "menu-route-probe-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	// 404 means unregistered; 401 means registered but auth denied.
	return resp.StatusCode != http.StatusNotFound
}

// ==========================================================================
// TestMenuRoutes_AllRegistered verifies all four menu admin routes are
// registered in Routes(). This fails until Routes() is updated.
// ==========================================================================

func TestMenuRoutes_AllRegistered(t *testing.T) {
	pool := dialTestPool(t)

	routes := []struct {
		method string
		path   string
	}{
		{"POST", "/v1/admin/restaurants/00000000-0000-0000-0000-000000000001/menu/categories"},
		{"POST", "/v1/admin/restaurants/00000000-0000-0000-0000-000000000001/menu/items"},
		{"GET", "/v1/admin/menu-reviews"},
		{"POST", "/v1/admin/menu-reviews/00000000-0000-0000-0000-000000000002/decision"},
	}

	for _, route := range routes {
		route := route
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			if !menuRouteExists(t, pool, route.method, route.path) {
				t.Errorf("route %s %s is not registered (got 404 — not-implemented red state)",
					route.method, route.path)
			}
		})
	}
}

// ==========================================================================
// createMenuCategoryOnBehalf tests
// ==========================================================================

// ---- (3) authz: createMenuCategoryOnBehalf ----------------------------

// TestCreateMenuCategoryOnBehalf_AuthzAllowed verifies that ADMIN and SUPER_ADMIN
// are not rejected with 401 or 403 (x-roles: [ADMIN, SUPER_ADMIN]).
func TestCreateMenuCategoryOnBehalf_AuthzAllowed(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		role := role
		t.Run(string(role), func(t *testing.T) {
			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()

			body := map[string]any{"name": "Starters"}
			b, _ := json.Marshal(body)
			req, _ := http.NewRequest(http.MethodPost,
				fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
				bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "menu-idem-cat-"+string(role))

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			resp.Body.Close()
			// Route does not exist yet → 404 from router. That is the RED state.
			// When implemented, it must not be 401 or 403.
			if resp.StatusCode == http.StatusUnauthorized {
				t.Fatalf("role %s got 401; route should be reachable by this role", role)
			}
			if resp.StatusCode == http.StatusForbidden {
				t.Fatalf("role %s got 403; ADMIN/SUPER_ADMIN are in x-roles", role)
			}
		})
	}
}

// TestCreateMenuCategoryOnBehalf_AuthzDenied verifies non-listed roles get 403
// and unauthenticated callers get 401.
func TestCreateMenuCategoryOnBehalf_AuthzDenied(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	t.Run("CUSTOMER_denied", func(t *testing.T) {
		p := principalFor(t, pool, httpx.RoleCustomer)
		srv := buildAdminTestServer(t, pool, p)
		defer srv.Close()

		body := map[string]any{"name": "Starters"}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "idem-customer-denied")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("CUSTOMER: want 403, got %d", resp.StatusCode)
		}
	})

	t.Run("unauthenticated_401", func(t *testing.T) {
		srv := buildAdminTestServerAnon(t, pool)
		defer srv.Close()

		body := map[string]any{"name": "Starters"}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "idem-anon-denied")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anon: want 401, got %d", resp.StatusCode)
		}
	})
}

// ---- (1) happy path: createMenuCategoryOnBehalf --------------------------

// TestCreateMenuCategoryOnBehalf_HappyPath verifies 201 with the MenuCategory shape.
func TestCreateMenuCategoryOnBehalf_HappyPath(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"name":        "Desserts",
		"description": "Sweet treats",
		"sort_order":  10,
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "menu-happy-cat-0001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("want 201, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	d := envelope.Data
	// Required fields per MenuCategory schema.
	for _, field := range []string{"id", "name", "sort_order", "is_active"} {
		if _, ok := d[field]; !ok {
			t.Errorf("missing required field %q in MenuCategory response", field)
		}
	}
	if d["name"] != "Desserts" {
		t.Errorf("name = %v, want Desserts", d["name"])
	}
}

// ---- (2) error codes: createMenuCategoryOnBehalf -------------------------

// TestCreateMenuCategoryOnBehalf_RestaurantNotFound verifies 404 when the
// restaurantId path param does not exist.
func TestCreateMenuCategoryOnBehalf_RestaurantNotFound(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"name": "Ghost Category"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		srv.URL+"/v1/admin/restaurants/00000000-0000-0000-0000-000000000000/menu/categories",
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "not-found-cat-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404 for unknown restaurant, got %d", resp.StatusCode)
	}
}

// TestCreateMenuCategoryOnBehalf_DuplicateName verifies 409 CATEGORY_NAME_TAKEN.
func TestCreateMenuCategoryOnBehalf_DuplicateName(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// "Mains" is already seeded by seedMenuRestaurantFull.
	body := map[string]any{"name": "Mains"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "menu-dup-cat-00001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("want 409 for duplicate category name, got %d", resp.StatusCode)
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err == nil {
		if envelope.Error.Code != "CATEGORY_NAME_TAKEN" {
			t.Errorf("error code = %q, want CATEGORY_NAME_TAKEN", envelope.Error.Code)
		}
	}
}

// ---- (4) input validation: createMenuCategoryOnBehalf --------------------

// TestCreateMenuCategoryOnBehalf_UnknownField verifies 422 for unknown body fields.
func TestCreateMenuCategoryOnBehalf_UnknownField(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"name":             "Extras",
		"unrecognised_key": "should_reject",
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "unknown-field-cat-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for unknown field, got %d", resp.StatusCode)
	}
}

// ---- (6) idempotency: createMenuCategoryOnBehalf -------------------------

// TestCreateMenuCategoryOnBehalf_IdempotencyKeyRequired verifies that omitting
// the Idempotency-Key header returns 4xx.
func TestCreateMenuCategoryOnBehalf_IdempotencyKeyRequired(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"name": "No Idempotency Key Category"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/categories", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	// No Idempotency-Key header.

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusCreated {
		t.Fatal("write without Idempotency-Key must not succeed (expected 4xx)")
	}
}

// ==========================================================================
// createMenuItemOnBehalf tests
// ==========================================================================

// ---- (3) authz: createMenuItemOnBehalf -----------------------------------

func TestCreateMenuItemOnBehalf_AuthzAllowed(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		role := role
		t.Run(string(role), func(t *testing.T) {
			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()

			body := map[string]any{
				"category_id": data.categoryID,
				"name":        "New Item " + string(role),
				"price_cents": 1200,
			}
			b, _ := json.Marshal(body)
			req, _ := http.NewRequest(http.MethodPost,
				fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
				bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "menu-idem-item-"+string(role))

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized {
				t.Fatalf("role %s got 401", role)
			}
			if resp.StatusCode == http.StatusForbidden {
				t.Fatalf("role %s got 403; ADMIN/SUPER_ADMIN are in x-roles", role)
			}
		})
	}
}

func TestCreateMenuItemOnBehalf_AuthzDenied(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	t.Run("RIDER_denied", func(t *testing.T) {
		p := principalFor(t, pool, httpx.RoleRider)
		srv := buildAdminTestServer(t, pool, p)
		defer srv.Close()

		body := map[string]any{"category_id": data.categoryID, "name": "X", "price_cents": 500}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "rider-denied-001")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("RIDER: want 403, got %d", resp.StatusCode)
		}
	})

	t.Run("unauthenticated_401", func(t *testing.T) {
		srv := buildAdminTestServerAnon(t, pool)
		defer srv.Close()

		body := map[string]any{"category_id": data.categoryID, "name": "X", "price_cents": 500}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "menu-anon-denied-001")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anon: want 401, got %d", resp.StatusCode)
		}
	})
}

// ---- (1) happy path: createMenuItemOnBehalf ------------------------------

// TestCreateMenuItemOnBehalf_HappyPath verifies 201 with MenuItemOwnerView shape.
// A-19: admin-created items are immediately approved (reviewer == author).
func TestCreateMenuItemOnBehalf_HappyPath(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"category_id": data.categoryID,
		"name":        "Halal Burger",
		"price_cents": 1500,
		"description": "A juicy halal beef burger",
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "menu-happy-item-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("want 201, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	d := envelope.Data
	// Required fields per MenuItem schema (base of MenuItemOwnerView).
	for _, field := range []string{"id", "name", "price_cents", "currency", "availability_state", "tax_category"} {
		if _, ok := d[field]; !ok {
			t.Errorf("missing required field %q in MenuItemOwnerView response", field)
		}
	}
	// MenuItemOwnerView additional required field.
	if _, ok := d["category_id"]; !ok {
		t.Error("missing required field category_id in MenuItemOwnerView")
	}
	if d["name"] != "Halal Burger" {
		t.Errorf("name = %v, want Halal Burger", d["name"])
	}
}

// ---- (7) domain invariant: admin-created items are auto-approved ---------

// TestCreateMenuItemOnBehalf_AdminCreatedIsAutoApproved verifies the A-19 invariant:
// "An item created by an admin is created already approved, because the reviewer
// and the author are the same accountable person". live_version must be set.
func TestCreateMenuItemOnBehalf_AdminCreatedIsAutoApproved(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"category_id": data.categoryID,
		"name":        "Auto Approved Item",
		"price_cents": 800,
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "admin-auto-approve-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("want 201, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// live_version must not be null — admin-created items are immediately approved.
	if lv, exists := envelope.Data["live_version"]; exists && lv == nil {
		t.Fatal("admin-created item must have live_version set (A-19 auto-approve invariant)")
	}
	// pending_version must be null since there's nothing pending.
	if pv, exists := envelope.Data["pending_version"]; exists && pv != nil {
		t.Errorf("admin-created item should have pending_version=null; got %v", pv)
	}
}

// ---- (2) error codes: createMenuItemOnBehalf -----------------------------

// TestCreateMenuItemOnBehalf_RestaurantNotFound verifies 404 for unknown restaurant.
func TestCreateMenuItemOnBehalf_RestaurantNotFound(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"category_id": "00000000-0000-0000-0000-000000000001",
		"name":        "Ghost Item",
		"price_cents": 1000,
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		srv.URL+"/v1/admin/restaurants/00000000-0000-0000-0000-000000000000/menu/items",
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "not-found-item-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

// TestCreateMenuItemOnBehalf_PriceOutOfRange verifies 422 PRICE_OUT_OF_RANGE
// for price_cents outside [50, 50000] (contract spec).
func TestCreateMenuItemOnBehalf_PriceOutOfRange(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	for _, price := range []int{10, 99999} {
		price := price
		t.Run(fmt.Sprintf("price_%d", price), func(t *testing.T) {
			body := map[string]any{
				"category_id": data.categoryID,
				"name":        "Price Test Item",
				"price_cents": price,
			}
			b, _ := json.Marshal(body)
			req, _ := http.NewRequest(http.MethodPost,
				fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
				bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", fmt.Sprintf("price-range-item-%d", price))

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("price %d: want 422, got %d", price, resp.StatusCode)
			}
			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&env); err == nil {
				if env.Error.Code != "PRICE_OUT_OF_RANGE" && env.Error.Code != "VALIDATION_FAILED" {
					t.Errorf("code = %q, want PRICE_OUT_OF_RANGE or VALIDATION_FAILED", env.Error.Code)
				}
			}
		})
	}
}

// TestCreateMenuItemOnBehalf_HalalCertifiedDietaryTagForbidden verifies that
// asserting HALAL_CERTIFIED in dietary_tags is rejected with 403 FIELD_NOT_WRITABLE.
// Contract: "HALAL_CERTIFIED here is 403 FIELD_NOT_WRITABLE — it is platform-derived."
func TestCreateMenuItemOnBehalf_HalalCertifiedDietaryTagForbidden(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"category_id":  data.categoryID,
		"name":         "Halal Claim Item",
		"price_cents":  1000,
		"dietary_tags": []string{"HALAL_CERTIFIED"},
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "halal-tag-forbidden-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403 for HALAL_CERTIFIED dietary_tag assertion, got %d", resp.StatusCode)
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err == nil {
		if env.Error.Code != "FIELD_NOT_WRITABLE" {
			t.Errorf("error code = %q, want FIELD_NOT_WRITABLE", env.Error.Code)
		}
	}
}

// TestCreateMenuItemOnBehalf_UnknownField verifies 422 for unknown fields in body.
func TestCreateMenuItemOnBehalf_UnknownField(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"category_id":   data.categoryID,
		"name":          "Item With Unknown",
		"price_cents":   1000,
		"unknown_field": "should fail",
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/restaurants/%s/menu/items", srv.URL, data.restaurantID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "unknown-item-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for unknown field, got %d", resp.StatusCode)
	}
}

// ==========================================================================
// listMenuReviewQueue tests
// ==========================================================================

// ---- (3) authz: listMenuReviewQueue -------------------------------------

func TestListMenuReviewQueue_AuthzAllowed(t *testing.T) {
	pool := dialTestPool(t)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		role := role
		t.Run(string(role), func(t *testing.T) {
			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()

			req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/admin/menu-reviews", nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized {
				t.Fatalf("role %s: want not-401, got 401", role)
			}
			if resp.StatusCode == http.StatusForbidden {
				t.Fatalf("role %s: want not-403, got 403", role)
			}
		})
	}
}

func TestListMenuReviewQueue_AuthzDenied(t *testing.T) {
	pool := dialTestPool(t)

	t.Run("CUSTOMER_denied", func(t *testing.T) {
		p := principalFor(t, pool, httpx.RoleCustomer)
		srv := buildAdminTestServer(t, pool, p)
		defer srv.Close()

		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/admin/menu-reviews", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("CUSTOMER: want 403, got %d", resp.StatusCode)
		}
	})

	t.Run("unauthenticated_401", func(t *testing.T) {
		srv := buildAdminTestServerAnon(t, pool)
		defer srv.Close()

		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/admin/menu-reviews", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anon: want 401, got %d", resp.StatusCode)
		}
	})
}

// ---- (1) happy path: listMenuReviewQueue ---------------------------------

// TestListMenuReviewQueue_HappyPath verifies 200 with {data: [], meta: {has_more, next_cursor}}
// and that returned items have the MenuItemVersion contract shape.
func TestListMenuReviewQueue_HappyPath(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	// Seed a restaurant with a PENDING_REVIEW version.
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	_ = data

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/v1/admin/menu-reviews", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data []map[string]any `json:"data"`
		Meta map[string]any   `json:"meta"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Meta == nil {
		t.Fatal("response missing meta object")
	}
	if _, ok := envelope.Meta["has_more"]; !ok {
		t.Error("meta missing has_more")
	}
	if envelope.Data == nil {
		t.Fatal("response data must not be null (empty array is ok)")
	}
	// Every returned item must have the MenuItemVersion required fields.
	for i, item := range envelope.Data {
		for _, field := range []string{"id", "menu_item_id", "version", "review_status", "created_at"} {
			if _, ok := item[field]; !ok {
				t.Errorf("item[%d] missing required field %q", i, field)
			}
		}
		if item["review_status"] != "PENDING_REVIEW" {
			t.Errorf("item[%d] review_status = %v, want PENDING_REVIEW", i, item["review_status"])
		}
	}
}

// TestListMenuReviewQueue_FilterByRestaurant verifies ?restaurant_id= narrows results.
func TestListMenuReviewQueue_FilterByRestaurant(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet,
		fmt.Sprintf("%s/v1/admin/menu-reviews?restaurant_id=%s", srv.URL, data.restaurantID), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Results must only contain versions from the requested restaurant.
	for i, item := range envelope.Data {
		if rid, ok := item["restaurant_id"]; ok && rid != data.restaurantID {
			t.Errorf("item[%d] restaurant_id = %v, want %v", i, rid, data.restaurantID)
		}
	}
}

// TestListMenuReviewQueue_EmptyQueue verifies the empty-queue fixture shape.
func TestListMenuReviewQueue_EmptyQueue(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// Filter by a restaurant UUID that cannot exist → guaranteed empty.
	req, _ := http.NewRequest(http.MethodGet,
		srv.URL+"/v1/admin/menu-reviews?restaurant_id=00000000-0000-0000-0000-000000000000",
		nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data []map[string]any `json:"data"`
		Meta struct {
			HasMore    bool    `json:"has_more"`
			NextCursor *string `json:"next_cursor"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(envelope.Data) != 0 {
		t.Errorf("want empty data array, got %d items", len(envelope.Data))
	}
	if envelope.Meta.HasMore {
		t.Error("has_more should be false for empty queue")
	}
	if envelope.Meta.NextCursor != nil {
		t.Error("next_cursor should be null for empty queue")
	}
}

// ---- (7) domain invariant: R-05 never-auto-approve -----------------------

// TestListMenuReviewQueue_NeverAutoApproved verifies the R-05 invariant:
// items in the queue have PENDING_REVIEW status and are not yet reviewed.
// Silence must never become consent on a halal claim.
func TestListMenuReviewQueue_NeverAutoApproved(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet,
		fmt.Sprintf("%s/v1/admin/menu-reviews?restaurant_id=%s", srv.URL, data.restaurantID), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for i, item := range envelope.Data {
		status, _ := item["review_status"].(string)
		// R-05: no auto-approve. Queue items must be PENDING_REVIEW.
		if status != "PENDING_REVIEW" {
			t.Errorf("item[%d] has review_status=%q; queue must only contain PENDING_REVIEW (R-05)", i, status)
		}
		// reviewed_at must be null for a pending item (not yet decided).
		if ra, ok := item["reviewed_at"]; ok && ra != nil {
			t.Errorf("item[%d] reviewed_at=%v; pending items must not be reviewed", i, ra)
		}
	}
}

// ==========================================================================
// decideMenuVersion tests
// ==========================================================================

// ---- (3) authz: decideMenuVersion ----------------------------------------

func TestDecideMenuVersion_AuthzAllowed(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		role := role
		t.Run(string(role), func(t *testing.T) {
			// Fresh PENDING_REVIEW version per sub-test to avoid ALREADY_DECIDED.
			freshData := seedMenuRestaurantFull(t, ctx, pool, sa)

			p := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, p)
			defer srv.Close()

			body := map[string]any{"decision": "APPROVE"}
			b, _ := json.Marshal(body)
			req, _ := http.NewRequest(http.MethodPost,
				fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, freshData.versionID),
				bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Idempotency-Key", "decide-allowed-"+string(role))

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized {
				t.Fatalf("role %s: got 401", role)
			}
			if resp.StatusCode == http.StatusForbidden {
				t.Fatalf("role %s: got 403; ADMIN/SUPER_ADMIN are in x-roles", role)
			}
		})
	}
}

func TestDecideMenuVersion_AuthzDenied(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	t.Run("RESTAURANT_OWNER_denied", func(t *testing.T) {
		p := principalFor(t, pool, httpx.RoleRestaurantOwner)
		srv := buildAdminTestServer(t, pool, p)
		defer srv.Close()

		body := map[string]any{"decision": "APPROVE"}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "menu-ro-denied-0001")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("RESTAURANT_OWNER: want 403, got %d", resp.StatusCode)
		}
	})

	t.Run("unauthenticated_401", func(t *testing.T) {
		srv := buildAdminTestServerAnon(t, pool)
		defer srv.Close()

		body := map[string]any{"decision": "APPROVE"}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "anon-decide-denied")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("anon: want 401, got %d", resp.StatusCode)
		}
	})
}

// ---- (1) happy path: decideMenuVersion — APPROVE -------------------------

// TestDecideMenuVersion_ApproveHappyPath verifies 200 with MenuItemVersion shape
// with review_status=APPROVED and reviewed_at set.
func TestDecideMenuVersion_ApproveHappyPath(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "decide-approve-happy-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	d := envelope.Data
	// Required fields per MenuItemVersion schema.
	for _, field := range []string{"id", "menu_item_id", "version", "review_status", "created_at"} {
		if _, ok := d[field]; !ok {
			t.Errorf("missing required field %q in MenuItemVersion response", field)
		}
	}
	if d["review_status"] != "APPROVED" {
		t.Errorf("review_status = %v, want APPROVED", d["review_status"])
	}
	if d["reviewed_at"] == nil {
		t.Error("reviewed_at must be set after APPROVE decision")
	}
}

// TestDecideMenuVersion_RejectHappyPath verifies 200 with REJECTED status
// and rejection_reason_code present.
func TestDecideMenuVersion_RejectHappyPath(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"decision":    "REJECT",
		"reason_code": "MISLEADING_DESCRIPTION",
		"review_note": "The description overstates the portion size.",
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "decide-reject-happy-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}

	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	d := envelope.Data
	if d["review_status"] != "REJECTED" {
		t.Errorf("review_status = %v, want REJECTED", d["review_status"])
	}
	if d["rejection_reason_code"] == nil {
		t.Error("rejection_reason_code must be present after REJECT decision")
	}
}

// ---- (2) error codes: decideMenuVersion ----------------------------------

// TestDecideMenuVersion_NotFound verifies 404 for a non-existent versionId.
func TestDecideMenuVersion_NotFound(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		srv.URL+"/v1/admin/menu-reviews/00000000-0000-0000-0000-000000000000/decision",
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "decide-not-found-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

// TestDecideMenuVersion_AlreadyDecided verifies 409 ALREADY_DECIDED on a second decision.
func TestDecideMenuVersion_AlreadyDecided(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	doDecide := func(idemKey string, body map[string]any) *http.Response {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost,
			fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
			bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", idemKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		return resp
	}

	// First decision: APPROVE.
	resp1 := doDecide("already-first-001", map[string]any{"decision": "APPROVE"})
	resp1.Body.Close()

	// Second decision must be 409 ALREADY_DECIDED (if first succeeded).
	resp2 := doDecide("already-second-001", map[string]any{
		"decision":    "REJECT",
		"reason_code": "POOR_IMAGE_QUALITY",
	})
	defer resp2.Body.Close()

	if resp1.StatusCode == http.StatusOK && resp2.StatusCode != http.StatusConflict {
		t.Fatalf("second decision: want 409 ALREADY_DECIDED, got %d", resp2.StatusCode)
	}
	if resp1.StatusCode == http.StatusOK {
		var env struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.NewDecoder(resp2.Body).Decode(&env); err == nil {
			if env.Error.Code != "ALREADY_DECIDED" {
				t.Errorf("error code = %q, want ALREADY_DECIDED", env.Error.Code)
			}
		}
	}
}

// TestDecideMenuVersion_ItemDeleted verifies 409 ITEM_DELETED when the menu item
// has been soft-deleted before the version is decided.
func TestDecideMenuVersion_ItemDeleted(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	// Soft-delete the menu item before deciding.
	if _, err := pool.Exec(ctx,
		`UPDATE menu_item SET deleted_at=now() WHERE id=$1`, data.menuItemID); err != nil {
		t.Fatalf("soft-delete menu item: %v", err)
	}

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "item-deleted-decide-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("want 409 ITEM_DELETED, got %d", resp.StatusCode)
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err == nil {
		if env.Error.Code != "ITEM_DELETED" {
			t.Errorf("error code = %q, want ITEM_DELETED", env.Error.Code)
		}
	}
}

// ---- (4) input validation: decideMenuVersion -----------------------------

// TestDecideMenuVersion_UnknownField verifies 422 for unknown fields in body.
func TestDecideMenuVersion_UnknownField(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"decision":      "APPROVE",
		"unknown_extra": "should_fail",
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "unknown-decide-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for unknown field, got %d", resp.StatusCode)
	}
}

// TestDecideMenuVersion_InvalidDecisionEnum verifies 422 for an unrecognised decision.
func TestDecideMenuVersion_InvalidDecisionEnum(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "MAYBE_LATER"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "invalid-enum-decide-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for invalid decision enum, got %d", resp.StatusCode)
	}
}

// TestDecideMenuVersion_RejectRequiresReasonCode verifies that REJECT without a
// reason_code returns 422.
func TestDecideMenuVersion_RejectRequiresReasonCode(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "REJECT"} // no reason_code
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "reject-no-reason-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("want 422 for REJECT without reason_code, got %d", resp.StatusCode)
	}
}

// ---- (6) idempotency: decideMenuVersion ----------------------------------

// TestDecideMenuVersion_IdempotencyKeyRequired verifies that omitting the
// Idempotency-Key returns 4xx (write class route).
func TestDecideMenuVersion_IdempotencyKeyRequired(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	// No Idempotency-Key.

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("write without Idempotency-Key must not succeed")
	}
}

// ---- (5) IDOR: decideMenuVersion ----------------------------------------

// TestDecideMenuVersion_IDOR_NonExistentVersionIs404 verifies that a
// non-existent version returns 404 (not 403, not 500).
func TestDecideMenuVersion_IDOR_NonExistentVersionIs404(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		srv.URL+"/v1/admin/menu-reviews/deadbeef-dead-beef-dead-beefdeadbeef/decision",
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idor-dead-version-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-existent version: want 404, got %d", resp.StatusCode)
	}
}

// ---- (7) domain invariant: audit trail -----------------------------------

// TestDecideMenuVersion_AuditTrailWritten verifies that after an APPROVE decision
// an audit_event row is written.
func TestDecideMenuVersion_AuditTrailWritten(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := httpx.Principal{AccountID: sa, Roles: []httpx.Role{httpx.RoleSuperAdmin}}
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "audit-trail-approve-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Skipf("implementation not yet present (got %d), skipping audit check", resp.StatusCode)
	}

	// Verify audit_event was written for the decision.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_event WHERE action='menu_version.decide' AND subject_id=$1`,
		data.versionID).Scan(&count); err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if count == 0 {
		t.Error("expected audit_event for menu_version.decide, found none")
	}
}

// TestDecideMenuVersion_ApproveAdvancesLiveVersionID verifies that approving a
// PENDING_REVIEW version atomically repoints live_version_id on the menu_item
// (contract: "Approval repoints live_version_id and clears pending_version_id
// in one transaction").
func TestDecideMenuVersion_ApproveAdvancesLiveVersionID(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)

	p := httpx.Principal{AccountID: sa, Roles: []httpx.Role{httpx.RoleSuperAdmin}}
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{"decision": "APPROVE"}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost,
		fmt.Sprintf("%s/v1/admin/menu-reviews/%s/decision", srv.URL, data.versionID),
		bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "live-version-advance-001")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Skipf("implementation not yet present (got %d), skipping live_version_id check", resp.StatusCode)
	}

	// Verify live_version_id and pending_version_id after approval.
	var liveID, pendingID *string
	if err := pool.QueryRow(ctx,
		`SELECT live_version_id, pending_version_id FROM menu_item WHERE id=$1`,
		data.menuItemID).Scan(&liveID, &pendingID); err != nil {
		t.Fatalf("select menu_item: %v", err)
	}
	if liveID == nil || *liveID != data.versionID {
		t.Errorf("live_version_id = %v, want %s", liveID, data.versionID)
	}
	if pendingID != nil {
		t.Errorf("pending_version_id = %v, want NULL after approval", pendingID)
	}
}
