package httpx

import (
	"context"
	"net/http"
)

// Role is a role grant from P-01's account_role table. The set is closed and
// mirrors the contract's Role enum.
type Role string

const (
	RoleCustomer          Role = "CUSTOMER"
	RoleRider             Role = "RIDER"
	RoleRestaurantOwner   Role = "RESTAURANT_OWNER"
	RoleRestaurantManager Role = "RESTAURANT_MANAGER"
	RoleRestaurantStaff   Role = "RESTAURANT_STAFF"
	RoleSupportAgent      Role = "SUPPORT_AGENT"
	RoleAdmin             Role = "ADMIN"
	RoleSuperAdmin        Role = "SUPER_ADMIN"
)

// Principal is the server's own view of who is calling. It is derived from the
// token and never from a client-asserted field.
//
// I-06.3: no handler reads the raw *http.Request for identity. Principal comes
// from the context, and only the authentication middleware constructs one.
type Principal struct {
	AccountID string
	SessionID string
	Roles     []Role
	// AMR is the authentication method reference from P-04: "otp", "pwd" or
	// "pwd+totp". A session with amr=["otp"] may never carry ADMIN.
	AMR []string
	// Anonymous is true for an unauthenticated caller. Anonymous is a *valid*
	// principal — stage 10 never rejects; stage 11 decides (P-06).
	Anonymous bool
}

// AnonymousPrincipal is the principal of a caller who presented no credentials.
func AnonymousPrincipal() Principal { return Principal{Anonymous: true} }

// HasRole reports whether the principal holds the given role grant.
func (p Principal) HasRole(r Role) bool {
	for _, have := range p.Roles {
		if have == r {
			return true
		}
	}
	return false
}

// Authenticator turns credentials into a Principal. It corresponds to stage 10
// of the P-06 chain and **never rejects a request for being anonymous**: it
// returns an error only for a malformed or revoked token.
type Authenticator interface {
	Authenticate(ctx context.Context, r *http.Request) (Principal, error)
}

// Authorizer answers the P-05 role question: does any role this principal holds
// grant this action? Ownership (P-07) is a separate, later question that the
// repository layer answers by pushing the predicate into SQL.
type Authorizer interface {
	RoleHasAction(roles []Role, a Action) bool
}

// AnonymousAuthenticator is the boot-time stub: every caller is anonymous.
//
// TODO(auth sibling): replace with the P-04 implementation — parse the EdDSA
// access token or the hg_rt cookie + X-HG-CSRF double submit, check the revoked
// session-id deny set, and return 401 only on a malformed or revoked token.
// Nothing else in this package needs to change.
type AnonymousAuthenticator struct{}

// Authenticate always returns the anonymous principal.
func (AnonymousAuthenticator) Authenticate(context.Context, *http.Request) (Principal, error) {
	return AnonymousPrincipal(), nil
}

// DenyAllAuthorizer is the boot-time stub: no role grants any action.
//
// This is deliberately the *safe* stub. Until the P-05 matrix exists, every
// non-public route answers 401 or 403 rather than falling open. A permissive
// stub here would make the deny-by-default guard decorative.
//
// TODO(auth sibling): replace with internal/authz.Matrix — a static Go map
// role → set[action] with a golden test, per P-05.
type DenyAllAuthorizer struct{}

// RoleHasAction always returns false.
func (DenyAllAuthorizer) RoleHasAction([]Role, Action) bool { return false }

type principalKey struct{}

func withPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, p)
}

// PrincipalFrom returns the authenticated principal. A request that has passed
// the chain always has one; absent means the chain did not run, so the safe
// answer is anonymous.
func PrincipalFrom(ctx context.Context) Principal {
	p, ok := ctx.Value(principalKey{}).(Principal)
	if !ok {
		return AnonymousPrincipal()
	}
	return p
}
