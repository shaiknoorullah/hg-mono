package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
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

// NewGateway builds a Gateway. Call Run to start the Redis fan-out loop.
func NewGateway(store *Store, rdb *redis.Client, log *slog.Logger, auth Reauthenticator) *Gateway {
	if auth == nil {
		auth = NoopReauthenticator{}
	}
	return &Gateway{
		store: store,
		rdb:   rdb,
		log:   log,
		auth:  auth,
		conns: map[*connection]struct{}{},
		index: map[string]map[*connection]struct{}{},
		done:  make(chan struct{}),
	}
}

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
// its channel, projecting per viewer.
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
		c.send(out)
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
// (server going away) so clients reconnect with backoff (§1.5).
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
