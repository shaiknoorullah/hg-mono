package httpx

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

// TestClientIPBelievesForwardedForOnlyFromATrustedProxy pins the client address
// every per-IP rate limit and audit row is keyed on. Two failures it rules out:
// behind Traefik every caller sharing Traefik's address (one global limit), and
// a caller dodging its limit by sending its own X-Forwarded-For.
//
// It goes through the router, so it also proves RealIP is in the chain.
func TestClientIPBelievesForwardedForOnlyFromATrustedProxy(t *testing.T) {
	traefik := []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16"), netip.MustParsePrefix("fd00::/8")}

	cases := []struct {
		name    string
		trusted []netip.Prefix
		peer    string
		xff     []string
		want    string
	}{
		{"no trusted proxies by default: the header is ignored",
			nil, "172.18.0.5:41000", []string{"203.0.113.7"}, "172.18.0.5"},
		{"untrusted peer: a forged header is ignored",
			traefik, "198.51.100.9:5000", []string{"203.0.113.7"}, "198.51.100.9"},
		{"trusted peer: the address Traefik appended",
			traefik, "172.18.0.5:41000", []string{"203.0.113.7"}, "203.0.113.7"},
		{"trusted peer: a client-written prefix is never read",
			traefik, "172.18.0.5:41000", []string{"10.9.9.9, 203.0.113.7"}, "203.0.113.7"},
		{"two trusted hops: the right-most untrusted address",
			traefik, "172.18.0.5:41000", []string{"1.1.1.1, 203.0.113.7", "172.18.0.9"}, "203.0.113.7"},
		{"trusted peer, no header: the peer",
			traefik, "172.18.0.5:41000", nil, "172.18.0.5"},
		{"every entry trusted: the left-most trusted address",
			traefik, "172.18.0.5:41000", []string{"172.18.0.7, 172.18.0.9"}, "172.18.0.7"},
		{"garbage left of a trusted hop: the last address a proxy vouched for",
			traefik, "172.18.0.5:41000", []string{"not-an-ip, 172.18.0.9"}, "172.18.0.9"},
		{"IPv6 peer and client, unbracketed and zone-free",
			traefik, "[fd00::5%eth0]:41000", []string{"[2001:db8::7]:443"}, "2001:db8::7"},
		{"IPv4-mapped peer still matches an IPv4 range",
			traefik, "[::ffff:172.18.0.5]:41000", []string{"203.0.113.7"}, "203.0.113.7"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rt := testRouter(func(o *Options) { o.TrustedProxies = tc.trusted })
			var got string
			rt.Get("/ip", Policy{Public: true, Class: ClassRead}, func(w http.ResponseWriter, r *http.Request) {
				got = ClientIP(r)
				w.WriteHeader(http.StatusNoContent)
			})

			req := httptest.NewRequest(http.MethodGet, "/ip", nil)
			req.RemoteAddr = tc.peer
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			rt.ServeHTTP(httptest.NewRecorder(), req)

			if got != tc.want {
				t.Errorf("ClientIP = %q, want %q", got, tc.want)
			}
		})
	}
}
