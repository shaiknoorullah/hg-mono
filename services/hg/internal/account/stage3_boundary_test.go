package account_test

// Stage 3 — BOUNDARY & LEAK ANALYSIS (independent auditor).
//
// These tests close the gaps the Stage-2 suite did not cover. They assume the
// implementation is guilty until the wire shape, the authz matrix, the tenant
// isolation, the money invariant, the idempotency and the error taxonomy each
// prove otherwise.
//
// Sources of truth:
//   - contracts/openapi.yaml  (CustomerProfile, Device, Notification schemas;
//     all additionalProperties:false; DevicePlatform / NotificationPriority /
//     Role enums; ErrorCode enum; x-roles per operation)
//   - migrations/00004_identity.sql, 00020_notifications.sql (columns)
//   - internal/auth/matrix.go (role→action grants)

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── shared helpers ───────────────────────────────────────────────────────────

// newHandlerNil builds a handler with no store — for pure auth/validation unit
// tests where the request must be rejected before the store is reached.
func newHandlerNil() *account.Handler { return account.NewHandler(nil) }

// accountRoutes registers this package's routes on a router for policy checks.
func accountRoutes(r *httpx.Router) { account.Routes(r, account.NewHandler(nil)) }

// jsonKeys returns the top-level keys of a JSON object as a sorted slice.
func jsonKeys(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("object expected, got %s: %v", raw, err)
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// assertKeysExactly fails if the object's key set differs from want (order-free).
// This is the additionalProperties:false + required-field closure test: it
// catches BOTH an extra field (leak) AND a missing required field.
func assertKeysExactly(t *testing.T, where string, raw json.RawMessage, want []string) {
	t.Helper()
	got := jsonKeys(t, raw)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s: key set drift\n got:  %v\n want: %v", where, got, want)
	}
}

// dataOf extracts the "data" member of a {"data": …} envelope as raw JSON.
func dataOf(t *testing.T, body []byte) json.RawMessage {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("envelope unmarshal: %v (body: %s)", err, body)
	}
	return env.Data
}

// contract ErrorCode enum members this package can legitimately emit on a wired
// route. Any failure MUST carry one of these — never a bare/empty code, never a
// 500 with no code.
var contractErrorCodes = map[string]bool{
	"AUTHENTICATION_REQUIRED": true,
	"FORBIDDEN":               true,
	"NOT_FOUND":               true,
	"VALIDATION_FAILED":       true,
	"INTERNAL_ERROR":          true,
}

// ═══════════════════════════════════════════════════════════════════════════════
// A) CONTRACT CONFORMANCE — closed-shape golden assertions
// ═══════════════════════════════════════════════════════════════════════════════

// TestGolden_CustomerProfile_ClosedShape asserts the updateCustomerProfile
// response object carries EXACTLY the CustomerProfile schema keys — no more, no
// fewer. This catches the pre-Stage-3 leak where the DTO shipped a forbidden
// `updated_at` and a `marketing_consent` bool that the contract does not define,
// and omitted `email`, `default_address_id`, `marketing_consent_at`.
func TestGolden_CustomerProfile_ClosedShape(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
		strings.NewReader(`{"first_name":"Shape","last_name":"Check"}`))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	data := dataOf(t, rec.Body.Bytes())
	assertKeysExactly(t, "CustomerProfile", data, []string{
		"account_id", "first_name", "last_name", "email", "email_verified",
		"phone_e164", "avatar_url", "default_address_id", "marketing_consent_at",
		"created_at",
	})

	// Type + nullability spot checks against the schema.
	var p struct {
		AccountID          string          `json:"account_id"`
		FirstName          string          `json:"first_name"`
		EmailVerified      bool            `json:"email_verified"`
		PhoneE164          string          `json:"phone_e164"`
		CreatedAt          string          `json:"created_at"`
		MarketingConsentAt json.RawMessage `json:"marketing_consent_at"`
	}
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatalf("typed unmarshal: %v", err)
	}
	if p.AccountID != f.customerAccountID {
		t.Errorf("account_id=%q, want %q", p.AccountID, f.customerAccountID)
	}
	// marketing_consent_at must be a string OR null — never a bool, never a number.
	s := strings.TrimSpace(string(p.MarketingConsentAt))
	if s != "null" && !strings.HasPrefix(s, `"`) {
		t.Errorf("marketing_consent_at must be a date-time string or null, got %s", s)
	}
	// created_at must be the G-9 Timestamp scalar (…Z, millisecond precision).
	if !strings.HasSuffix(p.CreatedAt, "Z") || len(p.CreatedAt) != len("2006-01-02T15:04:05.000Z") {
		t.Errorf("created_at not a G-9 Timestamp: %q", p.CreatedAt)
	}
}

