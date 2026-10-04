package auth

import (
	"container/list"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"sync"
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
	// FallBackLocally counts the request in this replica's memory instead,
	// under the same key, Max and Window, and logs an error once per window
	// so an alert can fire (localLimiter). The limit keeps holding while Redis
	// is down, once per replica: with two replicas a caller gets at most twice
	// Max. It is the degraded mode, not a second source of truth: its counts
	// are dropped when they expire or are evicted, and the next answer from
	// Redis is the count again (docs/spec/01-platform.md, "P-38 — Rate
	// limiting"). For limits whose request must not become a 503 while Redis
	// is down: login (the lockout that stops password guessing lives in
	// Postgres), restaurant sign-up and the verification-email resend.
	FallBackLocally
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
	rdb   *redis.Client
	log   *slog.Logger
	local *localLimiter // used only while Redis cannot answer
}

// NewRateLimiter builds a RateLimiter over the shared client. A nil rdb gives a
// limiter that allows everything (test / local mode without Redis).
func NewRateLimiter(rdb *redis.Client, log *slog.Logger) *RateLimiter {
	if log == nil {
		log = slog.Default()
	}
	return &RateLimiter{rdb: rdb, log: log, local: newLocalLimiter(localMaxEntriesPerLimit, time.Now)}
}

// Allow counts one request against l. It returns nil when the request may
// proceed, a *RateLimitedError (errors.Is ErrRateLimited) when it is over the
// cap, and ErrLimiterUnavailable only when Redis cannot answer and l fails
// closed. What happens when Redis cannot answer is decided here, from l, so a
// caller never filters error kinds: any non-nil error means "do not proceed".
func (rl *RateLimiter) Allow(ctx context.Context, l Limit) error {
	if rl == nil || rl.rdb == nil {
		return nil // no-op: allow everything in test/local mode without Redis
	}
	pipe := rl.rdb.TxPipeline()
	incr := pipe.Incr(ctx, l.key())
	pipe.ExpireNX(ctx, l.key(), l.Window)
	ttl := pipe.PTTL(ctx, l.key())
	if _, err := pipe.Exec(ctx); err != nil {
		if l.OnUnavailable != FallBackLocally {
			return ErrLimiterUnavailable
		}
		logged, verdict := rl.local.allow(l)
		if logged > 0 {
			rl.log.ErrorContext(ctx, "rate limiter unavailable; counting in this replica's memory",
				"limit", l.Name, "window", l.Window.String(),
				"requests_since_last_log", logged, "error", err.Error())
		}
		return verdict
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

// localMaxEntriesPerLimit caps the counters the local fallback keeps for one
// limit (one Limit.Name). Subjects come from the caller (an address, an
// email), so without a cap a flood of made-up emails would grow memory for as
// long as Redis is down. Names are constants in code, so the fallback holds at
// most this many counters per limit: about 2 MB per limit at the cap, since a
// counter keeps its key as a 32-byte hash, however long the email. A window
// sees hundreds of subjects per limit at launch, not thousands.
const localMaxEntriesPerLimit = 10_000

// localSweepEvery is how often the fallback drops one limit's counters whose
// window has ended. A sweep walks all of that limit's counters, so it runs at
// most this often, never on every request.
const localSweepEvery = time.Minute

// localLimiter is the degraded mode behind FallBackLocally: the same
// fixed-window count Redis keeps, held in this replica's memory while Redis
// cannot answer. Each limit has its own counters, so a flood of made-up emails
// on one limit cannot evict another limit's counters. Within a limit, a
// counter whose window has ended is dropped by the next sweep, and beyond the
// cap the least recently counted is evicted. Losing a counter costs at most a
// window of extra allowance, exactly as losing a Redis key does.
type localLimiter struct {
	mu         sync.Mutex
	now        func() time.Time
	maxEntries int
	limits     map[string]*localCounters // by Limit.Name
}

// localCounters is one limit's counters, most recently counted first.
type localCounters struct {
	byKey     map[[sha256.Size]byte]*list.Element // of *localCounter
	lru       *list.List
	nextSweep time.Time
	nextLog   time.Time // the next fallback for this limit logs an error
	unlogged  int64     // fallbacks counted since the last error was logged
}

type localCounter struct {
	key     [sha256.Size]byte
	count   int64
	resetAt time.Time // the end of the window, as Redis's TTL would be
}

func newLocalLimiter(maxEntries int, now func() time.Time) *localLimiter {
	return &localLimiter{now: now, maxEntries: maxEntries, limits: map[string]*localCounters{}}
}

// allow counts one request against l, with Redis's answers: a
// *RateLimitedError carrying the time left in the window when the count is
// over l.Max, nil otherwise. logged is non-zero on the first fallback for
// l.Name in each l.Window, and is then the number of fallbacks for that limit
// since the last time, so the caller logs one error per window per limit, not
// one per request.
func (ll *localLimiter) allow(l Limit) (logged int64, verdict error) {
	now := ll.now()
	key := sha256.Sum256([]byte(l.key()))

	ll.mu.Lock()
	defer ll.mu.Unlock()

	cs := ll.limits[l.Name]
	if cs == nil {
		cs = &localCounters{byKey: map[[sha256.Size]byte]*list.Element{}, lru: list.New()}
		ll.limits[l.Name] = cs
	}
	cs.unlogged++
	if !now.Before(cs.nextLog) {
		logged, cs.unlogged = cs.unlogged, 0
		cs.nextLog = now.Add(l.Window)
	}
	if !now.Before(cs.nextSweep) {
		cs.dropExpired(now)
		cs.nextSweep = now.Add(localSweepEvery)
	}

	var c *localCounter
	if e, ok := cs.byKey[key]; ok {
		c = e.Value.(*localCounter)
		cs.lru.MoveToFront(e)
		if !now.Before(c.resetAt) { // the window ended: this request opens the next
			c.count, c.resetAt = 0, now.Add(l.Window)
		}
	} else {
		for len(cs.byKey) >= ll.maxEntries {
			cs.remove(cs.lru.Back())
		}
		c = &localCounter{key: key, resetAt: now.Add(l.Window)}
		cs.byKey[key] = cs.lru.PushFront(c)
	}
	c.count++
	if c.count > l.Max {
		return logged, &RateLimitedError{RetryAfter: c.resetAt.Sub(now)}
	}
	return logged, nil
}

// dropExpired removes every counter whose window has ended.
func (cs *localCounters) dropExpired(now time.Time) {
	for e := cs.lru.Back(); e != nil; {
		prev := e.Prev()
		if !now.Before(e.Value.(*localCounter).resetAt) {
			cs.remove(e)
		}
		e = prev
	}
}

func (cs *localCounters) remove(e *list.Element) {
	delete(cs.byKey, e.Value.(*localCounter).key)
	cs.lru.Remove(e)
}
