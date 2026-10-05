package admin

// Tests for the three admin-order operations:
//   - listOrdersAdmin   GET /v1/admin/orders
//   - getOrderAdmin     GET /v1/admin/orders/{orderId}
//   - cancelOrderAdmin  POST /v1/admin/orders/{orderId}/cancel
//
// Every test is derived from all three sources of truth:
//   1. contracts/openapi.yaml (wire shape, enums, error codes)
//   2. docs/spec/05-admin.md (A-38 order oversight)
//   3. internal invariants (state machine T11, money-zero-residual, deny-by-default)
//
// GATE: each test is expected to FAIL (red) until the feature is implemented.
// Tests guard against:
//   (1) happy path — contract shape
//   (2) every documented error code per operation
//   (3) authz — each allowed role passes, at least one non-listed role is denied,
//       unauthenticated → 401
//   (4) input validation — unknown fields rejected (DisallowUnknownFields), price
//       fields in cancel body rejected
//   (5) ownership/IDOR — another account's order returns 404, never their data
//   (6) idempotency — cancelOrderAdmin requires Idempotency-Key (MONEY class)
//   (7) domain invariants — T11 state machine legality, money-zero-residual

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// ---- test helpers --------------------------------------------------------

// buildAdminTestServer builds a httptest.Server with the admin routes
// registered under the real auth authorizer but a synthetic authenticator
// that injects the given principal.
func buildAdminTestServer(t *testing.T, pool *pgxpool.Pool, principal httpx.Principal) *httptest.Server {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: fixedPrincipalAuth{principal},
		Authorizer:    auth.Matrix{},
	})
	handler := NewHandler(NewRepo(pool), DefaultConfig())
	Routes(router, handler)
	return httptest.NewServer(router)
}

// buildAdminTestServerAnon builds a server where every caller is anonymous.
func buildAdminTestServerAnon(t *testing.T, pool *pgxpool.Pool) *httptest.Server {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: httpx.AnonymousAuthenticator{},
		Authorizer:    auth.Matrix{},
	})
	handler := NewHandler(NewRepo(pool), DefaultConfig())
	Routes(router, handler)
	return httptest.NewServer(router)
}

// fixedPrincipalAuth always returns the same principal, regardless of credentials.
type fixedPrincipalAuth struct{ p httpx.Principal }

func (f fixedPrincipalAuth) Authenticate(_ context.Context, _ *http.Request) (httpx.Principal, error) {
	return f.p, nil
}

// principalFor returns an authenticated Principal for the given role.
func principalFor(t *testing.T, pool *pgxpool.Pool, role httpx.Role) httpx.Principal {
	t.Helper()
	ctx := context.Background()
	var accountID string
	err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('test-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
		RETURNING id`).Scan(&accountID)
	if err != nil {
		t.Fatalf("seed principal account: %v", err)
	}
	scope := "GLOBAL"
	_, err = pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, $2, $3)`,
		accountID, string(role), scope)
	if err != nil {
		t.Fatalf("grant role %s: %v", role, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, accountID)
	})
	return httpx.Principal{AccountID: accountID, Roles: []httpx.Role{role}}
}

// orderTestBasics is the seeded data needed to create a real order for admin tests.
type orderTestBasics struct {
	accountID    string
	restaurantID string
	menuItemID   string
	addressID    string
}

