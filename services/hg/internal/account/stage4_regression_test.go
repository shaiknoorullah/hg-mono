package account_test

// Stage 4 — ADVERSARIAL REVIEW regressions.
//
// Each test below reproduces a concrete bug found by throwing hostile / boundary
// inputs at the write and read operations, and pins the fix so it cannot regress.
//
// Findings covered:
//   R1  registerDevice: same account + same token + different device_id → was 500
//       (token-uniqueness index violation). Fix: revoke every OTHER live row of
//       the token (not only foreign accounts) inside one transaction.
//   R2  listNotifications: non-numeric / out-of-range ?limit= → was silently
//       defaulted to 20. Contract: "A non-numeric value is a 422, never a silent
//       NaN". Fix: reject with 422 VALIDATION_FAILED.
//   R3  listNotifications: malformed (non-UUID) ?cursor= → was 500 (uuid cast).
//       Fix: reject with 422 before the store.
//   R4  markNotificationRead: malformed (non-UUID) {notificationId} → was 500.
//       Fix: 404 (indistinguishable from a non-existent resource; IDOR-safe).
//   R5  updateCustomerProfile: the contract permits `email`, but it was rejected
//       as UNKNOWN_FIELD. Fix: accept it, reset email_verified, EMAIL_IN_USE on
//       collision.
//   R6  updateCustomerProfile: first_name / last_name maxLength=50 unenforced.
//   R7  registerDevice: device_id maxLength=128 / expo_push_token maxLength=256
//       unenforced.
//   R8  updateCustomerProfile: a soft-deleted (deleted_at) profile was still
//       updatable and resurfaced. Fix: scope to deleted_at IS NULL → 404.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
)

// ─── R1: same account, same token, different device_id → one live row, no 500 ──

