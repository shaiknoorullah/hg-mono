package auth

// An emailed link never signs anyone in
// (https://github.com/shaiknoorullah/hg-mono/issues/356). Otherwise an attacker
// could send someone the link for the attacker's own account and that person
// would land signed in to it (login cross-site request forgery).
//
// Verifying an email, resetting a password and accepting a staff invitation
// (a first password set through resetPassword) each answer 204 with no body,
// no Set-Cookie and no session row. The user then signs in with login, which
// still asks for everything the account requires.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// postAs sends an anonymous JSON POST from the given browser surface, the way
// a page opened from an email (or the sign-in page) calls the API.
func postAs(t *testing.T, srv *httptest.Server, path string, client ClientSurface, body any) *http.Response {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-HG-Client", string(client))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

func sessionCount(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM session WHERE account_id = $1`, accountID).Scan(&n); err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	return n
}

// mintLinkToken stores a credential token the way the email flows do and
// returns the plaintext that the emailed link would carry.
func mintLinkToken(t *testing.T, pool *pgxpool.Pool, accountID, kind string, ttl time.Duration) string {
	t.Helper()
	token, hash, err := NewOpaqueToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := NewStore(pool).InsertCredentialToken(context.Background(), accountID, kind, hash, ttl); err != nil {
		t.Fatalf("InsertCredentialToken: %v", err)
	}
	return token
}

// requireNoSession fails unless a link's answer is a bare 204 that created no
// session in any form: no body, no cookie, no session row.
func requireNoSession(t *testing.T, pool *pgxpool.Pool, accountID string, resp *http.Response) {
	t.Helper()
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
	if len(body) != 0 {
		t.Errorf("body = %.60s…, want none (no SessionGrant)", body)
	}
	for _, c := range resp.Cookies() {
		t.Errorf("Set-Cookie %s, want none", c.Name)
	}
	if n := sessionCount(t, pool, accountID); n != 0 {
		t.Errorf("sessions after the link = %d, want 0", n)
	}
	if t.Failed() {
		t.FailNow()
	}
}

// requireSignedIn fails unless a login answer is a session for a web client:
// an access token in the body and the hg_rt refresh cookie.
func requireSignedIn(t *testing.T, resp *http.Response) {
	t.Helper()
	var out struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want 200 (body: %s)", resp.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.Data.AccessToken == "" {
		t.Fatalf("login body has no access token: %s", raw)
	}
	for _, c := range resp.Cookies() {
		if c.Name == "hg_rt" && c.Value != "" {
			return
		}
	}
	t.Fatalf("login set no hg_rt cookie: %q", resp.Header.Values("Set-Cookie"))
}

func linkErrorCode(t *testing.T, resp *http.Response) (status int, code string, details map[string]any) {
	t.Helper()
	var out struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if c := resp.Header.Values("Set-Cookie"); len(c) != 0 {
		t.Errorf("refused sign-in set cookies %q", c)
	}
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out.Error.Code, out.Error.Details
}

func cleanupAccount(t *testing.T, pool *pgxpool.Pool, accountID, email string) {
	t.Cleanup(func() {
		ctx := context.Background()
		for _, q := range []string{
			`DELETE FROM credential_token WHERE account_id = $1`,
			`DELETE FROM session WHERE account_id = $1`,
			`DELETE FROM staff_profile WHERE account_id = $1`,
			`DELETE FROM account_role WHERE account_id = $1`,
			`DELETE FROM account WHERE id = $1`,
		} {
			_, _ = pool.Exec(ctx, q, accountID)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM login_attempt WHERE email = $1`, email)
	})
}

// TestVerifyEmailIssuesNoSession: the verification link verifies the email and
// nothing else; the owner then signs in with their password.
func TestVerifyEmailIssuesNoSession(t *testing.T) {
	pool := openTestPool(t)
	srv := buildTOTPTestServerAnon(t, pool)
	defer srv.Close()
	ctx := context.Background()

	email := uniqueEmail("verify_link")
	const pw = "VerifyLinkPass12!"
	hash, err := HashPassword(context.Background(), pw)
	if err != nil {
		t.Fatal(err)
	}
	var accountID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, password_hash, password_set_at, status)
		VALUES ($1, $2, now(), 'ACTIVE') RETURNING id`, email, hash).Scan(&accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	cleanupAccount(t, pool, accountID, email)
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'RESTAURANT_OWNER', 'GLOBAL')`,
		accountID); err != nil {
		t.Fatalf("seed role: %v", err)
	}
	token := mintLinkToken(t, pool, accountID, "EMAIL_VERIFY", 24*time.Hour)

	resp := postAs(t, srv, "/v1/auth/email/verify", ClientRestaurantWeb, map[string]any{"token": token})
	requireNoSession(t, pool, accountID, resp)

	var verified *time.Time
	if err := pool.QueryRow(ctx, `SELECT email_verified_at FROM account WHERE id = $1`, accountID).Scan(&verified); err != nil {
		t.Fatal(err)
	}
	if verified == nil {
		t.Fatal("email_verified_at is still NULL after the link")
	}

	requireSignedIn(t, postAs(t, srv, "/v1/auth/login", ClientRestaurantWeb,
		map[string]any{"email": email, "password": pw}))
}

