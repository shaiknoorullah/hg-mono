package session

import (
	"context"
	"sync"
	"time"
)

// DenySet is the in-process revocation set from P-04: revoked session ids and
// wholesale-revoked account ids. Access tokens are trusted for their ≤15-minute
// life *unless* their sid or account appears here.
//
// Correctness lives in Postgres; this set is the fast path. It is refreshed from
// Postgres every 10 seconds and invalidated immediately via Redis pub/sub, so
// the worst-case propagation with Redis down is ≤10 s. A FLUSHALL cannot grant
// access because the Postgres refresh re-populates the set.
type DenySet struct {
	mu       sync.RWMutex
	sessions map[string]struct{}
	accounts map[string]struct{}
}

// NewDenySet builds an empty deny set.
func NewDenySet() *DenySet {
	return &DenySet{
		sessions: map[string]struct{}{},
		accounts: map[string]struct{}{},
	}
}

// RevokedSession reports whether a session id is denied.
func (d *DenySet) RevokedSession(sid string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	_, ok := d.sessions[sid]
	return ok
}

// RevokedAccount reports whether an account id is wholesale-denied.
func (d *DenySet) RevokedAccount(accountID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	_, ok := d.accounts[accountID]
	return ok
}

// Denied reports whether either the session or its account is revoked.
func (d *DenySet) Denied(sid, accountID string) bool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if _, ok := d.sessions[sid]; ok {
		return true
	}
	_, ok := d.accounts[accountID]
	return ok
}

// AddSession marks a session id revoked immediately (the Redis pub/sub fast
// path). The next Postgres refresh keeps it.
func (d *DenySet) AddSession(sid string) {
	d.mu.Lock()
	d.sessions[sid] = struct{}{}
	d.mu.Unlock()
}

// AddAccount marks an account wholesale-revoked immediately.
func (d *DenySet) AddAccount(accountID string) {
	d.mu.Lock()
	d.accounts[accountID] = struct{}{}
	d.mu.Unlock()
}

// Replace atomically swaps in a freshly-loaded snapshot from Postgres. This is
// the 10-second refresh: it is authoritative, so a session no longer revoked in
// Postgres (impossible today — revocation is monotonic) would also fall out.
func (d *DenySet) Replace(sessions, accounts []string) {
	s := make(map[string]struct{}, len(sessions))
	for _, x := range sessions {
		s[x] = struct{}{}
	}
	a := make(map[string]struct{}, len(accounts))
	for _, x := range accounts {
		a[x] = struct{}{}
	}
	d.mu.Lock()
	d.sessions = s
	d.accounts = a
	d.mu.Unlock()
}

// Loader loads the current revoked-session and revoked-account id sets from the
// source of truth (Postgres). internal/auth's store implements it.
type Loader interface {
	LoadRevoked(ctx context.Context) (sessions, accounts []string, err error)
}

// RunRefresher refreshes the deny set from the loader every interval until ctx
// is cancelled. It performs one immediate load so a freshly-booted replica does
// not serve a revoked token for up to a full interval.
func (d *DenySet) RunRefresher(ctx context.Context, l Loader, interval time.Duration) {
	if s, a, err := l.LoadRevoked(ctx); err == nil {
		d.Replace(s, a)
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if s, a, err := l.LoadRevoked(ctx); err == nil {
				d.Replace(s, a)
			}
		}
	}
}
