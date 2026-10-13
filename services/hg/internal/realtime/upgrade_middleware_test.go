package realtime

import (
	"bufio"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestUpgradeThroughTheAccessLog pins the handshake behind the real middleware: the access
// log wraps the response writer, and the upgrade must still reach the connection and answer
// 101. Before the fix it answered an empty 200, so no client ever got a socket.
func TestUpgradeThroughTheAccessLog(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := httpx.AccessLog(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrade(w, r)
		if err != nil {
			t.Errorf("upgrade behind the access log: %v", err)
			return
		}
		_ = ws.writeClose(CloseNormal, "bye")
	}))
	srv := httptest.NewServer(handler)
	defer srv.Close()

	conn, err := net.Dial("tcp", strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	req := "GET /v1/ws HTTP/1.1\r\nHost: test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write handshake: %v", err)
	}
	status, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatalf("read status: %v", err)
	}
	if !strings.HasPrefix(status, "HTTP/1.1 101") {
		t.Fatalf("status line = %q, want 101 Switching Protocols", strings.TrimSpace(status))
	}
}
