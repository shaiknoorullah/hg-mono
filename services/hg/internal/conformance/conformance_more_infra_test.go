package conformance

// Infra + auth-write conformance — reconstructed for the "more-infra" class.
//
// System module (bespoke in-process server wiring only system.Routes):
//	getHealth            GET  /health               (public; nil store suffices)
//	getPublicConfig      GET  /v1/config/public     (public)
//	getOpenApiDocument   GET  /v1/openapi.json      (public; serves the contract as JSON)
//	getReadiness         GET  /health/ready         (needs a live store.Store)
//	getDependencyStatus  GET  /internal/deps        (needs a live store; SUPER_ADMIN)
//
// Auth module (reuses newAuthHarness — the full auth stack):
//	getCurrentPrincipal  GET  /v1/auth/me           (200 Principal)
//	logout               POST /v1/auth/logout       (204)
//	logoutAll            POST /v1/auth/logout-all   (204)
//	disableTotp          POST /v1/auth/totp/disable (enroll→verify→disable; 204)
//	registerRestaurant   POST /v1/auth/register/restaurant (public; 201)
//
// getReadiness/getDependencyStatus open a real store.Store (Postgres+Redis+MinIO
// are up in this environment). If store.Open fails they skip-with-reason rather
// than being recorded as covered — the oracle is never faked. Every 2xx body is
// validated against contracts/openapi.yaml; every write body is additionally
// ValidateRequest-checked. All new identifiers are prefixed `mi`.

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
)

// miConfig builds the local config the system dependency probes need. The
// Postgres DSN comes from HG_TEST_POSTGRES_DSN; Redis and MinIO point at the
// running local stack (dev credentials from deploy/.env).
func miConfig() *config.Config {
	return &config.Config{
		Env:            config.EnvLocal,
		ServiceVersion: "conf-test-1",
		Postgres:       config.Postgres{DSN: os.Getenv("HG_TEST_POSTGRES_DSN"), MaxConns: 4, MinConns: 0, ConnTimeout: 5 * time.Second},
		Redis:          config.Redis{Addr: "localhost:6379"},
		MinIO: config.MinIO{
			Endpoint:  "localhost:9000",
			AccessKey: "hgminio",
			SecretKey: "change-me-in-your-env",
			UseSSL:    false,
			Region:    "us-east-1",
			Buckets: config.Buckets{
				KYC: "hg-kyc", POD: "hg-pod", Media: "hg-media",
				Exports: "hg-exports", Tmp: "hg-tmp",
			},
		},
	}
}

// miNewSystemServer stands up an in-process server wiring only system.Routes.
// It attempts to open a real store.Store for the dependency-reading paths; if
// that fails, st is nil and the caller skips getReadiness/getDependencyStatus.
func miNewSystemServer(t *testing.T) (*Harness, *store.Store) {
	t.Helper()
	spec := LoadSpec(t)
	cfg := miConfig()
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	st, err := store.Open(ctx, cfg, log)
	if err != nil {
		t.Logf("miNewSystemServer: store.Open failed (%v) — readiness/deps will skip", err)
		st = nil
	}

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})
	system.Routes(router, system.NewHandler(cfg, st, time.Now().UTC(), nil), cfg)
	if err := router.Verify(); err != nil {
		t.Fatalf("system router verify: %v", err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	if st != nil {
		t.Cleanup(st.Close)
	}
	return &Harness{Pool: nil, Server: srv, Spec: spec, covered: map[string]bool{}}, st
}

// TestConformance_MoreInfra_System validates the public system read surface plus
// the two dependency-report paths (when a live store can be opened).
func TestConformance_MoreInfra_System(t *testing.T) {
	// System reads do not touch Postgres directly, but the dependency paths need
	// the live stack; require the DSN so the run is meaningful.
	if os.Getenv("HG_TEST_POSTGRES_DSN") == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set — conformance harness needs the live stack")
	}
	h, st := miNewSystemServer(t)
	t.Cleanup(func() { writeCoverage(t, h) })

	t.Run("getHealth", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/health"}, 200)
	})
	t.Run("getPublicConfig", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/config/public"}, 200)
	})
	t.Run("getOpenApiDocument", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/openapi.json"}, 200)
	})

	if st == nil {
		t.Log("getReadiness/getDependencyStatus: SKIPPED — store.Open failed (Redis/MinIO unreachable). Not recorded as covered.")
		return
	}

	t.Run("getReadiness", func(t *testing.T) {
		// 200 (all deps up) or 503 (a degraded dep) — both are contract-declared
		// ReadinessStatus bodies. Validate whatever status comes back.
		req, resp := h.Do(t, Request{Method: "GET", Path: "/health/ready"})
		defer resp.Body.Close()
		opID, err := ValidateResponse(t, h.Spec, req, resp)
		h.MarkCovered(opID)
		if err != nil {
			t.Errorf("CONFORMANCE FAIL (getReadiness, status %d): %v", resp.StatusCode, err)
		}
	})
	t.Run("getDependencyStatus", func(t *testing.T) {
		// x-roles [ADMIN, SUPER_ADMIN]; use a SUPER_ADMIN principal.
		h.CheckResponse(t, Request{Method: "GET", Path: "/internal/deps",
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200)
	})
}

// TestConformance_MoreInfra_AuthMe validates getCurrentPrincipal for an
// authenticated account.
func TestConformance_MoreInfra_AuthMe(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("mime")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")
	hdrs := map[string]string{"X-Test-Account-ID": acctID, "X-Test-Roles": "RESTAURANT_OWNER"}

	req := a.req(t, "GET", "/v1/auth/me", nil, hdrs)
	resp := a.do(t, req)
	a.validateResp(t, req, resp, http.StatusOK)
	resp.Body.Close()
}

