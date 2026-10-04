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
