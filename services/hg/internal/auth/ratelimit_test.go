package auth

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The tests below pin what the auth limits do when Redis cannot answer
// (issue #407). Redis is disposable (docs/spec/01-platform.md, "G-1 —
// Postgres is the only source of truth"), so login, restaurant sign-up and the
// verification-email resend keep working, and keep being limited, counted in
// this replica's memory (FallBackLocally). The OTP endpoints are the two where
// a limit that does not hold is unacceptable ("P-02 — Phone OTP
// authentication") and answer 503 instead. None needs a container: the client
// points at a closed port.

// TestWithRedisGoneLoginAndResendStayLimited: with Redis unreachable, the 31st
// login from one address and the 11th for one email in 15 minutes, and the 6th
// verification-email resend in 24 hours, get 429 with Retry-After.
func TestWithRedisGoneLoginAndResendStayLimited(t *testing.T) {
	cases := []struct {
		name    string
		max     int
		window  time.Duration
		path    string
		handler func(*Handler) http.HandlerFunc
		request func(i int) (ip, body string) // the i-th request, from 0
	}{
		{
			name: "login per IP", max: 30, window: 15 * time.Minute, path: "/v1/auth/login",
			handler: func(h *Handler) http.HandlerFunc { return h.Login },
			request: func(i int) (string, string) {
				// One address, a new email each time: only the per-IP limit fills.
				return "203.0.113.20", fmt.Sprintf(`{"email":"owner%d@example.com","password":"correct horse battery"}`, i)
			},
		},
		{
			name: "login per email", max: 10, window: 15 * time.Minute, path: "/v1/auth/login",
			handler: func(h *Handler) http.HandlerFunc { return h.Login },
			request: func(i int) (string, string) {
				// One email from a new address each time: only the per-email limit fills.
				return fmt.Sprintf("198.51.100.%d", i+1), `{"email":"target@example.com","password":"correct horse battery"}`
			},
		},
		{
			name: "verification-email resend", max: 5, window: 24 * time.Hour, path: "/v1/auth/email/resend",
			handler: func(h *Handler) http.HandlerFunc { return h.ResendEmailVerification },
			request: func(int) (string, string) { return "203.0.113.21", `{"email":"pending@example.com"}` },
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := tc.handler(handlerWithoutStore(NewRateLimiter(goneRedis(t), nil)))
			for i := range tc.max {
				ip, body := tc.request(i)
				if rec, passed := serve(handler, authRequest(tc.path, ip, body)); !passed {
					t.Fatalf("request %d of %d was refused: %d %s", i+1, tc.max, rec.Code, rec.Body.String())
				}
			}
			ip, body := tc.request(tc.max)
			rec, passed := serve(handler, authRequest(tc.path, ip, body))
			if passed {
				t.Fatalf("request %d went past the limiter with Redis gone", tc.max+1)
			}
			assertLimited(t, rec, tc.window)
		})
	}
}

// TestWithRedisGoneASignUpOverTheLimitRunsNoHash: with Redis unreachable, the
// 6th restaurant sign-up from one address in an hour gets 429 before any
// argon2id hash runs, so a flood of sign-ups costs no CPU. The first five
// reach the hash, which proves the test watches the hash the handler uses.
func TestWithRedisGoneASignUpOverTheLimitRunsNoHash(t *testing.T) {
	errStop := errors.New("test: stop after the hash")
	hashes := 0
	orig := hashNewPassword
	hashNewPassword = func(string) (string, error) { hashes++; return "", errStop }
	t.Cleanup(func() { hashNewPassword = orig })

	h := handlerWithoutStore(NewRateLimiter(goneRedis(t), nil))
	body := `{"email":"new@example.com","password":"correct horse battery","business_name":"Bismillah Grill","terms_version":"2026-01"}`
	for i := 1; i <= 5; i++ {
		rec, _ := serve(h.RegisterRestaurant, authRequest("/v1/auth/register/restaurant", "203.0.113.22", body))
		if hashes != i {
			t.Fatalf("sign-up %d: %d hashes, want %d (status %d %s)", i, hashes, i, rec.Code, rec.Body.String())
		}
	}
	rec, passed := serve(h.RegisterRestaurant, authRequest("/v1/auth/register/restaurant", "203.0.113.22", body))
	if passed {
		t.Fatal("the 6th sign-up went past the limiter with Redis gone")
	}
	assertLimited(t, rec, time.Hour)
	if hashes != 5 {
		t.Errorf("the 6th sign-up ran the hash: %d hashes, want 5", hashes)
	}
}

