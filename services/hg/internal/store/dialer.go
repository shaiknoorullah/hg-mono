package store

import (
	"context"
	"net"
	"sync"
	"time"
)

// addrRecorder wraps a net.Dialer and remembers the remote address of the most
// recent successful connection.
//
// This is the mechanism behind the "configured versus connected" report: the
// configured string is what an operator typed, while RemoteAddr() is what the
// kernel actually opened a socket to. A DNS alias, a Docker network, an
// /etc/hosts entry or a stale environment variable makes them differ, and that
// difference is exactly the bug class /debug/deps exists to surface.
type addrRecorder struct {
	mu   sync.RWMutex
	addr string

	dialer *net.Dialer
}

func newAddrRecorder() *addrRecorder {
	return &addrRecorder{dialer: &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}}
}

// DialContext dials and records the resulting remote address.
func (a *addrRecorder) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	conn, err := a.dialer.DialContext(ctx, network, address)
	if err != nil {
		return nil, err
	}
	a.set(conn.RemoteAddr().String())
	return conn, nil
}

// Dial matches the signature go-redis expects for its Dialer option.
func (a *addrRecorder) Dial(ctx context.Context, network, address string) (net.Conn, error) {
	return a.DialContext(ctx, network, address)
}

func (a *addrRecorder) set(addr string) {
	a.mu.Lock()
	a.addr = addr
	a.mu.Unlock()
}

// addr returns the last recorded remote address, or "" if nothing has connected.
func (a *addrRecorder) get() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.addr
}
