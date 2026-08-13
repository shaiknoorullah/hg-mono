package catalog

import (
	"context"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestScopeResolverDeniesAnonymous asserts the ownership resolver short-circuits
// to ("", false) for an anonymous or account-less principal without ever
// touching the pool — a nil-repo resolver must not panic on these, because they
// are the deny-by-default answer a restaurant trading route depends on.
func TestScopeResolverDeniesAnonymous(t *testing.T) {
	// A resolver with a repo whose pool is nil: the anonymous/account-less paths
	// must return before any query is issued, so this must not panic.
	s := NewPgScopeResolver(&Repo{})

	cases := []struct {
		name string
		p    httpx.Principal
	}{
		{"anonymous", httpx.AnonymousPrincipal()},
		{"empty account id", httpx.Principal{AccountID: ""}},
		{"anonymous with account id", httpx.Principal{Anonymous: true, AccountID: "019ff4fe-b21c-7986-97fc-5cb7aef94b19"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := s.RestaurantForPrincipal(context.Background(), tc.p)
			if ok || id != "" {
				t.Fatalf("expected (\"\", false) for %s, got (%q, %v)", tc.name, id, ok)
			}
		})
	}
}

// TestRestaurantRolesAreTheScopedSet documents that the resolver's role set is
// exactly the three RESTAURANT-scoped roles from P-01 — not CUSTOMER, RIDER or
// any admin role, which are GLOBAL and must never resolve to a restaurant scope.
func TestRestaurantRolesAreTheScopedSet(t *testing.T) {
	want := map[string]bool{
		string(httpx.RoleRestaurantOwner):   true,
		string(httpx.RoleRestaurantManager): true,
		string(httpx.RoleRestaurantStaff):   true,
	}
	if len(restaurantRoles) != len(want) {
		t.Fatalf("restaurantRoles has %d entries, want %d", len(restaurantRoles), len(want))
	}
	for _, r := range restaurantRoles {
		if !want[r] {
			t.Errorf("unexpected role %q in the RESTAURANT-scoped set", r)
		}
	}
	// Guard against a GLOBAL role sneaking in.
	for _, forbidden := range []httpx.Role{httpx.RoleCustomer, httpx.RoleRider, httpx.RoleAdmin, httpx.RoleSuperAdmin, httpx.RoleSupportAgent} {
		for _, r := range restaurantRoles {
			if r == string(forbidden) {
				t.Errorf("GLOBAL role %q must not be in the RESTAURANT-scoped set", forbidden)
			}
		}
	}
}
