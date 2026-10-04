package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"
)

// connection is one live socket and its subscription state. Its identity was
// resolved once at upgrade from the ticket; no inbound frame can change it.
type connection struct {
	gw  *Gateway
	ws  *wsConn
	log *slog.Logger
	ctx context.Context

	connID    string
	accountID string
	roles     []string

	mu        sync.Mutex
	sessionID string
	subs      map[string]Viewer // channel → this connection's viewer relation

	lastReauth   time.Time
	lastPong     time.Time
	sentPingAt   time.Time
	awaitingPong bool

	// outbound is the bounded fan-out queue drained by writeLoop (send.go).
	outbound chan []byte
	// quit is closed by stop; closeCode and closeReason are set before it closes
	// and read by the writer only after.
	quit        chan struct{}
	writerDone  chan struct{} // closed when writeLoop has closed the socket
	stopOnce    sync.Once
	closeCode   int
	closeReason string
}

// newConnection builds a connection with its fan-out queue. serve starts the
// writer.
func newConnection(gw *Gateway, ws *wsConn, log *slog.Logger, connID, accountID, sessionID string, roles []string) *connection {
	return &connection{
		gw:         gw,
		ws:         ws,
		log:        log,
		ctx:        context.Background(),
		connID:     connID,
		accountID:  accountID,
		roles:      roles,
		sessionID:  sessionID,
		subs:       map[string]Viewer{},
		outbound:   make(chan []byte, outboundQueueFrames),
		quit:       make(chan struct{}),
		writerDone: make(chan struct{}),
	}
}

// serve runs the whole connection lifecycle: hello, then a read loop with the
// heartbeat, reauth and session-revocation timers running alongside. It returns
// when the socket closes for any reason.
func (c *connection) serve() {
	// Whatever ends the read loop also ends the writer. The writer, not this
	// goroutine, closes the socket, so a close frame already handed to it
	// (4429 from the read loop, say) still goes out first.
	defer func() {
		c.stop(0, "")
		c.gw.unregister(c)
		<-c.writerDone
	}()

	now := time.Now()
	c.lastReauth = now
	c.lastPong = now

	// The writer starts before register: from then on the gateway may queue
	// fan-out frames for this connection.
	go c.writeLoop()
	c.gw.register(c)

	// hello: the principal, the roles, and the allowed channel set. The account
	// channel is auto-subscribed here (§3.1).
	if err := c.sendHello(); err != nil {
		c.gw.store.CloseConnection(c.ctx, c.connID, CloseNormal, "hello failed")
		return
	}
	c.autoSubscribeAccount()

	// Timers run in their own goroutine so a blocked read cannot stall the
	// heartbeat, the reauth deadline, or revocation propagation.
	timerCtx, cancelTimers := context.WithCancel(c.ctx)
	defer cancelTimers()
	go c.runTimers(timerCtx)

	c.readLoop()
}

// readLoop reads and dispatches inbound frames until the socket closes. A soft
// rate-limit breach returns error{RATE_LIMITED} and keeps the socket open; a
// flood closes 4429 (§1.4).
func (c *connection) readLoop() {
	var window struct {
		start time.Time
		count int
	}
	window.start = time.Now()

	for {
		// A silent peer must not pin this goroutine forever; the timer goroutine
		// enforces the real heartbeat, but a generous read deadline bounds a
		// stalled TCP read.
		c.ws.setReadDeadline(time.Now().Add(reauthHardLimit + time.Minute))

		op, data, err := c.ws.readMessage()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				c.log.Debug("read closed", slog.String("error", err.Error()))
			}
			return
		}
		if op == opPong {
			c.notePong()
			continue
		}

		// Rate limiting: reset the 1-second window as it rolls over.
		if time.Since(window.start) >= time.Second {
			window.start = time.Now()
			window.count = 0
		}
		window.count++
		if window.count > inboundHardPerSec {
			c.closeWith(CloseFrameFlood, "frame flood")
			return
		}
		if window.count > inboundSoftPerSec {
			c.sendError(ErrCodeRateLimited, "Too many frames; slow down.", true)
			continue
		}

		c.handleFrame(data)
	}
}

