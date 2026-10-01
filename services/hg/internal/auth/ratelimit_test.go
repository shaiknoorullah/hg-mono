package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestLimiterWithRedisGoneFailsClosedOnlyWhereTheSpecSaysSo pins the two
// Redis-down policies. Redis is disposable (docs/spec/01-platform.md, "G-1 —
// Postgres is the only source of truth"), so login, restaurant sign-up and the
// email resend keep working when it is gone; the OTP endpoints are the two
// where fail-open is unacceptable ("P-02 — Phone OTP authentication") and
// answer 503 instead. Needs no container: the client points at a closed port.
func TestLimiterWithRedisGoneFailsClosedOnlyWhereTheSpecSaysSo(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close() // nothing listens here now

	rdb := redis.NewClient(&redis.Options{Addr: addr, MaxRetries: -1, DialTimeout: time.Second})
	t.Cleanup(func() { _ = rdb.Close() })
	rl := NewRateLimiter(rdb, nil)
	ctx := context.Background()

	open := Limit{Name: "login:ip", Subject: "203.0.113.9", Max: 30, Window: 15 * time.Minute, OnUnavailable: FailOpen}
	if err := rl.Allow(ctx, open); err != nil {
		t.Errorf("fail-open limit with Redis gone = %v, want nil (the request proceeds)", err)
	}

	closed := Limit{Name: "otp:phone", Subject: "+14165550123", Max: 5, Window: 15 * time.Minute}
	if err := rl.Allow(ctx, closed); !errors.Is(err, ErrLimiterUnavailable) {
		t.Errorf("default (fail-closed) limit with Redis gone = %v, want ErrLimiterUnavailable", err)
	}
}

// TestOverTheLimitIs429WithRetryAfterAndNothingRuns pins that an over-the-cap
// answer stops login and restaurant sign-up before any work is done, and says
// when to come back. The handler is built with no store: had the request gone
// past the limiter, the first store call would panic, which the test reports.
func TestOverTheLimitIs429WithRetryAfterAndNothingRuns(t *testing.T) {
	rdb := startRedis(t)
	secrets := &Secrets{CurrentTermsVersion: "2026-01"}
	svc := NewService(nil, NewRateLimiter(rdb, nil), nil, nil, nil, secrets, nil)
	h := NewHandler(svc, nil, nil, secrets)

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
			name: "login per email", key: "rl:login:email:limited@example.com", max: 10, window: 15 * time.Minute,
			ip: "203.0.113.11", handler: h.Login, path: "/v1/auth/login",
			body: `{"email":"limited@example.com","password":"correct horse battery"}`,
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
			req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.RemoteAddr = tc.ip + ":51000"
			rec := httptest.NewRecorder()

			func() {
				defer func() {
					if p := recover(); p != nil {
						t.Fatalf("the request went past the limiter and reached the store: %v", p)
					}
				}()
				tc.handler(rec, req)
			}()

			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429; body %s", rec.Code, rec.Body.String())
			}
			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Error.Code != "RATE_LIMITED" {
				t.Errorf("error code = %q (%v), want RATE_LIMITED", env.Error.Code, err)
			}
			secs, err := strconv.Atoi(rec.Header().Get("Retry-After"))
			if err != nil || secs < 1 || secs > int(tc.window/time.Second) {
				t.Errorf("Retry-After = %q, want whole seconds in [1, %d]", rec.Header().Get("Retry-After"), int(tc.window/time.Second))
			}
		})
	}
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
