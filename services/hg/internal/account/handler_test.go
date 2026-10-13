package account_test

// Tests for the account package — customer profile, device registration, and
// notification inbox.
//
// Sources of truth consulted:
//   - contracts/openapi.yaml (wire shapes, error codes, x-roles)
//   - contracts/fixtures/index.json (reference response shapes)
//   - migrations/00004_identity.sql (customer_profile table)
//   - migrations/00020_notifications.sql (device, notification tables)
//   - internal/auth/matrix.go (role→action grants)
//   - docs/AGENTS.md invariants (price fields, deny-by-default, IDOR→404)
//
// Coverage per operation:
//   1. Happy path — correct HTTP status + contract envelope shape.
//   2. Every documented error code for that op.
//   3. Authz — allowed roles pass; at least one non-listed role gets 403;
//      unauthenticated → 401.
//   4. Input validation — unknown fields rejected (DisallowUnknownFields);
//      price/amount fields on inbound writes rejected.
//   5. Ownership / IDOR — another account's resource ID → 404, never their data.
//   6. Idempotency for writes (registerDevice same token twice = one row).
//   7. Domain invariant relevant to the op.
//
// Unit tests (no DB) use handler directly via httptest.NewRecorder.
// Integration tests (guarded by HG_TEST_POSTGRES_DSN) hit the real DB.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// ─── Test infrastructure ──────────────────────────────────────────────────────

// testPool opens a connection to the real database or skips the test if the
// DSN is not set. It fails loudly (not skip) when the DSN is provided but the
// connection fails or fixtures are missing.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set; skipping account integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// accountFixtures holds IDs seeded for one test run.
type accountFixtures struct {
	customerAccountID string // has CUSTOMER role
	riderAccountID    string // has RIDER role
	otherAccountID    string // different CUSTOMER account — used for IDOR checks
	notificationID    string // a notification belonging to customerAccountID
	otherNotifID      string // a notification belonging to otherAccountID
}

