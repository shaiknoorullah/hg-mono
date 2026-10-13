package auth

import (
	"reflect"
	"sort"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestRoutesVerifyAndPublicSet boots a router with the auth routes registered
// and asserts (a) Verify passes — every route carries a coherent policy (I-06.1)
// — and (b) the public set equals the checked-in allowlist exactly (I-06.2).
func TestRoutesVerifyAndPublicSet(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	// A zero-value handler is sufficient: Routes only records patterns and
	// policies; no handler is invoked during registration or Verify.
	Routes(r, &Handler{})

	if err := r.Verify(); err != nil {
		t.Fatalf("router.Verify() failed for auth routes: %v", err)
	}

	got := r.PublicRoutes()
	want := PublicRouteAllowlist()
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public routes drifted from the allowlist:\n got: %v\nwant: %v", got, want)
	}
}

// TestPublicRoutesAreExactlyTheContractPublicOps guards against accidentally
// making an authenticated route public. Every entry here is x-roles:[PUBLIC] in
// contracts/openapi.yaml.
func TestPublicRoutesAreExactlyTheContractPublicOps(t *testing.T) {
	want := map[string]struct{}{
		"POST /v1/auth/otp/request":         {},
		"POST /v1/auth/otp/verify":          {},
		"POST /v1/auth/register/restaurant": {},
		"POST /v1/auth/email/verify":        {},
		"POST /v1/auth/email/resend":        {},
		"POST /v1/auth/login":               {},
		"POST /v1/auth/refresh":             {},
		"POST /v1/auth/password/forgot":     {},
		"POST /v1/auth/password/reset":      {},
	}
	for _, r := range PublicRouteAllowlist() {
		if _, ok := want[r]; !ok {
			t.Errorf("route %q is public but is not a contract PUBLIC operation", r)
		}
		delete(want, r)
	}
	for r := range want {
		t.Errorf("contract PUBLIC operation %q is missing from the allowlist", r)
	}
}
