// Package store owns every connection this process holds to the outside world:
// Postgres, Redis and MinIO. Nothing else constructs a client, and nothing else
// knows a hostname.
//
// Responsibility:
//
//   - G-1 — Postgres is the only source of truth. Redis is disposable: it holds
//     cache, pub/sub fan-out, rate-limit counters and OTP codes, and a FLUSHALL
//     must cause degradation and never incorrectness. Every Redis key added here
//     must name its Postgres rebuild source in a comment.
//   - G-7 — fail loud on config. Open() dials every dependency at boot and
//     returns an error rather than a half-connected Store, and Report() answers
//     the question that /debug/deps exists for: *what address did we configure,
//     and what address are we actually talking to?* Those two strings being
//     different is how the previous system's cache silently pointed at
//     localhost:6379 inside Docker while appearing healthy.
//
// How "actually connected" is obtained, per dependency — none of it is inferred
// from configuration:
//
//   - Postgres: pgxpool's AfterConnect hook reads the live net.Conn's RemoteAddr.
//   - Redis: a recording net.Dialer is installed in redis.Options.
//   - MinIO: a recording DialContext is installed in the client's Transport.
//
// TODO(siblings): repositories go in sibling packages and take the pool from
// here; they do not open their own. P-07 is mechanical — a repository method
// that loads an owned entity takes the Principal and pushes the ownership
// predicate into SQL, so GetOrder(ctx, id) does not exist and GetOrderFor(ctx,
// p, id) does.
//
// TODO(payments sibling): a Stripe client belongs in this package's Report too —
// the contract's ReadinessStatus and DependencyReport both enumerate "stripe",
// and the stripe_livemode boot probe (G-7) has no home until it exists.
package store
