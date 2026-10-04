package auth

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"math"
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
	// are dropped when their window ends (or, when memory is full, the lowest
	// one is), the next answer from Redis is the count again, and the local
	// window starts at the first request Redis
	// could not answer, so a caller can get Max from Redis and then Max here
	// in the window a Redis outage begins (docs/spec/01-platform.md, "P-38 —
	// Rate limiting"). For limits whose request must not become a 503 while
	// Redis is down: login (the lockout that stops password guessing lives in
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

// localMaxEntriesPerLimit caps the counts the local fallback keeps for one
// limit (one Limit.Name). Subjects come from the caller (an address, an
// email), so without a cap a flood of made-up emails would grow memory for as
// long as Redis is down. Names are constants in code, so the fallback holds at
// most this many counts per limit: a count is a 16-byte key hash and two
// integers, however long the email, and a limit at the cap measured 5 MB of
// heap, levelling off at 11 MB under a flood of a million made-up subjects
// (evictions leave the map's tables partly empty). A window sees hundreds of
// subjects per limit at launch; the cap is far above that so that a flood,
// not real traffic, is what fills it.
const localMaxEntriesPerLimit = 100_000

// localEvictionSample is how many counts are looked at to choose the one to
// drop when a limit is full, as Redis samples keys for its LRU and LFU
// policies: enough that a count-1 entry is almost always among them while
// any are left, few enough that each eviction costs the same small time.
const localEvictionSample = 16

// localSweepEvery is how often the fallback drops one limit's counts whose
// window has ended. A sweep walks all of that limit's counts (a few
// milliseconds at the cap), so it runs at most this often, never on every
// request. In between, an ended window is the first choice for eviction.
const localSweepEvery = time.Minute

// localLimiter is the degraded mode behind FallBackLocally: the same count
// Redis keeps, held in this replica's memory while Redis cannot answer.
//
//   - Same key: a count is keyed by Limit.key(), the Redis key, built by the
//     caller from the canonical email and the address bucket
//     (httpx.RateLimitKey: IPv6 per /64, "unknown" when unresolved), so
//     changing letter case or an IPv6 suffix does not reset a count here
//     either.
//   - Same window: a fixed window from the first request, like INCR then
//     EXPIRE NX, so across a window boundary a caller can get up to 2×Max in
//     a short time, exactly as with Redis.
//   - Atomic: one mutex covers the read, the increment and the answer, so
//     concurrent requests can never take more than Max between them.
//   - Bounded: each limit keeps at most maxEntries counts. A count is dropped
//     when its window ends; when a limit is full, a new subject takes the
//     place of the lowest count among localEvictionSample sampled (an ended
//     window counting as zero; on a tie, the oldest window). A flood of
//     made-up subjects creates counts of one, so those are what it evicts:
//     a subject that is really being tried keeps its count, losing a count of
//     one gives back at most one attempt, and a new caller always gets a
//     count of its own, so a flood can neither reset a guesser's budget nor
//     lock new callers out.
//   - Separate per limit: a flood on one limit cannot touch another's counts.
type localLimiter struct {
	mu         sync.Mutex
	now        func() time.Time
	maxEntries int
	limits     map[string]*localCounters // by Limit.Name
}

// localCounters is one limit's counts.
type localCounters struct {
	byKey     map[localKey]localWindow
	nextSweep time.Time
	nextLog   time.Time // the next fallback for this limit logs an error
	unlogged  int64     // fallbacks counted since the last error was logged
}

// localKey is the first 16 bytes of the SHA-256 of a Redis key: fixed-size
// whatever the subject's length, and 128 bits, so two subjects never share a
// count by accident.
type localKey [16]byte

// localWindow is one fixed-window count.
type localWindow struct {
	count   int64
	resetAt int64 // UnixNano at the end of the window, as Redis's TTL would be
}

func newLocalLimiter(maxEntries int, now func() time.Time) *localLimiter {
	return &localLimiter{now: now, maxEntries: maxEntries, limits: map[string]*localCounters{}}
}

// allow counts one request against l and answers as Redis would: a
// *RateLimitedError carrying the time left in the window when the count is
// over l.Max, nil otherwise. Every answer is a counted one. logged is
// non-zero on the first fallback for l.Name in each l.Window, and is then the
// number of fallbacks for that limit since the last time, so the caller logs
// one error per window per limit, not one per request.
func (ll *localLimiter) allow(l Limit) (logged int64, verdict error) {
	now := ll.now()
	sum := sha256.Sum256([]byte(l.key()))
	key := localKey(sum[:16])

	ll.mu.Lock()
	defer ll.mu.Unlock()

	cs := ll.limits[l.Name]
	if cs == nil {
		cs = &localCounters{byKey: map[localKey]localWindow{}}
		ll.limits[l.Name] = cs
	}
	cs.unlogged++
	if !now.Before(cs.nextLog) {
		logged, cs.unlogged = cs.unlogged, 0
		cs.nextLog = now.Add(l.Window)
	}
	if !now.Before(cs.nextSweep) {
		for k, w := range cs.byKey {
			if w.resetAt <= now.UnixNano() {
				delete(cs.byKey, k)
			}
		}
		cs.nextSweep = now.Add(localSweepEvery)
	}

	w, ok := cs.byKey[key]
	if !ok && len(cs.byKey) >= ll.maxEntries {
		cs.evictLowest(now.UnixNano())
	}
	verdict = w.add(now, l)
	cs.byKey[key] = w
	return logged, verdict
}

// evictLowest drops the lowest of localEvictionSample counts. Go starts every
// walk over a map at a random place, so the first counts walked are a sample.
func (cs *localCounters) evictLowest(now int64) {
	var victim localKey
	lowest, oldest := int64(math.MaxInt64), int64(math.MaxInt64)
	n := 0
	for k, w := range cs.byKey {
		count := w.count
		if w.resetAt <= now {
			count = 0 // the window has ended: nothing is lost by dropping it
		}
		if count < lowest || (count == lowest && w.resetAt < oldest) {
			victim, lowest, oldest = k, count, w.resetAt
		}
		if n++; n == localEvictionSample || lowest == 0 {
			break
		}
	}
	delete(cs.byKey, victim)
}

// add counts one request in w, opening the next window if the last one has
// ended, and answers as Redis would.
func (w *localWindow) add(now time.Time, l Limit) error {
	t := now.UnixNano()
	if t >= w.resetAt {
		w.count, w.resetAt = 0, now.Add(l.Window).UnixNano()
	}
	w.count++
	if w.count > l.Max {
		return &RateLimitedError{RetryAfter: time.Duration(w.resetAt - t)}
	}
	return nil
}
