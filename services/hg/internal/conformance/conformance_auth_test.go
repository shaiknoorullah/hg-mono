package conformance

// Auth/session conformance coverage.
//
// This file extends the contract-conformance oracle to the auth class:
// requestOtp, verifyOtp, login, refreshSession, listSessions, revokeSession,
// requestPasswordReset, resetPassword, changePassword, resendEmailVerification,
// verifyEmail, enrollTotp, verifyTotpEnrolment.
//
// Unlike the read-path harness in harness_test.go (which never wires the auth
// module), these operations require the full auth stack: an SMS sender to carry
// the OTP code, an Ed25519 issuer, the credential-token store, and TOTP sealing.
// So this file stands up its OWN in-process auth server (the same production
// constructors cmd/hg/main.go uses — auth.NewService / auth.NewHandler /
// auth.Routes) and validates the live 2xx bytes against the SHARED contract Spec
// via conformance.ValidateResponse / ValidateRequest.
//
// The OTP code is read from a capturing SMS sender (never an external log); the
// TOTP code is derived from the enrolment provisioning URI via
// auth.TOTPCodeFromURI. Every 2xx body is validated against the contract schema
// (additionalProperties:false + required[] + closed enums are the oracle), and
// every write op's body is additionally ValidateRequest-checked.
//
// It writes into the shared conformance coverage aggregate through a Harness
// whose covered set is merged in a t.Cleanup, exactly like the other files.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// ---- capturing SMS sender --------------------------------------------------

// captureSMS is a stub SMSSender that records the last code delivered per phone,
// so the conformance driver can complete the OTP flow in-process without a real
// provider (O-03 is unresolved). This is not a fake pass: the real service calls
// SendOTP with the real generated code; we simply read it back the way a phone
// would, then feed it to verifyOtp.
type captureSMS struct {
	mu    sync.Mutex
	codes map[string]string
}

func newCaptureSMS() *captureSMS { return &captureSMS{codes: map[string]string{}} }

func (c *captureSMS) SendOTP(_ context.Context, phone, code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.codes[phone] = code
	return nil
}

func (c *captureSMS) code(phone string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.codes[phone]
}

// ---- auth conformance harness ----------------------------------------------

// authHarness bundles the shared contract Spec, a live auth-only httptest
// server, the capturing SMS sender, the pool, and the coverage-recording
// Harness. The auth server uses the same testAuthenticator as the read harness
// (X-Test-Account-ID / X-Test-Roles headers → Principal; neither header →
// anonymous), so public routes are reachable anonymously and authenticated
// routes are reachable with headers, all against the real deny-by-default chain.
type authHarness struct {
	pool    *pgxpool.Pool
	spec    *Spec
	server  *httptest.Server
	sms     *captureSMS
	secrets *auth.Secrets
	cov     *Harness
}

// authSecrets builds a Secrets with a deterministic Ed25519 seed and pepper,
// matching auth.LoadSecrets' env contract. The 32-zero-byte seed and app data
// key mirror the auth package's own integration tests.
func authSecrets(t *testing.T) *auth.Secrets {
	t.Helper()
	env := map[string]string{
		"HG_OTP_PEPPER":            "conformance-otp-pepper-0123456789",
		"HG_AUTH_SIGNING_KEY_SEED": base64.StdEncoding.EncodeToString(make([]byte, ed25519.SeedSize)),
		"HG_AUTH_SIGNING_KID":      "k1",
		"HG_AUTH_TERMS_VERSION":    "2026-01",
		"HG_APP_DATA_KEY":          strings.Repeat("00", 32),
	}
	s, err := auth.LoadSecrets(func(k string) string { return env[k] }, false)
	if err != nil {
		t.Fatalf("authSecrets: LoadSecrets: %v", err)
	}
	return s
}

