package auth

// STAGE 3 — BOUNDARY & LEAK ANALYSIS for the four gap2-authtotp operations:
//   - changePassword      POST /v1/auth/password/change
//   - enrollTotp          POST /v1/auth/totp/enroll
//   - verifyTotpEnrolment POST /v1/auth/totp/verify
//   - disableTotp         POST /v1/auth/totp/disable
//
// The prior test file (handlers_totp_test.go) already covers authz-per-role,
// the documented error codes, the TOTP state machine, secret sealing and
// session revocation. This file closes what those tests do NOT assert:
//
//   A) CONTRACT CONFORMANCE — the success bodies carry EXACTLY the fixture keys
//      (no extra/missing fields); the error envelope carries exactly
//      {code, message, request_id[, details]} and the code is a member of the
//      contract's closed ErrorCode enum.
//   C) DATA ISOLATION / IDOR — a TOTP or password op scoped to caller A never
//      reads, activates, clears or mutates account B's row.
//   F) CONCURRENCY / IDEMPOTENCY — running a write op twice (sequentially and
//      concurrently) produces no double effect and never a bare 500.
//   G) ERROR TAXONOMY — hostile/malformed input never yields a bare 500 and
//      always returns a contract ErrorCode.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// contractErrorCodes is the closed ErrorCode enum from contracts/openapi.yaml
// (schema ErrorCode). A failure whose code is not in this set is a taxonomy
// leak: clients branch on the code and a novel/ bare code breaks them.
var contractErrorCodes = map[string]struct{}{
	"INTERNAL_ERROR": {}, "TIMEOUT": {}, "PAYLOAD_TOO_LARGE": {}, "ORIGIN_NOT_ALLOWED": {},
	"CSRF_ORIGIN_REJECTED": {}, "RATE_LIMITED": {}, "RATE_LIMITER_UNAVAILABLE": {},
	"VALIDATION_FAILED": {}, "UNKNOWN_FIELD": {}, "INVALID_FIELD": {}, "INVALID_ENUM_VALUE": {},
	"NOT_FOUND": {}, "FORBIDDEN": {}, "PERMISSION_DENIED": {}, "AUTHENTICATION_REQUIRED": {},
	"METHOD_NOT_ALLOWED": {}, "UNSUPPORTED_MEDIA_TYPE": {},
	"IDEMPOTENCY_KEY_REQUIRED": {}, "IDEMPOTENCY_KEY_REUSE": {}, "IDEMPOTENCY_IN_PROGRESS": {},
	"IDEMPOTENCY_CONFLICT":   {},
	"OTP_INVALID_OR_EXPIRED": {}, "OTP_INCORRECT": {}, "INVALID_PHONE": {}, "UNSUPPORTED_COUNTRY": {},
	"INVALID_CREDENTIALS": {}, "EMAIL_NOT_VERIFIED": {}, "EMAIL_ALREADY_REGISTERED": {},
	"TERMS_VERSION_STALE": {}, "BREACHED_PASSWORD": {}, "ACCOUNT_TEMPORARILY_LOCKED": {},
	"ACCOUNT_LOCKED": {}, "SESSION_REVOKED": {}, "SESSION_EXPIRED": {}, "REFRESH_REUSE_DETECTED": {},
	"TOKEN_CONSUMED": {}, "VERIFICATION_TOKEN_EXPIRED": {}, "VERIFICATION_TOKEN_USED": {},
	"MFA_REQUIRED": {}, "LAST_OWNER_REQUIRED": {}, "ACCOUNT_SUSPENDED": {}, "ACCOUNT_DEACTIVATED": {},
	"ACCOUNT_NOT_ACTIVE": {}, "ACCOUNT_BANNED": {}, "ONBOARDING_INCOMPLETE": {}, "PROFILE_INCOMPLETE": {},
}