func TestRegression_RegisterDevice_SameAccountSameTokenTwoDevices(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	token := fmt.Sprintf("ExponentPushToken[r1-%d]", time.Now().UnixNano())

	reg := func(devID string) *httptest.ResponseRecorder {
		body := validDeviceBody(token, devID, "ios", "CUSTOMER")
		req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.RegisterDevice(rec, req)
		return rec
	}

	if rec := reg("r1-dev-A"); rec.Code != http.StatusOK {
		t.Fatalf("first register: status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := reg("r1-dev-B")
	if rec.Code == http.StatusInternalServerError {
		t.Fatalf("BUG R1: same account+token, different device_id → 500 (body: %s)", rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("second register: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// The token-uniqueness invariant: exactly one live binding of this token.
	var live int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE expo_push_token=$1 AND revoked_at IS NULL`,
		token).Scan(&live); err != nil {
		t.Fatalf("count live: %v", err)
	}
	if live != 1 {
		t.Errorf("token must have exactly 1 live binding after device_id move, got %d", live)
	}
	// And it must be bound to the NEW device_id, with the old one revoked.
	var liveDev string
	if err := pool.QueryRow(context.Background(),
		`SELECT device_id FROM device WHERE expo_push_token=$1 AND revoked_at IS NULL`,
		token).Scan(&liveDev); err != nil {
		t.Fatalf("read live dev: %v", err)
	}
	if liveDev != "r1-dev-B" {
		t.Errorf("live device_id=%q, want r1-dev-B (latest registration wins)", liveDev)
	}
}

// ─── R2: limit validation — non-numeric / out-of-range → 422 ──────────────────

func TestRegression_ListNotifications_LimitValidation(t *testing.T) {
	h := account.NewHandler(nil) // rejected before the store is reached
	bad := []string{"abc", "0", "-1", "101", "200", "9999999999999999999999", "1.5", ""}
	for _, l := range bad {
		t.Run("limit="+l, func(t *testing.T) {
			u := "/v1/notifications?" + url.Values{"limit": {l}}.Encode()
			req := httptest.NewRequest(http.MethodGet, u, nil)
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.ListNotifications(rec, req)
			// Empty string is treated as "absent" → falls through to the store
			// (nil), which yields 501; every genuinely-bad value is 422.
			if l == "" {
				if rec.Code == http.StatusInternalServerError {
					t.Fatalf("empty limit → 500 (body: %s)", rec.Body.String())
				}
				return
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("limit=%q: status=%d, want 422 (body: %s)", l, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "VALIDATION_FAILED" {
				t.Errorf("limit=%q: code=%q, want VALIDATION_FAILED", l, c)
			}
		})
	}
}

func TestRegression_ListNotifications_LimitInRangeAccepted(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)
	for _, l := range []string{"1", "20", "100"} {
		u := "/v1/notifications?" + url.Values{"limit": {l}}.Encode()
		req := httptest.NewRequest(http.MethodGet, u, nil)
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.ListNotifications(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("limit=%q: status=%d, want 200 (body: %s)", l, rec.Code, rec.Body.String())
		}
	}
}

// ─── R3: malformed cursor → 422, never 500, never a cross-tenant leak ─────────

func TestRegression_ListNotifications_MalformedCursor(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	bad := []string{"not-a-uuid", "12345", "abc-def", "0000", "%20"}
	for _, c := range bad {
		t.Run("cursor="+c, func(t *testing.T) {
			u := "/v1/notifications?" + url.Values{"cursor": {c}}.Encode()
			req := httptest.NewRequest(http.MethodGet, u, nil)
			req = withPrincipal(req, customerPrincipal(f.customerAccountID))
			rec := httptest.NewRecorder()
			h.ListNotifications(rec, req)
			if rec.Code == http.StatusInternalServerError {
				t.Fatalf("BUG R3: malformed cursor %q → 500 (body: %s)", c, rec.Body.String())
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("cursor=%q: status=%d, want 422 (body: %s)", c, rec.Code, rec.Body.String())
			}
			if ec := errCode(rec.Body.Bytes()); ec != "VALIDATION_FAILED" {
				t.Errorf("cursor=%q: code=%q, want VALIDATION_FAILED", c, ec)
			}
		})
	}
}

// A well-formed UUID cursor that belongs to no notification must still be safe:
// no rows, no 500.
func TestRegression_ListNotifications_UnknownUUIDCursor(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	const phantom = "00000000-dead-4000-8000-000000000000"
	u := "/v1/notifications?" + url.Values{"cursor": {phantom}}.Encode()
	req := httptest.NewRequest(http.MethodGet, u, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListNotifications(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unknown uuid cursor: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── R4: malformed notificationId → 404, never 500 ────────────────────────────

func TestRegression_MarkNotificationRead_MalformedID(t *testing.T) {
	h := account.NewHandler(nil) // rejected before the store on the UUID guard
	bad := []string{"not-a-uuid", "12345", "'; DROP--", "abc", " "}
	for _, id := range bad {
		t.Run("id="+id, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/notifications/x/read", nil)
			req = withChiParam(req, "notificationId", id)
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.MarkNotificationRead(rec, req)
			if rec.Code == http.StatusInternalServerError {
				t.Fatalf("BUG R4: malformed notificationId %q → 500", id)
			}
			if rec.Code != http.StatusNotFound {
				t.Fatalf("notificationId=%q: status=%d, want 404 (body: %s)", id, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "NOT_FOUND" {
				t.Errorf("notificationId=%q: code=%q, want NOT_FOUND", id, c)
			}
		})
	}
}

// ─── R5: email is a contract field — accepted, resets verified, EMAIL_IN_USE ──

// A valid email change succeeds and resets email_verified to false (C-03).
func TestRegression_UpdateProfile_EmailAcceptedResetsVerified(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// Pre-verify the caller's email so we can observe the reset.
	if _, err := pool.Exec(context.Background(),
		`UPDATE account SET email_verified_at = now() WHERE id = $1`, f.customerAccountID); err != nil {
		t.Fatalf("pre-verify: %v", err)
	}

	newEmail := fmt.Sprintf("changed-%d@test.local", time.Now().UnixNano())
	body := fmt.Sprintf(`{"email":%q}`, newEmail)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("email change: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			Email         *string `json:"email"`
			EmailVerified bool    `json:"email_verified"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.Email == nil || *env.Data.Email != newEmail {
		t.Errorf("email=%v, want %q", env.Data.Email, newEmail)
	}
	if env.Data.EmailVerified {
		t.Errorf("email_verified must reset to false after an email change (C-03)")
	}
	// DB reflects the reset.
	var verifiedAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT email_verified_at FROM account WHERE id=$1`, f.customerAccountID).Scan(&verifiedAt); err != nil {
		t.Fatalf("read verified: %v", err)
	}
	if verifiedAt != nil {
		t.Errorf("email_verified_at must be NULL after an email change")
	}
}

// An email already registered to ANOTHER account is EMAIL_IN_USE (422), not 500,
// and the caller's own email is left untouched.
func TestRegression_UpdateProfile_EmailInUse(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	// The other account's email.
	var otherEmail string
	if err := pool.QueryRow(context.Background(),
		`SELECT email::text FROM account WHERE id=$1`, f.otherAccountID).Scan(&otherEmail); err != nil {
		t.Fatalf("read other email: %v", err)
	}
	var callerBefore string
	if err := pool.QueryRow(context.Background(),
		`SELECT email::text FROM account WHERE id=$1`, f.customerAccountID).Scan(&callerBefore); err != nil {
		t.Fatalf("read caller email: %v", err)
	}

	body := fmt.Sprintf(`{"email":%q}`, otherEmail)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code == http.StatusInternalServerError {
		t.Fatalf("BUG: EMAIL_IN_USE surfaced as 500 (body: %s)", rec.Body.String())
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("duplicate email: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(rec.Body.Bytes()); c != "EMAIL_IN_USE" {
		t.Errorf("code=%q, want EMAIL_IN_USE", c)
	}
	// The caller's email must be unchanged (transaction rolled back).
	var callerAfter string
	if err := pool.QueryRow(context.Background(),
		`SELECT email::text FROM account WHERE id=$1`, f.customerAccountID).Scan(&callerAfter); err != nil {
		t.Fatalf("read caller email after: %v", err)
	}
	if callerAfter != callerBefore {
		t.Errorf("caller email mutated on a failed email change: %q → %q", callerBefore, callerAfter)
	}
}

// Malformed email shapes are rejected as VALIDATION_FAILED, never reaching the DB.
func TestRegression_UpdateProfile_EmailFormat(t *testing.T) {
	h := account.NewHandler(nil)
	bad := []string{`"noatsign"`, `"a@b"`, `"@nolocal.com"`, `"has space@x.com"`, `""`}
	for _, e := range bad {
		body := `{"email":` + e + `}`
		req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
		req = withPrincipal(req, customerPrincipal("acct-c"))
		rec := httptest.NewRecorder()
		h.UpdateCustomerProfile(rec, req)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("email=%s: status=%d, want 422 (body: %s)", e, rec.Code, rec.Body.String())
		}
	}
}

// ─── R6: first_name / last_name maxLength enforced ────────────────────────────

func TestRegression_UpdateProfile_NameMaxLength(t *testing.T) {
	h := account.NewHandler(nil)
	long := strings.Repeat("x", 51)
	cases := []struct{ name, body string }{
		{"first_name>50", `{"first_name":"` + long + `"}`},
		{"last_name>50", `{"last_name":"` + long + `"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(tc.body))
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.UpdateCustomerProfile(rec, req)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s: status=%d, want 422 (body: %s)", tc.name, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "VALIDATION_FAILED" {
				t.Errorf("%s: code=%q, want VALIDATION_FAILED", tc.name, c)
			}
		})
	}

	// Exactly 50 is allowed (boundary), rejected only at 51.
	ok := strings.Repeat("y", 50)
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
		strings.NewReader(`{"first_name":"`+ok+`"}`))
	req = withPrincipal(req, customerPrincipal("acct-c"))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	// nil store → 501, but must NOT be a 422 validation rejection.
	if rec.Code == http.StatusUnprocessableEntity {
		t.Errorf("first_name of exactly 50 chars must be accepted, got 422")
	}
}

