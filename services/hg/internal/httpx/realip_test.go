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

		// The ways a caller might try to choose its own address.
		{"untrusted peer: several forged lines, one naming a trusted proxy, all ignored",
			traefik, "198.51.100.9:5000", []string{"203.0.113.7", "172.18.0.9"}, "198.51.100.9"},
		{"trusted peer: a forged line before the one Traefik wrote is never read",
			traefik, "172.18.0.5:41000", []string{"10.9.9.9", "203.0.113.7"}, "203.0.113.7"},
		{"trusted peer: garbage where Traefik's entry should be gives the peer, not the client's pick",
			traefik, "172.18.0.5:41000", []string{"203.0.113.66, garbage"}, "172.18.0.5"},
		{"trusted peer: an empty header gives the peer",
			traefik, "172.18.0.5:41000", []string{""}, "172.18.0.5"},
		{"IPv4-mapped client is unmapped, so it shares its IPv4 key",
			traefik, "172.18.0.5:41000", []string{"::ffff:203.0.113.7"}, "203.0.113.7"},
		{"a zone on a forwarded entry is dropped",
			traefik, "172.18.0.5:41000", []string{"2001:db8::7%eth0"}, "2001:db8::7"},
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