// TestGolden_CustomerProfile_MarketingConsentAt_SetShape asserts that once
// consent is granted, marketing_consent_at is a non-null Timestamp string (never
// a bare boolean) — the field the contract actually defines.
func TestGolden_CustomerProfile_MarketingConsentAt_SetShape(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
		strings.NewReader(`{"marketing_consent":true}`))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var p struct {
		MarketingConsentAt *string `json:"marketing_consent_at"`
	}
	if err := json.Unmarshal(dataOf(t, rec.Body.Bytes()), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.MarketingConsentAt == nil {
		t.Fatalf("marketing_consent_at must be set (Timestamp) after consent granted")
	}
	if !strings.HasSuffix(*p.MarketingConsentAt, "Z") {
		t.Errorf("marketing_consent_at not a Timestamp: %q", *p.MarketingConsentAt)
	}
}

// TestGolden_Device_ClosedShape asserts the registerDevice response is exactly
// the Device schema, and that role_context is a valid Role enum member — never
// the DB-collapsed "RESTAURANT" (which is not in the Role enum).
func TestGolden_Device_ClosedShape(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	validRoles := map[string]bool{
		"CUSTOMER": true, "RIDER": true, "RESTAURANT_OWNER": true,
		"RESTAURANT_MANAGER": true, "RESTAURANT_STAFF": true,
		"SUPPORT_AGENT": true, "ADMIN": true, "SUPER_ADMIN": true,
	}
	validPlatforms := map[string]bool{"ios": true, "android": true, "web": true}

	cases := []struct {
		roleCtx   string
		principal httpx.Principal
		platform  string
	}{
		{"CUSTOMER", customerPrincipal(f.customerAccountID), "ios"},
		{"RIDER", riderPrincipal(f.riderAccountID), "android"},
		{"RESTAURANT_OWNER", restaurantOwnerPrincipal(f.customerAccountID), "web"},
		{"RESTAURANT_MANAGER", restaurantManagerPrincipal(f.customerAccountID), "ios"},
		{"RESTAURANT_STAFF", restaurantStaffPrincipal(f.customerAccountID), "android"},
	}
	for _, tc := range cases {
		t.Run(tc.roleCtx, func(t *testing.T) {
			token := fmt.Sprintf("ExponentPushToken[shape-%s-%d]", tc.roleCtx, time.Now().UnixNano())
			body := validDeviceBody(token, "shape-dev-"+tc.roleCtx, tc.platform, tc.roleCtx)
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
			req = withPrincipal(req, tc.principal)
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
			}

			data := dataOf(t, rec.Body.Bytes())
			assertKeysExactly(t, "Device", data, []string{
				"device_id", "platform", "role_context", "push_enabled", "last_seen_at",
			})

			var d struct {
				Platform    string `json:"platform"`
				RoleContext string `json:"role_context"`
				PushEnabled bool   `json:"push_enabled"`
				LastSeenAt  string `json:"last_seen_at"`
			}
			if err := json.Unmarshal(data, &d); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			// Closed Role enum — the leak this catches is "RESTAURANT".
			if !validRoles[d.RoleContext] {
				t.Errorf("role_context=%q is not a valid Role enum member", d.RoleContext)
			}
			// The response must echo the contract-valid role the caller sent.
			if d.RoleContext != tc.roleCtx {
				t.Errorf("role_context=%q, want %q (echo of submitted Role)", d.RoleContext, tc.roleCtx)
			}
			if !validPlatforms[d.Platform] {
				t.Errorf("platform=%q not a DevicePlatform enum member", d.Platform)
			}
			if !strings.HasSuffix(d.LastSeenAt, "Z") {
				t.Errorf("last_seen_at not a Timestamp: %q", d.LastSeenAt)
			}
		})
	}
}

