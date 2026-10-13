package auth

// STAGE-4 adversarial regression tests for gap2-authtotp.
//
// Each test pins a concrete bug found during adversarial review of the four
// P-01/P-03/P-04 operations. They are written to FAIL against the pre-fix code
// and pass after the fix:
//
//   F1  (retired) disableTotp mandatory-MFA bypass. Two-step sign-in is now
//       opt-in for staff, so staff may turn it off; TestTotp_StaffOptIn pins the
//       new rules instead.
//
//   F2  changePassword session leak: the pre-fix flow revoked "all but the
//       calling session" then minted a NEW session, leaving the caller's old
//       refresh-token family live. Fix revokes ALL sessions (including the
//       caller's old one) inside one transaction, then issues one fresh session.
//
//   F3  changePassword atomicity: password change + session revocation must be
//       one transaction (no "password changed, stale sessions live" partial).
//
// Plus hostile / boundary inputs thrown at every write op.

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// grantRole adds a second live account_role to an existing account. Cleaned up
// by seedEmailAccount's t.Cleanup (which deletes all account_role for the id).
func grantRole(t *testing.T, pool *pgxpool.Pool, accountID string, role httpx.Role) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, $2, 'GLOBAL')`, accountID, string(role))
	if err != nil {
		t.Fatalf("grantRole %s: %v", role, err)
	}
}

// seedCallingSession inserts a live session row and returns its id, so a test
// can set it as the principal's SessionID and later assert its revocation.
func seedCallingSession(t *testing.T, pool *pgxpool.Pool, accountID, amr string) string {
	t.Helper()
	_, refreshHash, _ := NewRefreshToken()
	var sessID string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO session (family_id, account_id, amr, roles_snapshot, client, refresh_hash,
		                     idle_expires_at, absolute_expires_at)
		VALUES (gen_random_uuid(), $1, $2, '[]', 'restaurant-web', $3,
		        now()+interval '1 day', now()+interval '90 days')
		RETURNING id`, accountID, amr, refreshHash).Scan(&sessID)
	if err != nil {
		t.Fatalf("seedCallingSession: %v", err)
	}
	return sessID
}

// ---------------------------------------------------------------------------
// F1 — disableTotp mandatory-MFA bypass for multi-role accounts
// ---------------------------------------------------------------------------

// TestTotp_StaffOptIn: two-step sign-in is opt-in for staff (docs/decisions/
// README.md, "Two-step sign-in is opt-in"). An admin enrols and confirms an
// authenticator; while it is on, a second enrolment is refused (409) and leaves
// it on, because starting again would replace a working authenticator with an
// unconfirmed one; turning it off takes a current code (204) and clears it.
func TestTotp_StaffOptIn(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("totp_optin")
	const pw = "SomePass12345!!"
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleAdmin)

	p := principalForTOTP(accountID, httpx.RoleAdmin, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	enrollResp, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	var enrollOut struct {
		Data struct {
			ProvisioningURI string `json:"provisioning_uri"`
		} `json:"data"`
	}
	mustDecodeJSON(t, enrollResp, &enrollOut)
	if enrollResp.StatusCode != http.StatusOK {
		t.Fatalf("enroll: got %d", enrollResp.StatusCode)
	}
	code, err := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	if err != nil {
		t.Fatalf("totp code: %v", err)
	}
	verResp := doJSON(t, srv, "/v1/auth/totp/verify", map[string]any{"totp_code": code})
	if verResp.StatusCode != http.StatusNoContent {
		t.Fatalf("verify: got %d", verResp.StatusCode)
	}
	verResp.Body.Close()

	enrolled := func() bool {
		t.Helper()
		var at *time.Time
		if err := pool.QueryRow(context.Background(),
			`SELECT totp_enrolled_at FROM account WHERE id=$1`, accountID).Scan(&at); err != nil {
			t.Fatalf("query account: %v", err)
		}
		return at != nil
	}

	again, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	again.Body.Close()
	if again.StatusCode != http.StatusConflict || !enrolled() {
		t.Fatalf("second enroll while on: got %d enrolled=%v, want 409 and still on", again.StatusCode, enrolled())
	}

	code2, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	disResp := doJSON(t, srv, "/v1/auth/totp/disable", map[string]any{"totp_code": code2})
	disResp.Body.Close()
	if disResp.StatusCode != http.StatusNoContent || enrolled() {
		t.Fatalf("admin disableTotp with a current code: got %d enrolled=%v, want 204 and off", disResp.StatusCode, enrolled())
	}
}

