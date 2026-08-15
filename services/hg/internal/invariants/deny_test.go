package invariants

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// ---------------------------------------------------------------------------
// Invariant 2 — "Deny by default. A route is public only if explicitly
// registered public." (AGENTS.md §3.2)
// ---------------------------------------------------------------------------

// TestDenyByDefault_RegisteredPrivateRouteRejectsAnonymous drives a real
// registered route (getCart, never marked Public in orders.Routes) with no
// principal at all and asserts the P-06 chain rejects it before the handler
// runs — a real database round trip would prove the handler was never
// reached, but 401-before-any-handler-side-effect is the contract itself.
func TestDenyByDefault_RegisteredPrivateRouteRejectsAnonymous(t *testing.T) {
	pool := testPool(t)
	st := orders.NewStore(pool)
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: auth.Matrix{}})
	orders.Routes(router, orders.NewHandler(st, nil, nil))
	if err := router.Verify(); err != nil {
		t.Fatalf("router policy verify: %v", err)
	}

	srv := httptest.NewServer(router)
	defer srv.Close()

	// No X-Test-Account-ID, no X-Test-Roles: genuinely anonymous.
	resp, err := srv.Client().Get(srv.URL + "/v1/cart")
	if err != nil {
		t.Fatalf("get /v1/cart: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET /v1/cart anonymous = %d, want 401 (deny by default)", resp.StatusCode)
	}
}

// TestDenyByDefault_UnregisteredPathIs404NeverRoutedElsewhere asserts that a
// path nobody registered answers 404 through the router's own NotFound
// handler — not a 500 from some catch-all, and not a 200 from a handler that
// happened to be reachable by prefix match. Router.Handle is "the only way to
// register an HTTP route in this service" (router.go); this is the negative
// space of that claim.
func TestDenyByDefault_UnregisteredPathIs404NeverRoutedElsewhere(t *testing.T) {
	pool := testPool(t)
	st := orders.NewStore(pool)
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: auth.Matrix{}})
	orders.Routes(router, orders.NewHandler(st, nil, nil))

	srv := httptest.NewServer(router)
	defer srv.Close()

	resp, err := srv.Client().Get(srv.URL + "/v1/definitely-not-a-route")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("GET unregistered path = %d, want 404", resp.StatusCode)
	}
}

// TestDenyByDefault_VerifyRejectsARouteWithNoPolicy is the boot-time half of
// I-06.1: a route Handle'd with neither an Action nor Public set must fail
// Router.Verify(), because that omission is a programmer error that must
// crash the boot, never surface as a silently-public or silently-401 route in
// production.
func TestDenyByDefault_VerifyRejectsARouteWithNoPolicy(t *testing.T) {
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: auth.Matrix{}})
	router.Get("/v1/__test/no-policy", httpx.Policy{}, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	if err := router.Verify(); err == nil {
		t.Fatal("Verify() accepted a route with no Action and no Public — deny-by-default is not a boot-time gate")
	}
}
