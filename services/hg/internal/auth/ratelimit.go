package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrLimiterUnavailable is returned when Redis cannot answer a rate-limit
// question for a limit that fails closed. The OTP request/verify paths map it
// to 503 RATE_LIMITER_UNAVAILABLE: they are the two endpoints where fail-open
// is unacceptable (docs/spec/01-platform.md, "P-02 — Phone OTP
// authentication", and the requestOtp description in contracts/openapi.yaml).
var ErrLimiterUnavailable = errors.New("auth: rate limiter unavailable")

// ErrRateLimited matches every over-the-cap answer (errors.Is). The concrete
// error is a *RateLimitedError carrying the Retry-After. Mapped to 429.
var ErrRateLimited = errors.New("auth: rate limited")

// RateLimitedError is the over-the-cap answer. RetryAfter is the time left in
// the window, so the 429 can say when to come back.
type RateLimitedError struct {
	RetryAfter time.Duration
}

// Error names the answer and the wait, so a log line is self-explanatory.
func (e *RateLimitedError) Error() string {
	return fmt.Sprintf("auth: rate limited, retry after %s", e.RetryAfter)
}

// Is makes errors.Is(err, ErrRateLimited) hold for every RateLimitedError.
func (e *RateLimitedError) Is(target error) bool { return target == ErrRateLimited }

// OnUnavailable says what a limit does when Redis cannot answer. The zero value
// fails closed, so a limit that forgets to choose is the strict one.
type OnUnavailable int

const (
	// FailClosed refuses the request (ErrLimiterUnavailable → 503). Only for
	// the OTP endpoints, where the limiter is the only brute-force defence.
	FailClosed OnUnavailable = iota
	// FailOpen allows the request and logs an error so an alert can fire.
	// Redis is disposable — losing it degrades protection, never correctness
	// (docs/spec/01-platform.md, "G-1 — Postgres is the only source of
	// truth") — and the caller must have a defence that does not live in
	// Redis: the Postgres login lockout, Traefik's per-IP limit.
	FailOpen
)

// Limit is one fixed-window cap. The Redis key is "rl:{Name}:{Subject}". Name
// is safe to log; Subject (an email, a phone, an IP) is not, and never is.
type Limit struct {
	Name          string
	Subject       string
	Max           int64
	Window        time.Duration
	OnUnavailable OnUnavailable
}

func (l Limit) key() string { return "rl:" + l.Name + ":" + l.Subject }

// RateLimiter is a fixed-window counter over Redis. Every counter is
// disposable: a FLUSHALL costs at most a window of extra allowance, never a
// correctness bypass — the OTP attempt counter and the login lockout both live
// in Postgres, not here (docs/spec/01-platform.md, "G-1 — Postgres is the only
// source of truth").
type RateLimiter struct {
	rdb *redis.Client
	log *slog.Logger
}

// NewRateLimiter builds a RateLimiter over the shared client. A nil rdb gives a
// limiter that allows everything (test / local mode without Redis).
func NewRateLimiter(rdb *redis.Client, log *slog.Logger) *RateLimiter {
	if log == nil {
		log = slog.Default()
	}
	return &RateLimiter{rdb: rdb, log: log}
}

// Allow counts one request against l. It returns nil when the request may
// proceed, a *RateLimitedError (errors.Is ErrRateLimited) when it is over the
// cap, and ErrLimiterUnavailable only when Redis cannot answer and l fails
// closed. The fail-open decision is made here, from l, so a caller never
// filters error kinds: any non-nil error means "do not proceed".
func (rl *RateLimiter) Allow(ctx context.Context, l Limit) error {
	if rl == nil || rl.rdb == nil {
		return nil // no-op: allow everything in test/local mode without Redis
	}
	pipe := rl.rdb.TxPipeline()
	incr := pipe.Incr(ctx, l.key())
	pipe.ExpireNX(ctx, l.key(), l.Window)
	ttl := pipe.PTTL(ctx, l.key())
	if _, err := pipe.Exec(ctx); err != nil {
		if l.OnUnavailable == FailOpen {
			rl.log.ErrorContext(ctx, "rate limiter unavailable; failing open",
				"limit", l.Name, "error", err.Error())
			return nil
		}
		return ErrLimiterUnavailable
	}
	if incr.Val() > l.Max {
		retry := ttl.Val()
		if retry <= 0 || retry > l.Window {
			retry = l.Window
		}
		return &RateLimitedError{RetryAfter: retry}
	}
	return nil
}

// Cooldown reports the remaining TTL on a cooldown key (e.g. OTP resend). Zero
// means no active cooldown. A Redis error is surfaced so the caller fails closed.
// When rdb is nil, returns 0 (no cooldown — no-op mode).
func (rl *RateLimiter) Cooldown(ctx context.Context, key string) (time.Duration, error) {
	if rl == nil || rl.rdb == nil {
		return 0, nil // no-op
	}
	ttl, err := rl.rdb.TTL(ctx, key).Result()
	if err != nil {
		return 0, ErrLimiterUnavailable
	}
	if ttl < 0 {
		return 0, nil
	}
	return ttl, nil
}

// SetCooldown sets a cooldown key with the given TTL. Used for the OTP 60 s
// resend cooldown. The value is irrelevant; presence is the signal.
// When rdb is nil, no-ops (returns nil).
func (rl *RateLimiter) SetCooldown(ctx context.Context, key string, ttl time.Duration) error {
	if rl == nil || rl.rdb == nil {
		return nil // no-op
	}
	if err := rl.rdb.Set(ctx, key, "1", ttl).Err(); err != nil {
		return ErrLimiterUnavailable
	}
	return nil
}
