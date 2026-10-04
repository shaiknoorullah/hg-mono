package realtime

import (
	"encoding/json"
	"log/slog"
	"time"
)

// Close reasons sent with 1013 (try again later). Both tell the client to
// reconnect with backoff and resume every channel from Postgres
// (contracts/websocket.md "Close codes").
const (
	reasonSlowConsumer = "slow_consumer" // fell outboundQueueFrames behind
	reasonAtCapacity   = "at_capacity"   // this replica holds maxSockets already
)

// There are two ways out to a socket, and they differ in who may wait:
//
//   - send is for the connection's own replies (hello, subscribed, a resume's
//     replay, errors). It runs on the connection's own goroutine and writes
//     directly, so a slow phone slows only its own requests. A resume replaying
//     1,000 events waits for the phone instead of overflowing the queue below.
//   - enqueue is for fan-out. The gateway delivers every published event from
//     one goroutine for the whole replica, so it must never wait on a socket:
//     it drops the frame into a bounded queue that writeLoop drains. A full
//     queue closes the socket with 1013 instead of blocking.
//
// Both encode through encode, so the wire shape is enforced in one place.

// encode marshals an envelope to its wire form.
func (c *connection) encode(env Envelope) ([]byte, bool) {
	if env.Data == nil {
		env.Data = json.RawMessage("{}")
	}
	b, err := json.Marshal(env)
	if err != nil {
		c.log.Warn("marshal envelope failed", "type", env.Type)
		return nil, false
	}
	return b, true
}

// send writes one of the connection's own replies as a JSON text frame.
func (c *connection) send(env Envelope) {
	b, ok := c.encode(env)
	if !ok {
		return
	}
	if err := c.ws.writeText(b); err != nil {
		// A failed write means the socket is gone; the read loop will observe it
		// and tear down.
		c.ws.close()
	}
}

// enqueue hands a fan-out frame to the connection's writer without waiting. If
// the phone has fallen outboundQueueFrames behind, the connection is closed
// with 1013: the events it misses are durable in Postgres and the client's
// resume replays them, so dropping the socket loses nothing.
func (c *connection) enqueue(env Envelope) {
	select {
	case <-c.quit:
		return // already closing; the client resumes after it reconnects
	default:
	}
	b, ok := c.encode(env)
	if !ok {
		return
	}
	select {
	case c.outbound <- b:
	default:
		if c.stop(CloseTryAgainLater, reasonSlowConsumer) {
			c.log.Warn("realtime socket fell behind; closing 1013",
				slog.String("conn_id", c.connID), slog.Int("queued", outboundQueueFrames))
			// Recording the close is a Postgres write; the fan-out goroutine must
			// not wait for it.
			go c.gw.store.CloseConnection(c.ctx, c.connID, CloseTryAgainLater, reasonSlowConsumer)
		}
	}
}

// writeLoop is the connection's writer: the only goroutine that drains the
// fan-out queue. It runs until stop is called or a write fails, then sends the
// close frame stop asked for (if any) and closes the socket. Frames still queued
// at that point are dropped; the client recovers them with resume.
func (c *connection) writeLoop() {
	defer close(c.writerDone)
	defer c.ws.close()
	for {
		// Check quit first so a closing connection stops writing data at once,
		// even while frames are still queued.
		select {
		case <-c.quit:
			c.writeCloseFrame()
			return
		default:
		}
		select {
		case <-c.quit:
			c.writeCloseFrame()
			return
		case b := <-c.outbound:
			if err := c.ws.writeText(b); err != nil {
				return
			}
		}
	}
}

// writeCloseFrame sends the close frame stop recorded, if it recorded one.
func (c *connection) writeCloseFrame() {
	if c.closeCode != 0 {
		_ = c.ws.writeClose(c.closeCode, c.closeReason)
	}
}

// stop tells the writer to finish: send a close frame carrying code (0 sends
// none), then close the socket. It never blocks. The first call wins and
// reports true; later calls are no-ops.
func (c *connection) stop(code int, reason string) bool {
	first := false
	c.stopOnce.Do(func() {
		c.closeCode, c.closeReason = code, reason
		close(c.quit)
		first = true
	})
	return first
}

// control writes a control envelope: seq 0, empty channel, the given type and
// data payload.
func (c *connection) control(ctrlType string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		c.log.Warn("marshal control failed", "type", ctrlType)
		return
	}
	c.send(Envelope{
		ID:      newEventULID(),
		Seq:     0,
		Channel: "",
		Type:    ctrlType,
		V:       1,
		TS:      time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Data:    raw,
	})
}

// sendHello emits the hello control frame with the principal, its roles and the
// server-derived allowed channel set (§4.1).
func (c *connection) sendHello() error {
	allowed, err := c.gw.store.AllowedChannels(c.ctx, c.accountID, c.roles)
	if err != nil {
		return err
	}
	roles := make([]helloRole, 0, len(c.roles))
	for _, r := range c.roles {
		roles = append(roles, helloRole{R: r, S: nil})
	}
	c.control(CtrlHello, helloData{
		AccountID:       c.accountID,
		Roles:           roles,
		SessionID:       c.sessionID,
		AllowedChannels: allowed,
		ServerTime:      time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		HeartbeatS:      HeartbeatSeconds,
		Protocol:        Protocol,
	})
	return nil
}

func (c *connection) sendSubscribed(channel string, head int64) {
	c.control(CtrlSubscribed, subscribedData{Channel: channel, CursorSeq: head})
}

func (c *connection) sendUnsubscribed(channel, reason string) {
	c.control(CtrlUnsubscribed, unsubscribedData{Channel: channel, Reason: reason})
}

func (c *connection) sendSubscribeError(channel, code, message string) {
	c.control(CtrlSubscribeError, subscribeErrorData{Channel: channel, Code: code, Message: message})
}

func (c *connection) sendResumeComplete(channel string, from, to int64, replayed int, truncated bool) {
	c.control(CtrlResumeComplete, resumeCompleteData{
		Channel:   channel,
		FromSeq:   from,
		ToSeq:     to,
		Replayed:  replayed,
		Truncated: truncated,
	})
}

func (c *connection) sendError(code, message string, retryable bool) {
	c.control(CtrlError, errorData{Code: code, Message: message, Retryable: retryable})
}

func (c *connection) sendReauthRequired(deadline time.Time) error {
	c.control(CtrlReauthRequired, reauthRequiredData{
		Deadline: deadline.UTC().Format("2006-01-02T15:04:05.000Z"),
	})
	return nil
}