// TestGolden_Notification_ClosedShape asserts each notification item carries
// only Notification-schema keys and closed enums (priority ∈ NotificationPriority),
// with read_at/deep_link nullable and present.
func TestGolden_Notification_ClosedShape(t *testing.T) {
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

	// Envelope closure: {data, meta} only.
	var env struct {
		Data []json.RawMessage `json:"data"`
		Meta json.RawMessage   `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope: %v", err)
	}
	if len(env.Data) == 0 {
		t.Fatal("expected at least one seeded notification")
	}
	// meta keys ⊆ {next_cursor, has_more, total}; next_cursor + has_more required.
	metaKeys := jsonKeys(t, env.Meta)
	for _, must := range []string{"has_more", "next_cursor"} {
		found := false
		for _, k := range metaKeys {
			if k == must {
				found = true
			}
		}
		if !found {
			t.Errorf("meta missing required key %q (got %v)", must, metaKeys)
		}
	}
	for _, k := range metaKeys {
		if k != "has_more" && k != "next_cursor" && k != "total" {
			t.Errorf("meta carries non-PageMeta key %q", k)
		}
	}

	validPriority := map[string]bool{"CRITICAL": true, "HIGH": true, "NORMAL": true, "LOW": true}
	for i, item := range env.Data {
		// Notification schema: required id,kind,title,body,priority,created_at,read_at
		// optional deep_link (this impl always includes it, which is permitted).
		assertKeysExactly(t, fmt.Sprintf("Notification[%d]", i), item, []string{
			"id", "kind", "title", "body", "priority", "deep_link", "created_at", "read_at",
		})
		var n struct {
			Priority  string          `json:"priority"`
			ReadAt    json.RawMessage `json:"read_at"`
			DeepLink  json.RawMessage `json:"deep_link"`
			CreatedAt string          `json:"created_at"`
		}
		if err := json.Unmarshal(item, &n); err != nil {
			t.Fatalf("item unmarshal: %v", err)
		}
		if !validPriority[n.Priority] {
			t.Errorf("Notification[%d].priority=%q not in NotificationPriority enum", i, n.Priority)
		}
		// read_at + deep_link must be string OR null, never another type.
		for name, raw := range map[string]json.RawMessage{"read_at": n.ReadAt, "deep_link": n.DeepLink} {
			s := strings.TrimSpace(string(raw))
			if s != "null" && !strings.HasPrefix(s, `"`) {
				t.Errorf("Notification[%d].%s must be string or null, got %s", i, name, s)
			}
		}
		if !strings.HasSuffix(n.CreatedAt, "Z") {
			t.Errorf("Notification[%d].created_at not a Timestamp: %q", i, n.CreatedAt)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// B) AUTHZ LEAK — every non-x-role denied; x-roles allowed; route not public
// ═══════════════════════════════════════════════════════════════════════════════

// TestAuthz_UpdateProfile_EveryNonCustomerDenied: updateCustomerProfile is
// x-roles:[CUSTOMER]. EVERY other role in the Role enum must get 403 — not 401,
// not 200, not a bare 500. This is the full deny sweep the Stage-2 suite only
// spot-checked (RIDER, ADMIN).
func TestAuthz_UpdateProfile_EveryNonCustomerDenied(t *testing.T) {
	nonCustomer := []struct {
		name string
		p    httpx.Principal
	}{
		{"RIDER", riderPrincipal("a")},
		{"RESTAURANT_OWNER", restaurantOwnerPrincipal("a")},
		{"RESTAURANT_MANAGER", restaurantManagerPrincipal("a")},
		{"RESTAURANT_STAFF", restaurantStaffPrincipal("a")},
		{"SUPPORT_AGENT", httpx.Principal{AccountID: "a", Roles: []httpx.Role{httpx.RoleSupportAgent}}},
		{"ADMIN", adminPrincipal("a")},
		{"SUPER_ADMIN", httpx.Principal{AccountID: "a", Roles: []httpx.Role{httpx.RoleSuperAdmin}}},
	}
	for _, tc := range nonCustomer {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
				strings.NewReader(`{"first_name":"X"}`))
			req = withPrincipal(req, tc.p)
			rec := httptest.NewRecorder()
			h.UpdateCustomerProfile(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s: status=%d, want 403 (body: %s)", tc.name, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "FORBIDDEN" {
				t.Errorf("%s: code=%q, want FORBIDDEN", tc.name, c)
			}
		})
	}
}