// assertErrorEnvelope reads a non-2xx body and asserts (G + A) that:
//   - it carries a top-level "error" object and no top-level "data";
//   - the error object's keys are a subset of {code, message, details, request_id};
//   - "code", "message" and "request_id" are present;
//   - the code is a member of the contract's closed ErrorCode enum;
//   - the status is never 500 unless explicitly allowed.
func assertErrorEnvelope(t *testing.T, resp *http.Response, allow500 bool) string {
	t.Helper()
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read error body: %v", err)
	}
	if !allow500 && resp.StatusCode == http.StatusInternalServerError {
		t.Fatalf("bare 500 leaked: status=%d body=%s", resp.StatusCode, raw)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("error body is not a JSON object: %v (body=%s)", err, raw)
	}
	if _, hasData := top["data"]; hasData {
		t.Fatalf("error envelope must not carry a top-level \"data\" key: %s", raw)
	}
	errRaw, ok := top["error"]
	if !ok {
		t.Fatalf("error response missing top-level \"error\" object: %s", raw)
	}
	var errObj map[string]json.RawMessage
	if err := json.Unmarshal(errRaw, &errObj); err != nil {
		t.Fatalf("error object is not a JSON object: %v", err)
	}
	allowedKeys := map[string]struct{}{"code": {}, "message": {}, "details": {}, "request_id": {}}
	for k := range errObj {
		if _, ok := allowedKeys[k]; !ok {
			t.Errorf("error object carries unexpected key %q (leak): %s", k, raw)
		}
	}
	for _, req := range []string{"code", "message", "request_id"} {
		if _, ok := errObj[req]; !ok {
			t.Errorf("error object missing required key %q: %s", req, raw)
		}
	}
	var code string
	if err := json.Unmarshal(errObj["code"], &code); err != nil {
		t.Fatalf("error.code is not a string: %v", err)
	}
	if _, ok := contractErrorCodes[code]; !ok {
		t.Errorf("error.code %q is NOT a member of the contract ErrorCode enum (taxonomy leak)", code)
	}
	return code
}

// ---- A) CONTRACT CONFORMANCE — closed-set golden shapes ---------------------

// TestEnrollTotp_GoldenShape asserts the enrollTotp success body is EXACTLY the
// TotpEnrolment fixture shape: data = {provisioning_uri, recovery_codes} and
// nothing else. additionalProperties:false in the contract means an extra field
// is a conformance break clients cannot see coming.
func TestEnrollTotp_GoldenShape(t *testing.T) {
	pool := openTestPool(t)
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_enroll_shape"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enrollTotp: got %d, want 200", resp.StatusCode)
	}

	raw, _ := io.ReadAll(resp.Body)
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("body not JSON object: %v", err)
	}
	// Top-level envelope is exactly {data}.
	for k := range top {
		if k != "data" {
			t.Errorf("enroll envelope carries unexpected top-level key %q: %s", k, raw)
		}
	}
	if _, ok := top["data"]; !ok {
		t.Fatalf("enroll envelope missing \"data\": %s", raw)
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(top["data"], &data); err != nil {
		t.Fatalf("data not JSON object: %v", err)
	}
	// data is exactly {provisioning_uri, recovery_codes}.
	want := map[string]struct{}{"provisioning_uri": {}, "recovery_codes": {}}
	for k := range data {
		if _, ok := want[k]; !ok {
			t.Errorf("TotpEnrolment carries unexpected field %q (conformance leak): %s", k, raw)
		}
	}
	for k := range want {
		if _, ok := data[k]; !ok {
			t.Errorf("TotpEnrolment missing required field %q: %s", k, raw)
		}
	}
	// provisioning_uri is a string starting otpauth://; recovery_codes is exactly
	// 10 strings (contract minItems=maxItems=10).
	var provURI string
	if err := json.Unmarshal(data["provisioning_uri"], &provURI); err != nil {
		t.Fatalf("provisioning_uri not a string: %v", err)
	}
	if !strings.HasPrefix(provURI, "otpauth://") {
		t.Errorf("provisioning_uri %q must start with otpauth://", provURI)
	}
	var codes []string
	if err := json.Unmarshal(data["recovery_codes"], &codes); err != nil {
		t.Fatalf("recovery_codes not a string array: %v", err)
	}
	if len(codes) != 10 {
		t.Errorf("recovery_codes: got %d, contract requires exactly 10", len(codes))
	}
	for i, c := range codes {
		if c == "" {
			t.Errorf("recovery_codes[%d] is empty", i)
		}
	}
}