// ─── R7: device_id / expo_push_token maxLength enforced ───────────────────────

func TestRegression_RegisterDevice_LengthCaps(t *testing.T) {
	h := account.NewHandler(nil)
	cases := []struct {
		name  string
		token string
		dev   string
	}{
		{"device_id>128", "ExponentPushToken[x]", strings.Repeat("d", 129)},
		{"token>256", "ExponentPushToken[" + strings.Repeat("t", 260) + "]", "dev-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := validDeviceBody(tc.token, tc.dev, "ios", "CUSTOMER")
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
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

// ─── R8: soft-deleted profile is not updatable → 404, no resurrection ─────────

func TestRegression_UpdateProfile_SoftDeleted404(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	if _, err := pool.Exec(context.Background(),
		`UPDATE customer_profile SET deleted_at = now() WHERE account_id = $1`,
		f.customerAccountID); err != nil {
		t.Fatalf("soft-delete: %v", err)
	}

	body := `{"first_name":"Zombie"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile", strings.NewReader(body))
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.UpdateCustomerProfile(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("soft-deleted profile update: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(rec.Body.Bytes()); c != "NOT_FOUND" {
		t.Errorf("code=%q, want NOT_FOUND", c)
	}
	// The row must NOT have been resurrected/edited.
	var firstName string
	var deletedAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT first_name, deleted_at FROM customer_profile WHERE account_id=$1`,
		f.customerAccountID).Scan(&firstName, &deletedAt); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if firstName == "Zombie" {
		t.Errorf("soft-deleted profile was mutated (resurrected)")
	}
	if deletedAt == nil {
		t.Errorf("soft-deleted profile lost its deleted_at (resurrected)")
	}
}

// ─── R9: concurrent same-token, DIFFERENT device_ids → one live row, no 500 ───
//
// A harder race than the same-device_id concurrency test: N goroutines register
// the SAME token under N DIFFERENT device_ids at once. Under READ COMMITTED the
// revoke+insert transactions could each miss the others' uncommitted inserts and
// the losers would trip the token-uniqueness index (23505 → 500). A
// transaction-scoped advisory lock on the token serialises them.
func TestRegression_RegisterDevice_ConcurrentSameTokenManyDevices(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)

	token := fmt.Sprintf("ExponentPushToken[r9-%d]", time.Now().UnixNano())
	const n = 10
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := validDeviceBody(token, fmt.Sprintf("r9-dev-%d", i), "ios", "CUSTOMER")
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(body))
			req = withPrincipal(req, customerPrincipal(f.customerAccountID))
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			codes[i] = rec.Code
		}(i)
	}
	wg.Wait()

	for i, c := range codes {
		if c == http.StatusInternalServerError {
			t.Errorf("goroutine %d: 500 under concurrent same-token many-device", i)
		}
	}
	var live int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM device WHERE expo_push_token=$1 AND revoked_at IS NULL`,
		token).Scan(&live); err != nil {
		t.Fatalf("count live: %v", err)
	}
	if live != 1 {
		t.Errorf("token-uniqueness under concurrency: want exactly 1 live binding, got %d", live)
	}
}

// ─── Extra hostile boundary sweep on registerDevice (≥5 hostile inputs) ───────

func TestRegression_RegisterDevice_HostileSweep(t *testing.T) {
	h := account.NewHandler(nil)
	cases := []struct{ name, body string }{
		{"null_body", `null`},
		{"array_body", `[1,2,3]`},
		{"number_body", `42`},
		{"platform_null", `{"expo_push_token":"t","device_id":"d","platform":null,"role_context":"CUSTOMER"}`},
		{"role_context_null", `{"expo_push_token":"t","device_id":"d","platform":"ios","role_context":null}`},
		{"token_whitespace_only_ok_shape_but_platform_bad", `{"expo_push_token":"t","device_id":"d","platform":"desktop","role_context":"CUSTOMER"}`},
		{"nested_unknown", `{"expo_push_token":"t","device_id":"d","platform":"ios","role_context":"CUSTOMER","meta":{"x":1}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/devices", strings.NewReader(tc.body))
			req = withPrincipal(req, customerPrincipal("acct-c"))
			rec := httptest.NewRecorder()
			h.RegisterDevice(rec, req)
			if rec.Code == http.StatusInternalServerError {
				t.Fatalf("%s: bare 500 on hostile input (body: %s)", tc.name, rec.Body.String())
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s: status=%d, want 422 (body: %s)", tc.name, rec.Code, rec.Body.String())
			}
			if c := errCode(rec.Body.Bytes()); c != "VALIDATION_FAILED" {
				t.Errorf("%s: code=%q, want VALIDATION_FAILED", tc.name, c)
			}
		})
	}
}
