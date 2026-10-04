package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// Password hashing is the most expensive thing this process does: every
// argon2id hash or verification allocates 64 MiB and keeps two cores busy (the
// parameters are in crypto.go). Restaurant sign-up, password reset and login are
// public, so nothing upstream bounds how many arrive at once, and about ten in
// parallel exhaust a replica's memory. The gates below cap how many run at once
// in this process. A caller that cannot get a slot within the wait gets a
// *HashBusyError (errors.Is ErrPasswordHashBusy), which the handlers turn into
// 503 with Retry-After.
//
// There is one gate per audience, so a flood on one public form cannot lock
// everyone else out: throwaway sign-ups fill only the sign-up gate, and admins
// keep a slot of their own however busy customer-facing login is. The slots of
// all gates add up to HG_AUTH_HASH_CONCURRENCY, so peak memory stays bounded.
//
// The argon2id work is reachable only through a held hashSlot, so no code path
// can hash outside the cap. The per-request rate limits run before a slot is
// taken (service_flows.go), so a limited request never holds one.
//
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/216 ("Unbounded
// argon2id hashing"). Spec: docs/spec/01-platform.md, "P-03 — Email + password
// authentication".

// hashAudience names a gate. The type is unexported and only the three
// constants below exist, so a caller cannot invent a gate that has no cap.
type hashAudience string

const (
	// audienceSignup is the public forms that create a password: restaurant
	// sign-up and password reset.
	audienceSignup hashAudience = "signup"
	// audienceLogin is sign-in for every account that is not staff, and for an
	// email with no account (which still pays for a verification; see Login).
	audienceLogin hashAudience = "login"
	// audienceStaff is sign-in for admin and super-admin accounts, and the
	// authenticated password change. Its slot is never shared with the public.
	audienceStaff hashAudience = "staff"
)

const (
	// DefaultHashConcurrency is how many password hashes may run at once in one
	// process, across all gates, when HG_AUTH_HASH_CONCURRENCY is unset.
	DefaultHashConcurrency = 3
	// MinHashConcurrency is one slot per gate: below it a gate would have none.
	MinHashConcurrency = 3
	// MaxHashConcurrency bounds the setting (64 × 64 MiB = 4 GiB).
	MaxHashConcurrency = 64
	// DefaultHashWait is how long a caller waits for a free hashing slot before
	// giving up, when HG_AUTH_HASH_WAIT is unset.
	DefaultHashWait = 2 * time.Second
	// MaxHashWait bounds HG_AUTH_HASH_WAIT. Every waiter holds a goroutine, a
	// request and a connection for the whole wait, so a long wait turns a flood
	// into connection exhaustion instead of memory exhaustion.
	MaxHashWait = 5 * time.Second
	// DefaultHashWaitersPerSlot sets the default of HG_AUTH_HASH_MAX_WAITERS:
	// this many waiting callers per hashing slot.
	DefaultHashWaitersPerSlot = 4
	// MaxHashWaiters bounds HG_AUTH_HASH_MAX_WAITERS.
	MaxHashWaiters = 1024
)

// ErrPasswordHashBusy matches every "hashing is at capacity" answer
// (errors.Is). Nothing was hashed and nothing was written; the caller should
// answer 503 with Retry-After and must not count it as a failed sign-in. The
// concrete error is a *HashBusyError naming the gate.
var ErrPasswordHashBusy = errors.New("auth: password hashing is at capacity")

// HashBusyError is the "at capacity" answer from one gate.
type HashBusyError struct {
	// Gate is the audience whose slots were all taken.
	Gate string
	// Reason is "wait_expired", "too_many_waiting" or "request_ended".
	Reason string
	// RetryAfter is how long the client should wait before trying again.
	RetryAfter time.Duration
	cause      error
}

// Error names the gate and the reason, so a log line is self-explanatory.
func (e *HashBusyError) Error() string {
	return fmt.Sprintf("auth: password hashing is at capacity (gate %s, %s)", e.Gate, e.Reason)
}

// Is makes errors.Is(err, ErrPasswordHashBusy) hold for every HashBusyError.
func (e *HashBusyError) Is(target error) bool { return target == ErrPasswordHashBusy }

// Unwrap exposes the request's context error when the request ended while
// waiting.
func (e *HashBusyError) Unwrap() error { return e.cause }

// hashGate is a counting semaphore over argon2id work with a bounded queue.
type hashGate struct {
	audience   hashAudience
	slots      chan struct{}
	wait       time.Duration
	maxWaiters int32

	waiters  atomic.Int32
	acquired atomic.Uint64 // slots handed out, ever
	rejected atomic.Uint64 // callers turned away, ever
}

func newHashGate(audience hashAudience, capacity int, wait time.Duration, maxWaiters int) *hashGate {
	if capacity < 1 {
		capacity = 1
	}
	if maxWaiters < 1 {
		maxWaiters = 1
	}
	return &hashGate{
		audience:   audience,
		slots:      make(chan struct{}, capacity),
		wait:       wait,
		maxWaiters: int32(maxWaiters),
	}
}

// hashGates is the set of gates for one process.
type hashGates struct {
	signup, login, staff *hashGate
}

// newHashGates splits total slots across the three gates: one for staff, about
// a third of the rest for sign-up, and the remainder (the most) for login.
// total below MinHashConcurrency, a wait of zero or less and maxWaiters below 1
// fall back to the defaults, so a zero-valued config cannot disable the cap.
// The waiters are split across the gates in proportion to their slots.
func newHashGates(total int, wait time.Duration, maxWaiters int) *hashGates {
	if total < MinHashConcurrency {
		total = DefaultHashConcurrency
	}
	if wait <= 0 {
		wait = DefaultHashWait
	}
	if maxWaiters < 1 {
		maxWaiters = DefaultHashWaitersPerSlot * total
	}
	staff := 1
	signup := max(1, (total-staff)/3)
	login := total - staff - signup
	waitersFor := func(slots int) int { return max(1, maxWaiters*slots/total) }
	return &hashGates{
		signup: newHashGate(audienceSignup, signup, wait, waitersFor(signup)),
		login:  newHashGate(audienceLogin, login, wait, waitersFor(login)),
		staff:  newHashGate(audienceStaff, staff, wait, waitersFor(staff)),
	}
}

func (gs *hashGates) gate(a hashAudience) *hashGate {
	switch a {
	case audienceSignup:
		return gs.signup
	case audienceLogin:
		return gs.login
	case audienceStaff:
		return gs.staff
	}
	panic("auth: no password-hashing gate for audience " + string(a))
}

// passwordGates is the process-wide set every hash goes through.
var passwordGates atomic.Pointer[hashGates]

func init() { passwordGates.Store(newHashGates(DefaultHashConcurrency, DefaultHashWait, 0)) }

// ConfigurePasswordHashing sets the process-wide cap on concurrent password
// hashing (total slots across the gates), how long a caller waits for a slot,
// and how many callers may wait at once (0 means the default, four per slot).
// It is called once at boot by NewModule from the loaded Secrets. Hashes
// already holding a slot finish on the old gates.
func ConfigurePasswordHashing(concurrency int, wait time.Duration, maxWaiters int) {
	passwordGates.Store(newHashGates(concurrency, wait, maxWaiters))
}

// PasswordHashingRejections reports, per gate, how many callers have been
// turned away since boot. Each rejection is also logged by the handler.
func PasswordHashingRejections() map[string]uint64 {
	gs := passwordGates.Load()
	return map[string]uint64{
		string(audienceSignup): gs.signup.rejected.Load(),
		string(audienceLogin):  gs.login.rejected.Load(),
		string(audienceStaff):  gs.staff.rejected.Load(),
	}
}

// retryAfter is the Retry-After for this gate's 503: the wait, rounded up to
// whole seconds.
func (g *hashGate) retryAfter() time.Duration {
	return ((g.wait + time.Second - 1) / time.Second) * time.Second
}

func (g *hashGate) busy(reason string, cause error) error {
	g.rejected.Add(1)
	return &HashBusyError{Gate: string(g.audience), Reason: reason, RetryAfter: g.retryAfter(), cause: cause}
}

// hashSlot is a held place in a gate. Hash and verify are methods on it, so
// argon2id cannot run without one. Release it exactly once, with defer.
type hashSlot struct {
	gate *hashGate
	once sync.Once
}

// acquire takes a free slot at once if there is one. Otherwise it joins the
// queue, unless the queue is full, and waits for at most the gate's wait or
// until ctx ends.
func (g *hashGate) acquire(ctx context.Context) (*hashSlot, error) {
	select {
	case g.slots <- struct{}{}:
		g.acquired.Add(1)
		return &hashSlot{gate: g}, nil
	default:
	}
	if g.waiters.Add(1) > g.maxWaiters {
		g.waiters.Add(-1)
		return nil, g.busy("too_many_waiting", nil)
	}
	defer g.waiters.Add(-1)
	timer := time.NewTimer(g.wait)
	defer timer.Stop()
	select {
	case g.slots <- struct{}{}:
		g.acquired.Add(1)
		return &hashSlot{gate: g}, nil
	case <-timer.C:
		return nil, g.busy("wait_expired", nil)
	case <-ctx.Done():
		return nil, g.busy("request_ended", ctx.Err())
	}
}

// acquireHashSlot takes a slot on the process-wide gate for the audience.
func acquireHashSlot(ctx context.Context, audience hashAudience) (*hashSlot, error) {
	return passwordGates.Load().gate(audience).acquire(ctx)
}

// release gives the slot back. Calling it more than once is harmless.
func (s *hashSlot) release() {
	s.once.Do(func() { <-s.gate.slots })
}
