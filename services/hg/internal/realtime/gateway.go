package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Reauth and heartbeat budgets from §1.2–§1.4.
const (
	heartbeatInterval = 25 * time.Second
	pongDeadline      = 10 * time.Second
	reauthInterval    = 10 * time.Minute
	reauthHardLimit   = 15 * time.Minute
	sessionCheckEvery = 10 * time.Second
	maxSubscriptions  = 50
	inboundSoftPerSec = 20
	inboundHardPerSec = 100
	redisChannelGlob  = "rt:*"

	// outboundQueueFrames bounds the fan-out frames waiting for one socket. A
	// phone that falls this far behind is closed with 1013 and resumes from
	// Postgres (contracts/websocket.md "Gap detection — the client's contract").
	// At most a few events a second reach one socket, so 64 is many seconds of
	// lag, not a burst.
	outboundQueueFrames = 64

	// shutdownFlushBudget bounds how long Shutdown waits for every writer to
	// send its 1001 close frame. It is well inside the process's shutdown
	// budget and far below the 10 s per-write deadline a stalled socket holds.
	shutdownFlushBudget = 2 * time.Second
)

// Gateway owns the live socket fleet on this replica. It subscribes once to the
// Redis rt:* fan-out and routes each published envelope to the local sockets
// subscribed to that channel, applying the per-role projection at send time
// (§6.1 step 3). Redis is fan-out only; nothing about identity or subscription
// rights is ever read from it.
type Gateway struct {
	store *Store
	rdb   *redis.Client
	log   *slog.Logger
	auth  Reauthenticator

	// maxSockets caps the live sockets on this replica; sockets counts them.
	// An upgrade beyond the cap is closed with 1013 so the client retries and
	// can land on the other replica.
	maxSockets int64
	sockets    atomic.Int64

	mu    sync.RWMutex
	conns map[*connection]struct{}
	// index maps a channel to the connections subscribed to it, so a published
	// event reaches only interested sockets without scanning the whole fleet.
	index map[string]map[*connection]struct{}

	closeOnce sync.Once
	done      chan struct{}
}

// Reauthenticator validates a reauth frame's access token and returns the
// session it belongs to. It is the same validation the HTTP path performs; the
// auth sibling owns the implementation. Until it lands the gateway treats reauth
// leniently (see NoopReauthenticator).
type Reauthenticator interface {
	Reauth(ctx context.Context, accessToken string) (sessionID string, err error)
}

// NewGateway builds a Gateway that holds at most maxSockets live sockets. Call
// Run to start the Redis fan-out loop.
func NewGateway(store *Store, rdb *redis.Client, log *slog.Logger, auth Reauthenticator, maxSockets int) *Gateway {
	if auth == nil {
		auth = NoopReauthenticator{}
	}
	return &Gateway{
		store:      store,
		rdb:        rdb,
		log:        log,
		auth:       auth,
		maxSockets: int64(maxSockets),
		conns:      map[*connection]struct{}{},
		index:      map[string]map[*connection]struct{}{},
		done:       make(chan struct{}),
	}
}

// admit reserves a socket slot on this replica. It reports false when the
// replica is full; a true result must be paired with exactly one release.
func (g *Gateway) admit() bool {
	if g.sockets.Add(1) > g.maxSockets {
		g.sockets.Add(-1)
		return false
	}
	return true
}

// release frees a slot taken by admit.
func (g *Gateway) release() { g.sockets.Add(-1) }

// Run starts the Redis pub/sub fan-out. It blocks until ctx is cancelled and
// reconnects on error: a Redis outage costs live fan-out, never a lost event —
// clients resume from Postgres when it returns (§6.2).
func (g *Gateway) Run(ctx context.Context) {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-g.done:
			return
		default:
		}

		sub := g.rdb.PSubscribe(ctx, redisChannelGlob)
		ch := sub.Channel()
		g.log.Info("realtime fan-out subscribed", slog.String("pattern", redisChannelGlob))
		backoff = time.Second

	loop:
		for {
			select {
			case <-ctx.Done():
				_ = sub.Close()
				return
			case <-g.done:
				_ = sub.Close()
				return
			case msg, ok := <-ch:
				if !ok {
					break loop
				}
				g.dispatch(msg.Channel, []byte(msg.Payload))
			}
		}
		_ = sub.Close()

		// Redis dropped us. Back off and retry; the outbox keeps accumulating and
		// clients will resume the gap.
		g.log.Warn("realtime fan-out lost; retrying", slog.Duration("backoff", backoff))
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		case <-g.done:
			return
		}
		if backoff < 15*time.Second {
			backoff *= 2
		}
	}
}