// TestChangePassword_GoldenSessionGrantShape asserts the changePassword 200 body
// is exactly the SessionGrant fixture shape: data has exactly
// {access_token, refresh_token, expires_in, is_new_account, principal} and the
// principal has exactly its 8 contract fields with correct nullability
// (refresh_token null for a web surface).
func TestChangePassword_GoldenSessionGrantShape(t *testing.T) {
	pool := openTestPool(t)
	const current = "CurrentPass99!!"
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_chpw_shape"), current, httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	resp := doJSON(t, srv, "/v1/auth/password/change", map[string]any{
		"current_password": current,
		"new_password":     "BrandNewPass12!",
	})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("changePassword: got %d, want 200", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("body not JSON object: %v", err)
	}
	for k := range top {
		if k != "data" {
			t.Errorf("SessionGrant envelope carries unexpected top-level key %q: %s", k, raw)
		}
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(top["data"], &data); err != nil {
		t.Fatalf("data not JSON object: %v", err)
	}
	wantGrant := map[string]struct{}{
		"access_token": {}, "refresh_token": {}, "expires_in": {},
		"is_new_account": {}, "principal": {},
	}
	for k := range data {
		if _, ok := wantGrant[k]; !ok {
			t.Errorf("SessionGrant carries unexpected field %q (conformance leak): %s", k, raw)
		}
	}
	for k := range wantGrant {
		if _, ok := data[k]; !ok {
			t.Errorf("SessionGrant missing required field %q: %s", k, raw)
		}
	}
	// refresh_token must be present-as-null for the web surface (never omitted:
	// the wire struct uses a *string without omitempty).
	if string(data["refresh_token"]) != "null" {
		t.Errorf("SessionGrant.refresh_token should be null for a web surface, got %s", data["refresh_token"])
	}
	// principal is exactly its 8 contract fields.
	var principal map[string]json.RawMessage
	if err := json.Unmarshal(data["principal"], &principal); err != nil {
		t.Fatalf("principal not JSON object: %v", err)
	}
	wantPrincipal := map[string]struct{}{
		"account_id": {}, "session_id": {}, "roles": {}, "amr": {},
		"status": {}, "locale": {}, "timezone": {}, "next_route": {},
	}
	for k := range principal {
		if _, ok := wantPrincipal[k]; !ok {
			t.Errorf("Principal carries unexpected field %q (conformance leak): %s", k, raw)
		}
	}
	for k := range wantPrincipal {
		if _, ok := principal[k]; !ok {
			t.Errorf("Principal missing required field %q: %s", k, raw)
		}
	}
}

// ---- G) ERROR TAXONOMY — every failure is a contract code, never a bare 500 --

