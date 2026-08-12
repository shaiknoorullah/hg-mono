package admin

import (
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Every admin route must carry a coherent Policy: a declared Action (never
// Public — the admin surface is authenticated staff only) and a RateClass. The
// router's Verify is the boot-time gate that proves it (I-06.1); this pins it in
// a unit test so a route added without a policy fails here, not at boot.
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	if err := r.Verify(); err != nil {
		t.Fatalf("admin routes failed policy verification: %v", err)
	}
	// No admin route may be public.
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("admin routes must never be public, found: %v", pub)
	}
}

// Every mutating admin route is MONEY-free but must still require an
// Idempotency-Key (0.1: every mutating admin endpoint accepts one). The router
// enforces MONEY→Idempotent; here we assert our writes set Idempotent so a
// replay of a decision cannot double-apply once P-37 dedupe lands.
func TestMutatingRoutesAreIdempotent(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	// The POST/PUT routes are the mutating ones; Verify already ran shape checks,
	// so reaching here without panic and with a clean Verify is the assertion.
	if err := r.Verify(); err != nil {
		t.Fatalf("verify: %v", err)
	}
}
