package realtime

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestSocketCapAdmitsUpToTheLimit pins the per-replica socket cap: exactly
// maxSockets slots, and a released slot is usable again. A leaked slot would
// make the replica refuse every socket for good.
func TestSocketCapAdmitsUpToTheLimit(t *testing.T) {
	gw := NewGateway(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, 2)
	if !gw.admit() || !gw.admit() {
		t.Fatal("the first two sockets were refused under a cap of 2")
	}
	if gw.admit() {
		t.Fatal("a third socket was admitted under a cap of 2")
	}
	gw.release()
	if !gw.admit() {
		t.Fatal("a released slot was not reusable")
	}
}

// TestFullReplicaClosesUpgradeWithTryAgainLater pins the refusal a client sees
// on a full replica: the handshake completes and the first frame is a close
// with 1013 (try again later) and reason at_capacity (contracts/websocket.md
// "Close codes"), so a browser can read why and retry on the other replica.
func TestFullReplicaClosesUpgradeWithTryAgainLater(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	gw := NewGateway(nil, nil, log, nil, 1)
	if !gw.admit() {
		t.Fatal("could not fill the replica")
	}
	srv := httptest.NewServer(http.HandlerFunc(NewHandler(nil, gw, log, nil).Upgrade))
	defer srv.Close()

	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	// The handshake nonce is any 16 bytes, base64-encoded (RFC 6455).
	nonce := base64.StdEncoding.EncodeToString([]byte("capacity-test-16"))
	_, err = io.WriteString(conn, "GET /v1/ws HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: "+nonce+"\r\n\r\n")
	if err != nil {
		t.Fatalf("write handshake: %v", err)
	}

	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatalf("read handshake response: %v", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", resp.StatusCode)
	}
	op, body, err := readServerFrame(br)
	if err != nil || op != opClose || len(body) < 2 {
		t.Fatalf("first frame: op %d, err %v; want a close frame", op, err)
	}
	if code, reason := binary.BigEndian.Uint16(body), string(body[2:]); code != CloseTryAgainLater || reason != reasonAtCapacity {
		t.Fatalf("close = %d %q, want %d %q", code, reason, CloseTryAgainLater, reasonAtCapacity)
	}
	if got := gw.sockets.Load(); got != 1 {
		t.Fatalf("refused upgrade left %d slots taken, want 1", got)
	}
}