// newAuthHarness stands up the auth module in-process with a capturing SMS
// sender and the shared contract Spec.
func newAuthHarness(t *testing.T, pool *pgxpool.Pool) *authHarness {
	t.Helper()
	spec := LoadSpec(t)
	secrets := authSecrets(t)
	sms := newCaptureSMS()

	store := auth.NewStore(pool)
	rl := auth.NewRateLimiter(nil) // nil redis → limiter no-ops (never fail-closed here)
	deny := session.NewDenySet()
	issuer := session.NewIssuer(secrets.SigningKID, secrets.SigningPriv, "hg-api")

	svc := auth.NewService(store, rl, sms, issuer, deny, secrets, nil)
	h := auth.NewHandler(svc, store, deny, secrets)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})
	auth.Routes(router, h)
	if err := router.Verify(); err != nil {
		t.Fatalf("auth router policy verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// A coverage-recording Harness that shares the same Spec; its covered set is
	// merged into the package aggregate on cleanup so COVERAGE.md reflects auth.
	cov := &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
	t.Cleanup(func() { writeCoverage(t, cov) })

	return &authHarness{pool: pool, spec: spec, server: srv, sms: sms, secrets: secrets, cov: cov}
}

// req builds an *http.Request against the auth server. headers is applied last
// so a caller can set X-HG-Client, X-Test-Account-ID, X-Test-Roles, etc. The
// body (when non-nil) is JSON-marshaled and GetBody is set so ValidateRequest
// can read it and the request can still be issued.
func (a *authHarness) req(t *testing.T, method, path string, body any, headers map[string]string) *http.Request {
	t.Helper()
	var raw []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		raw = b
	}
	var r io.Reader
	if raw != nil {
		r = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, a.server.URL+path, r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if raw != nil {
		req.Header.Set("Content-Type", "application/json")
		req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(raw)), nil }
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return req
}

// do issues the request and returns the response (body left readable).
func (a *authHarness) do(t *testing.T, req *http.Request) *http.Response {
	t.Helper()
	resp, err := a.server.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return resp
}

// validateReq runs ValidateRequest on a contract-valid body (proving the wire
// input conforms) and records coverage for the matched op.
func (a *authHarness) validateReq(t *testing.T, req *http.Request) {
	t.Helper()
	opID, err := ValidateRequest(t, a.spec, req)
	a.cov.MarkCovered(opID)
	if err != nil {
		t.Errorf("REQUEST CONFORMANCE FAIL: %v", err)
	}
}

// validateResp runs ValidateResponse on a live response, asserts wantStatus, and
// records coverage. A non-conformant body fails the subtest.
func (a *authHarness) validateResp(t *testing.T, req *http.Request, resp *http.Response, wantStatus int) {
	t.Helper()
	if resp.StatusCode != wantStatus {
		body, _ := io.ReadAll(resp.Body)
		resp.Body = io.NopCloser(bytes.NewReader(body))
		t.Errorf("%s %s: status = %d, want %d (body: %s)",
			req.Method, req.URL.Path, resp.StatusCode, wantStatus, truncate(string(body), 400))
	}
	opID, err := ValidateResponse(t, a.spec, req, resp)
	a.cov.MarkCovered(opID)
	if err != nil {
		t.Errorf("RESPONSE CONFORMANCE FAIL: %v", err)
	}
}

// ---- seed helpers ----------------------------------------------------------