// TestAuthz_DeviceAndNotification_SupportAndSuperAdminDenied: the device +
// notification ops are x-roles:[CUSTOMER,RIDER,RESTAURANT_*]. SUPPORT_AGENT,
// ADMIN and SUPER_ADMIN are NOT listed and must be denied on every one of them.
func TestAuthz_DeviceAndNotification_SupportAndSuperAdminDenied(t *testing.T) {
	deniers := []struct {
		name string
		p    httpx.Principal
	}{
		{"SUPPORT_AGENT", httpx.Principal{AccountID: "a", Roles: []httpx.Role{httpx.RoleSupportAgent}}},
		{"ADMIN", adminPrincipal("a")},
		{"SUPER_ADMIN", httpx.Principal{AccountID: "a", Roles: []httpx.Role{httpx.RoleSuperAdmin}}},
	}
	for _, d := range deniers {
		t.Run(d.name+"/registerDevice", func(t *testing.T) {
			h := newHandlerNil()
			body := validDeviceBody("ExponentPushToken[x]", "dev", "ios", "CUSTOMER")
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
			req = withPrincipal(req, d.p)
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			mustForbidden(t, rec)
		})
		t.Run(d.name+"/unregisterDevice", func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodDelete, "/v1/devices/dev", nil)
			req = withChiParam(req, "deviceId", "dev")
			req = withPrincipal(req, d.p)
			rec := httptest.NewRecorder()
			h.UnregisterDevice(rec, req)
			mustForbidden(t, rec)
		})
		t.Run(d.name+"/listNotifications", func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
			req = withPrincipal(req, d.p)
			rec := httptest.NewRecorder()
			h.ListNotifications(rec, req)
			mustForbidden(t, rec)
		})
		t.Run(d.name+"/markNotificationRead", func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodPost, "/v1/notifications/x/read", nil)
			req = withChiParam(req, "notificationId", "x")
			req = withPrincipal(req, d.p)
			rec := httptest.NewRecorder()
			h.MarkNotificationRead(rec, req)
			mustForbidden(t, rec)
		})
	}
}

func mustForbidden(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(rec.Body.Bytes()); c != "FORBIDDEN" {
		t.Errorf("code=%q, want FORBIDDEN", c)
	}
}

// TestAuthz_RoutesNotPublic re-affirms deny-by-default: every account route
// carries a non-public Policy. (Complements TestRoutesVerify.)
func TestAuthz_RoutesNotPublic(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	accountRoutes(r)
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Fatalf("account declared PUBLIC routes: %v — deny-by-default violated", pub)
	}
	if err := r.Verify(); err != nil {
		t.Fatalf("router.Verify: %v", err)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// C) DATA ISOLATION / IDOR — no field of a foreign tenant ever leaks
// ═══════════════════════════════════════════════════════════════════════════════

// TestIsolation_ListNotifications_NeverLeaksForeignField: the caller's inbox
// must contain none of the OTHER account's notification — asserted by id AND by
// the distinctive body text seeded for the other tenant ("Other body.").
func TestIsolation_ListNotifications_NeverLeaksForeignField(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/notifications?limit=100", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	raw := rec.Body.String()
	if strings.Contains(raw, f.otherNotifID) {
		t.Errorf("IDOR: caller inbox contains other tenant's notification id")
	}
	if strings.Contains(raw, "Other body.") {
		t.Errorf("IDOR: caller inbox leaked other tenant's notification body")
	}
}

// TestIsolation_ListNotifications_CursorCannotCrossTenant: passing another
// account's notification id as the cursor must NOT act as a valid keyset anchor
// that could expose that account's data. The caller only ever sees their own
// rows regardless of the cursor value.
func TestIsolation_ListNotifications_CursorCannotCrossTenant(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet,
		"/v1/notifications?limit=100&cursor="+f.otherNotifID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)
	// Must not 500; must not leak the other tenant's row.
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), f.otherNotifID) {
		t.Errorf("IDOR: foreign cursor exposed the foreign notification")
	}
}

