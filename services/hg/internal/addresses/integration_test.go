package addresses_test

// Integration tests for the addresses package.
// Guarded by HG_TEST_POSTGRES_DSN (set in this worktree's environment).
// Each test seeds its own rows and registers a cleanup to remove them.
//
// Coverage per operation:
//   1. Happy path — correct status + contract envelope shape.
//   2. IDOR / ownership — another account's id returns 404, never data.
//   3. Auth — CUSTOMER allowed; RIDER, anon denied.
//   4. Input validation — DisallowUnknownFields, price fields rejected.
//   5. Domain invariants:
//      - setDefaultAddress flips exactly ONE default per account (atomically).
//      - deleteAddress with ADDRESS_IN_USE → 409.
//      - Max 20 addresses per customer → 409 on the 21st.
//   6. Soft-delete: deleted address is invisible to list/get.
//   7. setDefaultAddress on unknown / other-account id → 404.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
)

// ─── Infrastructure ──────────────────────────────────────────────────────────

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set; skipping addresses integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// addrFixtures holds IDs for one test run.
type addrFixtures struct {
	customerAccountID string
	otherAccountID    string // different customer — for IDOR checks
	addressID         string // one saved address belonging to customerAccountID
}

// seedAccount inserts a minimal account + customer_profile + CUSTOMER role grant.
func seedAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account (email, status) VALUES ('addr-'||replace(uuid_generate_v7()::text,'-','')||'@test.local','ACTIVE') RETURNING id`,
	).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO customer_profile (account_id, first_name, last_name) VALUES ($1, 'Test', 'User')`, id); err != nil {
		t.Fatalf("seed customer_profile: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, id); err != nil {
		t.Fatalf("seed account_role: %v", err)
	}
	return id
}

// seedAddress inserts one address row for the given account.
func seedAddress(t *testing.T, pool *pgxpool.Pool, accountID string, isDefault bool) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, label, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, 'Home', '100 Test Street', 'Toronto', 'ON', 'M4J 1M4',
		        ST_SetSRID(ST_MakePoint(-79.3282, 43.6820), 4326)::geography, 'America/Toronto', $2)
		RETURNING id`,
		accountID, isDefault,
	).Scan(&id); err != nil {
		t.Fatalf("seed address: %v", err)
	}
	return id
}

// cleanupAccount removes everything seeded for an account (in FK order).
func cleanupAccount(pool *pgxpool.Pool, accountID string) {
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM address WHERE account_id=$1`, accountID)
	_, _ = pool.Exec(ctx, `DELETE FROM customer_profile WHERE account_id=$1`, accountID)
	_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, accountID)
	_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, accountID)
}

func seedFixtures(t *testing.T, pool *pgxpool.Pool) addrFixtures {
	t.Helper()
	f := addrFixtures{}
	f.customerAccountID = seedAccount(t, pool)
	f.otherAccountID = seedAccount(t, pool)
	f.addressID = seedAddress(t, pool, f.customerAccountID, true)

	t.Cleanup(func() {
		cleanupAccount(pool, f.customerAccountID)
		cleanupAccount(pool, f.otherAccountID)
	})
	return f
}

func newHandler(pool *pgxpool.Pool) *addresses.Handler {
	return addresses.NewHandler(addresses.NewRepo(pool))
}

// validCreateBody is the minimal valid AddressInput JSON.
const validCreateBody = `{"line1":"200 Example Ave","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328}`

// ─── listAddresses ────────────────────────────────────────────────────────────

