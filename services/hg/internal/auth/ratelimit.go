package auth

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrLimiterUnavailable is returned when Redis cannot answer a rate-limit
// question. The OTP and login paths treat this as fatal (fail closed): they
// return 503 RATE_LIMITER_UNAVAILABLE rather than proceeding. This is the P-02
// rule — these are the endpoints where fail-open is unacceptable.
var ErrLimiterUnavailable = errors.New("auth: rate limiter unavailable")

// ErrRateLimited is returned when a counter is over its cap. Mapped to 429.
var ErrRateLimited = errors.New("auth: rate limited")

// RateLimiter is a fixed-window counter over Redis. Every key names its rebuild
// source in a comment at the call site; a FLUSHALL here costs a window of extra
// allowance, never a correctness bypass into a money path — the OTP attempt
// counter and the login lockout both live in Postgres, not here (G-1).
type RateLimiter struct {
	rdb *redis.Client
}

// NewRateLimiter builds a RateLimiter over the shared client.
func NewRateLimiter(rdb *redis.Client) *RateLimiter {
	return &RateLimiter{rdb: rdb}
}

// Allow increments the counter at key and reports whether it is within limit
// over the window. The first increment sets the TTL. A Redis error returns
// ErrLimiterUnavailable so the caller can fail closed.
func (rl *RateLimiter) Allow(ctx context.Context, key string, limit int64, window time.Duration) error {
	if rl == nil || rl.rdb == nil {
		return ErrLimiterUnavailable
	}
	pipe := rl.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return ErrLimiterUnavailable
	}
	if incr.Val() > limit {
		return ErrRateLimited
	}
	return nil
}

// Cooldown reports the remaining TTL on a cooldown key (e.g. OTP resend). Zero
// means no active cooldown. A Redis error is surfaced so the caller fails closed.
func (rl *RateLimiter) Cooldown(ctx context.Context, key string) (time.Duration, error) {
	if rl == nil || rl.rdb == nil {
		return 0, ErrLimiterUnavailable
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
func (rl *RateLimiter) SetCooldown(ctx context.Context, key string, ttl time.Duration) error {
	if rl == nil || rl.rdb == nil {
		return ErrLimiterUnavailable
	}
	if err := rl.rdb.Set(ctx, key, "1", ttl).Err(); err != nil {
		return ErrLimiterUnavailable
	}
	return nil
}