// TestIsolation_UpdateProfile_ForeignHasNoRow_404: a caller whose account has no
// customer_profile row (here: the rider account acting with a forged CUSTOMER
// principal) gets 404 and never touches another tenant's row — and the response
// leaks no profile field.
func TestIsolation_UpdateProfile_ForeignHasNoRow_404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
		strings.NewReader(`{"first_name":"NoRow"}`))
	req = withPrincipal(req, customerPrincipal(f.riderAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(rec.Body.Bytes()); c != "NOT_FOUND" {
		t.Errorf("code=%q, want NOT_FOUND", c)
	}
	// The other tenant's profile row must be untouched.
	var otherName string
	if err := pool.QueryRow(context.Background(),
		`SELECT first_name FROM customer_profile WHERE account_id=$1`, f.otherAccountID).Scan(&otherName); err != nil {
		t.Fatalf("read other: %v", err)
	}
	if otherName == "NoRow" {
		t.Errorf("IDOR: 404 path mutated another tenant's profile")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// D) MONEY / NO-PRICE — no monetary field on any inbound OR outbound account DTO
// ═══════════════════════════════════════════════════════════════════════════════

// TestMoney_NoPriceOnAnyResponse: none of the account responses may carry a
// *_cents / amount / price / total field — this package has no monetary surface
// and must not grow one silently.
func TestMoney_NoPriceOnAnyResponse(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	banned := []string{"cents", "price", "amount", "total", "\"tax", "subtotal"}

	// profile
	{
		req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
			strings.NewReader(`{"first_name":"M"}`))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.UpdateCustomerProfile(rec, req)
		assertNoBanned(t, "profile", rec.Body.String(), banned)
	}
	// device
	{
		token := fmt.Sprintf("ExponentPushToken[money-%d]", time.Now().UnixNano())
		req := httptest.NewRequest(http.MethodPost, "/v1/devices",
			strings.NewReader(validDeviceBody(token, "money-dev", "ios", "CUSTOMER")))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.RegisterDevice(rec, req)
		assertNoBanned(t, "device", rec.Body.String(), banned)
	}
	// notifications
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.ListNotifications(rec, req)
		assertNoBanned(t, "notifications", rec.Body.String(), banned)
	}
}

func assertNoBanned(t *testing.T, where, body string, banned []string) {
	t.Helper()
	low := strings.ToLower(body)
	for _, b := range banned {
		if strings.Contains(low, strings.ToLower(b)) {
			t.Errorf("%s: response leaked a monetary-shaped field containing %q: %s", where, b, body)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// F) CONCURRENCY / IDEMPOTENCY — a write run twice concurrently has one effect
// ═══════════════════════════════════════════════════════════════════════════════

// TestConcurrency_RegisterDevice_SameTokenTwice_OneRow fires the same device
// registration from N goroutines at once; the (account_id, device_id) upsert +
// the device_token_one_account unique index must leave exactly ONE live row.
func TestConcurrency_RegisterDevice_SameTokenTwice_OneRow(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	token := fmt.Sprintf("ExponentPushToken[conc-%d]", time.Now().UnixNano())
	devID := "conc-dev"
	body := validDeviceBody(token, devID, "ios", "CUSTOMER")

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
			req = withPrincipal(req, customerPrincipal(f.customerAccountID))
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()

	// No request may have crashed with a 500.
	for i, c := range codes {
		if c == http.StatusInternalServerError {
			t.Errorf("goroutine %d got 500 under concurrency", i)
		}
	}
	var live int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE account_id=$1 AND device_id=$2 AND revoked_at IS NULL`,
		f.customerAccountID, devID).Scan(&live); err != nil {
		t.Fatalf("count: %v", err)
	}
	if live != 1 {
		t.Errorf("concurrent idempotency: want exactly 1 live device row, got %d", live)
	}
	// Also assert token uniqueness across the account under concurrency.
	var liveToken int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE expo_push_token=$1 AND revoked_at IS NULL`,
		token).Scan(&liveToken); err != nil {
		t.Fatalf("count token: %v", err)
	}
	if liveToken != 1 {
		t.Errorf("token_one_account: want 1 live binding, got %d", liveToken)
	}
}

// TestConcurrency_MarkNotificationRead_NoDoubleEffect marks the same
// notification read from N goroutines; read_at must be set once and stable
// (COALESCE keeps the first timestamp), and no goroutine may 500 or 404.
func TestConcurrency_MarkNotificationRead_NoDoubleEffect(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost,
				"/v1/notifications/"+f.notificationID+"/read", nil)
			req = withChiParam(req, "notificationId", f.notificationID)
			req = withPrincipal(req, customerPrincipal(f.customerAccountID))
			rec := httptest.NewRecorder()
			h.MarkNotificationRead(rec, req)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()

	for i, c := range codes {
		if c != http.StatusNoContent {
			t.Errorf("goroutine %d: status=%d, want 204", i, c)
		}
	}
	var readAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT read_at FROM notification WHERE id=$1`, f.notificationID).Scan(&readAt); err != nil {
		t.Fatalf("read: %v", err)
	}
	if readAt == nil {
		t.Errorf("read_at must be set after concurrent markRead")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// G) ERROR TAXONOMY — every failure returns a contract ErrorCode, never bare 500
// ═══════════════════════════════════════════════════════════════════════════════

// TestErrorTaxonomy_MalformedAndHostileInput: malformed JSON, wrong-typed
// fields and structurally invalid bodies must all fail as a contract
// VALIDATION_FAILED (422), never a bare 500 or an empty error code. These
// bodies are rejected at decode time, before the store is reached, so a nil
// store is sufficient (and proves the rejection is not store-dependent).
func TestErrorTaxonomy_MalformedAndHostileInput(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"not_json", `}{not json`},
		{"first_name_wrong_type", `{"first_name":123}`},
		{"marketing_consent_wrong_type", `{"marketing_consent":"yes"}`},
		{"trailing_content", `{"first_name":"A"}{"x":1}`},
		{"array_body", `[1,2,3]`},
		{"unknown_field", `{"nope":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(tc.body))
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.UpdateCustomerProfile(rec, req)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s: status=%d, want 422 (body: %s)", tc.name, rec.Code, rec.Body.String())
			}
			c := errCode(rec.Body.Bytes())
			if c != "VALIDATION_FAILED" {
				t.Errorf("%s: code=%q, want VALIDATION_FAILED", tc.name, c)
			}
			if !contractErrorCodes[c] {
				t.Errorf("%s: code=%q is not a contract ErrorCode", tc.name, c)
			}
		})
	}
}