// TestWithRedisGoneTheOTPRequestStillAnswers503: sign-in codes never use the
// local count. requestOtp fails closed with 503 RATE_LIMITER_UNAVAILABLE on
// every request, and nothing is counted in memory.
func TestWithRedisGoneTheOTPRequestStillAnswers503(t *testing.T) {
	rl := NewRateLimiter(goneRedis(t), nil)
	h := handlerWithoutStore(rl)
	for i := 1; i <= 3; i++ {
		req := authRequest("/v1/auth/otp/request", "203.0.113.23", `{"phone_e164":"+14165550123","purpose":"SIGN_IN"}`)
		req.Header.Set("X-HG-Client", string(ClientCustomerApp))
		rec, passed := serve(h.RequestOTP, req)
		if passed {
			t.Fatalf("request %d went past the limiter with Redis gone", i)
		}
		if rec.Code != http.StatusServiceUnavailable || errorCode(rec) != string(httpx.CodeRateLimiterUnavailable) {
			t.Fatalf("request %d = %d %s, want 503 %s", i, rec.Code, rec.Body.String(), httpx.CodeRateLimiterUnavailable)
		}
	}
	if n := localEntries(rl.local, "otp:phone") + localEntries(rl.local, "otp:ip"); n != 0 {
		t.Errorf("%d OTP counters in memory, want 0: the OTP limits fail closed", n)
	}
}

// TestLocalFallbackLogsOncePerWindowPerLimit: while Redis is down, each limit
// logs one error per window, not one per request, so an alert can fire
// without the logs flooding. The next line counts the requests in between.
func TestLocalFallbackLogsOncePerWindowPerLimit(t *testing.T) {
	var out bytes.Buffer
	rl := NewRateLimiter(goneRedis(t), slog.New(slog.NewJSONHandler(&out, nil)))
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	rl.local.now = func() time.Time { return now }
	ctx := context.Background()
	byIP := Limit{Name: "login:ip", Subject: "203.0.113.24", Max: 30, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}
	byEmail := Limit{Name: "login:email", Subject: "owner@example.com", Max: 10, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}
	for range 50 {
		_ = rl.Allow(ctx, byIP)
		_ = rl.Allow(ctx, byEmail)
	}
	now = now.Add(15 * time.Minute)
	_ = rl.Allow(ctx, byIP)

	type line struct {
		Level    string `json:"level"`
		Limit    string `json:"limit"`
		Requests int    `json:"requests_since_last_log"`
	}
	var lines []line
	sc := bufio.NewScanner(&out)
	for sc.Scan() {
		var l line
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			t.Fatalf("log line %q: %v", sc.Text(), err)
		}
		lines = append(lines, l)
	}
	want := []line{
		{Level: "ERROR", Limit: "login:ip", Requests: 1},
		{Level: "ERROR", Limit: "login:email", Requests: 1},
		{Level: "ERROR", Limit: "login:ip", Requests: 50}, // 49 unlogged, then this one
	}
	if fmt.Sprint(lines) != fmt.Sprint(want) {
		t.Errorf("log lines = %+v, want %+v", lines, want)
	}
}