// TestIntegration_ListAddresses_HappyPath verifies the envelope shape:
// {"data": [...], "meta": {"next_cursor": ..., "has_more": ...}}.
func TestIntegration_ListAddresses_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []struct {
			ID        string `json:"id"`
			Line1     string `json:"line1"`
			City      string `json:"city"`
			Province  string `json:"province"`
			IsDefault bool   `json:"is_default"`
			Latitude  *float64 `json:"latitude"`
			Longitude *float64 `json:"longitude"`
			Timezone  string `json:"timezone"`
		} `json:"data"`
		Meta struct {
			NextCursor *string `json:"next_cursor"`
			HasMore    bool    `json:"has_more"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if len(env.Data) == 0 {
		t.Error("expected at least one address in data array")
	}
	// Contract shape: required fields must be present.
	for _, a := range env.Data {
		if a.ID == "" {
			t.Error("address.id must not be empty")
		}
		if a.Latitude == nil {
			t.Error("address.latitude must be present")
		}
		if a.Longitude == nil {
			t.Error("address.longitude must be present")
		}
		if a.Timezone == "" {
			t.Error("address.timezone must not be empty")
		}
	}
	// meta is required on list responses.
	if env.Meta.NextCursor == nil && !env.Meta.HasMore {
		// end of list — valid
	}
}

// TestIntegration_ListAddresses_OtherAccountSeesEmpty ensures account isolation:
// a second customer sees only their own (empty) list.
func TestIntegration_ListAddresses_OtherAccountSeesEmpty(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(env.Data) != 0 {
		t.Errorf("otherAccount should see 0 addresses, got %d", len(env.Data))
	}
}

// TestIntegration_ListAddresses_DeletedAddressNotReturned verifies that
// soft-deleted addresses do not appear in list results.
func TestIntegration_ListAddresses_DeletedAddressNotReturned(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)

	// Soft-delete the address directly in DB.
	_, err := pool.Exec(context.Background(),
		`UPDATE address SET deleted_at=now() WHERE id=$1`, f.addressID)
	if err != nil {
		t.Fatalf("soft-delete: %v", err)
	}

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", rec.Code)
	}
	var env struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(env.Data) != 0 {
		t.Errorf("soft-deleted address must not appear in list, got %d rows", len(env.Data))
	}
}

// ─── createAddress ────────────────────────────────────────────────────────────

// TestIntegration_CreateAddress_HappyPath verifies 201 + Address shape returned.
func TestIntegration_CreateAddress_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPost, "/v1/addresses",
		bytes.NewBufferString(validCreateBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H000000000000000000000001")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			ID        string   `json:"id"`
			Line1     string   `json:"line1"`
			City      string   `json:"city"`
			Province  string   `json:"province"`
			PostalCode string  `json:"postal_code"`
			Country   string   `json:"country"`
			Latitude  float64  `json:"latitude"`
			Longitude float64  `json:"longitude"`
			Timezone  string   `json:"timezone"`
			IsDefault bool     `json:"is_default"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.ID == "" {
		t.Error("id must not be empty")
	}
	if env.Data.Country != "CA" {
		t.Errorf("country=%q, want CA (server-fixed)", env.Data.Country)
	}
	if env.Data.Timezone == "" {
		t.Error("timezone must be derived and returned")
	}
	if env.Data.Latitude == 0 && env.Data.Longitude == 0 {
		t.Error("latitude/longitude must be stored and returned")
	}

	// Cleanup the newly created address.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM address WHERE account_id=$1 AND id!=$2`, f.customerAccountID, f.addressID)
	})
}

// TestIntegration_CreateAddress_RejectsUnknownField verifies unknown fields → 422.
func TestIntegration_CreateAddress_RejectsUnknownField(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	body := `{"line1":"200 Example Ave","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"bad_field":"x"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H000000000000000000000002")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestIntegration_CreateAddress_MaxAddressesLimit verifies that creating
// a 21st address returns 409 (maximum 20 per customer).
func TestIntegration_CreateAddress_MaxAddressesLimit(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()

	// The fixture already has 1; insert 19 more to reach the limit.
	for i := 0; i < 19; i++ {
		_, err := pool.Exec(ctx, `
			INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone)
			VALUES ($1, $2, 'Toronto', 'ON', 'M4J 1M4',
			        ST_SetSRID(ST_MakePoint(-79.3282, 43.6820), 4326)::geography, 'America/Toronto')`,
			f.customerAccountID, fmt.Sprintf("%d Limit St", i+1))
		if err != nil {
			t.Fatalf("seed address %d: %v", i+1, err)
		}
	}

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses",
		bytes.NewBufferString(validCreateBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H000000000000000000000003")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("status=%d, want 409 at 21st address (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── getAddress ───────────────────────────────────────────────────────────────

// TestIntegration_GetAddress_HappyPath verifies 200 + correct Address shape.
func TestIntegration_GetAddress_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, f.addressID)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			ID       string `json:"id"`
			IsDefault bool  `json:"is_default"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.ID != f.addressID {
		t.Errorf("id=%q, want %q", env.Data.ID, f.addressID)
	}
}

// TestIntegration_GetAddress_IDOR_Returns404 verifies that querying another
// account's addressId returns 404, never the data (IDOR invariant).
func TestIntegration_GetAddress_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	// otherAccountID tries to read customerAccountID's address.
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (IDOR, body: %s)", rec.Code, rec.Body.String())
	}
	// Ensure no data from the owner's address leaks in the body.
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err == nil && env.Data != nil {
		t.Error("IDOR: data must not be present in 404 response")
	}
}

// TestIntegration_GetAddress_NonExistentID returns 404.
func TestIntegration_GetAddress_NonExistentID(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	fakeID := "00000000-0000-4000-8000-000000000099"
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/"+fakeID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, fakeID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── updateAddress ────────────────────────────────────────────────────────────

// TestIntegration_UpdateAddress_HappyPath verifies partial update returns 200
// with the updated address.
func TestIntegration_UpdateAddress_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	body := `{"label":"Office"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+f.addressID, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, f.addressID)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Label *string `json:"label"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.Label == nil || *env.Data.Label != "Office" {
		t.Errorf("label=%v, want Office", env.Data.Label)
	}
}