// TestDisableTotp_PureRestaurantStillWorks guards against over-correction: a
// restaurant-only owner (no TOTP-mandatory role) must still be able to disable.
func TestDisableTotp_PureRestaurantStillWorks(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("dis_pure_owner")
	const pw = "SomePass12345!!"
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)
	p := principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	enrollResp, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json",
		strings.NewReader("{}"))
	var enrollOut struct {
		Data struct {
			ProvisioningURI string `json:"provisioning_uri"`
		} `json:"data"`
	}
	mustDecodeJSON(t, enrollResp, &enrollOut)
	code, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	verResp := doJSON(t, srv, "/v1/auth/totp/verify", map[string]any{"totp_code": code})
	verResp.Body.Close()

	code2, _ := totpCodeFromURI(t, enrollOut.Data.ProvisioningURI)
	disResp := doJSON(t, srv, "/v1/auth/totp/disable", map[string]any{"totp_code": code2})
	defer disResp.Body.Close()
	if disResp.StatusCode != http.StatusNoContent {
		t.Fatalf("pure restaurant owner disableTotp: got %d, want 204", disResp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// F2/F3 — changePassword revokes the caller's OLD session and is atomic
// ---------------------------------------------------------------------------

// TestChangePassword_RevokesCallersOldSession is the F2 regression: after a
// password change the caller's PRE-CHANGE session must be revoked, not left live
// alongside a freshly minted one. A surviving old refresh token would defeat
// I-03.2 (a stolen token still authenticates after the password change).
func TestChangePassword_RevokesCallersOldSession(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("chpw_oldsess")
	const current = "CurrentPass99!!"
	accountID := seedEmailAccount(t, pool, email, current, httpx.RoleRestaurantOwner)

	// Seed the CALLING session and make the principal use its real id.
	callingID := seedCallingSession(t, pool, accountID, "pwd")
	p := httpx.Principal{
		AccountID: accountID,
		SessionID: callingID,
		Roles:     []httpx.Role{httpx.RoleRestaurantOwner},
		AMR:       []string{"pwd"},
	}
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, srv, "/v1/auth/password/change", map[string]any{
		"current_password": current,
		"new_password":     "BrandNewPass12!!",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("changePassword: got %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// The caller's OLD session must now be revoked.
	var revokedAt *time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT revoked_at FROM session WHERE id=$1`, callingID).Scan(&revokedAt); err != nil {
		t.Fatalf("query calling session: %v", err)
	}
	if revokedAt == nil {
		t.Fatal("changePassword: caller's OLD session must be revoked (old refresh token must not survive)")
	}

	// Exactly one live session must remain (the freshly issued one).
	var liveCount int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM session WHERE account_id=$1 AND revoked_at IS NULL`, accountID).
		Scan(&liveCount); err != nil {
		t.Fatalf("count live sessions: %v", err)
	}
	if liveCount != 1 {
		t.Fatalf("changePassword: want exactly 1 live session after change, got %d", liveCount)
	}
}

// TestChangePassword_AtomicNoPartialWrite is the F3 regression: password change
// and session revocation are one transaction. We assert the post-condition an
// atomic path guarantees — every pre-existing session is revoked AND the new
// password verifies — so a partial write (password changed, sessions live, or
// vice versa) cannot pass.
func TestChangePassword_AtomicNoPartialWrite(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("chpw_atomic")
	const current = "CurrentPass99!!"
	const next = "AtomicNewPass12!"
	accountID := seedEmailAccount(t, pool, email, current, httpx.RoleRestaurantOwner)

	callingID := seedCallingSession(t, pool, accountID, "pwd")
	// A second device session too.
	otherID := seedCallingSession(t, pool, accountID, "pwd")

	p := httpx.Principal{
		AccountID: accountID,
		SessionID: callingID,
		Roles:     []httpx.Role{httpx.RoleRestaurantOwner},
		AMR:       []string{"pwd"},
	}
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, srv, "/v1/auth/password/change", map[string]any{
		"current_password": current,
		"new_password":     next,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("changePassword: got %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	// Both pre-existing sessions revoked.
	for _, id := range []string{callingID, otherID} {
		var revokedAt *time.Time
		if err := pool.QueryRow(context.Background(), `
			SELECT revoked_at FROM session WHERE id=$1`, id).Scan(&revokedAt); err != nil {
			t.Fatalf("query session %s: %v", id, err)
		}
		if revokedAt == nil {
			t.Fatalf("changePassword: pre-existing session %s must be revoked", id)
		}
	}

	// New password verifies (the account write committed).
	var hash *string
	if err := pool.QueryRow(context.Background(), `
		SELECT password_hash FROM account WHERE id=$1`, accountID).Scan(&hash); err != nil {
		t.Fatalf("query hash: %v", err)
	}
	if hash == nil {
		t.Fatal("changePassword: password_hash must be set")
	}
	ok, err := VerifyPassword(context.Background(), *hash, next)
	if err != nil || !ok {
		t.Fatalf("changePassword: new password must verify (err=%v ok=%v)", err, ok)
	}
}

// ---------------------------------------------------------------------------
// Hostile / boundary inputs across the write ops
// ---------------------------------------------------------------------------

// TestChangePassword_HostileInputs throws malformed and boundary bodies at
// changePassword; none may 500 or 200. Deny/validate, never crash.
func TestChangePassword_HostileInputs(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("chpw_hostile")
	const current = "CurrentPass99!!"
	accountID := seedEmailAccount(t, pool, email, current, httpx.RoleRestaurantOwner)
	p := principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	cases := []struct {
		name       string
		body       string
		mustReject bool // true: must NOT return 200 (malformed/invalid input)
	}{
		{"empty body", ``, true},
		{"null body", `null`, true},
		{"array body", `[]`, true},
		{"wrong types", `{"current_password":123,"new_password":true}`, true},
		{"missing new", `{"current_password":"CurrentPass99!!"}`, true},
		{"blank new", `{"current_password":"CurrentPass99!!","new_password":""}`, true},
		{"max+1 length", `{"current_password":"CurrentPass99!!","new_password":"` + strings.Repeat("a", 257) + `"}`, true},
		{"nested json", `{"current_password":{"x":1},"new_password":"NewValidPass12!"}`, true},
		{"trailing garbage", `{"current_password":"CurrentPass99!!","new_password":"NewValidPass12!"} EVIL`, true},
		// A NUL inside an otherwise valid-length password is legitimately hashable
		// (the Password schema imposes only length limits): it must not CRASH the
		// argon2 path, but a 200 here is acceptable, not a defect.
		{"nul injection", "{\"current_password\":\"CurrentPass99!!\",\"new_password\":\"pass\\u0000word1234\"}", false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			resp, err := http.Post(srv.URL+"/v1/auth/password/change", "application/json",
				strings.NewReader(c.body))
			if err != nil {
				t.Fatalf("POST: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusInternalServerError {
				t.Fatalf("%s: 500 (crash) on hostile input", c.name)
			}
			if c.mustReject && resp.StatusCode == http.StatusOK {
				t.Fatalf("%s: unexpectedly succeeded (200)", c.name)
			}
		})
	}
}

// TestVerifyTotp_HostileInputs throws malformed codes at verifyTotpEnrolment.
func TestVerifyTotp_HostileInputs(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("ver_hostile")
	const pw = "SomePass12345!!"
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)
	p := principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	// Enrol so a secret exists (the format guard must still reject bad shapes).
	er, _ := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json", strings.NewReader("{}"))
	er.Body.Close()

	bad := []string{
		`{"totp_code":"12345"}`,        // 5 digits
		`{"totp_code":"1234567"}`,      // 7 digits
		`{"totp_code":"12 456"}`,       // space
		`{"totp_code":"12345a"}`,       // letter
		`{"totp_code":"-12345"}`,       // sign
		`{"totp_code":123456}`,         // number not string
		`{"totp_code":null}`,           // null
		`{"totp_code":"००००००"}`,       // devanagari digits
		`{"totp_code":"123456","x":1}`, // unknown field
	}
	for _, b := range bad {
		b := b
		t.Run(b, func(t *testing.T) {
			resp, err := http.Post(srv.URL+"/v1/auth/totp/verify", "application/json",
				strings.NewReader(b))
			if err != nil {
				t.Fatalf("POST: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusNoContent {
				t.Fatalf("hostile %q was ACCEPTED (204)", b)
			}
			if resp.StatusCode == http.StatusInternalServerError {
				t.Fatalf("hostile %q caused 500", b)
			}
		})
	}
}

// TestDisableTotp_HostileInputs throws malformed codes at disableTotp.
func TestDisableTotp_HostileInputs(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("dis_hostile")
	const pw = "SomePass12345!!"
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)

	if _, err := pool.Exec(context.Background(), `
		UPDATE account SET totp_secret_enc = '\x01020304', totp_enrolled_at = now()
		WHERE id = $1`, accountID); err != nil {
		t.Fatalf("seed totp: %v", err)
	}
	p := principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	bad := []string{
		`{"totp_code":""}`,
		`{"totp_code":"abcdef"}`,
		`{"totp_code":"1234567"}`,
		`{}`,
		`{"totp_code":"123456","amount_cents":0}`,
		`{"totp_code":["123456"]}`,
	}
	for _, b := range bad {
		b := b
		t.Run(b, func(t *testing.T) {
			resp, err := http.Post(srv.URL+"/v1/auth/totp/disable", "application/json",
				strings.NewReader(b))
			if err != nil {
				t.Fatalf("POST: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusNoContent {
				t.Fatalf("hostile %q was ACCEPTED (204)", b)
			}
			if resp.StatusCode == http.StatusInternalServerError {
				t.Fatalf("hostile %q caused 500", b)
			}
		})
	}

	// The seeded TOTP must still be intact after all the rejected attempts.
	var secretEnc []byte
	if err := pool.QueryRow(context.Background(), `
		SELECT totp_secret_enc FROM account WHERE id=$1`, accountID).Scan(&secretEnc); err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(secretEnc) == 0 {
		t.Fatal("disableTotp: rejected hostile inputs must not have cleared the secret")
	}
}

// TestEnrollTotp_HostileBodies throws non-empty/garbage bodies at enrollTotp,
// which declares an empty body. None may 500.
func TestEnrollTotp_HostileBodies(t *testing.T) {
	pool := openTestPool(t)
	email := uniqueEmail("enroll_hostile")
	const pw = "SomePass12345!!"
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)
	p := principalForTOTP(accountID, httpx.RoleRestaurantOwner, "pwd")
	srv := buildTOTPTestServer(t, pool, p)
	defer srv.Close()

	bad := []string{
		`{"secret":"attacker-chosen"}`, // must not let the caller pick the secret
		`{"recovery_codes":[]}`,
		`[]`,
		`not json`,
		`{"totp_enrolled_at":"2020-01-01"}`,
	}
	for _, b := range bad {
		b := b
		t.Run(b, func(t *testing.T) {
			resp, err := http.Post(srv.URL+"/v1/auth/totp/enroll", "application/json",
				strings.NewReader(b))
			if err != nil {
				t.Fatalf("POST: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusInternalServerError {
				t.Fatalf("hostile enroll body %q caused 500", b)
			}
		})
	}
}
