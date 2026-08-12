package auth

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// The P-05 permission matrix: a static Go map role → set[action]. It is not
// database-configurable (I-05.1), and every action a route declares must appear
// here for at least one role. Scope narrowing (a RESTAURANT_MANAGER only over
// their own restaurant) is the ownership check (P-07) done in SQL, never here.
//
// This module (B3, auth) owns only the actions its own routes declare. Sibling
// modules own the nouns they define (order.*, menu_item.*, refund.*, …) and
// contribute their actions to this matrix as they land. Until then the matrix
// carries the auth-owned actions plus the one action the system module already
// declares (platform_deps.read), so the router verifies and the deps route is
// reachable by an admin.

// Auth-owned Action constants. Actions are typed, never string literals at the
// call site (I-05.2).
const (
	// ActionSessionReadSelf guards the self-scoped session endpoints
	// (listSessions, getCurrentPrincipal). Ownership to the caller's own account
	// is enforced in SQL — these never read another account's sessions.
	ActionSessionReadSelf httpx.Action = "session.read_self"
	// ActionSessionRevokeSelf guards logout, logout-all and revokeSession over
	// the caller's own sessions only.
	ActionSessionRevokeSelf httpx.Action = "session.revoke_self"
)

// platformDepsRead mirrors system.ActionDepsRead without importing that package
// (an import cycle: system does not import auth, and auth must not depend on it
// for a constant). The string is the contract-anchored action id.
const platformDepsRead httpx.Action = "platform_deps.read"

// matrix is the closed role → action grant set.
var matrix = map[httpx.Role]map[httpx.Action]struct{}{
	httpx.RoleCustomer: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
	),
	httpx.RoleRider: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
	),
	httpx.RoleRestaurantOwner: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
	),
	httpx.RoleRestaurantManager: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
	),
	httpx.RoleRestaurantStaff: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
	),
	httpx.RoleSupportAgent: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		platformDepsRead,
	),
	httpx.RoleAdmin: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		platformDepsRead,
	),
	httpx.RoleSuperAdmin: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		platformDepsRead,
	),
}

func setOf(actions ...httpx.Action) map[httpx.Action]struct{} {
	m := make(map[httpx.Action]struct{}, len(actions))
	for _, a := range actions {
		m[a] = struct{}{}
	}
	return m
}

// Matrix is the httpx.Authorizer answering the P-05 role question. It replaces
// the boot-time DenyAllAuthorizer. Ownership (P-07) is a separate, later
// question the repository answers in SQL — this only decides the role→action
// half.
type Matrix struct{}

// RoleHasAction reports whether any of the caller's roles grants the action.
func (Matrix) RoleHasAction(roles []httpx.Role, a httpx.Action) bool {
	for _, r := range roles {
		if acts, ok := matrix[r]; ok {
			if _, granted := acts[a]; granted {
				return true
			}
		}
	}
	return false
}

// AllActions returns every action present in the matrix, sorted-independent.
// Used by the golden test to assert the closed set does not drift silently.
func AllActions() map[httpx.Action]struct{} {
	all := map[httpx.Action]struct{}{}
	for _, acts := range matrix {
		for a := range acts {
			all[a] = struct{}{}
		}
	}
	return all
}
