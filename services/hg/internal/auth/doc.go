// Package auth owns identity, sessions and the authorization matrix.
//
// Responsibility: turn a credential into a Principal, and answer whether a role
// grants an action. One `account` table, many role grants — customers and riders
// authenticate by phone OTP, restaurants and admins by email + password.
//
// Spec: docs/spec/01-platform.md
//
//   - P-01 Account model (one table, many roles; account_role is the only
//     persisted authorization data)
//   - P-02 Phone OTP (no account enumeration: identical body shape and latency
//     whether or not the number is known; re-request inside an open challenge
//     re-sends the same code and does not rotate it; fails *closed* with
//     RATE_LIMITER_UNAVAILABLE when Redis is down — this and verifyOtp are the
//     two endpoints where fail-open is unacceptable)
//   - P-03 Email + password, TOTP where enrolled
//   - P-04 Sessions: EdDSA access token, 15 min, `amr` claim, refresh rotation
//     with reuse detection that revokes the whole session family
//   - P-05 Role/scope/permission model — a static Go map role → set[action] with
//     a golden test, not database-configurable (I-05.1, I-05.2, I-05.3)
//   - P-07 Ownership checks: the repository takes the Principal and pushes the
//     predicate into SQL. There is no GetOrder(ctx, id), only GetOrderFor(ctx, p,
//     id). This is what makes the IDOR class unwriteable.
//
// Contract: tag `auth` in contracts/openapi.yaml. Public operations are exactly
// requestOtp, verifyOtp, login, registerRestaurant, verifyEmail,
// resendEmailVerification, requestPasswordReset, resetPassword, refreshSession.
//
// TODO: implement httpx.Authenticator and httpx.Authorizer here and wire them in
// cmd/hg/main.go, replacing AnonymousAuthenticator and DenyAllAuthorizer. The
// deny-by-default guard already works; it is waiting for these two inputs.
// Add every Action constant this package owns, and keep the 404-vs-403 rule:
// a principal with no relationship to a subject gets 404, never 403.
package auth