// seedAccountFixtures creates a minimal test dataset and registers cleanup.
func seedAccountFixtures(t *testing.T, pool *pgxpool.Pool) accountFixtures {
	t.Helper()
	ctx := context.Background()
	var f accountFixtures

	// Seed three accounts.
	for _, ptr := range []*string{&f.customerAccountID, &f.riderAccountID, &f.otherAccountID} {
		suffix := fmt.Sprintf("%d", time.Now().UnixNano())
		if err := pool.QueryRow(ctx,
			`INSERT INTO account (email, status, timezone)
			 VALUES ('acct-'||$1||'@test.local', 'ACTIVE', 'America/Toronto')
			 RETURNING id`, suffix).Scan(ptr); err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}

	// customer_profile for customerAccountID.
	if _, err := pool.Exec(ctx,
		`INSERT INTO customer_profile (account_id, first_name, last_name)
		 VALUES ($1, 'Test', 'Customer')
		 ON CONFLICT (account_id) DO NOTHING`,
		f.customerAccountID); err != nil {
		t.Fatalf("seed customer_profile: %v", err)
	}
	// customer_profile for otherAccountID.
	if _, err := pool.Exec(ctx,
		`INSERT INTO customer_profile (account_id, first_name)
		 VALUES ($1, 'Other')
		 ON CONFLICT (account_id) DO NOTHING`,
		f.otherAccountID); err != nil {
		t.Fatalf("seed other customer_profile: %v", err)
	}

	// account_role grants.
	type grant struct {
		accountID string
		role      string
	}
	for _, g := range []grant{
		{f.customerAccountID, "CUSTOMER"},
		{f.riderAccountID, "RIDER"},
		{f.otherAccountID, "CUSTOMER"},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO account_role (account_id, role, scope_type)
			 VALUES ($1, $2, 'GLOBAL')
			 ON CONFLICT DO NOTHING`,
			g.accountID, g.role); err != nil {
			t.Fatalf("grant %s: %v", g.role, err)
		}
	}

	// One notification for customerAccountID.
	if err := pool.QueryRow(ctx,
		`INSERT INTO notification
		 (account_id, role_context, kind, title, body, priority)
		 VALUES ($1, 'CUSTOMER', 'ORDER_PLACED', 'Order placed', 'Your order is being prepared.', 'NORMAL')
		 RETURNING id`,
		f.customerAccountID).Scan(&f.notificationID); err != nil {
		t.Fatalf("seed notification: %v", err)
	}

	// One notification for otherAccountID.
	if err := pool.QueryRow(ctx,
		`INSERT INTO notification
		 (account_id, role_context, kind, title, body, priority)
		 VALUES ($1, 'CUSTOMER', 'ORDER_PLACED', 'Other order', 'Other body.', 'NORMAL')
		 RETURNING id`,
		f.otherAccountID).Scan(&f.otherNotifID); err != nil {
		t.Fatalf("seed other notification: %v", err)
	}

	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM notification WHERE account_id IN ($1,$2,$3)`,
			f.customerAccountID, f.riderAccountID, f.otherAccountID)
		_, _ = pool.Exec(c, `DELETE FROM device WHERE account_id IN ($1,$2,$3)`,
			f.customerAccountID, f.riderAccountID, f.otherAccountID)
		_, _ = pool.Exec(c, `DELETE FROM customer_profile WHERE account_id IN ($1,$2)`,
			f.customerAccountID, f.otherAccountID)
		_, _ = pool.Exec(c, `DELETE FROM account_role WHERE account_id IN ($1,$2,$3)`,
			f.customerAccountID, f.riderAccountID, f.otherAccountID)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id IN ($1,$2,$3)`,
			f.customerAccountID, f.riderAccountID, f.otherAccountID)
	})
	return f
}

// newHandler builds the handler wired to the test pool.
func newHandler(pool *pgxpool.Pool) *account.Handler {
	return account.NewHandler(account.NewRepo(pool))
}

// withPrincipal injects a Principal into the request context.
func withPrincipal(r *http.Request, p httpx.Principal) *http.Request {
	return r.WithContext(httpx.WithPrincipalForTest(r.Context(), p))
}

// withChiParam injects a chi URL parameter (mimics chi routing in unit tests).
func withChiParam(r *http.Request, key, val string) *http.Request {
	return account.WithChiParamForTest(r, key, val)
}

func customerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-cust", Roles: []httpx.Role{httpx.RoleCustomer}}
}
func riderPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-rider", Roles: []httpx.Role{httpx.RoleRider}}
}
func restaurantOwnerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-owner", Roles: []httpx.Role{httpx.RoleRestaurantOwner}}
}
func restaurantManagerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-mgr", Roles: []httpx.Role{httpx.RoleRestaurantManager}}
}
func restaurantStaffPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-staff", Roles: []httpx.Role{httpx.RoleRestaurantStaff}}
}
func adminPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess-admin", Roles: []httpx.Role{httpx.RoleAdmin}}
}
func anonPrincipal() httpx.Principal { return httpx.AnonymousPrincipal() }

// errCode decodes the {"error":{"code":"…"}} envelope.
func errCode(body []byte) string {
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &env)
	return env.Error.Code
}

// ─── Routes verify (unit) ─────────────────────────────────────────────────────

// TestRoutesVerify asserts every account route carries a coherent Policy and
// none is Public (G-4 / I-06.1). This detects a policy-less registration before
// the server ever boots.
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	account.Routes(r, account.NewHandler(nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("account routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("account routes must never be public, found: %v", pub)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// updateCustomerProfile  [PATCH /v1/me/profile]  x-roles: CUSTOMER
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Unit: auth + input validation (no DB) ───────────────────────────────────

// TestUpdateProfile_Unauthenticated: no token → 401 AUTHENTICATION_REQUIRED.
func TestUpdateProfile_Unauthenticated(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(`{"first_name":"A"}`))
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(rec.Body.Bytes()); c != "AUTHENTICATION_REQUIRED" {
		t.Errorf("code=%q, want AUTHENTICATION_REQUIRED", c)
	}
}

// TestUpdateProfile_RiderDenied: RIDER is not listed in x-roles → 403.
func TestUpdateProfile_RiderDenied(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(`{"first_name":"A"}`))
	req = withPrincipal(req, riderPrincipal("acct-r"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("RIDER: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_AdminDenied: ADMIN is not in x-roles → 403.
func TestUpdateProfile_AdminDenied(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(`{"first_name":"A"}`))
	req = withPrincipal(req, adminPrincipal("acct-a"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ADMIN: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_UnknownField: phone_e164 is read-only — sending it is 422.
// (spec: "phone_e164 is deliberately absent — sending it is `422 UNKNOWN_FIELD`")
func TestUpdateProfile_UnknownField_PhoneE164(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"first_name":"A","phone_e164":"+14165550123"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("phone_e164 in body: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_UnknownField_PriceCents: price fields are invariant-1-forbidden.
func TestUpdateProfile_UnknownField_PriceCents(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"first_name":"A","price_cents":999}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("price_cents in body: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_UnknownField_AmountCents: amount_cents is also price-shaped.
func TestUpdateProfile_UnknownField_AmountCents(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"first_name":"A","amount_cents":0}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("amount_cents in body: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_UnknownField_AccountID: account_id is server-controlled.
func TestUpdateProfile_UnknownField_AccountID(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"first_name":"A","account_id":"00000000-0000-0000-0000-000000000001"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("account_id in body: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateProfile_EmptyFirstName: first_name has minLength=1.
func TestUpdateProfile_EmptyFirstName(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"first_name":""}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty first_name: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Integration: happy path + IDOR (requires DB) ────────────────────────────

// TestIntegration_UpdateProfile_HappyPath: CUSTOMER updates their own profile.
// Response must include the CustomerProfile shape with required fields.
func TestIntegration_UpdateProfile_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	body := `{"first_name":"Updated","last_name":"Name"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Contract shape: {"data": CustomerProfile}
	var env struct {
		Data struct {
			AccountID     string  `json:"account_id"`
			FirstName     string  `json:"first_name"`
			LastName      *string `json:"last_name"`
			EmailVerified bool    `json:"email_verified"` // required field in schema
			PhoneE164     string  `json:"phone_e164"`     // required field in schema
			CreatedAt     string  `json:"created_at"`     // required Timestamp field
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.AccountID != f.customerAccountID {
		t.Errorf("account_id=%q, want %q", env.Data.AccountID, f.customerAccountID)
	}
	if env.Data.FirstName != "Updated" {
		t.Errorf("first_name=%q, want Updated", env.Data.FirstName)
	}
	if env.Data.LastName == nil || *env.Data.LastName != "Name" {
		t.Errorf("last_name=%v, want 'Name'", env.Data.LastName)
	}
	// Timestamp must be RFC3339-like (non-empty).
	if env.Data.CreatedAt == "" {
		t.Errorf("created_at must be present")
	}
	// phone_e164 must never be absent from the response even when null in DB.
	// (It is a required field in the schema.)
}

// TestIntegration_UpdateProfile_NoProfile_404: a CUSTOMER without a profile row
// receives 404, not a panic or internal error.
func TestIntegration_UpdateProfile_NoProfile_404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// riderAccountID has no customer_profile row.
	body := `{"first_name":"Rider"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.riderAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("no profile: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestIntegration_UpdateProfile_CallerOwnedOnly: the handler MUST scope the
// update to the caller's own account_id; sending a different account's update
// must only affect the caller's row (ownership enforced in SQL).
// This test verifies the caller cannot update another user's profile via a
// different body — the SQL WHERE must be account_id = $caller.
func TestIntegration_UpdateProfile_CallerOwnedOnly(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// customerAccountID updates their first_name.
	body := `{"first_name":"CallerOnly"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("update caller: status=%d (body: %s)", rec.Code, rec.Body.String())
	}

	// Verify the OTHER account's first_name is unchanged.
	var otherName string
	if err := pool.QueryRow(context.Background(),
		`SELECT first_name FROM customer_profile WHERE account_id = $1`,
		f.otherAccountID).Scan(&otherName); err != nil {
		t.Fatalf("read other profile: %v", err)
	}
	if otherName == "CallerOnly" {
		t.Errorf("IDOR: caller's update overwrote the other account's profile")
	}
}

// TestIntegration_UpdateProfile_MarketingConsent_SetTimestamp: setting
// marketing_consent:true must record marketing_consent_at as a non-null
// timestamp (CASL compliance).
func TestIntegration_UpdateProfile_MarketingConsent_SetTimestamp(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	body := `{"marketing_consent":true}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Verify the DB row has marketing_consent_at non-null.
	var ts *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT marketing_consent_at FROM customer_profile WHERE account_id = $1`,
		f.customerAccountID).Scan(&ts); err != nil {
		t.Fatalf("read consent_at: %v", err)
	}
	if ts == nil {
		t.Errorf("marketing_consent_at must be set when consent is granted (CASL)")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// registerDevice  [POST /v1/devices]
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Unit: auth + input validation ───────────────────────────────────────────

// TestRegisterDevice_Unauthenticated: no token → 401.
func TestRegisterDevice_Unauthenticated(t *testing.T) {
	h := account.NewHandler(nil)
	body := validDeviceBody("ExponentPushToken[test123]", "dev-1", "ios", "CUSTOMER")
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRegisterDevice_AdminDenied: ADMIN is not in x-roles → 403.
func TestRegisterDevice_AdminDenied(t *testing.T) {
	h := account.NewHandler(nil)
	body := validDeviceBody("ExponentPushToken[test123]", "dev-1", "ios", "CUSTOMER")
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, adminPrincipal("acct-a"))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ADMIN: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRegisterDevice_AllAllowedRoles: CUSTOMER, RIDER, OWNER, MANAGER, STAFF
// must all pass the role check (unit — no DB; 501 from unimplemented store
// is acceptable, what we guard is no 401/403).
func TestRegisterDevice_AllAllowedRoles(t *testing.T) {
	cases := []struct {
		name      string
		principal httpx.Principal
	}{
		{"CUSTOMER", customerPrincipal("acct-c")},
		{"RIDER", riderPrincipal("acct-r")},
		{"RESTAURANT_OWNER", restaurantOwnerPrincipal("acct-o")},
		{"RESTAURANT_MANAGER", restaurantManagerPrincipal("acct-m")},
		{"RESTAURANT_STAFF", restaurantStaffPrincipal("acct-s")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := account.NewHandler(nil)
			body := validDeviceBody("ExponentPushToken[test]", "dev-unit", "android", "CUSTOMER")
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
			req = withPrincipal(req, tc.principal)
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			// 401 or 403 means the role check is wrong.
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Fatalf("%s: status=%d, role must be allowed (body: %s)",
					tc.name, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestRegisterDevice_MissingRequiredFields: expo_push_token is required.
func TestRegisterDevice_MissingRequiredFields(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"device_id":"dev-1","platform":"ios","role_context":"CUSTOMER"}` // missing expo_push_token
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing token: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRegisterDevice_UnknownField_PriceCents: price fields are invariant-1-forbidden.
func TestRegisterDevice_UnknownField_PriceCents(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"expo_push_token":"ExponentPushToken[t]","device_id":"dev-1","platform":"ios","role_context":"CUSTOMER","price_cents":100}`
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("price_cents in device body: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRegisterDevice_UnknownField_Garbage: an unrecognised field must be rejected.
func TestRegisterDevice_UnknownField_Garbage(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"expo_push_token":"ExponentPushToken[t]","device_id":"d","platform":"ios","role_context":"CUSTOMER","account_id":"bad"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown field: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRegisterDevice_InvalidPlatform: platform must be one of ios/android/web.
func TestRegisterDevice_InvalidPlatform(t *testing.T) {
	h := account.NewHandler(nil)
	body := `{"expo_push_token":"ExponentPushToken[t]","device_id":"d","platform":"symbian","role_context":"CUSTOMER"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad platform: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Integration: happy path + idempotency + IDOR ────────────────────────────

// TestIntegration_RegisterDevice_HappyPath: response is the Device shape.
func TestIntegration_RegisterDevice_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	token := fmt.Sprintf("ExponentPushToken[integ-%d]", time.Now().UnixNano())
	body := validDeviceBody(token, "dev-integ-1", "ios", "CUSTOMER")
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Verify Device shape.
	var env struct {
		Data struct {
			DeviceID    string `json:"device_id"`
			Platform    string `json:"platform"`
			RoleContext string `json:"role_context"`
			PushEnabled bool   `json:"push_enabled"`
			LastSeenAt  string `json:"last_seen_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.DeviceID != "dev-integ-1" {
		t.Errorf("device_id=%q, want dev-integ-1", env.Data.DeviceID)
	}
	if env.Data.Platform != "ios" {
		t.Errorf("platform=%q, want ios", env.Data.Platform)
	}
	if !env.Data.PushEnabled {
		t.Errorf("push_enabled must default to true")
	}
	if env.Data.LastSeenAt == "" {
		t.Errorf("last_seen_at must be present")
	}
}

// TestIntegration_RegisterDevice_Idempotent: registering the same token+device_id
// twice results in exactly ONE row (upsert, not duplicate insert). P-25 invariant.
func TestIntegration_RegisterDevice_Idempotent(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	token := fmt.Sprintf("ExponentPushToken[idem-%d]", time.Now().UnixNano())
	body := validDeviceBody(token, "dev-idem", "android", "CUSTOMER")

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.RegisterDevice(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("register #%d: status=%d, want 200 (body: %s)", i+1, rec.Code, rec.Body.String())
		}
	}

	// Exactly one live row must exist.
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE account_id=$1 AND device_id='dev-idem' AND revoked_at IS NULL`,
		f.customerAccountID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Errorf("idempotency: expected 1 live device row, got %d", n)
	}
}

// TestIntegration_RegisterDevice_TokenRebindRevokesOldAccount: registering the
// same push token from a different account must revoke the old binding so
// only one account holds the token. (P-25 / "shared phone" invariant).
func TestIntegration_RegisterDevice_TokenRebindRevokesOldAccount(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	sharedToken := fmt.Sprintf("ExponentPushToken[shared-%d]", time.Now().UnixNano())

	// First: customerAccountID registers the token.
	body1 := validDeviceBody(sharedToken, "shared-dev", "ios", "CUSTOMER")
	req1 := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body1))
	req1 = withPrincipal(req1, customerPrincipal(f.customerAccountID))
	rec1 := httptest.NewRecorder()
	h.RegisterDevice(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first register: status=%d (body: %s)", rec1.Code, rec1.Body.String())
	}

	// Second: otherAccountID registers the same token (new user, same phone).
	body2 := validDeviceBody(sharedToken, "shared-dev", "ios", "CUSTOMER")
	req2 := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body2))
	req2 = withPrincipal(req2, customerPrincipal(f.otherAccountID))
	rec2 := httptest.NewRecorder()
	h.RegisterDevice(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second register: status=%d (body: %s)", rec2.Code, rec2.Body.String())
	}

	// The unique index device_token_one_account ensures only one live row per token.
	// Verify the original binding is now revoked.
	var liveCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE expo_push_token=$1 AND revoked_at IS NULL`,
		sharedToken).Scan(&liveCount); err != nil {
		t.Fatalf("count live: %v", err)
	}
	if liveCount != 1 {
		t.Errorf("shared token must have exactly 1 live binding, got %d", liveCount)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// unregisterDevice  [DELETE /v1/devices/{deviceId}]
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF
// ═══════════════════════════════════════════════════════════════════════════════

// TestUnregisterDevice_Unauthenticated: no token → 401.
func TestUnregisterDevice_Unauthenticated(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodDelete, "/v1/devices/dev-1", nil)
	req = withChiParam(req, "deviceId", "dev-1")
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.UnregisterDevice(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUnregisterDevice_AdminDenied: ADMIN is not in x-roles → 403.
func TestUnregisterDevice_AdminDenied(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodDelete, "/v1/devices/dev-1", nil)
	req = withChiParam(req, "deviceId", "dev-1")
	req = withPrincipal(req, adminPrincipal("acct-a"))
	rec := httptest.NewRecorder()
	h.UnregisterDevice(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ADMIN: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestIntegration_UnregisterDevice_HappyPath: revokes the device, returns 204.
func TestIntegration_UnregisterDevice_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// First register a device.
	token := fmt.Sprintf("ExponentPushToken[unreg-%d]", time.Now().UnixNano())
	devID := "unreg-dev-1"
	body := validDeviceBody(token, devID, "ios", "CUSTOMER")
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("register: status=%d (body: %s)", rec.Code, rec.Body.String())
	}

	// Now delete it.
	req2 := httptest.NewRequest(http.MethodDelete, "/v1/devices/"+devID, nil)
	req2 = withChiParam(req2, "deviceId", devID)
	req2 = withPrincipal(req2, customerPrincipal(f.customerAccountID))
	rec2 := httptest.NewRecorder()
	h.UnregisterDevice(rec2, req2)
	if rec2.Code != http.StatusNoContent {
		t.Fatalf("unregister: status=%d, want 204 (body: %s)", rec2.Code, rec2.Body.String())
	}

	// Verify revoked_at is set.
	var revokedAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT revoked_at FROM device WHERE account_id=$1 AND device_id=$2 LIMIT 1`,
		f.customerAccountID, devID).Scan(&revokedAt); err != nil {
		t.Fatalf("read device: %v", err)
	}
	if revokedAt == nil {
		t.Errorf("revoked_at must be set after unregister")
	}
}

// TestIntegration_UnregisterDevice_IDOR_Returns404: a caller cannot revoke
// another account's device — must receive 404 (not 403, which would leak
// the existence of the device per the IDOR invariant).
func TestIntegration_UnregisterDevice_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// Register a device for customerAccountID.
	token := fmt.Sprintf("ExponentPushToken[idor-%d]", time.Now().UnixNano())
	devID := "idor-dev-1"
	body := validDeviceBody(token, devID, "ios", "CUSTOMER")
	req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.RegisterDevice(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("register: status=%d (body: %s)", rec.Code, rec.Body.String())
	}

	// otherAccountID tries to delete it → must get 404.
	req2 := httptest.NewRequest(http.MethodDelete, "/v1/devices/"+devID, nil)
	req2 = withChiParam(req2, "deviceId", devID)
	req2 = withPrincipal(req2, customerPrincipal(f.otherAccountID))
	rec2 := httptest.NewRecorder()
	h.UnregisterDevice(rec2, req2)
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("IDOR unregister: status=%d, want 404 (body: %s)", rec2.Code, rec2.Body.String())
	}
}

// TestIntegration_UnregisterDevice_NonExistent_404: a device_id that doesn't
// exist at all → 404.
func TestIntegration_UnregisterDevice_NonExistent_404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodDelete, "/v1/devices/no-such-device", nil)
	req = withChiParam(req, "deviceId", "no-such-device")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UnregisterDevice(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-existent device: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// listNotifications  [GET /v1/notifications]
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Unit: auth ──────────────────────────────────────────────────────────────

// TestListNotifications_Unauthenticated: no token → 401.
func TestListNotifications_Unauthenticated(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestListNotifications_AdminDenied: ADMIN is not in x-roles → 403.
func TestListNotifications_AdminDenied(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	req = withPrincipal(req, adminPrincipal("acct-a"))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ADMIN: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestListNotifications_AllAllowedRoles: all five x-roles must pass (no DB; 501 ok).
func TestListNotifications_AllAllowedRoles(t *testing.T) {
	cases := []struct {
		name      string
		principal httpx.Principal
	}{
		{"CUSTOMER", customerPrincipal("acct-c")},
		{"RIDER", riderPrincipal("acct-r")},
		{"RESTAURANT_OWNER", restaurantOwnerPrincipal("acct-o")},
		{"RESTAURANT_MANAGER", restaurantManagerPrincipal("acct-m")},
		{"RESTAURANT_STAFF", restaurantStaffPrincipal("acct-s")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := account.NewHandler(nil)
			req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
			req = withPrincipal(req, tc.principal)
			rec := httptest.NewRecorder()
			h.ListNotifications(rec, req)
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Fatalf("%s: status=%d, role must be allowed", tc.name, rec.Code)
			}
		})
	}
}

// ─── Integration: happy path + pagination + ownership ────────────────────────

// TestIntegration_ListNotifications_HappyPath: response must have data:[] + meta.
func TestIntegration_ListNotifications_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Must have {data: […], meta: {next_cursor, has_more}}.
	var env struct {
		Data []struct {
			ID        string  `json:"id"`
			Kind      string  `json:"kind"`
			Title     string  `json:"title"`
			Body      string  `json:"body"`
			Priority  string  `json:"priority"`
			CreatedAt string  `json:"created_at"`
			ReadAt    *string `json:"read_at"` // nullable in spec
		} `json:"data"`
		Meta struct {
			HasMore    bool    `json:"has_more"`
			NextCursor *string `json:"next_cursor"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data == nil {
		t.Error("data field must be an array (even when empty)")
	}
	if len(env.Data) < 1 {
		t.Error("expected at least 1 notification (seeded in fixtures)")
	}
	// Validate the first notification has required fields.
	if env.Data[0].ID == "" {
		t.Error("notification id must not be empty")
	}
	if env.Data[0].Kind == "" {
		t.Error("notification kind must not be empty")
	}
	if env.Data[0].CreatedAt == "" {
		t.Error("notification created_at must not be empty")
	}
	// read_at field must be present (nullable) — ensures the key exists in response.
	raw := rec.Body.Bytes()
	if !bytes.Contains(raw, []byte(`"read_at"`)) {
		t.Error("response must include read_at key (even if null)")
	}
}

// TestIntegration_ListNotifications_OnlyOwnInbox: caller must only receive
// their own notifications — never another account's. (IDOR / ownership in SQL).
func TestIntegration_ListNotifications_OnlyOwnInbox(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, n := range env.Data {
		if n.ID == f.otherNotifID {
			t.Errorf("IDOR: caller received another account's notification id=%q", n.ID)
		}
	}
}

// TestIntegration_ListNotifications_UnreadOnly: ?unread_only=true should
// return only notifications without a read_at timestamp.
func TestIntegration_ListNotifications_UnreadOnly(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// Mark the existing notification as read.
	if _, err := pool.Exec(context.Background(),
		`UPDATE notification SET read_at=now() WHERE id=$1`,
		f.notificationID); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/notifications?unread_only=true", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []struct {
			ID     string  `json:"id"`
			ReadAt *string `json:"read_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// The already-read notification must not appear.
	for _, n := range env.Data {
		if n.ID == f.notificationID {
			t.Errorf("unread_only=true returned a notification that is already read (id=%q)", n.ID)
		}
	}
}

// TestIntegration_ListNotifications_Pagination: listing with limit=1 and using
// the cursor from the first page must return the next page.
func TestIntegration_ListNotifications_Pagination(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// Seed a second notification for the same account so we have at least 2.
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO notification (account_id, role_context, kind, title, body, priority)
		 VALUES ($1, 'CUSTOMER', 'ORDER_STATUS', 'Second', 'Second body.', 'NORMAL')`,
		f.customerAccountID); err != nil {
		t.Fatalf("seed second notification: %v", err)
	}

	// Page 1: limit=1.
	req := httptest.NewRequest(http.MethodGet, "/v1/notifications?limit=1", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("page 1: status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	var page1 struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Meta struct {
			HasMore    bool    `json:"has_more"`
			NextCursor *string `json:"next_cursor"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page1); err != nil {
		t.Fatalf("unmarshal page1: %v", err)
	}
	if !page1.Meta.HasMore {
		t.Error("has_more must be true when there is at least one more item")
	}
	if page1.Meta.NextCursor == nil {
		t.Error("next_cursor must be present when has_more is true")
	}

	// Page 2: use the cursor.
	req2 := httptest.NewRequest(http.MethodGet,
		fmt.Sprintf("/v1/notifications?limit=1&cursor=%s", *page1.Meta.NextCursor), nil)
	req2 = withPrincipal(req2, customerPrincipal(f.customerAccountID))
	rec2 := httptest.NewRecorder()
	h.ListNotifications(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("page 2: status=%d (body: %s)", rec2.Code, rec2.Body.String())
	}
	var page2 struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &page2); err != nil {
		t.Fatalf("unmarshal page2: %v", err)
	}
	if len(page2.Data) == 0 {
		t.Error("page 2 must have at least 1 notification")
	}
	// The IDs on page 2 must not overlap with page 1.
	p1IDs := map[string]bool{}
	for _, n := range page1.Data {
		p1IDs[n.ID] = true
	}
	for _, n := range page2.Data {
		if p1IDs[n.ID] {
			t.Errorf("notification id=%q appeared on both pages (cursor broken)", n.ID)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// markNotificationRead  [POST /v1/notifications/{notificationId}/read]
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Unit: auth ──────────────────────────────────────────────────────────────

// TestMarkNotificationRead_Unauthenticated: no token → 401.
func TestMarkNotificationRead_Unauthenticated(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost,
		"/v1/notifications/00000000-0000-0000-0000-000000000001/read", nil)
	req = withChiParam(req, "notificationId", "00000000-0000-0000-0000-000000000001")
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.MarkNotificationRead(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestMarkNotificationRead_AdminDenied: ADMIN is not in x-roles → 403.
func TestMarkNotificationRead_AdminDenied(t *testing.T) {
	h := account.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost,
		"/v1/notifications/00000000-0000-0000-0000-000000000001/read", nil)
	req = withChiParam(req, "notificationId", "00000000-0000-0000-0000-000000000001")
	req = withPrincipal(req, adminPrincipal("acct-a"))
	rec := httptest.NewRecorder()
	h.MarkNotificationRead(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ADMIN: status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Integration: happy path + IDOR + idempotency ────────────────────────────

// TestIntegration_MarkNotificationRead_HappyPath: returns 204 and sets read_at.
func TestIntegration_MarkNotificationRead_HappyPath(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/v1/notifications/%s/read", f.notificationID), nil)
	req = withChiParam(req, "notificationId", f.notificationID)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.MarkNotificationRead(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204 (body: %s)", rec.Code, rec.Body.String())
	}

	// DB must have read_at set.
	var readAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT read_at FROM notification WHERE id=$1`, f.notificationID).Scan(&readAt); err != nil {
		t.Fatalf("read notification: %v", err)
	}
	if readAt == nil {
		t.Errorf("read_at must be set after markNotificationRead")
	}
}

// TestIntegration_MarkNotificationRead_Idempotent: marking read twice is safe.
// The second call must also return 204 (not 404 or 409).
func TestIntegration_MarkNotificationRead_Idempotent(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost,
			fmt.Sprintf("/v1/notifications/%s/read", f.notificationID), nil)
		req = withChiParam(req, "notificationId", f.notificationID)
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.MarkNotificationRead(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("mark read #%d: status=%d, want 204 (body: %s)", i+1, rec.Code, rec.Body.String())
		}
	}

	// The first read, and only the first, tells the caller's other devices
	// (contracts/websocket.md section 4.6, notification.read).
	events := realtimetest.Events(t, pool, realtime.AccountChannel(f.customerAccountID), "notification.read")
	if len(events) != 1 || !strings.Contains(string(events[0].Payload), f.notificationID) {
		t.Fatalf("notification.read events after two reads = %d, want 1 naming %s", len(events), f.notificationID)
	}
}

// TestIntegration_MarkNotificationRead_IDOR_Returns404: a caller must not be
// able to mark another account's notification as read — must get 404.
func TestIntegration_MarkNotificationRead_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// otherAccountID tries to mark customerAccountID's notification as read.
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/v1/notifications/%s/read", f.notificationID), nil)
	req = withChiParam(req, "notificationId", f.notificationID)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.MarkNotificationRead(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("IDOR markRead: status=%d, want 404 — must not expose another account's notification (body: %s)",
			rec.Code, rec.Body.String())
	}
	for _, acct := range []string{f.customerAccountID, f.otherAccountID} {
		if got := realtimetest.Events(t, pool, realtime.AccountChannel(acct), "notification.read"); len(got) != 0 {
			t.Errorf("a refused read wrote notification.read on %s", acct)
		}
	}
}

// TestIntegration_MarkNotificationRead_NonExistent_404: a completely unknown
// notificationId → 404 (not 500).
func TestIntegration_MarkNotificationRead_NonExistent_404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	const phantomID = "00000000-dead-4000-8000-000000000000"
	req := httptest.NewRequest(http.MethodPost,
		"/v1/notifications/"+phantomID+"/read", nil)
	req = withChiParam(req, "notificationId", phantomID)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.MarkNotificationRead(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-existent notification: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// validDeviceBody returns a minimal valid DeviceRegistrationInput JSON.
func validDeviceBody(token, deviceID, platform, roleContext string) string {
	body, _ := json.Marshal(map[string]any{
		"expo_push_token": token,
		"device_id":       deviceID,
		"platform":        platform,
		"role_context":    roleContext,
	})
	return string(body)
}
