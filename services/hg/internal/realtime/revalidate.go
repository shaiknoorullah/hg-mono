package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"
)

// An order:{id} subscription is re-checked whenever the order's participant
// set changes, and a rider who loses the dispatch is force-unsubscribed within
// 2 seconds with unsubscribed{reason:"no_longer_authorized"}, receiving no
// further events for that order (contracts/websocket.md section 3.1,
// "Re-validation").
//
// The trigger is the event that announces the change: dispatch.assigned (a
// rider took the order, possibly from another) and dispatch.unassigned. Both are
// written in the transaction that changes dispatch.rider_account_id, and the
// relay publishes only after that commits, so the re-check reads the new
// participant set.

// participantChange is the set of order-channel events after which the order's
// rider may have changed.
var participantChange = map[string]bool{
	"dispatch.assigned":   true,
	"dispatch.unassigned": true,
}

// recheckBudget bounds one re-check, inside the contract's 2-second window.
const recheckBudget = 1500 * time.Millisecond

// revalidateRiders re-runs the ownership check for every rider subscribed to
// an order channel, each on its own goroutine so the fan-out never waits on
// Postgres.
func (g *Gateway) revalidateRiders(channel string, conns []*connection) {
	ch, ok := ParseChannel(channel)
	if !ok || ch.Kind != KindOrder {
		return
	}
	for _, c := range conns {
		if v, ok := c.viewerFor(channel); ok && v == ViewRider {
			go c.recheck(ch, v)
		}
	}
}

// recheck evicts the connection from an order channel it may no longer read
// as the role it subscribed as. It fails closed: if the check cannot run, or
// it now names a different role, the subscriber is unsubscribed and may
// subscribe again, which re-runs the check and projects for the role it names
// then.
func (c *connection) recheck(ch Channel, was Viewer) {
	ctx, cancel := context.WithTimeout(c.ctx, recheckBudget)
	defer cancel()
	grant, err := c.gw.store.AuthorizeSubscribe(ctx, c.accountID, c.roles, ch)
	if err == nil && grant.Result == SubAllowed && grant.Viewer == was {
		return
	}
	if err != nil {
		c.log.Warn("realtime re-check failed; unsubscribing", slog.String("channel", ch.Raw), slog.String("error", err.Error()))
	}
	c.evict(ch.Raw, ReasonNoLongerAuth)
}

// evict drops a subscription the server ended and tells the client why. The
// subscription leaves the gateway's index first, so no event published after
// this point reaches the socket.
func (c *connection) evict(channel, reason string) {
	c.mu.Lock()
	_, had := c.subs[channel]
	delete(c.subs, channel)
	c.mu.Unlock()
	if !had {
		return
	}
	c.gw.indexUnsubscribe(c, channel)
	c.enqueueControl(CtrlUnsubscribed, unsubscribedData{Channel: channel, Reason: reason})
}

// enqueueControl queues a control frame behind the fan-out frames already
// waiting for this socket, so it arrives in order with them.
func (c *connection) enqueueControl(ctrlType string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		c.log.Warn("marshal control failed", "type", ctrlType)
		return
	}
	c.enqueue(Envelope{
		ID:   newEventULID(),
		Type: ctrlType,
		V:    1,
		TS:   time.Now().UTC().Format(tsLayout),
		Data: raw,
	})
}
