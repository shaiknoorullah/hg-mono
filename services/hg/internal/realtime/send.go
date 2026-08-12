package realtime

import (
	"encoding/json"
	"time"
)

// send writes one envelope to the socket as a JSON text frame. It is the single
// egress point: every server → client message goes through here, so the wire
// shape is enforced in one place.
func (c *connection) send(env Envelope) {
	if env.Data == nil {
		env.Data = json.RawMessage("{}")
	}
	b, err := json.Marshal(env)
	if err != nil {
		c.log.Warn("marshal envelope failed", "type", env.Type)
		return
	}
	if err := c.ws.writeText(b); err != nil {
		// A failed write means the socket is gone; the read loop will observe it
		// and tear down.
		c.ws.close()
	}
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
