package catalog

import (
	"context"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// restaurantRoles is the closed set of RESTAURANT-scoped roles from P-01's
// role_name enum. A caller acts for a restaurant when it holds any live grant of
// one of these, scoped to that restaurant's id.
var restaurantRoles = []string{
	string(httpx.RoleRestaurantOwner),
	string(httpx.RoleRestaurantManager),
	string(httpx.RoleRestaurantStaff),
}

// PgScopeResolver answers the P-07 ownership question for the restaurant-facing
// trading routes: which restaurant does this authenticated principal act for?
//
// It reads account_role directly — the table P-01 defines — rather than reaching
// into the staff/RBAC module's Go package. Catalogue owns no writes to that
// table; it only consumes the grant. The role→action question (P-05) is answered
// earlier by the router's authorizer; this is the later ownership question, which
// the contract requires be resolved from the server's own view of the caller,
// never a client-asserted restaurant id.
type PgScopeResolver struct {
	repo *Repo
}

// NewPgScopeResolver builds a resolver over the catalogue repo's pool.
func NewPgScopeResolver(repo *Repo) *PgScopeResolver { return &PgScopeResolver{repo: repo} }

// RestaurantForPrincipal returns the restaurant id the principal is scoped to,
// or ("", false) when the caller holds no live RESTAURANT-scoped grant.
//
// An anonymous or account-less principal is always ("", false): there is no
// account to join. When a caller holds grants for more than one restaurant
// (multi-site staff), the earliest-granted live scope is chosen deterministically
// so the answer is stable — R-22 trading state is single-restaurant, and a
// caller that manages several needs a selected-restaurant header the contract
// does not yet define. Until it does, the deterministic first grant is the safe,
// non-arbitrary choice.
func (s *PgScopeResolver) RestaurantForPrincipal(ctx context.Context, p httpx.Principal) (string, bool) {
	if p.Anonymous || p.AccountID == "" {
		return "", false
	}
	const q = `
		SELECT scope_id::text
		  FROM account_role
		 WHERE account_id = $1::uuid
		   AND scope_type = 'RESTAURANT'
		   AND role::text = ANY($2)
		   AND revoked_at IS NULL
		   AND scope_id IS NOT NULL
		 ORDER BY granted_at ASC, id ASC
		 LIMIT 1`
	var restaurantID string
	err := s.repo.db.QueryRow(ctx, q, p.AccountID, restaurantRoles).Scan(&restaurantID)
	if err != nil {
		// pgx.ErrNoRows — no live restaurant grant — or any transient error both
		// deny: a trading route must not fall open when ownership cannot be proven.
		return "", false
	}
	return restaurantID, true
}
