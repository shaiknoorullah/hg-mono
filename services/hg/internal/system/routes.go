package system

import (
	"net"
	"sort"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Routes registers this module's routes on the shared router.
//
// This function is the shape every module repeats: one Routes(r, deps) per
// package, each route carrying an explicit Policy and the contract's
// operationId. Nothing registers a handler any other way.
func Routes(r *httpx.Router, h *Handler, cfg *config.Config) {
	public := func(op string) httpx.Policy {
		return httpx.Policy{Public: true, Class: httpx.ClassRead, OperationID: op}
	}

	// Contract operations.
	r.Get("/health", public("getHealth"), h.Health)
	r.Get("/health/ready", public("getReadiness"), h.Readiness)
	r.Get("/internal/deps", httpx.Policy{
		Action:      ActionDepsRead,
		Class:       httpx.ClassRead,
		OperationID: "getDependencyStatus",
	}, h.DependencyStatus)

	// Aliases outside the contract, for container and orchestrator health checks
	// that look for these names.
	r.Get("/healthz", public("getHealth (alias)"), h.Health)
	r.Get("/readyz", public("getReadiness (alias)"), h.Readiness)

	// /debug/deps is public only in local, where there is no authentication to
	// have and the report contains no secret. Everywhere else it requires the
	// same action as the contract operation it mirrors — a diagnostics endpoint
	// that is public in production is how internal topology leaks.
	depsPolicy := httpx.Policy{
		Action:      ActionDepsRead,
		Class:       httpx.ClassRead,
		OperationID: "getDependencyStatus (debug)",
	}
	if cfg.Env.IsLocal() {
		depsPolicy = httpx.Policy{
			Public:      true,
			Class:       httpx.ClassRead,
			OperationID: "getDependencyStatus (debug, local only)",
			LocalOnly:   true,
		}
	}
	r.Get("/debug/deps", depsPolicy, h.DebugDependencies)
}

// PublicRouteAllowlist is the checked-in set required by I-06.2: the set of
// public routes must equal this exactly, so making a route public is a visible
// diff in a reviewed list rather than a one-word change buried in a call.
//
// TODO(siblings): as auth lands, add exactly the contract's PUBLIC operations —
// getOpenApiDocument, getPublicConfig, requestOtp, verifyOtp, registerRestaurant,
// verifyEmail, resendEmailVerification, login, requestPasswordReset,
// resetPassword, refreshSession, receiveStripeWebhook — and nothing else.
func PublicRouteAllowlist(local bool) []string {
	routes := []string{
		"GET /health",
		"GET /health/ready",
		"GET /healthz",
		"GET /readyz",
	}
	if local {
		routes = append(routes, "GET /debug/deps")
	}
	sort.Strings(routes)
	return routes
}

// sameEndpoint reports whether a configured address and an observed peer address
// plausibly describe the same endpoint.
//
// It compares ports strictly and hosts loosely, because a configured host is
// usually a name ("postgres", "redis") while the observed peer is always an IP.
// A mismatched *port*, or a configured IP that differs from the connected IP, is
// the signal worth surfacing; a name-versus-IP difference is normal.
func sameEndpoint(configured, resolved string) bool {
	if configured == "" || resolved == "" {
		return false
	}
	cHost, cPort := splitHostPort(configured)
	rHost, rPort := splitHostPort(resolved)

	if cPort != "" && rPort != "" && cPort != rPort {
		return false
	}
	if cHost == rHost {
		return true
	}
	// A configured literal IP must equal the connected IP.
	if ip := net.ParseIP(cHost); ip != nil {
		return cHost == rHost
	}
	// A configured hostname resolving to the connected IP is a match.
	addrs, err := net.LookupHost(cHost)
	if err != nil {
		// Cannot verify; report the difference rather than assuming agreement.
		return false
	}
	for _, a := range addrs {
		if a == rHost {
			return true
		}
	}
	return false
}

func splitHostPort(s string) (host, port string) {
	s = strings.TrimPrefix(strings.TrimPrefix(s, "http://"), "https://")
	if h, p, err := net.SplitHostPort(s); err == nil {
		return strings.Trim(h, "[]"), p
	}
	return strings.Trim(s, "[]"), ""
}