// TestLocalFallbackCapHoldsWithoutEvictingALiveCount: a flood of made-up
// subjects (random emails, or addresses in fresh IPv6 /64s) can neither grow
// one limit's counters past the cap nor push a guesser's count out to get a
// fresh budget. Once the limit is full of live counts, new subjects share one
// overflow window with the same Max, so the flood is refused, never let
// through. Another limit's counters are untouched, and counters whose window
// has ended are dropped.
func TestLocalFallbackCapHoldsWithoutEvictingALiveCount(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	ll := newLocalLimiter(localMaxEntriesPerLimit, func() time.Time { return now })
	target := Limit{Name: "login:email", Subject: "target@example.com", Max: 10, Window: 15 * time.Minute}
	other := Limit{Name: "login:ip", Subject: "203.0.113.25", Max: 30, Window: 15 * time.Minute}
	for range target.Max {
		if _, err := ll.allow(target); err != nil {
			t.Fatalf("under the limit: %v", err)
		}
	}
	if _, err := ll.allow(other); err != nil {
		t.Fatalf("other limit: %v", err)
	}

	flood, allowed := target, 0
	for i := range 3 * localMaxEntriesPerLimit {
		flood.Subject = fmt.Sprintf("made-up-%d@example.com", i)
		if _, err := ll.allow(flood); err == nil {
			allowed++
		} else if !errors.Is(err, ErrRateLimited) {
			t.Fatalf("made-up subject %d: %v", i, err)
		}
	}
	// Each subject that found room has its own count; after that, all of
	// them together get one Max.
	if want := localMaxEntriesPerLimit - 1 + int(target.Max); allowed != want {
		t.Errorf("%d made-up subjects allowed, want %d", allowed, want)
	}
	if n := localEntries(ll, target.Name); n != localMaxEntriesPerLimit {
		t.Errorf("%d counters after the flood, want the cap, %d", n, localMaxEntriesPerLimit)
	}
	if _, err := ll.allow(target); !errors.Is(err, ErrRateLimited) {
		t.Errorf("after the flood the guesser was allowed again (%v): its count was evicted", err)
	}
	if n := localEntries(ll, other.Name); n != 1 {
		t.Errorf("the flood changed another limit's counters: %d, want 1", n)
	}

	now = now.Add(target.Window + localSweepEvery)
	if _, err := ll.allow(target); err != nil {
		t.Errorf("a new window still limited: %v", err)
	}
	if n := localEntries(ll, target.Name); n != 1 {
		t.Errorf("%d counters once every window ended, want 1 (the one just counted)", n)
	}
}

// TestWithRedisGoneTheLocalCountUsesTheRedisKey: the local count is keyed
// exactly as Redis's is, so a guesser cannot reset it by changing the email's
// letter case or spaces, or the address within its IPv6 /64, and requests
// with no resolvable address share one "unknown" count.
func TestWithRedisGoneTheLocalCountUsesTheRedisKey(t *testing.T) {
	rl := NewRateLimiter(goneRedis(t), nil)
	login := handlerWithoutStore(rl).Login
	spellings := []string{"Target@Example.COM", " target@example.com", "TARGET@example.com", "target@EXAMPLE.com "}
	body := func(email string) string {
		return fmt.Sprintf(`{"email":%q,"password":"correct horse battery"}`, email)
	}

	// Ten logins for one email, spelled four ways, from ten addresses in one /64.
	for i := range 10 {
		ip := fmt.Sprintf("2001:db8:1:2::%x", i+1)
		if rec, passed := serve(login, authRequest("/v1/auth/login", ip, body(spellings[i%len(spellings)]))); !passed {
			t.Fatalf("login %d was refused: %d %s", i+1, rec.Code, rec.Body.String())
		}
	}
	if e, a := localEntries(rl.local, "login:email"), localEntries(rl.local, "login:ip"); e != 1 || a != 1 {
		t.Errorf("counters: %d per email, %d per address; want 1 and 1 (one email, one /64)", e, a)
	}
	rec, passed := serve(login, authRequest("/v1/auth/login", "2001:db8:1:2:ffff:ffff:ffff:ffff", body("tArGeT@example.com")))
	if passed {
		t.Fatal("an 11th spelling of the email, from a new address in the same /64, went past the limiter")
	}
	assertLimited(t, rec, 15*time.Minute)

	// No resolvable address: every request counts in the one "unknown" bucket.
	for i := range 31 {
		req := authRequest("/v1/auth/login", "", body(fmt.Sprintf("owner%d@example.com", i)))
		req.RemoteAddr = "pipe"
		rec, passed := serve(login, req)
		if i < 30 && !passed {
			t.Fatalf("login %d with no address was refused: %d %s", i+1, rec.Code, rec.Body.String())
		}
		if i == 30 {
			if passed {
				t.Fatal("the 31st login with no address went past the limiter")
			}
			assertLimited(t, rec, 15*time.Minute)
		}
	}
}