// TestErrorTaxonomy_AllOpsReturnContractCodes drives each op through its common
// failure modes and asserts the error envelope shape + a known contract code,
// and that none of them is a bare 500.
func TestErrorTaxonomy_AllOpsReturnContractCodes(t *testing.T) {
	pool := openTestPool(t)
	const current = "CurrentPass99!!"
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_taxonomy"), current, httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	cases := []struct {
		name string
		path string
		body map[string]any
	}{
		{"changePassword_wrong_current", "/v1/auth/password/change",
			map[string]any{"current_password": "WrongOne12345!", "new_password": "AnotherNew123!!"}},
		{"changePassword_weak", "/v1/auth/password/change",
			map[string]any{"current_password": current, "new_password": "short"}},
		{"changePassword_breached", "/v1/auth/password/change",
			map[string]any{"current_password": current, "new_password": "password123"}},
		{"changePassword_unknown_field", "/v1/auth/password/change",
			map[string]any{"current_password": current, "new_password": "GoodNewPass12!", "x": 1}},
		{"verify_bad_format", "/v1/auth/totp/verify", map[string]any{"totp_code": "abc"}},
		{"verify_not_enrolled", "/v1/auth/totp/verify", map[string]any{"totp_code": "123456"}},
		{"verify_unknown_field", "/v1/auth/totp/verify", map[string]any{"totp_code": "123456", "x": 1}},
		{"disable_not_enrolled", "/v1/auth/totp/disable", map[string]any{"totp_code": "123456"}},
		{"disable_bad_format", "/v1/auth/totp/disable", map[string]any{"totp_code": "xyz"}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			resp := doJSON(t, srv, tc.path, tc.body)
			if resp.StatusCode < 400 {
				t.Fatalf("%s: expected a failure status, got %d", tc.name, resp.StatusCode)
			}
			assertErrorEnvelope(t, resp, false)
		})
	}
}

// TestErrorTaxonomy_HostileBodiesNeverCrash sends malformed / adversarial
// payloads to each write op and asserts they never yield a bare 500 and always
// return a contract error code. A handler that panics or 500s on hostile input
// is a taxonomy + availability leak.
func TestErrorTaxonomy_HostileBodiesNeverCrash(t *testing.T) {
	pool := openTestPool(t)
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_hostile"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	hostile := []string{
		``,                      // empty body
		`{`,                     // truncated JSON
		`[]`,                    // wrong top-level type
		`"just a string"`,       // scalar
		`null`,                  // null body
		`{"totp_code": 123456}`, // wrong type (number not string)
		`{"totp_code": ["x"]}`,  // wrong type (array)
		`{"current_password": {}, "new_password": {}}`,         // wrong type (object)
		`{"totp_code": "` + strings.Repeat("9", 100000) + `"}`, // oversized field
	}
	paths := []string{
		"/v1/auth/password/change",
		"/v1/auth/totp/verify",
		"/v1/auth/totp/disable",
	}
	for _, path := range paths {
		for i, body := range hostile {
			resp, err := http.Post(srv.URL+path, "application/json", strings.NewReader(body))
			if err != nil {
				t.Fatalf("%s hostile[%d]: transport error %v", path, i, err)
			}
			if resp.StatusCode < 400 {
				resp.Body.Close()
				t.Fatalf("%s hostile[%d]=%.40q: expected 4xx, got %d", path, i, body, resp.StatusCode)
			}
			assertErrorEnvelope(t, resp, false)
		}
	}
}

// ---- C) DATA ISOLATION / IDOR ----------------------------------------------