// seedOrderBasics seeds an account, restaurant, menu item and address — enough
// to drive orders.Store through the real cart→quote→order flow. It registers a
// t.Cleanup that removes all rows in FK order.
func seedOrderBasics(t *testing.T, pool *pgxpool.Pool) orderTestBasics {
	t.Helper()
	ctx := context.Background()
	var b orderTestBasics

	// account
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('adm-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
		RETURNING id`).Scan(&b.accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// restaurant: LIVE + accepting + Ontario
	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (
			slug, legal_name, display_name, province, city, line1, postal_code,
			location, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps, tax_role, minimum_order_cents
		) VALUES (
			'adm-'||substr(md5(random()::text),1,8), 'Admin Test Co', 'Admin Kitchen', 'ON', 'Toronto', '1 King St', 'M5J0C3',
			ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
			'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0
		) RETURNING id`).Scan(&b.restaurantID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// menu category + item
	var categoryID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`,
		b.restaurantID).Scan(&categoryID); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		VALUES ($1, $2, 1500, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		b.restaurantID, categoryID).Scan(&b.menuItemID); err != nil {
		t.Fatalf("seed menu_item: %v", err)
	}

	// address in Ontario
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, b.accountID).Scan(&b.addressID); err != nil {
		t.Fatalf("seed address: %v", err)
	}

	testseed.CleanUpOrderFixtures(t, pool, b.accountID, b.restaurantID)
	// Certified through the real chain (an admin-verified certificate): the
	// order path refuses a restaurant the platform cannot vouch for.
	// https://github.com/shaiknoorullah/hg-mono/issues/292
	testseed.CertifyRestaurant(t, pool, b.restaurantID, 300)
	return b
}

// seedOrderForAdmin seeds a minimal real order via the orders.Store (preserving
// all FK constraints and the pricing_config_id), then force-updates the state to
// the desired state if it is not CREATED.
// Returns orderID and the customer accountID that owns it.
func seedOrderForAdmin(t *testing.T, pool *pgxpool.Pool, state string) (orderID, customerAccountID string) {
	t.Helper()
	ctx := context.Background()
	b := seedOrderBasics(t, pool)
	customerAccountID = b.accountID

	st := orders.NewStore(pool)

	// Add a menu item to the cart.
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		orders.CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("seed cart: %v", err)
	}

	// Create a quote.
	q, err := st.CreateQuote(ctx, orders.QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID,
		DeliveryAddressID: &b.addressID,
		Fulfilment:        "DELIVERY",
	})
	if err != nil {
		t.Fatalf("seed quote: %v", err)
	}

	// Create the order row (in CREATED state).
	var fresh *orders.Quote
	prepared, err := st.CreateOrder(ctx, orders.OrderInput{
		AccountID: b.accountID,
		QuoteID:   q.ID,
	}, &fresh)
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}
	orderID = prepared.OrderID

	// If the desired state is not CREATED, force-update it directly so we don't
	// need a full payment gateway. This is test-only: we reach directly into the
	// DB to set the state, preserve deadline invariants for non-terminal states,
	// and add a transition row.
	if state != "CREATED" {
		terminalStates := map[string]bool{
			"COMPLETED": true, "CANCELLED": true, "REJECTED": true, "FAILED": true, "RESOLVED": true,
		}
		var dlAt interface{} = time.Now().UTC().Add(30 * time.Minute)
		var dlAction interface{} = "EXPIRE_PAYMENT"
		if terminalStates[state] {
			dlAt = nil
			dlAction = nil
		}
		// For CANCELLED state we also need cancel_reason column set.
		if state == "CANCELLED" {
			_, err = pool.Exec(ctx, `
				UPDATE "order" SET state=$2, state_since=now(), deadline_at=$3, deadline_action=$4,
				                   cancelled_at=now(), cancel_reason='SUPPORT_CANCELLED'
				WHERE id=$1`, orderID, state, dlAt, dlAction)
		} else {
			_, err = pool.Exec(ctx, `
				UPDATE "order" SET state=$2, state_since=now(), deadline_at=$3, deadline_action=$4
				WHERE id=$1`, orderID, state, dlAt, dlAction)
		}
		if err != nil {
			t.Fatalf("force-set order state %s: %v", state, err)
		}
		_, _ = pool.Exec(ctx, `
			INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, reason)
			VALUES ($1, 'CREATED', $2, 'SYSTEM', 'seeded for admin test')`, orderID, state)
	}
	return orderID, customerAccountID
}

func doJSON(t *testing.T, method, url string, body any, extraHeaders map[string]string) *http.Response {
	t.Helper()
	var bodyReader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		bodyReader = bytes.NewReader(b)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return resp
}

func decodeBody(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	defer resp.Body.Close()
	return m
}

// =========================================================================
// listOrdersAdmin — GET /v1/admin/orders
// =========================================================================

// (1) happy path — SUPPORT_AGENT gets 200 with data/meta envelope
func TestListOrdersAdmin_HappyPath_SupportAgent(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	p := principalFor(t, pool, httpx.RoleSupportAgent)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	_ = orderID
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listOrdersAdmin: want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	_ = ctx
	// Contract requires data (array) and meta envelope.
	if _, ok := body["data"]; !ok {
		t.Error("listOrdersAdmin: response missing 'data' field")
	}
	if _, ok := body["meta"]; !ok {
		t.Error("listOrdersAdmin: response missing 'meta' field")
	}
}

// (1) happy path — ADMIN gets 200
func TestListOrdersAdmin_HappyPath_Admin(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listOrdersAdmin (ADMIN): want 200, got %d", resp.StatusCode)
	}
}

// (1) happy path — SUPER_ADMIN gets 200
func TestListOrdersAdmin_HappyPath_SuperAdmin(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listOrdersAdmin (SUPER_ADMIN): want 200, got %d", resp.StatusCode)
	}
}

// (1) happy path — OrderSummary shape has required fields
func TestListOrdersAdmin_ResponseShape(t *testing.T) {
	pool := dialTestPool(t)
	_, _ = seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	data, ok := body["data"].([]any)
	if !ok {
		t.Fatal("data must be an array")
	}
	if len(data) == 0 {
		t.Skip("no orders in DB; skipping shape check")
	}
	first, ok := data[0].(map[string]any)
	if !ok {
		t.Fatal("data items must be objects")
	}
	// Required fields from OrderSummary schema.
	for _, field := range []string{"id", "code", "state", "restaurant", "total_cents", "currency", "placed_at"} {
		if _, found := first[field]; !found {
			t.Errorf("OrderSummary missing required field %q", field)
		}
	}
}

// (3) authz — unauthenticated → 401
func TestListOrdersAdmin_Unauthenticated(t *testing.T) {
	pool := dialTestPool(t)
	srv := buildAdminTestServerAnon(t, pool)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated listOrdersAdmin: want 401, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	errBlock, _ := body["error"].(map[string]any)
	if errBlock["code"] != "AUTHENTICATION_REQUIRED" {
		t.Errorf("want AUTHENTICATION_REQUIRED, got %v", errBlock["code"])
	}
}

// (3) authz — CUSTOMER role → 403 FORBIDDEN
func TestListOrdersAdmin_CustomerForbidden(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleCustomer)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("customer listOrdersAdmin: want 403, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	errBlock, _ := body["error"].(map[string]any)
	if errBlock["code"] != "FORBIDDEN" {
		t.Errorf("want FORBIDDEN, got %v", errBlock["code"])
	}
}

// (3) authz — RESTAURANT_OWNER → 403
func TestListOrdersAdmin_RestaurantOwnerForbidden(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleRestaurantOwner)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("restaurant owner listOrdersAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (3) authz — RIDER → 403
func TestListOrdersAdmin_RiderForbidden(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleRider)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("rider listOrdersAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (1) query filters — state filter returns matching orders
func TestListOrdersAdmin_StateFilter(t *testing.T) {
	pool := dialTestPool(t)
	_, _ = seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders?state=CREATED", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("state filter: want 200, got %d", resp.StatusCode)
	}
}

// (1) meta contains has_more and next_cursor fields
func TestListOrdersAdmin_MetaShape(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	meta, ok := body["meta"].(map[string]any)
	if !ok {
		t.Fatal("meta must be an object")
	}
	if _, found := meta["has_more"]; !found {
		t.Error("meta missing has_more")
	}
}

// =========================================================================
// getOrderAdmin — GET /v1/admin/orders/{orderId}
// =========================================================================

// (1) happy path — SUPPORT_AGENT gets full admin view
func TestGetOrderAdmin_HappyPath_SupportAgent(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleSupportAgent)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getOrderAdmin (SUPPORT_AGENT): want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatal("data must be an object")
	}
	// OrderAdminView extends OrderCustomerView — check required customer fields.
	for _, field := range []string{"id", "code", "state", "restaurant", "lines", "money", "placed_at"} {
		if _, found := data[field]; !found {
			t.Errorf("OrderAdminView missing required field %q", field)
		}
	}
	// Admin-specific required fields from the spec.
	for _, field := range []string{"timeline", "payment", "refunds", "internal_money"} {
		if _, found := data[field]; !found {
			t.Errorf("OrderAdminView missing admin-required field %q", field)
		}
	}
}

// (1) happy path — ADMIN gets 200
func TestGetOrderAdmin_HappyPath_Admin(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getOrderAdmin (ADMIN): want 200, got %d", resp.StatusCode)
	}
}

// (1) happy path — SUPER_ADMIN gets 200
func TestGetOrderAdmin_HappyPath_SuperAdmin(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleSuperAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getOrderAdmin (SUPER_ADMIN): want 200, got %d", resp.StatusCode)
	}
}

// (2) 404 for unknown orderId
func TestGetOrderAdmin_NotFound(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	nonExistent := "00000000-0000-0000-0000-000000000001"
	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, nonExistent), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("getOrderAdmin (not found): want 404, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	errBlock, _ := body["error"].(map[string]any)
	if errBlock["code"] != "NOT_FOUND" {
		t.Errorf("want NOT_FOUND, got %v", errBlock["code"])
	}
}

// (2) 422 when reveal_pii=true but no justification
func TestGetOrderAdmin_RevealPiiWithoutJustification(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	url := fmt.Sprintf("%s/v1/admin/orders/%s?reveal_pii=true", srv.URL, orderID)
	resp := doJSON(t, http.MethodGet, url, nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("reveal_pii without justification: want 422, got %d", resp.StatusCode)
	}
}

// (3) authz — unauthenticated → 401
func TestGetOrderAdmin_Unauthenticated(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	srv := buildAdminTestServerAnon(t, pool)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated getOrderAdmin: want 401, got %d", resp.StatusCode)
	}
}

// (3) authz — CUSTOMER → 403
func TestGetOrderAdmin_CustomerForbidden(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleCustomer)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("customer getOrderAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (3) authz — RIDER → 403
func TestGetOrderAdmin_RiderForbidden(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleRider)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("rider getOrderAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (5) ownership/IDOR — admin can still see the order (no ownership restriction for admins)
// An order from a different customer is still visible to admin staff.
func TestGetOrderAdmin_AdminSeesAnyOrder(t *testing.T) {
	pool := dialTestPool(t)
	// Order belonging to customer1; admin principal is completely separate.
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	// The admin's own account ID is different from the order's customer_account_id.
	if p.AccountID == "" {
		t.Fatal("admin account not seeded")
	}
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin IDOR: admin should see any order, want 200 got %d", resp.StatusCode)
	}
}

// (5) IDOR guard — a non-existent order ID returns 404, not 403 (no data leak)
func TestGetOrderAdmin_IDORReturns404NotForbidden(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// A syntactically valid UUID that does not exist.
	resp := doJSON(t, http.MethodGet,
		fmt.Sprintf("%s/v1/admin/orders/00000000-dead-beef-cafe-000000000000", srv.URL), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden {
		t.Fatal("IDOR: must return 404 not 403 — 403 leaks order existence")
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("want 404, got %d", resp.StatusCode)
	}
}

// (7) domain invariant — pii_revealed field is present in the admin view
func TestGetOrderAdmin_PiiRevealedFieldPresent(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "COMPLETED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	data, _ := body["data"].(map[string]any)
	if _, found := data["pii_revealed"]; !found {
		t.Error("admin view must include pii_revealed field")
	}
	if data["pii_revealed"] != false {
		t.Error("pii_revealed must default to false when no justification was passed")
	}
}

// (7) money-zero-residual — internal_money fields present, ledger_residual_cents exposed
func TestGetOrderAdmin_InternalMoneyShape(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	data, _ := body["data"].(map[string]any)
	im, ok := data["internal_money"].(map[string]any)
	if !ok {
		t.Fatal("internal_money must be an object")
	}
	for _, f := range []string{"commission_cents", "restaurant_net_cents", "rider_earnings_cents", "platform_gross_cents", "currency"} {
		if _, found := im[f]; !found {
			t.Errorf("internal_money missing required field %q", f)
		}
	}
	// ledger_residual_cents is optional in schema but must be 0 for a non-terminal
	// order that has been captured; for a CREATED order without capture it may be absent.
}

// =========================================================================
// cancelOrderAdmin — POST /v1/admin/orders/{orderId}/cancel
// =========================================================================

// (6) idempotency — cancelOrderAdmin is MONEY class; must require Idempotency-Key
func TestCancelOrderAdmin_IdempotencyKeyRequired(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "PREPARING")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Customer request via support chat after acceptance.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	// Send without Idempotency-Key.
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("cancelOrderAdmin without Idempotency-Key: want 400, got %d", resp.StatusCode)
	}
	b := decodeBody(t, resp)
	errBlock, _ := b["error"].(map[string]any)
	if errBlock["code"] != "IDEMPOTENCY_KEY_REQUIRED" {
		t.Errorf("want IDEMPOTENCY_KEY_REQUIRED, got %v", errBlock["code"])
	}
}

// (1) happy path — SUPPORT_AGENT cancels a CREATED order (pre-acceptance — T3/T5)
func TestCancelOrderAdmin_HappyPath_SupportAgent_PreAcceptance(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleSupportAgent)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Customer contacted support and wants to cancel their order.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-support-agent-cancel-1234"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := json.Marshal(decodeBody(t, resp))
		t.Fatalf("cancelOrderAdmin (SUPPORT_AGENT, CREATED): want 200, got %d — %s", resp.StatusCode, b)
	}
	b := decodeBody(t, resp)
	data, _ := b["data"].(map[string]any)
	if data["state"] != "CANCELLED" {
		t.Errorf("want state CANCELLED, got %v", data["state"])
	}
}

// (1) happy path — ADMIN cancels a PREPARING order (post-acceptance T11).
// A post-acceptance order was captured on acceptance (invariant 5), so we seed
// a captured payment_intent + CAPTURE ledger batch: the cancel must post the
// refund reversal atomically. The reversal itself is asserted in detail by
// TestCancelOrderAdmin_PreparingPostsRefundAndLedgerReversal.
func TestCancelOrderAdmin_HappyPath_Admin_PostAcceptance(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedCapturedPreparingOrder(t, pool)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Admin is cancelling on behalf of customer after acceptance.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-admin-postaccept-cancel-5678"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := json.Marshal(decodeBody(t, resp))
		t.Fatalf("cancelOrderAdmin (ADMIN, PREPARING): want 200, got %d — %s", resp.StatusCode, b)
	}
	b := decodeBody(t, resp)
	data, _ := b["data"].(map[string]any)
	if data["state"] != "CANCELLED" {
		t.Errorf("want state CANCELLED, got %v", data["state"])
	}
}

// (2) 403 — SUPPORT_AGENT tries to cancel a post-acceptance order (A-38)
// After acceptance, only ADMIN / SUPER_ADMIN may cancel (T11 actor: support, admin, system).
// Wait — T11 does include ActorSupport. But the spec description says "Support agents
// may cancel before acceptance only; after acceptance they must escalate."
// So the handler must enforce this rule in addition to the state machine.
func TestCancelOrderAdmin_SupportAgentForbiddenPostAcceptance(t *testing.T) {
	pool := dialTestPool(t)
	// PREPARING = post-acceptance
	orderID, _ := seedOrderForAdmin(t, pool, "PREPARING")
	p := principalFor(t, pool, httpx.RoleSupportAgent)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Support agent trying to cancel after acceptance.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-support-postaccept-forbidden-9012"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("support agent post-acceptance cancel: want 403, got %d", resp.StatusCode)
	}
	b := decodeBody(t, resp)
	errBlock, _ := b["error"].(map[string]any)
	if errBlock["code"] != "FORBIDDEN" {
		t.Errorf("want FORBIDDEN, got %v", errBlock["code"])
	}
}

// (2) 409 — cancelling a terminal (COMPLETED) order
func TestCancelOrderAdmin_IllegalTransition_Terminal(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "COMPLETED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Trying to cancel an already completed order.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-illegal-transition-terminal"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("cancel COMPLETED order: want 409, got %d", resp.StatusCode)
	}
	b := decodeBody(t, resp)
	errBlock, _ := b["error"].(map[string]any)
	if errBlock["code"] != "ILLEGAL_TRANSITION" {
		t.Errorf("want ILLEGAL_TRANSITION, got %v", errBlock["code"])
	}
}

// (2) 404 — non-existent order
func TestCancelOrderAdmin_NotFound(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Cancelling an order that does not exist.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/00000000-0000-0000-0000-000000000001/cancel", srv.URL),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-not-found-cancel-3456"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cancel non-existent order: want 404, got %d", resp.StatusCode)
	}
}

// (3) authz — unauthenticated → 401
func TestCancelOrderAdmin_Unauthenticated(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	srv := buildAdminTestServerAnon(t, pool)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Anonymous user trying to cancel.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-anon-cancel-7890"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated cancelOrderAdmin: want 401, got %d", resp.StatusCode)
	}
}

// (3) authz — CUSTOMER → 403
func TestCancelOrderAdmin_CustomerForbidden(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleCustomer)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Customer trying to use admin cancel endpoint.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-customer-cancel-1111"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("customer cancelOrderAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (3) authz — RIDER → 403
func TestCancelOrderAdmin_RiderForbidden(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleRider)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Rider trying to use admin cancel endpoint.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-rider-cancel-2222"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("rider cancelOrderAdmin: want 403, got %d", resp.StatusCode)
	}
}

// (4) input validation — unknown fields rejected (DisallowUnknownFields)
func TestCancelOrderAdmin_UnknownFieldRejected(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// "price" is an example of a field that must never appear in inbound bodies.
	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Admin cancel with unknown field injected.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
		"price":       9999, // unknown field — must be rejected
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-unknown-field-3333"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("unknown field in cancel body: want 422, got %d", resp.StatusCode)
	}
}

// (4) input validation — price/amount field in body rejected (G-3 invariant)
func TestCancelOrderAdmin_PriceFieldRejected(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// "amount_cents" should not be allowed on this route (it is only allowed on issueRefund for GOODWILL).
	body := map[string]any{
		"reason_code":  "SUPPORT_CANCELLED",
		"reason_text":  "Cancel with an injected amount_cents — must be rejected.",
		"case_id":      "00000000-0000-0000-0000-000000000099",
		"amount_cents": 5000, // should be rejected as unknown field (G-3)
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-amount-field-4444"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("amount_cents in cancel body: want 422, got %d", resp.StatusCode)
	}
}

// (4) input validation — required fields missing
func TestCancelOrderAdmin_MissingRequiredFields(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	// Missing reason_text and case_id.
	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-missing-fields-5555"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("missing required fields: want 422, got %d", resp.StatusCode)
	}
}

// (4) input validation — reason_text too short (minLength: 10)
func TestCancelOrderAdmin_ReasonTextTooShort(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Short", // < 10 characters
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-short-reason-6666"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("reason_text too short: want 422, got %d", resp.StatusCode)
	}
}

// (5) IDOR — non-existent order → 404, not 403
func TestCancelOrderAdmin_IDORReturns404(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Admin cancel of someone else's order id.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/00000000-dead-beef-cafe-000000000000/cancel", srv.URL),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-idor-cancel-7777"},
	)
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden {
		t.Fatal("IDOR: must return 404, not 403 — 403 leaks order existence")
	}
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("IDOR cancel: want 404, got %d", resp.StatusCode)
	}
}

// (6) idempotency — re-sending the same Idempotency-Key on a cancelled order must
// not double-cancel. The order should remain CANCELLED (idempotent replay).
// NOTE: full P-37 replay deduplication is noted as TODO in the codebase; this test
// asserts at minimum that re-sending does not corrupt money (409 or 200 both acceptable).
func TestCancelOrderAdmin_IdempotentReplay(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Admin cancelling an order; testing idempotent replay.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	headers := map[string]string{"Idempotency-Key": "test-idem-key-replay-cancel-8888"}

	// First request — should succeed.
	resp1 := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body, headers)
	defer resp1.Body.Close()
	if resp1.StatusCode != http.StatusOK {
		b, _ := json.Marshal(decodeBody(t, resp1))
		t.Fatalf("first cancel: want 200, got %d — %s", resp1.StatusCode, b)
	}

	// Second request with the same Idempotency-Key — must not corrupt state.
	resp2 := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body, headers)
	defer resp2.Body.Close()
	// Accept either 200 (replayed) or 409 (transition refused on already-cancelled).
	if resp2.StatusCode != http.StatusOK && resp2.StatusCode != http.StatusConflict {
		t.Fatalf("idempotent replay: want 200 or 409, got %d", resp2.StatusCode)
	}

	// The order must still be CANCELLED — not double-cancelled or corrupted.
	ctx := context.Background()
	var state string
	_ = pool.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state)
	if state != "CANCELLED" {
		t.Errorf("after idempotent replay, order must be CANCELLED, got %s", state)
	}
}

// (7) state-machine invariant — CANCELLED order cannot be cancelled again (T11 is one-way)
func TestCancelOrderAdmin_StateMachineCancelledIsTerminal(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CANCELLED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Attempting to re-cancel an already cancelled order.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-terminal-cancel-9999"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("cancel already-CANCELLED: want 409 ILLEGAL_TRANSITION, got %d", resp.StatusCode)
	}
}

// (7) money-zero-residual — the cancel response includes internal_money with
// no negative ledger residual after cancellation.
func TestCancelOrderAdmin_MoneyZeroResidual(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Checking money zero residual after admin cancellation.",
		"case_id":     "00000000-0000-0000-0000-000000000099",
	}
	resp := doJSON(t, http.MethodPost,
		fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body,
		map[string]string{"Idempotency-Key": "test-idem-key-money-zero-residual-aaaa"},
	)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("money zero residual: want 200, got %d", resp.StatusCode)
	}
	b := decodeBody(t, resp)
	data, _ := b["data"].(map[string]any)
	im, ok := data["internal_money"].(map[string]any)
	if !ok {
		// internal_money may be absent for pre-capture orders; that is acceptable.
		return
	}
	// If present, ledger_residual_cents must be 0 (invariant 6).
	if v, found := im["ledger_residual_cents"]; found {
		if n, _ := v.(float64); n != 0 {
			t.Errorf("money zero residual violated: ledger_residual_cents = %g, want 0", n)
		}
	}
}

// =========================================================================
// Routes policy test — admin orders routes must be registered correctly
// =========================================================================

// TestAdminOrderRoutesPolicy asserts that the new routes:
//  1. pass Verify() (have a valid policy with an action + class)
//  2. are not public (admin surface is never public)
//  3. cancelOrderAdmin is Idempotent (MONEY class enforcement)
func TestAdminOrderRoutesPolicy(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	if err := r.Verify(); err != nil {
		t.Fatalf("admin routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("admin routes must never be public, found: %v", pub)
	}

	// Ensure the new routes exist at all.
	registered := r.Routes()
	wantRoutes := []string{
		"GET /v1/admin/orders",
		"GET /v1/admin/orders/{orderId}",
		"POST /v1/admin/orders/{orderId}/cancel",
	}
	routeSet := make(map[string]bool, len(registered))
	for _, rr := range registered {
		routeSet[rr] = true
	}
	for _, want := range wantRoutes {
		if !routeSet[want] {
			t.Errorf("route %q is not registered", want)
		}
	}
}

// =========================================================================
// Unit tests — pure logic
// =========================================================================

// TestAdminOrderActions_InMatrix asserts that the action strings required by
// the admin-order operations (order.read_any and order.cancel_support) are
// present in the auth matrix for the three allowed roles.
// These strings are load-bearing: a mismatch between actions.go and matrix.go
// leaves the routes permanently 403.
func TestAdminOrderActions_InMatrix(t *testing.T) {
	m := auth.Matrix{}
	// order.read_any must be granted to SUPPORT_AGENT, ADMIN, SUPER_ADMIN.
	readAny := httpx.Action("order.read_any")
	cancelSupport := httpx.Action("order.cancel_support")
	for _, role := range []httpx.Role{httpx.RoleSupportAgent, httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		if !m.RoleHasAction([]httpx.Role{role}, readAny) {
			t.Errorf("role %s must have action %q", role, readAny)
		}
		if !m.RoleHasAction([]httpx.Role{role}, cancelSupport) {
			t.Errorf("role %s must have action %q", role, cancelSupport)
		}
	}
	// CUSTOMER must NOT have order.read_any.
	if m.RoleHasAction([]httpx.Role{httpx.RoleCustomer}, readAny) {
		t.Errorf("CUSTOMER must not have action %q", readAny)
	}
}