// pad6 renders n as a zero-padded 6-digit string for unique-value generation.
func pad6(n int64) string {
	s := ""
	for i := 0; i < 6; i++ {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

// authUniqueEmail returns a test-unique email.
func authUniqueEmail(prefix string) string {
	n := time.Now().UnixNano() % 1_000_000
	return strings.ToLower(prefix) + "+" + pad6(n) + "@conf.test"
}

// authUniquePhone returns a test-unique E.164 number.
func authUniquePhone() string {
	n := time.Now().UnixNano() % 1_000_000
	return "+1416" + "0" + pad6(n)
}

// seedActiveEmailAccount inserts an ACTIVE, email-verified account with a
// password hash and a single GLOBAL role grant, cleaning up on test end.
func (a *authHarness) seedActiveEmailAccount(t *testing.T, email, password string, role string) (accountID string) {
	t.Helper()
	ctx := context.Background()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	err = a.pool.QueryRow(ctx, `
		INSERT INTO account (email, password_hash, password_set_at, email_verified_at, status)
		VALUES ($1, $2, now(), now(), 'ACTIVE')
		RETURNING id`, email, hash).Scan(&accountID)
	if err != nil {
		t.Fatalf("seedActiveEmailAccount: %v", err)
	}
	_, err = a.pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, $2, 'GLOBAL')`, accountID, role)
	if err != nil {
		t.Fatalf("seedActiveEmailAccount role: %v", err)
	}
	t.Cleanup(func() {
		_, _ = a.pool.Exec(ctx, `DELETE FROM session WHERE account_id=$1`, accountID)
		_, _ = a.pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, accountID)
		_, _ = a.pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, accountID)
	})
	return accountID
}

// seedUnverifiedEmailAccount inserts an ACTIVE account whose email is NOT yet
// verified (email_verified_at IS NULL) — the state verifyEmail transitions.
func (a *authHarness) seedUnverifiedEmailAccount(t *testing.T, email, password string) (accountID string) {
	t.Helper()
	ctx := context.Background()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	err = a.pool.QueryRow(ctx, `
		INSERT INTO account (email, password_hash, password_set_at, status)
		VALUES ($1, $2, now(), 'ACTIVE')
		RETURNING id`, email, hash).Scan(&accountID)
	if err != nil {
		t.Fatalf("seedUnverifiedEmailAccount: %v", err)
	}
	_, err = a.pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, 'RESTAURANT_OWNER', 'GLOBAL')`, accountID)
	if err != nil {
		t.Fatalf("seedUnverifiedEmailAccount role: %v", err)
	}
	t.Cleanup(func() {
		_, _ = a.pool.Exec(ctx, `DELETE FROM credential_token WHERE account_id=$1`, accountID)
		_, _ = a.pool.Exec(ctx, `DELETE FROM session WHERE account_id=$1`, accountID)
		_, _ = a.pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, accountID)
		_, _ = a.pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, accountID)
	})
	return accountID
}

// seedLiveSession inserts one live (unrevoked, unexpired) session for the
// account and returns its id — the row revokeSession/listSessions read.
func (a *authHarness) seedLiveSession(t *testing.T, accountID string) (sessionID string) {
	t.Helper()
	ctx := context.Background()
	_, hash, err := auth.NewRefreshToken()
	if err != nil {
		t.Fatalf("NewRefreshToken: %v", err)
	}
	err = a.pool.QueryRow(ctx, `
		INSERT INTO session (family_id, account_id, amr, roles_snapshot, client, refresh_hash,
		                     idle_expires_at, absolute_expires_at)
		VALUES (gen_random_uuid(), $1, 'pwd', '[]', 'restaurant-web', $2,
		        now()+interval '1 day', now()+interval '90 days')
		RETURNING id`, accountID, hash).Scan(&sessionID)
	if err != nil {
		t.Fatalf("seedLiveSession: %v", err)
	}
	return sessionID
}

// clientHdr is the required X-HG-Client header value used across the OTP/login
// flows. customer-app is a native surface, so login/verifyOtp deliver the
// refresh token in the body (needed for the refreshSession leg).
const clientHdr = "customer-app"

// webClient identifies the restaurant portal surface for email/password flows.
const webClient = "restaurant-web"

// ============================================================================
// OTP: requestOtp → verifyOtp (in-process, code read from the capturing sender)
// ============================================================================

