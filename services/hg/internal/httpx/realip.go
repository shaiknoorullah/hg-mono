package httpx

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// RealIP is stage 3 of the chain (docs/spec/01-platform.md, "P-06 —
// Deny-by-default routing and the middleware chain"). It resolves the address
// of the client that started the request and puts it in the context, where
// ClientIP reads it.
//
// Every public request reaches this binary through Traefik, so the TCP peer is
// Traefik's address, which every client shares. Keying a per-IP limit on the
// peer would turn it into one platform-wide limit. The forwarding headers name
// the real client, but anybody can send them, so they are believed only when
// the peer is one of the trusted proxies (HG_TRUSTED_PROXIES):
//
//   - X-Forwarded-For is read right to left, skipping trusted hops. The first
//     address that is not a trusted proxy is the client. Anything to its left
//     was written by the client and is ignored, so prepending a forged
//     address changes nothing.
//   - Without X-Forwarded-For, X-Real-Ip (which Traefik also sets) is used.
//   - From any other peer, the headers are ignored and the peer is the client.
func RealIP(trusted []netip.Prefix) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := resolveClientIP(r, trusted)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPKey{}, ip)))
		})
	}
}

type clientIPKey struct{}

// ClientIP returns the client's address as a bare literal ("203.0.113.9",
// "2001:db8::1"): no port, no brackets, no zone, IPv4-mapped IPv6 unmapped, so
// it fits an inet column, a log line or an audit row. A per-IP rate limit does
// not key on it directly: it keys on RateLimitKey(ClientIP(r)).
// It is the address RealIP resolved, or the TCP peer when RealIP did not run
// (a handler test). It is "" only when neither is a valid address.
func ClientIP(r *http.Request) string {
	ip, ok := r.Context().Value(clientIPKey{}).(netip.Addr)
	if !ok {
		ip = peerAddr(r.RemoteAddr)
	}
	if !ip.IsValid() {
		return ""
	}
	return ip.String()
}

// RateLimitKey is what a per-IP rate limit counts a caller under, given the
// address ClientIP returned. Logs, audit rows and inet columns keep the exact
// address; only the counter is coarser.
//
//   - IPv4: the address itself, "203.0.113.7".
//   - IPv6: the /64 the address is in, "2001:db8:1:2::/64". An ISP or a VPS
//     host gives one subscriber at least a /64, and the subscriber can send
//     from any address in it, so counting each address separately would give
//     one caller 2^64 fresh budgets.
//   - Unknown ("" or not an address): "unknown". Every such request shares one
//     budget, so an address that could not be resolved is limited along with
//     the rest, never waved through.
func RateLimitKey(clientIP string) string {
	ip, err := netip.ParseAddr(clientIP)
	if err != nil {
		return "unknown"
	}
	ip = normalise(ip)
	if ip.Is4() {
		return ip.String()
	}
	// Cannot fail: ip is a valid IPv6 address and 64 is within its 128 bits.
	p, _ := ip.Prefix(64)
	return p.String()
}

func resolveClientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	peer := peerAddr(r.RemoteAddr)
	if !peer.IsValid() || !isTrusted(peer, trusted) {
		return peer
	}

	var hops []string
	for _, v := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(v, ",")...)
	}
	if len(hops) > 0 {
		client := peer
		for i := len(hops) - 1; i >= 0; i-- {
			hop, ok := parseHop(hops[i])
			if !ok {
				// Garbage at this hop: stop at the last address a trusted
				// proxy vouched for rather than guess past it.
				return client
			}
			client = hop
			if !isTrusted(client, trusted) {
				return client
			}
		}
		return client
	}

	if hop, ok := parseHop(r.Header.Get("X-Real-Ip")); ok {
		return hop
	}
	return peer
}

// peerAddr parses r.RemoteAddr ("host:port", "[v6]:port"), or the zero Addr.
func peerAddr(remote string) netip.Addr {
	host := remote
	if h, _, err := net.SplitHostPort(remote); err == nil {
		host = h
	}
	a, _ := parseHop(host)
	return a
}

// parseHop parses one forwarding-header entry: a bare address, optionally
// bracketed, optionally with a port.
func parseHop(s string) (netip.Addr, bool) {
	s = strings.TrimSpace(s)
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return normalise(ap.Addr()), true
	}
	if a, err := netip.ParseAddr(strings.TrimSuffix(strings.TrimPrefix(s, "["), "]")); err == nil {
		return normalise(a), true
	}
	return netip.Addr{}, false
}

func normalise(a netip.Addr) netip.Addr { return a.Unmap().WithZone("") }

func isTrusted(a netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}