// dispatch routes one published envelope to every local connection subscribed to
// its channel, projecting per viewer. It never writes to a socket: it only
// queues the frame for each connection's own writer, so one stalled phone
// cannot delay delivery to the rest of the replica.
func (g *Gateway) dispatch(redisChannel string, payload []byte) {
	channel := strings.TrimPrefix(redisChannel, "rt:")

	var msg RelayMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		g.log.Warn("undecodable fan-out payload", slog.String("channel", channel), slog.String("error", err.Error()))
		return
	}
	env := msg.Envelope

	g.mu.RLock()
	subs := g.index[channel]
	targets := make([]*connection, 0, len(subs))
	for c := range subs {
		targets = append(targets, c)
	}
	g.mu.RUnlock()

	// Each subscriber gets the §5 projection for its viewer relation, and only if
	// it is in the event's audience. A principal can never receive an event for a
	// channel it is not subscribed to (index gate) nor one it is not an audience
	// of (audience gate).
	for _, c := range targets {
		viewer, ok := c.viewerFor(channel)
		if !ok {
			continue
		}
		projected, deliver := Project(env.Type, viewer, msg.Audience, env.Data)
		if !deliver {
			continue
		}
		out := env
		out.Data = projected
		c.enqueue(out)
	}

	// The order's rider may have changed: re-check the riders still subscribed
	// (revalidate.go).
	if participantChange[env.Type] {
		g.revalidateRiders(channel, targets)
	}
}

// register adds a connection to the fleet.
func (g *Gateway) register(c *connection) {
	g.mu.Lock()
	g.conns[c] = struct{}{}
	g.mu.Unlock()
}

// unregister removes a connection and all its channel index entries.
func (g *Gateway) unregister(c *connection) {
	g.mu.Lock()
	delete(g.conns, c)
	for ch := range c.subs {
		if set := g.index[ch]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(g.index, ch)
			}
		}
	}
	g.mu.Unlock()
}

// indexSubscribe records that a connection is subscribed to a channel.
func (g *Gateway) indexSubscribe(c *connection, channel string) {
	g.mu.Lock()
	set := g.index[channel]
	if set == nil {
		set = map[*connection]struct{}{}
		g.index[channel] = set
	}
	set[c] = struct{}{}
	g.mu.Unlock()
}

// indexUnsubscribe removes a connection from a channel's subscriber set.
func (g *Gateway) indexUnsubscribe(c *connection, channel string) {
	g.mu.Lock()
	if set := g.index[channel]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(g.index, channel)
		}
	}
	g.mu.Unlock()
}

// Shutdown stops the fan-out loop and closes every live socket with 1001
// (server going away) so clients reconnect with backoff (contracts/websocket.md
// "Close codes"). Each close is handed to that socket's writer, so a stalled
// socket does not hold up the rest, and Shutdown then waits up to
// shutdownFlushBudget for the writers to send those frames. Without the wait the
// process can exit first and clients see 1006 (abnormal closure) instead of
// 1001. Call it while the Postgres pool is still open: each close is recorded
// in realtime_connection.
func (g *Gateway) Shutdown() {
	g.closeOnce.Do(func() { close(g.done) })
	g.mu.RLock()
	conns := make([]*connection, 0, len(g.conns))
	for c := range g.conns {
		conns = append(conns, c)
	}
	g.mu.RUnlock()
	for _, c := range conns {
		c.closeWith(CloseGoingAway, "server going away")
	}
	// One budget for the whole fleet, not one per socket: a stalled socket can
	// hold its writer for the full 10 s write deadline, and a deploy must not
	// wait on it.
	deadline := time.After(shutdownFlushBudget)
	for _, c := range conns {
		select {
		case <-c.writerDone:
		case <-deadline:
			g.log.Warn("realtime shutdown: some sockets did not flush their close frame in time",
				slog.Duration("budget", shutdownFlushBudget))
			return
		}
	}
}

// NoopReauthenticator accepts any non-empty token and reports the connection's
// current session as still valid. It exists so the gateway builds and behaves
// correctly before the auth sibling's token validator lands: it never elevates
// identity — the session id is fixed at upgrade from the ticket and reauth only
// refreshes the liveness window.
//
// TODO(auth sibling): replace with the EdDSA access-token validator so a reauth
// carrying a token for a *different* session is rejected, per §1.3.
type NoopReauthenticator struct{}

// Reauth returns an empty session id, signalling "keep the existing binding".
func (NoopReauthenticator) Reauth(context.Context, string) (string, error) { return "", nil }