// TestConformance_OTPFlow drives requestOtp then verifyOtp end to end. The OTP
// code is read from the capturing SMS sender (never an external log). Both the
// request bodies and the 2xx responses (OtpChallenge, SessionGrant) are
// validated against the contract. verifyOtp on a native client returns a
// refresh token, reused by the refreshSession test below.
func TestConformance_OTPFlow(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)
	phone := authUniquePhone()

	// requestOtp — validate the request body and the OtpChallenge response.
	reqBody := map[string]any{"phone_e164": phone, "purpose": "SIGN_IN"}
	rq := a.req(t, "POST", "/v1/auth/otp/request", reqBody, map[string]string{"X-HG-Client": clientHdr})
	a.validateReq(t, rq)

	rq = a.req(t, "POST", "/v1/auth/otp/request", reqBody, map[string]string{"X-HG-Client": clientHdr})
	resp := a.do(t, rq)
	a.validateResp(t, rq, resp, http.StatusOK)

	challengeID, _ := dataObject(t, resp)["challenge_id"].(string)
	resp.Body.Close()
	if challengeID == "" {
		t.Fatalf("requestOtp: empty challenge_id")
	}

	code := a.sms.code(phone)
	if code == "" {
		t.Fatalf("requestOtp: capturing SMS sender received no code for %s", phone)
	}

	// verifyOtp — validate the request body and the SessionGrant response.
	vBody := map[string]any{"challenge_id": challengeID, "code": code}
	vrq := a.req(t, "POST", "/v1/auth/otp/verify", vBody, map[string]string{"X-HG-Client": clientHdr})
	a.validateReq(t, vrq)

	vrq = a.req(t, "POST", "/v1/auth/otp/verify", vBody, map[string]string{"X-HG-Client": clientHdr})
	vresp := a.do(t, vrq)
	a.validateResp(t, vrq, vresp, http.StatusOK)
	vresp.Body.Close()

	// Clean up the account this flow found-or-created by phone.
	t.Cleanup(func() {
		ctx := context.Background()
		var acctID string
		if err := pool.QueryRow(ctx, `SELECT id FROM account WHERE phone_e164=$1`, phone).Scan(&acctID); err == nil {
			_, _ = pool.Exec(ctx, `DELETE FROM session WHERE account_id=$1`, acctID)
			_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, acctID)
			_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acctID)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM otp_challenge WHERE phone_e164=$1`, phone)
	})
}

// ============================================================================
// login + refreshSession
// ============================================================================

// TestConformance_LoginAndRefresh validates login (SessionGrant, request body)
// and then refreshSession using the native refresh token login returns. A
// customer-app (native) surface carries the refresh token in the body, which is
// exactly what refreshSession consumes.
func TestConformance_LoginAndRefresh(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("login")
	const pw = "ConformancePass12!"
	a.seedActiveEmailAccount(t, email, pw, "CUSTOMER")

	loginBody := map[string]any{"email": email, "password": pw}
	lrq := a.req(t, "POST", "/v1/auth/login", loginBody, map[string]string{"X-HG-Client": clientHdr})
	a.validateReq(t, lrq)

	lrq = a.req(t, "POST", "/v1/auth/login", loginBody, map[string]string{"X-HG-Client": clientHdr})
	lresp := a.do(t, lrq)
	a.validateResp(t, lrq, lresp, http.StatusOK)
	grant := dataObject(t, lresp)
	lresp.Body.Close()

	refreshToken, _ := grant["refresh_token"].(string)
	if refreshToken == "" {
		t.Fatalf("login: native client expected a refresh_token in the body, got none")
	}

	// refreshSession — native body transport. Validate request and SessionGrant.
	refBody := map[string]any{"refresh_token": refreshToken}
	rrq := a.req(t, "POST", "/v1/auth/refresh", refBody, map[string]string{"X-HG-Client": clientHdr})
	a.validateReq(t, rrq)

	rrq = a.req(t, "POST", "/v1/auth/refresh", refBody, map[string]string{"X-HG-Client": clientHdr})
	rresp := a.do(t, rrq)
	a.validateResp(t, rrq, rresp, http.StatusOK)
	rresp.Body.Close()
}

// ============================================================================
// listSessions + revokeSession
// ============================================================================

// TestConformance_Sessions validates listSessions (SessionSummary list envelope)
// and revokeSession (204). Both are authenticated self-scoped ops driven through
// the X-Test-* header authenticator. A live session row is seeded so the list is
// non-empty and the revoke targets a real, owned session.
func TestConformance_Sessions(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("sessions")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")
	sessionID := a.seedLiveSession(t, acctID)

	authHdrs := map[string]string{
		"X-Test-Account-ID": acctID,
		"X-Test-Roles":      "RESTAURANT_OWNER",
	}

	// listSessions — validate the SessionSummary list envelope.
	lrq := a.req(t, "GET", "/v1/auth/sessions", nil, authHdrs)
	lresp := a.do(t, lrq)
	a.validateResp(t, lrq, lresp, http.StatusOK)
	lresp.Body.Close()

	// revokeSession — 204, no body. ValidateResponse still matches the op and
	// records coverage; the seeded owned session is revoked.
	drq := a.req(t, "DELETE", "/v1/auth/sessions/"+sessionID, nil, authHdrs)
	dresp := a.do(t, drq)
	a.validateResp(t, drq, dresp, http.StatusNoContent)
	dresp.Body.Close()
}

// ============================================================================
// requestPasswordReset + resetPassword
// ============================================================================

// TestConformance_PasswordResetFlow validates requestPasswordReset
// (AcknowledgementResponse, request body) and resetPassword (204). A real
// PASSWORD_RESET credential token is issued via the store so resetPassword can
// consume it.
func TestConformance_PasswordResetFlow(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("pwreset")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")

	// requestPasswordReset — always 200 AcknowledgementResponse (no enumeration).
	body := map[string]any{"email": email}
	frq := a.req(t, "POST", "/v1/auth/password/forgot", body, nil)
	a.validateReq(t, frq)

	frq = a.req(t, "POST", "/v1/auth/password/forgot", body, nil)
	fresp := a.do(t, frq)
	a.validateResp(t, frq, fresp, http.StatusOK)
	fresp.Body.Close()

	// Mint a real PASSWORD_RESET token for the account, then resetPassword.
	token, tokenHash, err := auth.NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken: %v", err)
	}
	store := auth.NewStore(pool)
	if err := store.InsertCredentialToken(context.Background(), acctID, "PASSWORD_RESET", tokenHash, 30*time.Minute); err != nil {
		t.Fatalf("InsertCredentialToken: %v", err)
	}

	resetBody := map[string]any{"token": token, "new_password": "BrandNewPass34!"}
	rrq := a.req(t, "POST", "/v1/auth/password/reset", resetBody, nil)
	a.validateReq(t, rrq)

	rrq = a.req(t, "POST", "/v1/auth/password/reset", resetBody, nil)
	rresp := a.do(t, rrq)
	a.validateResp(t, rrq, rresp, http.StatusNoContent)
	rresp.Body.Close()
}

// ============================================================================
// changePassword
// ============================================================================

// TestConformance_ChangePassword validates changePassword: an authenticated
// restaurant owner changes their password and receives a re-issued SessionGrant.
// Both the request body and the SessionGrant response are validated.
func TestConformance_ChangePassword(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("chpw")
	const current = "ConformanceCur12!"
	acctID := a.seedActiveEmailAccount(t, email, current, "RESTAURANT_OWNER")

	authHdrs := map[string]string{
		"X-Test-Account-ID": acctID,
		"X-Test-Roles":      "RESTAURANT_OWNER",
		"X-HG-Client":       webClient,
	}
	body := map[string]any{"current_password": current, "new_password": "ConformanceNew34!"}

	crq := a.req(t, "POST", "/v1/auth/password/change", body, authHdrs)
	a.validateReq(t, crq)

	crq = a.req(t, "POST", "/v1/auth/password/change", body, authHdrs)
	cresp := a.do(t, crq)
	a.validateResp(t, crq, cresp, http.StatusOK)
	cresp.Body.Close()
}

// ============================================================================
// resendEmailVerification + verifyEmail
// ============================================================================

// TestConformance_EmailVerification validates resendEmailVerification
// (AcknowledgementResponse, 202) and verifyEmail (204, no session: an emailed
// link never signs anyone in, https://github.com/shaiknoorullah/hg-mono/issues/356).
// A real EMAIL_VERIFY credential token is issued for an unverified account so
// verifyEmail can consume it.
func TestConformance_EmailVerification(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("emailverify")
	acctID := a.seedUnverifiedEmailAccount(t, email, "ConformancePass12!")

	// resendEmailVerification — 202 AcknowledgementResponse, no enumeration.
	body := map[string]any{"email": email}
	rrq := a.req(t, "POST", "/v1/auth/email/resend", body, nil)
	a.validateReq(t, rrq)

	rrq = a.req(t, "POST", "/v1/auth/email/resend", body, nil)
	rresp := a.do(t, rrq)
	a.validateResp(t, rrq, rresp, http.StatusAccepted)
	rresp.Body.Close()

	// Mint a real EMAIL_VERIFY token, then verifyEmail → 204.
	token, tokenHash, err := auth.NewOpaqueToken()
	if err != nil {
		t.Fatalf("NewOpaqueToken: %v", err)
	}
	store := auth.NewStore(pool)
	if err := store.InsertCredentialToken(context.Background(), acctID, "EMAIL_VERIFY", tokenHash, 24*time.Hour); err != nil {
		t.Fatalf("InsertCredentialToken: %v", err)
	}

	vBody := map[string]any{"token": token}
	vrq := a.req(t, "POST", "/v1/auth/email/verify", vBody, map[string]string{"X-HG-Client": webClient})
	a.validateReq(t, vrq)

	vrq = a.req(t, "POST", "/v1/auth/email/verify", vBody, map[string]string{"X-HG-Client": webClient})
	vresp := a.do(t, vrq)
	a.validateResp(t, vrq, vresp, http.StatusNoContent)
	vresp.Body.Close()
}

// ============================================================================
// enrollTotp + verifyTotpEnrolment
// ============================================================================

// TestConformance_TOTPEnrolment validates enrollTotp (TotpEnrolment) and then
// verifyTotpEnrolment (204). The verify code is derived from the enrolment
// provisioning URI via auth.TOTPCodeFromURI — the in-process TOTP flow, not an
// external secret.
func TestConformance_TOTPEnrolment(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("totp")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")
	authHdrs := map[string]string{
		"X-Test-Account-ID": acctID,
		"X-Test-Roles":      "RESTAURANT_OWNER",
	}

	// enrollTotp — no request body; validate the TotpEnrolment response.
	erq := a.req(t, "POST", "/v1/auth/totp/enroll", map[string]any{}, authHdrs)
	eresp := a.do(t, erq)
	a.validateResp(t, erq, eresp, http.StatusOK)
	provURI, _ := dataObject(t, eresp)["provisioning_uri"].(string)
	eresp.Body.Close()
	if provURI == "" {
		t.Fatalf("enrollTotp: empty provisioning_uri")
	}

	// Derive the live TOTP code from the provisioning URI (in-process).
	code, err := auth.TOTPCodeFromURI(provURI)
	if err != nil {
		t.Fatalf("TOTPCodeFromURI: %v", err)
	}

	// verifyTotpEnrolment — validate the request body and the 204.
	vBody := map[string]any{"totp_code": code}
	vrq := a.req(t, "POST", "/v1/auth/totp/verify", vBody, authHdrs)
	a.validateReq(t, vrq)

	vrq = a.req(t, "POST", "/v1/auth/totp/verify", vBody, authHdrs)
	vresp := a.do(t, vrq)
	a.validateResp(t, vrq, vresp, http.StatusNoContent)
	vresp.Body.Close()
}
