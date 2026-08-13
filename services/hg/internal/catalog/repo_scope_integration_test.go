package catalog

import (
	"context"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestScopeResolverResolvesLiveGrant seeds a fresh account with a live
// RESTAURANT_OWNER grant scoped to an existing restaurant and asserts the
// resolver returns that restaurant id. It then revokes the grant and asserts the
// resolver denies — a revoked grant must never resolve, or a fired manager could
// still toggle the restaurant open. Everything is cleaned up in a deferred DELETE.
//
// Guarded by HG_TEST_POSTGRES_DSN: skips cleanly when no migrated database is
// pointed at it.
func TestScopeResolverResolvesLiveGrant(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	res := NewPgScopeResolver(rp)
	ctx := context.Background()

	// An existing restaurant from the seed/migration to scope the grant to.
	var restaurantID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM restaurant LIMIT 1`).Scan(&restaurantID); err != nil {
		t.Skipf("no restaurant row available to scope a grant to: %v", err)
	}

	// A throwaway account. The email is unique and namespaced so a re-run never
	// collides; the deferred cleanup removes it and its grant.
	var accountID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account (email) VALUES ('scope-resolver-it@example.test') RETURNING id::text`,
	).Scan(&accountID); err != nil {
		t.Fatalf("insert throwaway account: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id = $1::uuid`, accountID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1::uuid`, accountID)
	})

	var grantID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account_role (account_id, role, scope_type, scope_id)
		 VALUES ($1::uuid, 'RESTAURANT_OWNER', 'RESTAURANT', $2::uuid)
		 RETURNING id::text`,
		accountID, restaurantID,
	).Scan(&grantID); err != nil {
		t.Fatalf("insert restaurant grant: %v", err)
	}

	// A principal with an unrelated role list still resolves by account_id: the
	// resolver reads the grant table, not the token's role claims, so the P-07
	// ownership answer cannot be spoofed by a client-asserted role.
	p := httpx.Principal{AccountID: accountID, Roles: []httpx.Role{httpx.RoleRestaurantOwner}}
	got, ok := res.RestaurantForPrincipal(ctx, p)
	if !ok {
		t.Fatalf("expected a live grant to resolve, got ok=false")
	}
	if got != restaurantID {
		t.Fatalf("resolved restaurant %q, want %q", got, restaurantID)
	}

	// A different account with no grant must not resolve — the deny path.
	if _, ok := res.RestaurantForPrincipal(ctx, httpx.Principal{AccountID: "00000000-0000-0000-0000-000000000000"}); ok {
		t.Fatalf("an account with no restaurant grant must not resolve")
	}

	// Revoke the grant: it must no longer resolve.
	if _, err := pool.Exec(ctx,
		`UPDATE account_role SET revoked_at = now() WHERE id = $1::uuid`, grantID,
	); err != nil {
		t.Fatalf("revoke grant: %v", err)
	}
	if id, ok := res.RestaurantForPrincipal(ctx, p); ok {
		t.Fatalf("a revoked grant must not resolve, got %q", id)
	}
}