// TestConformance_MoreInfra_Logout validates logout and logoutAll (both 204).
func TestConformance_MoreInfra_Logout(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("milogout")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")
	a.seedLiveSession(t, acctID)
	hdrs := map[string]string{"X-Test-Account-ID": acctID, "X-Test-Roles": "RESTAURANT_OWNER"}

	t.Run("logout", func(t *testing.T) {
		req := a.req(t, "POST", "/v1/auth/logout", nil, hdrs)
		resp := a.do(t, req)
		a.validateResp(t, req, resp, http.StatusNoContent)
		resp.Body.Close()
	})
	t.Run("logoutAll", func(t *testing.T) {
		req := a.req(t, "POST", "/v1/auth/logout-all", nil, hdrs)
		resp := a.do(t, req)
		a.validateResp(t, req, resp, http.StatusNoContent)
		resp.Body.Close()
	})
}

// TestConformance_MoreInfra_DisableTotp enrolls + verifies TOTP for a
// RESTAURANT_OWNER (a role for which TOTP is optional, so it can be disabled) and
// then disables it. The verify and disable codes are derived from the enrolment
// provisioning URI in-process.
func TestConformance_MoreInfra_DisableTotp(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("mitotp")
	acctID := a.seedActiveEmailAccount(t, email, "ConformancePass12!", "RESTAURANT_OWNER")
	hdrs := map[string]string{"X-Test-Account-ID": acctID, "X-Test-Roles": "RESTAURANT_OWNER"}

	// enroll
	erq := a.req(t, "POST", "/v1/auth/totp/enroll", map[string]any{}, hdrs)
	eresp := a.do(t, erq)
	if eresp.StatusCode != http.StatusOK {
		t.Fatalf("enrollTotp: status %d", eresp.StatusCode)
	}
	provURI, _ := dataObject(t, eresp)["provisioning_uri"].(string)
	eresp.Body.Close()
	if provURI == "" {
		t.Fatalf("enrollTotp: empty provisioning_uri")
	}

	// verify (complete enrolment)
	vcode, err := auth.TOTPCodeFromURI(provURI)
	if err != nil {
		t.Fatalf("TOTPCodeFromURI: %v", err)
	}
	vrq := a.req(t, "POST", "/v1/auth/totp/verify", map[string]any{"totp_code": vcode}, hdrs)
	vresp := a.do(t, vrq)
	if vresp.StatusCode != http.StatusNoContent {
		t.Fatalf("verifyTotpEnrolment: status %d", vresp.StatusCode)
	}
	vresp.Body.Close()

	// disable — validate the request body and the 204.
	dcode, err := auth.TOTPCodeFromURI(provURI)
	if err != nil {
		t.Fatalf("TOTPCodeFromURI (disable): %v", err)
	}
	dbody := map[string]any{"totp_code": dcode}
	drqV := a.req(t, "POST", "/v1/auth/totp/disable", dbody, hdrs)
	a.validateReq(t, drqV)

	drq := a.req(t, "POST", "/v1/auth/totp/disable", dbody, hdrs)
	dresp := a.do(t, drq)
	a.validateResp(t, drq, dresp, http.StatusNoContent)
	dresp.Body.Close()
}

// TestConformance_MoreInfra_RegisterRestaurant validates the public
// registerRestaurant op (request body + 201 RestaurantRegistration).
func TestConformance_MoreInfra_RegisterRestaurant(t *testing.T) {
	pool := openPool(t)
	a := newAuthHarness(t, pool)

	email := authUniqueEmail("mireg")
	body := map[string]any{
		"email":         email,
		"password":      "ConformanceReg12!",
		"business_name": "Conformance Kitchen Inc.",
		"terms_version": "2026-01",
	}

	// registerRestaurant is a public *idempotent* op: the contract requires both
	// X-HG-Client and an Idempotency-Key.
	regHdrs := map[string]string{"X-HG-Client": webClient, "Idempotency-Key": "mi-register-restaurant-0001"}
	rrq := a.req(t, "POST", "/v1/auth/register/restaurant", body, regHdrs)
	a.validateReq(t, rrq)

	rrq = a.req(t, "POST", "/v1/auth/register/restaurant", body, regHdrs)
	rresp := a.do(t, rrq)
	a.validateResp(t, rrq, rresp, http.StatusCreated)
	rresp.Body.Close()

	// Clean up the account + restaurant this flow created (found by email).
	t.Cleanup(func() { miCleanupRegisteredRestaurant(pool, email) })
}

// miCleanupRegisteredRestaurant removes the account + restaurant + role created
// by registerRestaurant, so the shared fixture DB is left as found.
func miCleanupRegisteredRestaurant(pool *pgxpool.Pool, email string) {
	bg := context.Background()
	var acctID string
	if err := pool.QueryRow(bg, `SELECT id FROM account WHERE email=$1`, email).Scan(&acctID); err != nil {
		return
	}
	// The restaurant created for this owner is linked via account_role scope.
	var restaurantID string
	_ = pool.QueryRow(bg, `SELECT scope_id::text FROM account_role WHERE account_id=$1 AND scope_id IS NOT NULL LIMIT 1`, acctID).Scan(&restaurantID)
	_, _ = pool.Exec(bg, `DELETE FROM session WHERE account_id=$1`, acctID)
	_, _ = pool.Exec(bg, `DELETE FROM credential_token WHERE account_id=$1`, acctID)
	_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, acctID)
	if restaurantID != "" {
		_, _ = pool.Exec(bg, `DELETE FROM restaurant_application WHERE restaurant_id=$1`, restaurantID)
		_, _ = pool.Exec(bg, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
	}
	_, _ = pool.Exec(bg, `DELETE FROM account WHERE id=$1`, acctID)
}
