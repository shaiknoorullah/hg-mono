package invariants

import (
	"context"
	"net/http"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// testAuthenticator injects a Principal from two test headers, exactly like
// internal/conformance's harness — a single in-process server can act as any
// role without minting a real session. With neither header the caller is
// anonymous, so deny-by-default is exercised for real (the authorizer, not
// this fake, is what decides).
type testAuthenticator struct{}

func (testAuthenticator) Authenticate(_ context.Context, r *http.Request) (httpx.Principal, error) {
	acct := r.Header.Get("X-Test-Account-ID")
	rolesHdr := r.Header.Get("X-Test-Roles")
	if acct == "" && rolesHdr == "" {
		return httpx.AnonymousPrincipal(), nil
	}
	var roles []httpx.Role
	for _, part := range strings.Split(rolesHdr, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			roles = append(roles, httpx.Role(part))
		}
	}
	return httpx.Principal{
		AccountID: acct,
		SessionID: "00000000-0000-4000-8000-0000c0f0face",
		Roles:     roles,
		AMR:       []string{"pwd+totp"},
	}, nil
}
