package httpx

import (
	"context"
	"net/http"
	"net/netip"
	"strings"
)

// RealIP is stage 3 of the middleware chain: it settles, once per request, which
// address the request came from. Every reader of the client address — the
// access log, the per-IP rate-limit keys (through RateLimitKey), audit rows,
// realtime tickets — gets it from ClientIP, so there is one answer and one place
// that decides it.
//
// Behind Traefik the socket peer is always Traefik, so the peer alone would make
// every customer look like one address and turn a per-IP limit into a global
// one. Trusting X-Forwarded-For blindly is worse: any caller could name any
// address. The rule (docs/spec/01-platform.md, "P-06 — Deny-by-default routing
// and the middleware chain", stage 3) is to believe the header only from a peer
// we run:
//
//   - The peer is not in trusted: the client is the peer. X-Forwarded-For is
//     ignored whatever it says.
//   - The peer is in trusted: walk X-Forwarded-For from the right (the entry the
//     nearest proxy appended) and stop at the first address that is not a
//     trusted proxy. That is the client. Entries further left were written by
//     the client or by proxies we do not run, so they are never read.
//   - Every entry is a trusted proxy, or an entry is not an address: the
//     left-most trusted address walked is the answer. It is an address one of
//     our proxies vouched for, never a value a client chose.
//
// What Traefik sends: with no forwardedHeaders settings on its entrypoints (the
// deploy compose files set none), Traefik deletes any X-Forwarded-For and
// X-Real-Ip a client sends, then appends the address of its own socket peer. So
// the API sees one entry, written by Traefik, and a client cannot put anything
// to its right.
//
// trusted is empty by default (config HG_TRUSTED_PROXY_CIDRS), which makes the
// header inert: the peer is reported, as before this stage existed.
func RealIP(trusted []netip.Prefix) Middleware {
	tp := trustedProxies(trusted)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := tp.clientAddr(r)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientIPCtx{}, ip)))
		})
	}
}

type clientIPCtx struct{}

// ClientIP returns the request's client address as RealIP resolved it: a bare
// IP literal with no port, brackets or IPv6 zone, ready for an inet column, a
// log line or an audit row. It is "" when the address is unknown. A per-IP rate
// limit does not key on it directly: it keys on RateLimitKey(ClientIP(r)).
//
// A request that did not pass through the router (a handler unit test) falls
// back to the socket peer, which is what RealIP reports with no trusted proxies.
func ClientIP(r *http.Request) string {
	ip, ok := r.Context().Value(clientIPCtx{}).(netip.Addr)
	if !ok {
		ip = peerAddr(r)
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

type trustedProxies []netip.Prefix

func (t trustedProxies) contains(ip netip.Addr) bool {
	for _, p := range t {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

func (t trustedProxies) clientAddr(r *http.Request) netip.Addr {
	client := peerAddr(r)
	if !client.IsValid() || !t.contains(client) {
		return client
	}
	// Later header lines were added by later hops, so the right-most entry of
	// the last line is the one the nearest proxy wrote.
	lines := r.Header.Values("X-Forwarded-For")
	for i := len(lines) - 1; i >= 0; i-- {
		rest := lines[i]
		for rest != "" {
			entry := rest
			if j := strings.LastIndexByte(rest, ','); j >= 0 {
				entry, rest = rest[j+1:], rest[:j]
			} else {
				rest = ""
			}
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			ip, ok := parseForwardedAddr(entry)
			if !ok {
				return client
			}
			client = ip
			if !t.contains(ip) {
				return client
			}
		}
	}
	return client
}

// peerAddr is the socket peer from RemoteAddr ("host:port", "[v6]:port").
func peerAddr(r *http.Request) netip.Addr {
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		return normalise(ap.Addr())
	}
	ip, _ := parseForwardedAddr(r.RemoteAddr)
	return ip
}

// parseForwardedAddr accepts a bare IP, a bracketed IPv6 literal, or either
// with a port. Traefik writes bare IPs; the rest is tolerated, not expected.
func parseForwardedAddr(s string) (netip.Addr, bool) {
	if ip, err := netip.ParseAddr(strings.Trim(s, "[]")); err == nil {
		return normalise(ip), true
	}
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return normalise(ap.Addr()), true
	}
	return netip.Addr{}, false
}

// normalise drops the IPv6 zone (an inet column rejects it) and unmaps
// IPv4-in-IPv6, so "::ffff:10.0.0.1" matches a 10.0.0.0/8 trusted range and
// rate-limits under the same key as "10.0.0.1".
func normalise(ip netip.Addr) netip.Addr {
	return ip.WithZone("").Unmap()
}