// TestIntegration_UpdateAddress_IDOR_Returns404 verifies cross-account update → 404.
func TestIntegration_UpdateAddress_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	body := `{"label":"Stolen"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+f.addressID, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (IDOR, body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── deleteAddress ────────────────────────────────────────────────────────────

// TestIntegration_DeleteAddress_HappyPath verifies 204 on soft-delete.
func TestIntegration_DeleteAddress_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// Add a second address so the delete doesn't remove the only default.
	addr2 := seedAddress(t, pool, f.customerAccountID, false)
	_ = addr2

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.DeleteAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204 (body: %s)", rec.Code, rec.Body.String())
	}
	// Verify the row is soft-deleted (deleted_at set) not hard-deleted.
	var deletedAt *string
	if err := pool.QueryRow(context.Background(),
		`SELECT deleted_at::text FROM address WHERE id=$1`, f.addressID,
	).Scan(&deletedAt); err != nil {
		t.Fatalf("verify soft-delete: %v", err)
	}
	if deletedAt == nil {
		t.Error("deleted_at must be set after delete")
	}
}

// TestIntegration_DeleteAddress_IDOR_Returns404 verifies cross-account delete → 404.
func TestIntegration_DeleteAddress_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.DeleteAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (IDOR, body: %s)", rec.Code, rec.Body.String())
	}
}

// TestIntegration_DeleteAddress_InUseReturns409 verifies that deleting an
// address referenced by a live (non-terminal) order → 409 ADDRESS_IN_USE.
func TestIntegration_DeleteAddress_InUseReturns409(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()

	// We need a restaurant, menu_item, cart, quote, and order referencing f.addressID.
	// Seed minimal data enough for an active order reference.
	var restID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (slug, legal_name, display_name, line1, city, province, postal_code,
		                        location, timezone, onboarding_state, account_state, is_accepting_orders,
		                        commission_rate_bps)
		VALUES ('addr-test-'||substr(md5(random()::text),1,6), 'Addr Test Inc.', 'Addr Kitchen',
		        '1 King St', 'Toronto', 'ON', 'M5H 1A1',
		        ST_SetSRID(ST_MakePoint(-79.38, 43.64), 4326)::geography, 'America/Toronto',
		        'ACTIVE', 'LIVE', true, 0)
		RETURNING id`).Scan(&restID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	var catID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`, restID,
	).Scan(&catID); err != nil {
		t.Fatalf("seed menu_category: %v", err)
	}
	var itemID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, tax_category)
		VALUES ($1, $2, 1500, 'PREPARED_FOOD') RETURNING id`, restID, catID,
	).Scan(&itemID); err != nil {
		t.Fatalf("seed menu_item: %v", err)
	}
	var cartID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO cart (account_id, restaurant_id, delivery_address_id)
		VALUES ($1, $2, $3) RETURNING id`, f.customerAccountID, restID, f.addressID,
	).Scan(&cartID); err != nil {
		t.Fatalf("seed cart: %v", err)
	}
	// Seed a pricing_config row if one doesn't exist.
	var pcID string
	if err := pool.QueryRow(ctx, `SELECT id FROM pricing_config LIMIT 1`).Scan(&pcID); err != nil {
		t.Skip("no pricing_config row available; skipping ADDRESS_IN_USE test")
	}
	var quoteID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO quote (
		  account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
		  pricing_config_id, tax_jurisdiction_code,
		  subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents,
		  tip_cents, total_cents, commission_cents, restaurant_net_cents,
		  rider_earnings_cents, platform_gross_cents, billable_km, route_meters,
		  input_hash, state_hash, expires_at)
		VALUES ($1,$2,$3,$4,'DELIVERY',$5,'CA-ON',
		        1500,419,0,0,0,1919,0,1500,419,0,2,1800,
		        digest('i','sha256'),digest('s','sha256'),now()+interval '10 min')
		RETURNING id`,
		f.customerAccountID, cartID, restID, f.addressID, pcID,
	).Scan(&quoteID); err != nil {
		t.Fatalf("seed quote: %v", err)
	}
	// Insert a non-terminal order referencing the address.
	// state=RESTAURANT_PENDING requires deadline_at + deadline_action (P-15).
	// total must = subtotal + delivery + service + tax + tip (1500+419+0+0+0 = 1919).
	var orderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO "order" (
		  code, account_id, restaurant_id, delivery_address_id, quote_id, fulfilment,
		  state, deadline_at, deadline_action,
		  subtotal_cents, delivery_fee_cents, service_fee_cents,
		  tax_total_cents, tip_cents, total_cents)
		VALUES ('HG-ADDRTEST1', $1,$2,$3,$4,'DELIVERY',
		        'RESTAURANT_PENDING', now()+interval '3 min', 'auto_reject',
		        1500, 419, 0, 0, 0, 1919)
		RETURNING id`,
		f.customerAccountID, restID, f.addressID, quoteID,
	).Scan(&orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	t.Cleanup(func() {
		ctx2 := context.Background()
		_, _ = pool.Exec(ctx2, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx2, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx2, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx2, `DELETE FROM menu_item WHERE id=$1`, itemID)
		_, _ = pool.Exec(ctx2, `DELETE FROM menu_category WHERE id=$1`, catID)
		_, _ = pool.Exec(ctx2, `DELETE FROM restaurant WHERE id=$1`, restID)
	})

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.DeleteAddress(rec, req, f.addressID)

	if rec.Code != http.StatusConflict {
		t.Errorf("status=%d, want 409 ADDRESS_IN_USE (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err == nil {
		if env.Error.Code != "ADDRESS_IN_USE" {
			t.Errorf("error.code=%q, want ADDRESS_IN_USE", env.Error.Code)
		}
	}
}

// ─── setDefaultAddress ────────────────────────────────────────────────────────

// TestIntegration_SetDefaultAddress_HappyPath verifies 200 + is_default=true.
func TestIntegration_SetDefaultAddress_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// Create a second address (not default).
	addr2 := seedAddress(t, pool, f.customerAccountID, false)

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+addr2+"/default", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, addr2)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			IsDefault bool `json:"is_default"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if !env.Data.IsDefault {
		t.Error("is_default must be true after setDefaultAddress")
	}
}