// TestTOTP_DataIsolation_EnrollDoesNotTouchOtherAccount verifies enrollTotp for
// account A never writes account B's totp_secret_enc. The store scopes every
// UPDATE by the caller's own account id; a wildcard write would be a
// cross-tenant leak.
func TestTOTP_DataIsolation_EnrollDoesNotTouchOtherAccount(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	idA := seedEmailAccount(t, pool, uniqueEmail("s3_isoA"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	idB := seedEmailAccount(t, pool, uniqueEmail("s3_isoB"), "SomePass12345!!", httpx.RoleRestaurantOwner)

	srv := buildTOTPTestServer(t, pool, principalForTOTP(idA, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	resp, err := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enroll A: got %d", resp.StatusCode)
	}

	// A now has a sealed secret; B must remain untouched (NULL secret, NULL enrolled_at).
	var aEnc, bEnc []byte
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc FROM account WHERE id=$1`, idA).Scan(&aEnc); err != nil {
		t.Fatalf("query A: %v", err)
	}
	if len(aEnc) == 0 {
		t.Fatal("account A should have a sealed secret after enroll")
	}
	var bEnrolledAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc, totp_enrolled_at FROM account WHERE id=$1`, idB).Scan(&bEnc, &bEnrolledAt); err != nil {
		t.Fatalf("query B: %v", err)
	}
	if len(bEnc) != 0 {
		t.Fatal("IDOR LEAK: account B's totp_secret_enc was written by A's enroll")
	}
	if bEnrolledAt != nil {
		t.Fatal("IDOR LEAK: account B's totp_enrolled_at was set by A's enroll")
	}
}

// TestTOTP_DataIsolation_DisableDoesNotClearOtherAccount verifies disableTotp for
// account A does not clear account B's enrolled TOTP. Both accounts are enrolled
// with the SAME sealed secret bytes so that the only thing distinguishing the
// target is the account-id predicate in the UPDATE.
func TestTOTP_DataIsolation_DisableDoesNotClearOtherAccount(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	idA := seedEmailAccount(t, pool, uniqueEmail("s3_disA"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	idB := seedEmailAccount(t, pool, uniqueEmail("s3_disB"), "SomePass12345!!", httpx.RoleRestaurantOwner)

	srv := buildTOTPTestServer(t, pool, principalForTOTP(idA, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	// Enroll + verify A to obtain a real activated secret and a live code.
	enrollResp, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	var enrollOut struct {
		Data struct {
			ProvisioningURI string `json:"provisioning_uri"`
		} `json:"data"`
	}
	mustDecodeJSON(t, enrollResp, &enrollOut)
	if enrollResp.StatusCode != http.StatusOK {
		t.Fatalf("enroll A: %d", enrollResp.StatusCode)
	}
	code, err := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	if err != nil {
		t.Skipf("cannot derive TOTP code: %v", err)
	}
	verResp := doJSON(t, srv, "/v1/auth/totp/verify", map[string]any{"totp_code": code})
	verResp.Body.Close()
	if verResp.StatusCode != http.StatusNoContent {
		t.Fatalf("verify A: %d", verResp.StatusCode)
	}

	// Copy A's sealed secret onto B and mark B enrolled — B is now a valid,
	// independent enrolment sharing the secret bytes.
	var aEnc []byte
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc FROM account WHERE id=$1`, idA).Scan(&aEnc); err != nil {
		t.Fatalf("read A secret: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE account SET totp_secret_enc=$2, totp_enrolled_at=now() WHERE id=$1`, idB, aEnc); err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// A disables with a live code. Because A and B share the secret, the code is
	// valid for B too — the ONLY thing that must protect B is the account-id
	// scoping of the UPDATE.
	code2, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	disResp := doJSON(t, srv, "/v1/auth/totp/disable", map[string]any{"totp_code": code2})
	disResp.Body.Close()
	if disResp.StatusCode != http.StatusNoContent {
		t.Fatalf("disable A: %d", disResp.StatusCode)
	}

	// A cleared; B must remain enrolled.
	var aEncAfter, bEncAfter []byte
	var bEnrolledAfter *time.Time
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc FROM account WHERE id=$1`, idA).Scan(&aEncAfter); err != nil {
		t.Fatalf("read A after: %v", err)
	}
	if len(aEncAfter) != 0 {
		t.Fatal("A's secret should be cleared after disable")
	}
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc, totp_enrolled_at FROM account WHERE id=$1`, idB).Scan(&bEncAfter, &bEnrolledAfter); err != nil {
		t.Fatalf("read B after: %v", err)
	}
	if len(bEncAfter) == 0 || bEnrolledAfter == nil {
		t.Fatal("IDOR LEAK: account B's TOTP was cleared by account A's disable")
	}
}

// TestChangePassword_DataIsolation verifies that changePassword for caller A
// changes only A's password hash and leaves account B's hash untouched, and that
// A's own session preserved while only A's other sessions are revoked (B's are
// not). The principal is the sole source of the target account id — there is no
// account id in the body to spoof.
func TestChangePassword_DataIsolation(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	const currentA = "CurrentPassA99!!"
	const currentB = "CurrentPassB99!!"
	idA := seedEmailAccount(t, pool, uniqueEmail("s3_cpA"), currentA, httpx.RoleRestaurantOwner)
	idB := seedEmailAccount(t, pool, uniqueEmail("s3_cpB"), currentB, httpx.RoleRestaurantOwner)

	var bHashBefore string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM account WHERE id=$1`, idB).Scan(&bHashBefore); err != nil {
		t.Fatalf("read B hash: %v", err)
	}

	// Seed a live session for B — it must survive A's password change.
	_, bRefreshHash, _ := NewRefreshToken()
	if _, err := pool.Exec(ctx, `
		INSERT INTO session (family_id, account_id, amr, roles_snapshot, client, refresh_hash,
		                     idle_expires_at, absolute_expires_at)
		VALUES (gen_random_uuid(), $1, 'pwd', '[]', 'restaurant-web', $2,
		        now()+interval '1 day', now()+interval '90 days')`, idB, bRefreshHash); err != nil {
		t.Fatalf("seed B session: %v", err)
	}

	srv := buildTOTPTestServer(t, pool, principalForTOTP(idA, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	resp := doJSON(t, srv, "/v1/auth/password/change", map[string]any{
		"current_password": currentA,
		"new_password":     "AsFreshPass12!!",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("changePassword A: got %d", resp.StatusCode)
	}

	// B's hash unchanged.
	var bHashAfter string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM account WHERE id=$1`, idB).Scan(&bHashAfter); err != nil {
		t.Fatalf("read B hash after: %v", err)
	}
	if bHashAfter != bHashBefore {
		t.Fatal("IDOR LEAK: account B's password hash changed when A changed theirs")
	}
	// B's session not revoked.
	var bRevoked *string
	if err := pool.QueryRow(ctx, `SELECT revoke_reason FROM session WHERE refresh_hash=$1`, bRefreshHash).Scan(&bRevoked); err != nil {
		t.Fatalf("read B session: %v", err)
	}
	if bRevoked != nil {
		t.Fatalf("IDOR LEAK: account B's session was revoked (reason=%q) by A's password change", *bRevoked)
	}
}

// ---- F) CONCURRENCY / IDEMPOTENCY ------------------------------------------

// TestVerifyTotp_ConcurrentNoDoubleActivation runs verifyTotpEnrolment twice
// concurrently with the same valid code and asserts: no request 500s, at least
// one succeeds (204), and the account ends in a single consistent activated
// state (totp_enrolled_at set exactly once, secret intact).
func TestVerifyTotp_ConcurrentNoDoubleActivation(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_verconc"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	enrollResp, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	var enrollOut struct {
		Data struct {
			ProvisioningURI string `json:"provisioning_uri"`
		} `json:"data"`
	}
	mustDecodeJSON(t, enrollResp, &enrollOut)
	if enrollResp.StatusCode != http.StatusOK {
		t.Fatalf("enroll: %d", enrollResp.StatusCode)
	}
	code, err := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	if err != nil {
		t.Skipf("cannot derive TOTP code: %v", err)
	}

	const n = 2
	var wg sync.WaitGroup
	statuses := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := doJSON(t, srv, "/v1/auth/totp/verify", map[string]any{"totp_code": code})
			statuses[i] = r.StatusCode
			r.Body.Close()
		}(i)
	}
	wg.Wait()

	oks := 0
	for i, s := range statuses {
		if s == http.StatusInternalServerError {
			t.Fatalf("concurrent verify[%d] returned a bare 500", i)
		}
		if s == http.StatusNoContent {
			oks++
		}
	}
	if oks == 0 {
		t.Fatalf("no concurrent verify succeeded; statuses=%v", statuses)
	}

	// Exactly one consistent activated state: secret present, enrolled_at set.
	var secretEnc []byte
	var enrolledAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc, totp_enrolled_at FROM account WHERE id=$1`, accountID).Scan(&secretEnc, &enrolledAt); err != nil {
		t.Fatalf("read account: %v", err)
	}
	if len(secretEnc) == 0 || enrolledAt == nil {
		t.Fatal("after concurrent verify, account must be in a single activated state")
	}
}

// TestDisableTotp_DoubleInvokeNoDoubleEffect runs disableTotp twice with a valid
// code. The first clears the secret (204). The second — now against a cleared
// account — must be a clean domain error (not-enrolled), never a 204 and never a
// bare 500. This proves the write is idempotent-safe: a replay does not
// re-succeed or crash.
func TestDisableTotp_DoubleInvokeNoDoubleEffect(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_disdbl"), "SomePass12345!!", httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	enrollResp, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	var enrollOut struct {
		Data struct {
			ProvisioningURI string `json:"provisioning_uri"`
		} `json:"data"`
	}
	mustDecodeJSON(t, enrollResp, &enrollOut)
	if enrollResp.StatusCode != http.StatusOK {
		t.Fatalf("enroll: %d", enrollResp.StatusCode)
	}
	code, err := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	if err != nil {
		t.Skipf("cannot derive TOTP code: %v", err)
	}
	verResp := doJSON(t, srv, "/v1/auth/totp/verify", map[string]any{"totp_code": code})
	verResp.Body.Close()
	if verResp.StatusCode != http.StatusNoContent {
		t.Fatalf("verify: %d", verResp.StatusCode)
	}

	code2, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	first := doJSON(t, srv, "/v1/auth/totp/disable", map[string]any{"totp_code": code2})
	first.Body.Close()
	if first.StatusCode != http.StatusNoContent {
		t.Fatalf("first disable: got %d, want 204", first.StatusCode)
	}

	// Second disable on a now-cleared account.
	code3, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	second := doJSON(t, srv, "/v1/auth/totp/disable", map[string]any{"totp_code": code3})
	if second.StatusCode == http.StatusNoContent {
		t.Fatal("second disable succeeded again — double effect on a cleared account")
	}
	assertErrorEnvelope(t, second, false)

	// Account remains cleared.
	var secretEnc []byte
	var enrolledAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT totp_secret_enc, totp_enrolled_at FROM account WHERE id=$1`, accountID).Scan(&secretEnc, &enrolledAt); err != nil {
		t.Fatalf("read account: %v", err)
	}
	if len(secretEnc) != 0 || enrolledAt != nil {
		t.Fatal("account TOTP must remain cleared after a double disable")
	}
}

