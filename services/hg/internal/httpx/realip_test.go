package httpx

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

// TestRealIPBelievesForwardingHeadersOnlyFromTrustedProxies pins the RealIP
// stage (docs/spec/01-platform.md, "P-06 — Deny-by-default routing and the
// middleware chain", stage 3). Behind Traefik every request has the same TCP
// peer, so per-IP limits need the forwarded address; but the headers are
// client-writable, so a forged one must never move a client into another
// client's budget or out of its own.
func TestRealIPBelievesForwardingHeadersOnlyFromTrustedProxies(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("172.16.0.0/12")}
	const traefik = "172.18.0.5:41000"

	cases := []struct {
		name    string
		peer    string
		xff     []string
		xRealIP string
		want    string
	}{
		{name: "through Traefik, X-Forwarded-For names the client",
			peer: traefik, xff: []string{"203.0.113.7"}, want: "203.0.113.7"},
		{name: "a forged entry prepended by the client is ignored",
			peer: traefik, xff: []string{"198.51.100.1, 203.0.113.7"}, want: "203.0.113.7"},
		{name: "trusted hops on the right are skipped",
			peer: traefik, xff: []string{"203.0.113.7", "172.18.0.9"}, want: "203.0.113.7"},
		{name: "X-Real-Ip when there is no X-Forwarded-For",
			peer: traefik, xRealIP: "2001:db8::7", want: "2001:db8::7"},
		{name: "IPv4-mapped IPv6 is the IPv4 client, one key not two",
			peer: traefik, xff: []string{"::ffff:203.0.113.7"}, want: "203.0.113.7"},
		{name: "headers from an untrusted peer are ignored",
			peer: "198.51.100.20:5000", xff: []string{"203.0.113.7"}, xRealIP: "203.0.113.8", want: "198.51.100.20"},
		{name: "IPv6 peer comes back without brackets or port",
			peer: "[2001:db8::20]:5000", want: "2001:db8::20"},
		{name: "a trusted peer with no headers is itself",
			peer: traefik, want: "172.18.0.5"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			h := RealIP(trusted)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				got = ClientIP(r)
			}))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.peer
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			if tc.xRealIP != "" {
				req.Header.Set("X-Real-Ip", tc.xRealIP)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)
			if got != tc.want {
				t.Errorf("ClientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestRateLimitKeyCountsAnIPv6CallerPerSlash64 pins what a per-IP limit counts
// a caller under. One subscriber gets at least an IPv6 /64 and can send from
// any address in it, so a key per address would let one caller dodge every
// per-IP limit by changing address. An address that could not be resolved is
// limited in one shared bucket, never skipped.
func TestRateLimitKeyCountsAnIPv6CallerPerSlash64(t *testing.T) {
	cases := []struct {
		name, ip, want string
	}{
		{"IPv4: the address", "203.0.113.7", "203.0.113.7"},
		{"IPv4-mapped IPv6: the IPv4 address", "::ffff:203.0.113.7", "203.0.113.7"},
		{"IPv6: its /64", "2001:db8:1:2::7", "2001:db8:1:2::/64"},
		{"IPv6, another address in the same /64: the same key", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"},
		{"IPv6, the next /64: a different key", "2001:db8:1:3::7", "2001:db8:1:3::/64"},
		{"IPv6 with a zone: its /64", "fe80::1%eth0", "fe80::/64"},
		{"unknown: one shared bucket", "", "unknown"},
		{"not an address: one shared bucket", "not-an-ip", "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RateLimitKey(tc.ip); got != tc.want {
				t.Errorf("RateLimitKey(%q) = %q, want %q", tc.ip, got, tc.want)
			}
		})
	}
}