// handleFrame decodes one inbound frame and dispatches it. Unknown fields and
// unknown types are rejected without changing the principal (§3.2).
func (c *connection) handleFrame(data []byte) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()

	var f inboundFrame
	if err := dec.Decode(&f); err != nil {
		// An unknown field is UNKNOWN_FIELD; any other malformed frame is
		// VALIDATION_FAILED. Both are ErrorCode members (§3.2 note): there is no
		// INVALID_FRAME in the enum.
		if isUnknownField(err) {
			c.sendError(ErrCodeUnknownField, "The frame carries a field that is not part of its schema.", false)
			return
		}
		c.sendError(ErrCodeValidationFailed, "The frame could not be parsed.", false)
		return
	}

	switch f.Type {
	case InSubscribe:
		c.handleSubscribe(f.Channel)
	case InUnsubscribe:
		c.handleUnsubscribe(f.Channel)
	case InResume:
		if f.AfterSeq == nil {
			c.sendError(ErrCodeValidationFailed, "resume requires after_seq.", false)
			return
		}
		c.handleResume(f.Channel, *f.AfterSeq)
	case InReauth:
		c.handleReauth(f.AccessToken)
	case InPong:
		c.notePong()
	default:
		// Any other type is not a member of the five-frame vocabulary.
		c.sendError(ErrCodeValidationFailed, "Unknown frame type.", false)
	}
}

// handleSubscribe runs the fresh Postgres ownership re-check (§0 rule 2) and,
// on success, records the subscription and reports the current head.
func (c *connection) handleSubscribe(channelStr string) {
	ch, ok := ParseChannel(channelStr)
	if !ok {
		c.sendSubscribeError(channelStr, SubErrInvalidChannel, "Not a valid channel.")
		return
	}

	c.mu.Lock()
	atLimit := len(c.subs) >= maxSubscriptions
	_, already := c.subs[ch.Raw]
	c.mu.Unlock()
	if already {
		// Idempotent: re-subscribing reports the head again, no error.
		head, _ := c.gw.store.ChannelHead(c.ctx, ch.Raw)
		c.sendSubscribed(ch.Raw, head)
		return
	}
	if atLimit {
		c.sendSubscribeError(ch.Raw, SubErrSubLimit, "Subscription limit reached for this connection.")
		return
	}

	res, err := c.gw.store.AuthorizeSubscribe(c.ctx, c.accountID, c.roles, ch)
	if err != nil {
		c.log.Warn("subscribe authz failed", slog.String("channel", ch.Raw), slog.String("error", err.Error()))
		c.sendSubscribeError(ch.Raw, SubErrNotFound, "Not found.")
		return
	}
	switch res {
	case SubNotFound:
		c.sendSubscribeError(ch.Raw, SubErrNotFound, "Not found.")
		return
	case SubForbidden:
		c.sendSubscribeError(ch.Raw, SubErrForbidden, "You may not subscribe to that channel.")
		return
	}

	viewer := c.resolveViewer(ch)
	c.mu.Lock()
	c.subs[ch.Raw] = viewer
	c.mu.Unlock()
	c.gw.indexSubscribe(c, ch.Raw)

	head, _ := c.gw.store.ChannelHead(c.ctx, ch.Raw)
	c.sendSubscribed(ch.Raw, head)
}

// handleUnsubscribe drops a subscription at the client's request.
func (c *connection) handleUnsubscribe(channelStr string) {
	ch, ok := ParseChannel(channelStr)
	if !ok {
		c.sendSubscribeError(channelStr, SubErrInvalidChannel, "Not a valid channel.")
		return
	}
	c.mu.Lock()
	_, had := c.subs[ch.Raw]
	delete(c.subs, ch.Raw)
	c.mu.Unlock()
	c.gw.indexUnsubscribe(c, ch.Raw)
	if had {
		c.sendUnsubscribed(ch.Raw, ReasonClientRequest)
	}
}