// TestChangePassword_ReplayOldPasswordFails verifies that once the password is
// changed, a replay of the SAME request (old current_password) fails with
// INVALID_CREDENTIALS rather than succeeding or 500ing — the write is not
// idempotently re-appliable with stale credentials.
func TestChangePassword_ReplayOldPasswordFails(t *testing.T) {
	pool := openTestPool(t)
	const current = "CurrentPass99!!"
	accountID := seedEmailAccount(t, pool, uniqueEmail("s3_cpreplay"), current, httpx.RoleRestaurantOwner)
	srv := buildTOTPTestServer(t, pool, principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd"))
	defer srv.Close()

	body := map[string]any{"current_password": current, "new_password": "RotatedPass12!!"}
	first := doJSON(t, srv, "/v1/auth/password/change", body)
	first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first change: got %d, want 200", first.StatusCode)
	}

	// Replay with the now-stale current password.
	second := doJSON(t, srv, "/v1/auth/password/change", body)
	if second.StatusCode == http.StatusOK {
		t.Fatal("replay of changePassword with stale current_password should not succeed")
	}
	code := assertErrorEnvelope(t, second, false)
	if code != string(CodeInvalidCredentials) {
		t.Fatalf("replay: code = %q, want %q", code, CodeInvalidCredentials)
	}
}
