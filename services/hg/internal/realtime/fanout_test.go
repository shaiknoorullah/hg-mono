package realtime

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

// TestStalledReaderDoesNotDelayOthers pins the fan-out rule: a phone that stops
// reading must not delay delivery to anyone else on the replica, and once it
// falls outboundQueueFrames behind it is closed with 1013 (try again later), so
// it reconnects and resumes from Postgres (contracts/websocket.md "Close
// codes"). Before each connection had its own writer, every event waited up to
// the 10 s write deadline on the stalled socket before reaching the others.
func TestStalledReaderDoesNotDelayOthers(t *testing.T) {
	const readers = 100
	const channel = "order:" + sampleUUID
	gw := NewGateway(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, Limits{MaxSockets: readers + 1})

	// open subscribes one socket to the channel. net.Pipe has no buffer, so a
	// write blocks until the peer reads: a peer that never reads is a phone on a
	// dead mobile link.
	open := func() (*connection, *bufio.Reader) {
		srv, peer := net.Pipe()
		c := newConnection(gw, &wsConn{raw: srv, br: bufio.NewReader(srv)}, gw.log, "", "", "", nil)
		go c.writeLoop()
		t.Cleanup(func() {
			c.stop(0, "")
			<-c.writerDone
			_ = peer.Close()
		})
		c.mu.Lock()
		c.subs[channel] = ViewCustomer
		c.mu.Unlock()
		gw.register(c)
		gw.indexSubscribe(c, channel)
		return c, bufio.NewReader(peer)
	}

	stalled, stalledPeer := open()
	received := make([]atomic.Int64, readers)
	for i := range received {
		_, peer := open()
		go func() {
			for {
				if _, _, err := readServerFrame(peer); err != nil {
					return
				}
				received[i].Add(1)
			}
		}()
	}

	// One frame more than the stalled socket can hold: one blocked in its
	// writer, outboundQueueFrames queued behind it, then the one that overflows.
	events := outboundQueueFrames + 2
	const budget = 2 * time.Second
	for n := 1; n <= events; n++ {
		start := time.Now()
		gw.dispatch("rt:"+channel, relayPayload(t, channel, n))
		for i := range received {
			for received[i].Load() < int64(n) && time.Since(start) < budget {
				time.Sleep(time.Millisecond)
			}
		}
		if took := time.Since(start); took >= budget {
			t.Fatalf("event %d took %v to reach the %d reading sockets: the stalled one is holding up fan-out",
				n, took.Round(time.Millisecond), readers)
		}
	}

	select {
	case <-stalled.quit:
	default:
		t.Fatalf("the stalled socket was not closed after falling %d frames behind", outboundQueueFrames)
	}

	// When the phone reads again it gets the frame that was mid-write, then the
	// 1013 close. The queued frames are dropped; its resume replays them.
	if op, _, err := readServerFrame(stalledPeer); err != nil || op != opText {
		t.Fatalf("first frame on the stalled socket: op %d, err %v; want the in-flight text frame", op, err)
	}
	op, body, err := readServerFrame(stalledPeer)
	if err != nil || op != opClose || len(body) < 2 {
		t.Fatalf("second frame on the stalled socket: op %d, err %v; want a close frame", op, err)
	}
	if code, reason := binary.BigEndian.Uint16(body), string(body[2:]); code != CloseTryAgainLater || reason != reasonSlowConsumer {
		t.Fatalf("close = %d %q, want %d %q", code, reason, CloseTryAgainLater, reasonSlowConsumer)
	}
}

// TestShutdownFlushesGoingAway pins the deploy promise in contracts/websocket.md
// "Close codes": every socket gets 1001 (server going away) before Shutdown
// returns, so the process cannot exit first and leave clients with 1006
// (abnormal closure). A stalled socket must not hold the deploy past
// shutdownFlushBudget.
func TestShutdownFlushesGoingAway(t *testing.T) {
	gw := NewGateway(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, Limits{MaxSockets: 2})
	open := func() (*connection, net.Conn) {
		srv, peer := net.Pipe()
		c := newConnection(gw, &wsConn{raw: srv, br: bufio.NewReader(srv)}, gw.log, "", "", "", nil)
		go c.writeLoop()
		t.Cleanup(func() {
			_ = peer.Close()
			<-c.writerDone
		})
		gw.register(c)
		return c, peer
	}

	reading, readingPeer := open()
	_, _ = open() // stalled: its peer never reads

	// The phone reads a moment after Shutdown starts, so a Shutdown that only
	// hands the close to the writer returns before the frame has gone out.
	type frame struct {
		op   wsOpcode
		body []byte
		err  error
	}
	got := make(chan frame, 1)
	go func() {
		time.Sleep(50 * time.Millisecond)
		op, body, err := readServerFrame(bufio.NewReader(readingPeer))
		got <- frame{op, body, err}
	}()

	start := time.Now()
	gw.Shutdown()
	if took := time.Since(start); took > shutdownFlushBudget+time.Second {
		t.Fatalf("Shutdown took %v; a stalled socket must not hold it past %v", took.Round(time.Millisecond), shutdownFlushBudget)
	}
	select {
	case <-reading.writerDone:
	default:
		t.Fatal("Shutdown returned before the reading socket's writer sent its close frame")
	}
	f := <-got
	if f.err != nil || f.op != opClose || len(f.body) < 2 {
		t.Fatalf("frame on shutdown: op %d, err %v; want a close frame", f.op, f.err)
	}
	if code := binary.BigEndian.Uint16(f.body); code != CloseGoingAway {
		t.Fatalf("close code = %d, want %d (server going away)", code, CloseGoingAway)
	}
}

// relayPayload is a Redis fan-out message for one all-participants event.
func relayPayload(t *testing.T, channel string, seq int) []byte {
	t.Helper()
	b, err := json.Marshal(RelayMessage{Envelope: Envelope{
		ID: newEventULID(), Seq: int64(seq), Channel: channel, Type: "order.state_changed", V: 1,
		TS: "2026-10-01T12:00:00.000Z", Data: json.RawMessage(`{}`),
	}})
	if err != nil {
		t.Fatalf("marshal relay message: %v", err)
	}
	return b
}

// readServerFrame reads one unmasked server frame, as a client would.
func readServerFrame(r *bufio.Reader) (wsOpcode, []byte, error) {
	var h [2]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return 0, nil, err
	}
	n := uint64(h[1] & 0x7f)
	switch n {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return 0, nil, err
		}
		n = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return 0, nil, err
		}
		n = binary.BigEndian.Uint64(ext[:])
	}
	payload := make([]byte, n)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	return wsOpcode(h[0] & 0x0f), payload, nil
}