// handleResume replays realtime_event for a channel from after_seq (§6.3). It
// requires an existing subscription: replay is gap recovery for a channel the
// client is watching, and it re-runs the ownership check to be safe.
func (c *connection) handleResume(channelStr string, afterSeq int64) {
	ch, ok := ParseChannel(channelStr)
	if !ok {
		c.sendSubscribeError(channelStr, SubErrInvalidChannel, "Not a valid channel.")
		return
	}

	// Re-authorize: a resume must not become a back door to a channel the
	// principal cannot subscribe to.
	res, err := c.gw.store.AuthorizeSubscribe(c.ctx, c.accountID, c.roles, ch)
	if err != nil || res != SubAllowed {
		c.sendSubscribeError(ch.Raw, SubErrNotFound, "Not found.")
		return
	}

	// The head is read before the replay, so the range the reply reports covers
	// at least everything that existed when the client asked.
	head, err := c.gw.store.ChannelHead(c.ctx, ch.Raw)
	if err != nil {
		c.log.Warn("replay head failed", slog.String("channel", ch.Raw), slog.String("error", err.Error()))
		c.sendError(ErrCodeValidationFailed, "Replay failed.", true)
		return
	}
	events, truncated, err := c.gw.store.Replay(c.ctx, ch.Raw, afterSeq)
	if err != nil {
		c.log.Warn("replay failed", slog.String("channel", ch.Raw), slog.String("error", err.Error()))
		c.sendError(ErrCodeValidationFailed, "Replay failed.", true)
		return
	}

	// resume_complete reports the range the replay covered — from the first seq
	// after the client's cursor to the channel's head — not just the events this
	// viewer was sent. Events outside the viewer's audience still take a seq on
	// the channel (contracts/websocket.md section 4: audiences are per event),
	// so a client that sets its cursor to to_seq moves past them instead of
	// seeing the same "gap" again. When truncated, to_seq is the head the client
	// resets its cursor to after refetching over REST (section 6.3).
	viewer := c.resolveViewer(ch)
	fromSeq, toSeq := afterSeq+1, head
	replayed := 0
	for _, e := range events {
		if e.Seq > toSeq {
			toSeq = e.Seq
		}
		projected, deliver := Project(e.Type, viewer, e.Audience, e.Payload)
		if !deliver {
			continue
		}
		replayed++
		c.send(Envelope{
			ID:      e.ULID,
			Seq:     e.Seq,
			Channel: e.Channel,
			Type:    e.Type,
			V:       e.V,
			TS:      e.TS.UTC().Format("2006-01-02T15:04:05.000Z"),
			Data:    projected,
		})
	}
	c.sendResumeComplete(ch.Raw, fromSeq, toSeq, replayed, truncated)
}

// handleReauth refreshes the liveness window. It never elevates identity: the
// session binding is fixed at upgrade, and a reauth only proves the client still
// holds a live access token (§1.3).
func (c *connection) handleReauth(token string) {
	if token == "" {
		c.sendError(ErrCodeValidationFailed, "reauth requires an access_token.", false)
		return
	}
	if _, err := c.gw.auth.Reauth(c.ctx, token); err != nil {
		// A bad token does not immediately close; the reauth deadline will if no
		// valid reauth arrives in time. But we do not extend the window.
		c.sendError(ErrCodeValidationFailed, "The access token is not valid.", false)
		return
	}
	c.mu.Lock()
	c.lastReauth = time.Now()
	c.mu.Unlock()
	c.gw.store.TouchReauth(c.ctx, c.connID)
}

