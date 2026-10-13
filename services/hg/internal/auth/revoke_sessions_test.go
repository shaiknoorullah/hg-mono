package auth

// A password reset and "sign out everywhere" revoke the sessions that existed,
// not every future session of the account. Signing in straight afterwards
// gives a session that works at once
// (https://github.com/shaiknoorullah/hg-mono/issues/748,
// https://github.com/shaiknoorullah/hg-mono/issues/752).

import (
	"crypto/ed25519"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// buildDenyingTestServer wires the auth routes behind the real access-token
// authenticator and deny set, as auth.NewModule does, with no refresher: what
// the deny set holds is only what the handlers put there.
func buildDenyingTestServer(t *testing.T, pool *pgxpool.Pool) *httptest.Server {
	t.Helper()
	secrets := testSecrets(t)
	store := NewStore(pool)
	deny := session.NewDenySet()
	issuer := session.NewIssuer(secrets.SigningKID, secrets.SigningPriv, "hg-api")
	verifier := session.NewVerifier(
		map[string]ed25519.PublicKey{secrets.SigningKID: secrets.SigningPub}, "hg-api")
	svc := NewService(store, NewRateLimiter(nil, nil), NewLogSMSSender(nil, false), issuer, deny, secrets, nil)
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: NewAuthenticator(verifier, deny),
		Authorizer:    Matrix{},
	})
	Routes(router, NewHandler(svc, store, deny, secrets))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

// signInToken signs in with email and password and returns the access token.
func signInToken(t *testing.T, srv *httptest.Server, email, password string) string {
	t.Helper()
	resp := postAs(t, srv, "/v1/auth/login", ClientRestaurantWeb,
		map[string]any{"email": email, "password": password})
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var out struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	if resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &out) != nil || out.Data.AccessToken == "" {
		t.Fatalf("login = %d %s, want 200 with an access token", resp.StatusCode, raw)
	}
	return out.Data.AccessToken
}

// callAs makes an authenticated request and returns its status.
func callAs(t *testing.T, srv *httptest.Server, method, path, token string) int {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-HG-Client", string(ClientRestaurantWeb))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp.StatusCode
}

func TestSignInRightAfterAPasswordResetWorks(t *testing.T) {
	pool := openTestPool(t)
	srv := buildDenyingTestServer(t, pool)

	email := uniqueEmail("reset_then_sign_in")
	accountID := seedEmailAccount(t, pool, email, "OldResetPass12!", httpx.RoleRestaurantOwner)
	cleanupAccount(t, pool, accountID, email)

	before := signInToken(t, srv, email, "OldResetPass12!")
	if got := callAs(t, srv, http.MethodGet, "/v1/auth/me", before); got != http.StatusOK {
		t.Fatalf("getCurrentPrincipal before the reset = %d, want 200", got)
	}

	const newPW = "NewResetPass34!"
	token := mintLinkToken(t, pool, accountID, "PASSWORD_RESET", 30*time.Minute)
	requireNoSession204(t, postAs(t, srv, "/v1/auth/password/reset", ClientRestaurantWeb,
		map[string]any{"token": token, "new_password": newPW}))

	// The session from before the reset is refused at once …
	if got := callAs(t, srv, http.MethodGet, "/v1/auth/me", before); got != http.StatusUnauthorized {
		t.Fatalf("the pre-reset session after the reset = %d, want 401", got)
	}
	// … and one signed in straight after works at once.
	after := signInToken(t, srv, email, newPW)
	if got := callAs(t, srv, http.MethodGet, "/v1/auth/me", after); got != http.StatusOK {
		t.Fatalf("getCurrentPrincipal right after reset and sign-in = %d, want 200", got)
	}
}

func TestSignInRightAfterSignOutEverywhereWorks(t *testing.T) {
	pool := openTestPool(t)
	srv := buildDenyingTestServer(t, pool)

	const pw = "SignOutAllPass12!"
	email := uniqueEmail("logout_all_then_sign_in")
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)
	cleanupAccount(t, pool, accountID, email)

	other := signInToken(t, srv, email, pw)
	this := signInToken(t, srv, email, pw)
	if got := callAs(t, srv, http.MethodPost, "/v1/auth/logout-all", this); got != http.StatusNoContent {
		t.Fatalf("logoutAll = %d, want 204", got)
	}
	for name, tok := range map[string]string{"this": this, "other": other} {
		if got := callAs(t, srv, http.MethodGet, "/v1/auth/me", tok); got != http.StatusUnauthorized {
			t.Fatalf("%s session after sign out everywhere = %d, want 401", name, got)
		}
	}
	again := signInToken(t, srv, email, pw)
	if got := callAs(t, srv, http.MethodGet, "/v1/auth/me", again); got != http.StatusOK {
		t.Fatalf("getCurrentPrincipal right after sign out everywhere and sign-in = %d, want 200", got)
	}
}

// requireNoSession204 fails unless the reset link answered a bare 204.
func requireNoSession204(t *testing.T, resp *http.Response) {
	t.Helper()
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("resetPassword = %d %s, want 204", resp.StatusCode, raw)
	}
}
