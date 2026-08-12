// Package httpx is the HTTP boundary: the router, the middleware chain, and the
// one response envelope. No business logic lives here and no other package
// writes to an http.ResponseWriter directly.
//
// Responsibility, by spec section (docs/spec/01-platform.md):
//
//   - G-6  — one envelope. Every 2xx is {"data": …} (+ {"meta": …} for
//     collections); every non-2xx is {"error": {code, message, details,
//     request_id}}. Bare arrays and {"success": false} are unrepresentable
//     because Respond/Fail are the only writers.
//   - G-4 / P-06 — deny by default. Routes are registered through Router.Handle,
//     which *requires* a Policy. Router.Verify() fails the boot on any route
//     whose policy declares neither an Action nor Public, on a zero RateClass,
//     and on a MONEY-class route that is not Idempotent. The Guard middleware
//     then denies at runtime anything that reached the mux without a registered
//     policy, so bypassing Handle cannot produce a reachable route.
//   - P-37 — Idempotency-Key extraction for money and durable-creation routes.
//   - G-8  — ULID request identifiers, echoed as X-Request-ID and carried into
//     every log line and every error body.
//
// What is real now and what is a stub:
//
//   - Real: the chain (request id, panic recovery, access log, CORS, timeout,
//     body limit, guard, idempotency-key extraction), the envelope, the
//     boot-time route verification, and the default-deny decision itself.
//   - Stub: Authenticator and Authorizer. AnonymousAuthenticator makes every
//     caller anonymous and DenyAllAuthorizer grants nothing, so a non-public
//     route answers 401/403 rather than pretending to authorize. The behaviour
//     is correct today and gets more permissive only when a real implementation
//     is wired in.
//
// TODO(auth sibling): implement Authenticator over the P-04 access token
// (EdDSA, 15 min, amr claim, revoked-sid deny set) and Authorizer over the P-05
// static role→action matrix, then wire them in cmd/hg. Do not change the Guard's
// decision table; only its two inputs.
//
// TODO(orders/payments siblings): P-37 idempotency is *extracted* here but not
// yet *enforced* — the claim/replay transaction against idempotency_record
// belongs in the store, in the same tx as the business effect.
//
// TODO: P-06 stages not yet present — RealIP (trust X-Forwarded-For only from
// Traefik's IP), SecurityHeaders, RateLimit (P-38), Validate with
// DisallowUnknownFields (P-36), ownership Authorize (P-07), AuditFinalize (P-35).
package httpx