// TestResetPasswordIssuesNoSession: the reset link sets the password and
// nothing else; signing in afterwards still needs the authenticator code for
// an admin.
func TestResetPasswordIssuesNoSession(t *testing.T) {
	pool := openTestPool(t)
	srv := buildTOTPTestServerAnon(t, pool)
	defer srv.Close()
	ctx := context.Background()

	email := uniqueEmail("reset_link")
	accountID := seedEmailAccount(t, pool, email, "OldResetPass12!", httpx.RoleAdmin)
	cleanupAccount(t, pool, accountID, email)

	// The admin has an authenticator, enrolled the way verifyTotpEnrolment
	// leaves it: the secret sealed under the app data key, then activated.
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	sealed, err := SealAESGCM(testSecrets(t).AppDataKey, []byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(pool)
	if err := store.StoreTOTPSecret(ctx, accountID, sealed); err != nil {
		t.Fatal(err)
	}
	if err := store.ActivateTOTP(ctx, accountID); err != nil {
		t.Fatal(err)
	}

	const newPW = "NewResetPass34!"
	token := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", 30*time.Minute)
	resp := postAs(t, srv, "/v1/auth/password/reset", ClientAdminWeb,
		map[string]any{"token": token, "new_password": newPW})
	requireNoSession(t, pool, accountID, resp)

	// The password alone is not a sign-in for an admin.
	status, code, _ := linkErrorCode(t, postAs(t, srv, "/v1/auth/login", ClientAdminWeb,
		map[string]any{"email": email, "password": newPW}))
	if status != http.StatusForbidden || code != string(CodeMFARequired) {
		t.Fatalf("login without a code = %d %s, want 403 %s", status, code, CodeMFARequired)
	}
	if n := sessionCount(t, pool, accountID); n != 0 {
		t.Fatalf("sessions after a refused sign-in = %d, want 0", n)
	}

	code6, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	requireSignedIn(t, postAs(t, srv, "/v1/auth/login", ClientAdminWeb,
		map[string]any{"email": email, "password": newPW, "totp_code": code6}))
}

// TestAcceptInviteIssuesNoSession: an invited staff member sets their first
// password with the invitation link, which is a PASSWORD_RESET token consumed
// by resetPassword. It sets the password and nothing else.
func TestAcceptInviteIssuesNoSession(t *testing.T) {
	pool := openTestPool(t)
	srv := buildTOTPTestServerAnon(t, pool)
	defer srv.Close()
	ctx := context.Background()

	// An invited admin as the admin console creates one: no password yet, a
	// staff profile in INVITED and a global role.
	email := uniqueEmail("invite_link")
	var accountID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id`, email).Scan(&accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	cleanupAccount(t, pool, accountID, email)
	if _, err := pool.Exec(ctx, `
		INSERT INTO staff_profile (account_id, full_name, status) VALUES ($1, 'Invited Admin', 'INVITED')`,
		accountID); err != nil {
		t.Fatalf("seed staff profile: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'ADMIN', 'GLOBAL')`,
		accountID); err != nil {
		t.Fatalf("seed role: %v", err)
	}

	const pw = "InvitedFirstPass12!"
	token := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", 72*time.Hour)
	resp := postAs(t, srv, "/v1/auth/password/reset", ClientAdminWeb,
		map[string]any{"token": token, "new_password": pw})
	requireNoSession(t, pool, accountID, resp)

	// The invitee then signs in with the password alone: two-step sign-in is
	// opt-in, set up afterwards from the console (docs/decisions/README.md,
	// "Two-step sign-in is opt-in"). Resetting also verified the email.
	login := postAs(t, srv, "/v1/auth/login", ClientAdminWeb, map[string]any{"email": email, "password": pw})
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login after the invite = %d, want 200", login.StatusCode)
	}
}