// TestLocalFallbackIsAtomicUnderConcurrency: with Redis gone, concurrent
// requests over one count can never take more than Max between them, and
// every one gets a counted answer.
func TestLocalFallbackIsAtomicUnderConcurrency(t *testing.T) {
	rl := NewRateLimiter(goneRedis(t), nil)
	l := Limit{Name: "login:email", Subject: "target@example.com", Max: 10, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}
	const attempts = 50 // Max plus 40
	var allowed, limited atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			switch err := rl.Allow(context.Background(), l); {
			case err == nil:
				allowed.Add(1)
			case errors.Is(err, ErrRateLimited):
				limited.Add(1)
			default:
				t.Errorf("an answer that is neither allowed nor limited: %v", err)
			}
		}()
	}
	close(start)
	wg.Wait()
	if allowed.Load() != l.Max || limited.Load() != attempts-l.Max {
		t.Errorf("%d allowed and %d limited, want %d and %d", allowed.Load(), limited.Load(), l.Max, attempts-l.Max)
	}
}

// TestWithRedisHealthyTheLocalCountIsUnused: while Redis answers, nothing
// changes. Every count is Redis's, the 31st login from one address is refused
// by Redis's count, and this replica's memory holds no counters.
func TestWithRedisHealthyTheLocalCountIsUnused(t *testing.T) {
	rdb := startRedis(t)
	rl := NewRateLimiter(rdb, nil)
	ctx := context.Background()
	l := Limit{Name: "login:ip", Subject: "203.0.113.26", Max: 30, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}
	for i := 1; i <= 30; i++ {
		if err := rl.Allow(ctx, l); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if err := rl.Allow(ctx, l); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("31st request = %v, want ErrRateLimited", err)
	}
	if n, err := rdb.Get(ctx, "rl:login:ip:203.0.113.26").Int(); err != nil || n != 31 {
		t.Errorf("Redis count = %d (%v), want 31", n, err)
	}
	if n := len(rl.local.limits); n != 0 {
		t.Errorf("%d limits counted in memory while Redis answered, want 0", n)
	}
}