// TestErrorTaxonomy_EmptyAndNullBody_WiredNoBareError: an empty PATCH body or an
// explicit JSON null is an empty patch — on the WIRED handler it must resolve to
// a defined outcome (200 no-op update or a contract 4xx), never a bare 500.
// This guards the store-reachable path the nil-store test cannot exercise.
func TestErrorTaxonomy_EmptyAndNullBody_WiredNoBareError(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	for _, body := range []string{``, `null`, `{}`} {
		req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.UpdateCustomerProfile(rec, req)
		if rec.Code == http.StatusInternalServerError {
			t.Fatalf("body=%q: bare 500 (body: %s)", body, rec.Body.String())
		}
		if rec.Code >= 400 {
			// If rejected, it must be a contract code — never bare/empty.
			if c := errCode(rec.Body.Bytes()); !contractErrorCodes[c] {
				t.Errorf("body=%q: status=%d code=%q is not a contract ErrorCode", body, rec.Code, c)
			}
		} else if rec.Code == http.StatusOK {
			// Empty patch must still return a shape-valid CustomerProfile.
			assertKeysExactly(t, "CustomerProfile(empty-patch)", dataOf(t, rec.Body.Bytes()), []string{
				"account_id", "first_name", "last_name", "email", "email_verified",
				"phone_e164", "avatar_url", "default_address_id", "marketing_consent_at",
				"created_at",
			})
		}
	}
}

// TestErrorTaxonomy_RegisterDevice_HostileBodies: registerDevice rejects
// malformed / hostile bodies with a contract code, never a 500.
func TestErrorTaxonomy_RegisterDevice_HostileBodies(t *testing.T) {
	cases := []struct{ name, body string }{
		{"not_json", `{{{`},
		{"platform_wrong_type", `{"expo_push_token":"t","device_id":"d","platform":123,"role_context":"CUSTOMER"}`},
		{"role_context_not_a_role", `{"expo_push_token":"t","device_id":"d","platform":"ios","role_context":"WIZARD"}`},
		{"role_context_collapsed_value", `{"expo_push_token":"t","device_id":"d","platform":"ios","role_context":"RESTAURANT"}`},
		{"missing_role_context", `{"expo_push_token":"t","device_id":"d","platform":"ios"}`},
		{"empty_body", ``},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandlerNil()
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(tc.body))
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s: status=%d, want 422 (body: %s)", tc.name, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "VALIDATION_FAILED" {
				t.Errorf("%s: code=%q, want VALIDATION_FAILED", tc.name, c)
			}
		})
	}
}
