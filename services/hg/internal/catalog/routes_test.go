package catalog

import (
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestRoutesRegisterAndVerify asserts that every catalogue route carries a
// coherent policy (Verify passes) and that NONE is public — deny-by-default is a
// property of registration, and the contract marks no catalogue operation
// [PUBLIC].
func TestRoutesRegisterAndVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	h := NewHandler(&Repo{}, nil, nil, nil)
	Routes(r, h)

	if err := r.Verify(); err != nil {
		t.Fatalf("catalogue routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("no catalogue route may be public, got %v", pub)
	}

	// The seven discovery operations plus three restaurant trading operations.
	got := r.Routes()
	wantContains := []string{
		"GET /v1/restaurants",
		"GET /v1/feed",
		"GET /v1/search",
		"GET /v1/restaurants/{restaurantId}",
		"GET /v1/restaurants/{restaurantId}/menu",
		"GET /v1/restaurants/{restaurantId}/certification",
		"POST /v1/restaurants/{restaurantId}/certificate-url",
		"GET /v1/restaurant/availability",
		"PATCH /v1/restaurant/availability",
		"POST /v1/restaurant/heartbeat",
	}
	for _, w := range wantContains {
		found := false
		for _, g := range got {
			if g == w {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected route %q to be registered; got %v", w, got)
		}
	}
}
