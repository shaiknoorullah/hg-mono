package conformance

// The platform-wide pause on new orders
// (https://github.com/shaiknoorullah/hg-mono/issues/244):
//
//	getOrderingPause  GET /v1/admin/ordering-pause  (staff)
//	setOrderingPause  PUT /v1/admin/ordering-pause  (ADMIN, SUPER_ADMIN)
//	getPublicConfig   GET /v1/config/public         (public; `ordering` while paused)
//
// Runs on a database of its own (testseed.FreshDatabase): pausing the shared
// conformance database would refuse the checkout the other conformance tests
// drive. Every request body is ValidateRequest-checked and every response body
// is validated against contracts/openapi.yaml.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/admin"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

func TestConformance_OrderingPause(t *testing.T) {
	if os.Getenv("HG_TEST_POSTGRES_DSN") == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set — conformance harness needs a Postgres server")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testseed.FreshDatabase(t, "hg_conformance_pause"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var adminID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status) VALUES ('op-admin@hg.test', 'ACTIVE') RETURNING id`).Scan(&adminID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'ADMIN', 'GLOBAL')`, adminID); err != nil {
		t.Fatal(err)
	}

	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: authMatrix()})
	admin.Routes(router, admin.NewHandler(admin.NewRepo(pool), admin.DefaultConfig()))
	cfg := miConfig()
	system.Routes(router, system.NewHandler(cfg, nil, time.Now().UTC(), nil).
		WithOrderingStatus(orders.NewStore(pool).OrderingStatus), cfg)
	if err := router.Verify(); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	h := &Harness{Pool: pool, Server: srv, Spec: LoadSpec(t), covered: map[string]bool{}}
	t.Cleanup(func() { writeCoverage(t, h) })

	set := func(paused bool, reason string) {
		t.Helper()
		rq := Request{
			Method: http.MethodPut, Path: "/v1/admin/ordering-pause",
			AccountID: adminID, Roles: []string{roleAdmin}, IdemKey: "op-conformance-" + reason[:8],
			Body: map[string]any{"paused": paused, "reason": reason},
		}
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, rq)); err != nil {
			t.Errorf("CONFORMANCE FAIL (request): %v", err)
		}
		h.CheckResponse(t, rq, http.StatusOK)
	}

	t.Run("getOrderingPause, never changed", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: http.MethodGet, Path: "/v1/admin/ordering-pause",
			AccountID: adminID, Roles: []string{"SUPPORT_AGENT"}}, http.StatusOK)
	})
	t.Run("setOrderingPause, pause", func(t *testing.T) {
		set(true, "Payments are failing; pausing new orders for the incident")
	})
	t.Run("getPublicConfig, while paused", func(t *testing.T) {
		_, resp := h.Do(t, Request{Method: http.MethodGet, Path: "/v1/config/public"})
		defer resp.Body.Close()
		cfg := dataObject(t, resp)
		ordering, _ := cfg["ordering"].(map[string]any)
		if ordering["paused"] != true || ordering["paused_since"] == nil {
			t.Errorf("ordering while paused = %v, want paused with paused_since", ordering)
		}
		h.CheckResponse(t, Request{Method: http.MethodGet, Path: "/v1/config/public"}, http.StatusOK)
	})
	t.Run("getOrderingPause, paused", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: http.MethodGet, Path: "/v1/admin/ordering-pause",
			AccountID: adminID, Roles: []string{roleAdmin}}, http.StatusOK)
	})
	t.Run("setOrderingPause, resume", func(t *testing.T) {
		set(false, "Resuming: the payment provider is healthy again")
	})
}
