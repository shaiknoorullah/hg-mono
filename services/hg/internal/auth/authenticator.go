package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// Authenticator is the P-06 stage-10 implementation replacing
// httpx.AnonymousAuthenticator. It parses the EdDSA access token from the
// Authorization header, verifies its signature and claims, checks the
// revocation deny set, and returns the resolved Principal.
//
// It NEVER rejects a request for being anonymous (no token → anonymous
// principal, and the Guard decides). It rejects only a malformed, expired or
// revoked token — exactly the contract for stage 10.
type Authenticator struct {
	verifier *session.Verifier
	deny     *session.DenySet
}

// NewAuthenticator builds the authenticator.
func NewAuthenticator(verifier *session.Verifier, deny *session.DenySet) *Authenticator {
	return &Authenticator{verifier: verifier, deny: deny}
}

// Authenticate implements httpx.Authenticator.
func (a *Authenticator) Authenticate(ctx context.Context, r *http.Request) (httpx.Principal, error) {
	token := bearerToken(r)
	if token == "" {
		// No credential presented — a valid anonymous principal. The Guard
		// decides whether the route tolerates it.
		return httpx.AnonymousPrincipal(), nil
	}
	claims, err := a.verifier.Verify(token)
	if err != nil {
		// Malformed, wrong-issuer, wrong-signature or expired: stage 10 rejects.
		return httpx.Principal{}, err
	}
	// Revocation: a revoked session id, or a wholesale-revoked account, denies the
	// token even though it is cryptographically valid and unexpired (P-04).
	if a.deny != nil && a.deny.Denied(claims.SessionID, claims.Subject) {
		return httpx.Principal{}, session.ErrTokenInvalid
	}

	roles := make([]httpx.Role, 0, len(claims.Roles))
	for _, r := range claims.Roles {
		roles = append(roles, httpx.Role(r))
	}
	// The verified token travels with the principal for the database's own check
	// of a staff account action (migration 00045, account_state_apply).
	return httpx.Principal{
		AccountID: claims.Subject,
		SessionID: claims.SessionID,
		Roles:     roles,
		AMR:       claims.AMR,
	}.WithCredential(token), nil
}

// bearerToken extracts the token from `Authorization: Bearer <token>`. This is
// the one place in the module permitted to read the raw Authorization header
// (I-06.3 confines it to the auth middleware).
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}