// runTimers drives the heartbeat, the reauth deadline, and the session-revoke
// poll. All three read Postgres for the correct answer; Redis only makes
// revocation instant, which is out of scope for this poll (§1.3).
func (c *connection) runTimers(ctx context.Context) {
	heartbeat := time.NewTicker(heartbeatInterval)
	sessionPoll := time.NewTicker(sessionCheckEvery)
	reauthWarn := time.NewTicker(reauthInterval)
	defer heartbeat.Stop()
	defer sessionPoll.Stop()
	defer reauthWarn.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-heartbeat.C:
			c.mu.Lock()
			c.awaitingPong = true
			c.sentPingAt = time.Now()
			c.mu.Unlock()
			if err := c.ws.writePing(); err != nil {
				c.closeWith(CloseNormal, "ping failed")
				return
			}
			// Enforce the pong deadline after the grace period.
			time.AfterFunc(pongDeadline, func() {
				c.mu.Lock()
				missed := c.awaitingPong && time.Since(c.sentPingAt) >= pongDeadline
				c.mu.Unlock()
				if missed {
					c.closeWith(CloseNormal, "pong timeout")
				}
			})

		case <-reauthWarn.C:
			c.mu.Lock()
			deadline := c.lastReauth.Add(reauthHardLimit)
			c.mu.Unlock()
			_ = c.sendReauthRequired(deadline)

		case <-sessionPoll.C:
			c.mu.Lock()
			overdue := time.Since(c.lastReauth) >= reauthHardLimit
			sid := c.sessionID
			c.mu.Unlock()
			if overdue {
				c.closeWith(CloseUnauthorized, "reauth_timeout")
				return
			}
			revoked, err := c.gw.store.SessionRevoked(ctx, sid)
			if err == nil && revoked {
				c.closeWith(CloseUnauthorized, "session_revoked")
				return
			}
		}
	}
}

// resolveViewer maps a channel and the principal's roles to the projection
// relationship used at send time. It is resolved at subscribe (or resume) time
// so the ownership decision and the projection are made from the same facts.
func (c *connection) resolveViewer(ch Channel) Viewer {
	priv := hasAny(c.roles, "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN")
	switch ch.Kind {
	case KindAccount, KindRider, KindAdminOps:
		if priv && ch.Subject != c.accountID {
			return ViewSupport
		}
		return ViewSelf
	case KindRestaurant:
		if priv {
			return ViewSupport
		}
		return ViewRestaurant
	case KindOrder:
		if priv {
			return ViewSupport
		}
		// Distinguish customer vs restaurant vs rider by relationship. The
		// authorize step already proved one of them holds; a follow-up cheap
		// check picks which. Default to the least-privileged customer view.
		return c.orderViewer(ch.Subject)
	}
	return ViewSelf
}

// orderViewer classifies the principal's relationship to an order for
// projection. It is a best-effort read; on error it defaults to the customer
// view, which is the most restrictive of the participant projections.
func (c *connection) orderViewer(orderID string) Viewer {
	v, err := c.gw.store.OrderViewer(c.ctx, c.accountID, orderID)
	if err != nil {
		return ViewCustomer
	}
	return v
}

// viewerFor returns the projection relation for a channel this connection is
// subscribed to. ok is false when it is not subscribed.
func (c *connection) viewerFor(channel string) (Viewer, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.subs[channel]
	return v, ok
}

// autoSubscribeAccount subscribes the principal to its own account channel at
// hello, no ownership check needed — it is derived, not asserted (§3.1).
func (c *connection) autoSubscribeAccount() {
	ch := AccountChannel(c.accountID)
	c.mu.Lock()
	c.subs[ch] = ViewSelf
	c.mu.Unlock()
	c.gw.indexSubscribe(c, ch)
}

// notePong clears the heartbeat deadline.
func (c *connection) notePong() {
	c.mu.Lock()
	c.awaitingPong = false
	c.lastPong = time.Now()
	c.mu.Unlock()
}

// closeWith records the close and hands the close frame to the writer, which
// sends it and tears down. It never waits on the socket, and only the first
// close is recorded and sent. Safe to call concurrently.
func (c *connection) closeWith(code int, reason string) {
	if c.stop(code, reason) {
		c.gw.store.CloseConnection(c.ctx, c.connID, code, reason)
	}
}

// isUnknownField reports whether a json decode error is the DisallowUnknownFields
// rejection, as opposed to a syntactic parse error.
func isUnknownField(err error) bool {
	return err != nil && bytes.Contains([]byte(err.Error()), []byte("unknown field"))
}
