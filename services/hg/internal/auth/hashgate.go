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
// parameters are in crypto.go). Restaurant sign-up and login are public, so
// nothing upstream bounds how many arrive at once, and about ten in parallel
// exhaust a replica's memory. The gate below caps how many run at once in this
// process. A caller that cannot get a slot within the wait gets
// ErrPasswordHashBusy, which the handlers turn into 503 with Retry-After.
//
// The argon2id work is reachable only through a held hashSlot, so no code path
// can hash outside the cap.
//
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/216 ("Unbounded
// argon2id hashing"). Spec: docs/spec/01-platform.md, "Password hashing".

const (
	// DefaultHashConcurrency is how many password hashes may run at once in one
	// process when HG_AUTH_HASH_CONCURRENCY is unset.
	DefaultHashConcurrency = 2
	// DefaultHashWait is how long a caller waits for a free hashing slot before
	// giving up, when HG_AUTH_HASH_WAIT is unset.
	DefaultHashWait = 2 * time.Second
)

// ErrPasswordHashBusy is returned when every password-hashing slot stayed taken
// for the whole wait. Nothing was hashed and nothing was written; the caller
// should answer 503 with Retry-After and must not count it as a failed sign-in.
var ErrPasswordHashBusy = errors.New("auth: password hashing is at capacity")

// hashGate is a counting semaphore over argon2id work.
type hashGate struct {
	slots chan struct{}
	wait  time.Duration
}

// newHashGate builds a gate. A concurrency below 1 or a wait of zero or less
// falls back to the defaults, so a zero-valued config cannot disable the cap.
func newHashGate(concurrency int, wait time.Duration) *hashGate {
	if concurrency < 1 {
		concurrency = DefaultHashConcurrency
	}
	if wait <= 0 {
		wait = DefaultHashWait
	}
	return &hashGate{slots: make(chan struct{}, concurrency), wait: wait}
}

// passwordGate is the process-wide gate every hash goes through.
var passwordGate atomic.Pointer[hashGate]

func init() { passwordGate.Store(newHashGate(DefaultHashConcurrency, DefaultHashWait)) }

// ConfigurePasswordHashing sets the process-wide cap on concurrent password
// hashing and how long a caller waits for a slot. It is called once at boot by
// NewModule from the loaded Secrets. Hashes already holding a slot finish on
// the old gate.
func ConfigurePasswordHashing(concurrency int, wait time.Duration) {
	passwordGate.Store(newHashGate(concurrency, wait))
}

// passwordHashRetryAfter is the Retry-After value, in whole seconds, sent with
// a 503 when hashing is at capacity: the configured wait, rounded up.
func passwordHashRetryAfter() int {
	s := int((passwordGate.Load().wait + time.Second - 1) / time.Second)
	if s < 1 {
		return 1
	}
	return s
}

// hashSlot is a held place in the gate. Hash and verify are methods on it, so
// argon2id cannot run without one. Release it exactly once, with defer.
type hashSlot struct {
	gate *hashGate
	once sync.Once
}

// acquire waits for a free slot for at most the gate's wait, or until ctx ends.
func (g *hashGate) acquire(ctx context.Context) (*hashSlot, error) {
	select {
	case g.slots <- struct{}{}:
		return &hashSlot{gate: g}, nil
	default:
	}
	timer := time.NewTimer(g.wait)
	defer timer.Stop()
	select {
	case g.slots <- struct{}{}:
		return &hashSlot{gate: g}, nil
	case <-timer.C:
		return nil, ErrPasswordHashBusy
	case <-ctx.Done():
		return nil, fmt.Errorf("%w: %w", ErrPasswordHashBusy, ctx.Err())
	}
}

// acquireHashSlot takes a slot on the process-wide gate.
func acquireHashSlot(ctx context.Context) (*hashSlot, error) {
	return passwordGate.Load().acquire(ctx)
}

// release gives the slot back. Calling it more than once is harmless.
func (s *hashSlot) release() {
	s.once.Do(func() { <-s.gate.slots })
}
