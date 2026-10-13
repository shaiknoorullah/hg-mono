package httpx

import "context"

// WithPrincipalForTest injects a Principal into a context. It is the public
// counterpart of the unexported withPrincipal, exposed for test packages that
// need to simulate the Authenticate middleware without standing up a full
// HTTP server. Production code uses the middleware; test code uses this.
func WithPrincipalForTest(ctx context.Context, p Principal) context.Context {
	return withPrincipal(ctx, p)
}

// WithIdempotencyKeyForTest puts a validated Idempotency-Key into a context,
// as the IdempotencyKey middleware does for a keyed route.
func WithIdempotencyKeyForTest(ctx context.Context, key string) context.Context {
	return withIdempotencyKey(ctx, key)
}
