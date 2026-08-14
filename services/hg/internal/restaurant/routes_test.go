package restaurant_test

// Route-shape tests: every registered route must carry a coherent Policy,
// and the set of public routes must be empty (deny by default, G-4 / I-06.1).

import (
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// TestRestaurantRoutesVerify boots a router with only the restaurant module's
// routes registered and asserts Router.Verify passes — every route has an
// Action and a RateClass.
func TestRestaurantRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("restaurant route policies are defective: %v", err)
	}
}

// TestRestaurantNoPublicRoutes asserts that no restaurant route is marked Public.
// The restaurant surface is authenticated staff only; x-roles never contains PUBLIC.
func TestRestaurantNoPublicRoutes(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("restaurant routes must never be public, found: %v", pub)
	}
}

// TestRestaurantRouteCount asserts the expected number of routes (19 operations).
// This pins the route surface so an accidental deletion or rename fails loudly.
func TestRestaurantRouteCount(t *testing.T) {
	const wantCount = 19
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	if got := len(r.Routes()); got != wantCount {
		t.Errorf("route count = %d, want %d; routes: %v", got, wantCount, r.Routes())
	}
}

// TestMoneyRoutesAreIdempotent: MONEY-class routes (acceptOrder, rejectOrder)
// must set Idempotent so the P-37 middleware requires an Idempotency-Key.
// Router.Verify rejects MONEY without Idempotent, so this is implicitly covered;
// this test names the invariant explicitly.
func TestMoneyRoutesAreIdempotent(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	// If Router.Verify passes (and it does per TestRestaurantRoutesVerify),
	// every MONEY-class route is Idempotent (I-37.4 is a Verify check).
	if err := r.Verify(); err != nil {
		t.Fatalf("verify: %v", err)
	}
}