// TestOverTheLimitIs429WithRetryAfterAndNothingRuns pins that an over-the-cap
// answer stops login and restaurant sign-up before any work is done, and says
// when to come back. The handler is built with no store: had the request gone
// past the limiter, the first store call would panic, which the test reports.
func TestOverTheLimitIs429WithRetryAfterAndNothingRuns(t *testing.T) {
	rdb := startRedis(t)
	h := handlerWithoutStore(NewRateLimiter(rdb, nil))

	cases := []struct {
		name    string
		key     string // the counter to fill to its cap before the request
		max     int64
		window  time.Duration
		ip      string
		handler http.HandlerFunc
		path    string
		body    string
	}{
		{
			name: "login per IP", key: "rl:login:ip:203.0.113.10", max: 30, window: 15 * time.Minute,
			ip: "203.0.113.10", handler: h.Login, path: "/v1/auth/login",
			body: `{"email":"owner@example.com","password":"correct horse battery"}`,
		},
		{
			name: "login per email, any letter case", key: "rl:login:email:limited@example.com", max: 10, window: 15 * time.Minute,
			ip: "203.0.113.11", handler: h.Login, path: "/v1/auth/login",
			// A case variant of the filled key: the account column is citext, so
			// it is the same account and must share the same budget.
			body: `{"email":" Limited@Example.COM","password":"correct horse battery"}`,
		},
		{
			name: "restaurant sign-up per IP", key: "rl:register:ip:203.0.113.12", max: 5, window: time.Hour,
			ip: "203.0.113.12", handler: h.RegisterRestaurant, path: "/v1/auth/register/restaurant",
			body: `{"email":"new@example.com","password":"correct horse battery","business_name":"Bismillah Grill","terms_version":"2026-01"}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if err := rdb.Set(ctx, tc.key, tc.max, tc.window).Err(); err != nil {
				t.Fatalf("fill counter: %v", err)
			}
			rec, passed := serve(tc.handler, authRequest(tc.path, tc.ip, tc.body))
			if passed {
				t.Fatal("the request went past the limiter and reached the store")
			}
			assertLimited(t, rec, tc.window)
		})
	}
}

// goneRedis is a client for a Redis that is not there: it points at a port
// nothing listens on, so every command fails at once, as in an outage.
func goneRedis(t *testing.T) *redis.Client {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close() // nothing listens here now
	// No retries and one quick dial, so a test of a hundred requests is fast.
	rdb := redis.NewClient(&redis.Options{Addr: addr, MaxRetries: -1, DialTimeout: time.Second,
		DialerRetries: 1, DialerRetryTimeout: time.Millisecond})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

// handlerWithoutStore builds the auth handler over rl with no store. A request
// the limiter lets through panics at its first store call, which serve
// reports.
func handlerWithoutStore(rl *RateLimiter) *Handler {
	secrets := &Secrets{CurrentTermsVersion: "2026-01"}
	return NewHandler(NewService(nil, rl, nil, nil, nil, secrets, nil), nil, nil, secrets)
}

// authRequest is a JSON POST to path from ip.
func authRequest(path, ip, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = net.JoinHostPort(ip, "51000")
	return req
}

// serve runs req through a handler from handlerWithoutStore. passed reports
// that the request went past the limiter and reached the store; rec is the
// answer otherwise.
func serve(handler http.HandlerFunc, req *http.Request) (rec *httptest.ResponseRecorder, passed bool) {
	rec = httptest.NewRecorder()
	defer func() {
		if recover() != nil {
			passed = true
		}
	}()
	handler(rec, req)
	return rec, false
}

// assertLimited checks for a 429 RATE_LIMITED answer whose Retry-After is
// whole seconds within the window.
func assertLimited(t *testing.T, rec *httptest.ResponseRecorder, window time.Duration) {
	t.Helper()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body %s", rec.Code, rec.Body.String())
	}
	if code := errorCode(rec); code != string(httpx.CodeRateLimited) {
		t.Errorf("error code = %q, want %s", code, httpx.CodeRateLimited)
	}
	secs, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || secs < 1 || secs > int(window/time.Second) {
		t.Errorf("Retry-After = %q, want whole seconds in [1, %d]", rec.Header().Get("Retry-After"), int(window/time.Second))
	}
}

// errorCode is the error.code of an error answer, or "" when there is none.
func errorCode(rec *httptest.ResponseRecorder) string {
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return env.Error.Code
}

// localEntries is how many counters ll holds for the limit called name.
func localEntries(ll *localLimiter, name string) int {
	ll.mu.Lock()
	defer ll.mu.Unlock()
	if cs := ll.limits[name]; cs != nil {
		return len(cs.byKey)
	}
	return 0
}

// startRedis brings up the compose stack's Redis image for the test, or skips
// when there is no Docker daemon.
func startRedis(t *testing.T) *redis.Client {
	t.Helper()
	if !dockerSocketPresent() {
		t.Skip("skipping: no Docker daemon reachable for the Redis container")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "redis:7-alpine",
			ExposedPorts: []string{"6379/tcp"},
			WaitingFor:   wait.ForLog("Ready to accept connections"),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("skipping: could not start the redis container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			t.Logf("terminating container: %v", err)
		}
	})
	endpoint, err := c.Endpoint(ctx, "")
	if err != nil {
		t.Fatalf("redis endpoint: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: endpoint})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func dockerSocketPresent() bool {
	if os.Getenv("DOCKER_HOST") != "" {
		return true
	}
	for _, sock := range []string{
		"/var/run/docker.sock",
		os.Getenv("HOME") + "/.docker/run/docker.sock",
		os.Getenv("XDG_RUNTIME_DIR") + "/docker.sock",
	} {
		if fi, err := os.Stat(sock); err == nil && fi.Mode()&os.ModeSocket != 0 {
			return true
		}
	}
	return false
}