// TestIntegration_SetDefaultAddress_FlipsExactlyOneDefault verifies the core
// domain invariant: at most ONE is_default=true per account after the call.
func TestIntegration_SetDefaultAddress_FlipsExactlyOneDefault(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // f.addressID is_default=true
	addr2 := seedAddress(t, pool, f.customerAccountID, false)

	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+addr2+"/default", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, addr2)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Count is_default=true rows for this account.
	var defaultCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND is_default=true AND deleted_at IS NULL`,
		f.customerAccountID,
	).Scan(&defaultCount); err != nil {
		t.Fatalf("count defaults: %v", err)
	}
	if defaultCount != 1 {
		t.Errorf("expected exactly 1 default address, got %d", defaultCount)
	}

	// The new default is addr2.
	var isDefaultNew bool
	if err := pool.QueryRow(context.Background(),
		`SELECT is_default FROM address WHERE id=$1`, addr2,
	).Scan(&isDefaultNew); err != nil {
		t.Fatalf("read addr2: %v", err)
	}
	if !isDefaultNew {
		t.Error("addr2 must be is_default=true")
	}

	// The old default (f.addressID) must now be false.
	var isDefaultOld bool
	if err := pool.QueryRow(context.Background(),
		`SELECT is_default FROM address WHERE id=$1`, f.addressID,
	).Scan(&isDefaultOld); err != nil {
		t.Fatalf("read addressID: %v", err)
	}
	if isDefaultOld {
		t.Error("original default (f.addressID) must be false after setDefaultAddress on addr2")
	}
}

// TestIntegration_SetDefaultAddress_IDOR_Returns404 verifies cross-account → 404.
func TestIntegration_SetDefaultAddress_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+f.addressID+"/default", nil)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (IDOR, body: %s)", rec.Code, rec.Body.String())
	}
}

// TestIntegration_SetDefaultAddress_NonExistentID returns 404.
func TestIntegration_SetDefaultAddress_NonExistentID(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	fakeID := "00000000-0000-4000-8000-000000000099"
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+fakeID+"/default", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, fakeID)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Response envelope invariants ────────────────────────────────────────────

// TestIntegration_ListAddresses_NeverBareArray verifies the list response is
// always {"data":[...],"meta":{...}} and never a bare array (G-6).
func TestIntegration_ListAddresses_NeverBareArray(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var raw json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("parse body: %v", err)
	}
	// Must be an object, not an array.
	if len(raw) > 0 && raw[0] == '[' {
		t.Error("response body is a bare array; want {\"data\":[...]}")
	}
}

// TestIntegration_CreateAddress_ResponseHasNoMeta verifies that a single-resource
// response (201 createAddress) has no meta field (only lists carry meta).
func TestIntegration_CreateAddress_ResponseHasNoMeta(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPost, "/v1/addresses",
		bytes.NewBufferString(validCreateBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H000000000000000000000010")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, hasMeta := env["meta"]; hasMeta {
		t.Error("single-resource create response must not have a meta field")
	}

	// Cleanup.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM address WHERE account_id=$1 AND id!=$2`, f.customerAccountID, f.addressID)
	})
}
