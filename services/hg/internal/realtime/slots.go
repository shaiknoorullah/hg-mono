package realtime

import (
	"errors"
	"sync"
)

// Defaults for Limits, from contracts/websocket.md §1.4 "Limits"
// (https://github.com/shaiknoorullah/hg-mono/blob/main/contracts/websocket.md#14-limits)
// and docs/spec/01-platform.md "P-20 — WebSocket connection authentication".
// cmd/hg reads the configured values; these only stand in for a zero field.
const (
	DefaultMaxSockets           = 2000
	DefaultMaxSocketsPerAccount = 10
	DefaultMaxSocketsPerSession = 4
	DefaultUpgradesPerAddress   = 120
	DefaultTicketsPerSession    = 30
)

// Limits caps the live sockets on this replica and how fast one caller may
// knock on the realtime surface. The socket caps are counted in memory on each
// replica, so a crashed replica cannot leave a count behind; the request caps
// are counted per minute through the shared rate limiter.
//
// The per-account and per-session caps exist because the replica cap alone let
// one signed-in account open sockets until the replica was full and every other
// user was refused (issue #288,
// https://github.com/shaiknoorullah/hg-mono/issues/288).
type Limits struct {
	// MaxSockets caps the live sockets on this replica. An upgrade beyond it is
	// closed with 1013 at_capacity so the client retries, possibly on the other
	// replica.
	MaxSockets int
	// MaxSocketsPerAccount caps one account's live sockets on this replica. An
	// upgrade beyond it is closed with 1013 connection_limit.
	MaxSocketsPerAccount int
	// MaxSocketsPerSession caps one session's live sockets on this replica. An
	// upgrade beyond it is closed with 1013 connection_limit.
	MaxSocketsPerSession int
	// UpgradesPerAddress caps upgrade attempts per client address per minute,
	// counted under httpx.RateLimitKey, so an IPv6 caller is counted per /64.
	// An attempt beyond it is refused with HTTP 429 before any Postgres work.
	UpgradesPerAddress int
	// TicketsPerSession caps createRealtimeTicket calls per session per minute.
	TicketsPerSession int
}

// withDefaults fills every zero or negative field with its default, so a
// caller that forgets a field gets the contract's cap, never "unlimited" and
// never "refuse everyone".
func (l Limits) withDefaults() Limits {
	orDefault := func(v, def int) int {
		if v < 1 {
			return def
		}
		return v
	}
	l.MaxSockets = orDefault(l.MaxSockets, DefaultMaxSockets)
	l.MaxSocketsPerAccount = orDefault(l.MaxSocketsPerAccount, DefaultMaxSocketsPerAccount)
	l.MaxSocketsPerSession = orDefault(l.MaxSocketsPerSession, DefaultMaxSocketsPerSession)
	l.UpgradesPerAddress = orDefault(l.UpgradesPerAddress, DefaultUpgradesPerAddress)
	l.TicketsPerSession = orDefault(l.TicketsPerSession, DefaultTicketsPerSession)
	return l
}

// Reasons bind refuses an upgrade's account or session slot.
var (
	errAccountAtLimit = errors.New("realtime: account holds its maximum sockets on this replica")
	errSessionAtLimit = errors.New("realtime: session holds its maximum sockets on this replica")
)

// socketSlots counts the live sockets on this replica: in total, per account
// and per session. The counts change in exactly two places, take/bind and
// release, all under one mutex, so the three counts never disagree.
type socketSlots struct {
	mu         sync.Mutex
	total      int
	perAccount map[string]int
	perSession map[string]int
}

// socketLease is the set of slots one upgrade holds. Upgrade takes it before
// any Postgres work, binds it to the account and session once the ticket
// resolves, and releases it with a single defer. Every way out of the handler
// (a refused ticket, a failed handshake, a failed registration, a closed
// socket) therefore gives back exactly what was taken, and only once.
type socketLease struct {
	g *Gateway

	// Guarded by g.slots.mu.
	bound     bool
	released  bool
	accountID string
	sessionID string
}

// admit takes a replica slot. It reports false when the replica is full; a
// true result must be paired with one release of the returned lease (a second
// release is a no-op).
func (g *Gateway) admit() (*socketLease, bool) {
	s := &g.slots
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.total >= g.limits.MaxSockets {
		return nil, false
	}
	s.total++
	return &socketLease{g: g}, true
}

// bind takes the account's and the session's slots for this lease, both or
// neither. It returns errAccountAtLimit or errSessionAtLimit when either is
// full; the lease then still holds only its replica slot, which release frees.
func (l *socketLease) bind(accountID, sessionID string) error {
	s := &l.g.slots
	s.mu.Lock()
	defer s.mu.Unlock()
	if l.released || l.bound {
		return errors.New("realtime: socket lease already bound or released")
	}
	if s.perAccount[accountID] >= l.g.limits.MaxSocketsPerAccount {
		return errAccountAtLimit
	}
	if s.perSession[sessionID] >= l.g.limits.MaxSocketsPerSession {
		return errSessionAtLimit
	}
	s.perAccount[accountID]++
	s.perSession[sessionID]++
	l.bound, l.accountID, l.sessionID = true, accountID, sessionID
	return nil
}

// release frees every slot the lease holds. It is safe to call more than once:
// only the first call decrements, so no count is ever taken back twice. A count
// that reaches zero is deleted, so the maps hold only accounts and sessions
// with a live socket.
func (l *socketLease) release() {
	s := &l.g.slots
	s.mu.Lock()
	defer s.mu.Unlock()
	if l.released {
		return
	}
	l.released = true
	s.total--
	if !l.bound {
		return
	}
	decrement(s.perAccount, l.accountID)
	decrement(s.perSession, l.sessionID)
}

func decrement(m map[string]int, key string) {
	if m[key] <= 1 {
		delete(m, key)
		return
	}
	m[key]--
}
