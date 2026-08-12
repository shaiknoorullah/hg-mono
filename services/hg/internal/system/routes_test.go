package system

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

func testSetup(t *testing.T, env config.Environment) (*httpx.Router, time.Time) {
	t.Helper()

	cfg := &config.Config{Env: env, ServiceVersion: "test-1.2.3"}
	startedAt := time.Date(2026, 8, 12, 14, 3, 11, 412_000_000, time.UTC)

	rt := httpx.NewRouter(httpx.Options{
		Logger:      slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError})),
		Env:         string(env),
		CORSOrigins: []string{"http://localhost:5173"},
	})
	// Health does not touch a dependency, so a nil store is the honest fixture
	// for the routing and envelope assertions here. The dependency-reading paths
	// are covered in internal/store against a real database.
	Routes(rt, NewHandler(cfg, nil, startedAt, nil), cfg)
	return rt, startedAt
}

// TestRoutesVerify is the boot gate: every system route carries a coherent
// policy, so the binary would not start otherwise.
func TestRoutesVerify(t *testing.T) {
	rt, _ := testSetup(t, config.EnvLocal)
	if err := rt.Verify(); err != nil {
		t.Fatalf("system routes failed policy verification: %v", err)
	}
}

// TestPublicRoutesMatchTheAllowlist is I-06.2: the set of public routes must
// equal a checked-in list exactly, so opening a route to the internet is a
// visible diff in a reviewed file rather than a one-word change in a call.
func TestPublicRoutesMatchTheAllowlist(t *testing.T) {
	for _, tc := range []struct {
		env   config.Environment
		local bool
	}{
		{config.EnvLocal, true},
		{config.EnvProduction, false},
	} {
		t.Run(string(tc.env), func(t *testing.T) {
			rt, _ := testSetup(t, tc.env)
			got := rt.PublicRoutes()
			want := PublicRouteAllowlist(tc.local)

			if !reflect.DeepEqual(got, want) {
				t.Errorf("public routes in %s:\n got %v\nwant %v", tc.env, got, want)
			}
		})
	}
}

// TestDebugDepsIsNotPublicOutsideLocal: a diagnostics endpoint that reports
// internal addresses must not be reachable unauthenticated in production.
func TestDebugDepsIsNotPublicOutsideLocal(t *testing.T) {
	rt, _ := testSetup(t, config.EnvProduction)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/debug/deps", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 for /debug/deps in production", rec.Code)
	}
}

// TestDependencyStatusRequiresAuthorization mirrors the contract, where
// getDependencyStatus carries x-roles [ADMIN, SUPER_ADMIN] rather than PUBLIC.
func TestDependencyStatusRequiresAuthorization(t *testing.T) {
	rt, _ := testSetup(t, config.EnvLocal)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/internal/deps", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 for an anonymous /internal/deps", rec.Code)
	}
}

// TestHealthMatchesTheContractShape checks getHealth against the contract's
// HealthStatus schema: required [status, version, started_at], status enum
// ["ok"], and a Timestamp that is RFC3339 with milliseconds, UTC, Z-suffixed.
func TestHealthMatchesTheContractShape(t *testing.T) {
	rt, startedAt := testSetup(t, config.EnvLocal)

	for _, path := range []string{"/health", "/healthz"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %v", err)
			}
			if _, ok := body["data"]; !ok {
				t.Fatal("2xx body has no top-level \"data\" key — G-6")
			}
			if _, ok := body["error"]; ok {
				t.Fatal("a 2xx body carried \"error\" — G-6 forbids it")
			}

			var got healthStatus
			if err := json.Unmarshal(body["data"], &got); err != nil {
				t.Fatalf("data is not a HealthStatus: %v", err)
			}
			if got.Status != "ok" {
				t.Errorf("status = %q, want the enum's only member \"ok\"", got.Status)
			}
			if got.Version != "test-1.2.3" {
				t.Errorf("version = %q, want the configured service version", got.Version)
			}
			if got.StartedAt != "2026-08-12T14:03:11.412Z" {
				t.Errorf("started_at = %q, want an RFC3339 UTC timestamp with milliseconds", got.StartedAt)
			}
			if parsed, err := time.Parse(time.RFC3339, got.StartedAt); err != nil {
				t.Errorf("started_at does not parse as RFC3339: %v", err)
			} else if !parsed.Equal(startedAt) {
				t.Errorf("started_at = %v, want %v", parsed, startedAt)
			}
		})
	}
}

func TestSameEndpoint(t *testing.T) {
	cases := []struct {
		name                 string
		configured, resolved string
		want                 bool
	}{
		{"identical", "10.0.0.4:5432", "10.0.0.4:5432", true},
		{"different port on the same host", "10.0.0.4:5432", "10.0.0.4:6432", false},
		{"configured IP differs from connected IP", "10.0.0.4:5432", "10.0.0.9:5432", false},
		{"nothing connected yet", "redis:6379", "", false},
		{"nothing configured", "", "10.0.0.4:6379", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameEndpoint(tc.configured, tc.resolved); got != tc.want {
				t.Errorf("sameEndpoint(%q, %q) = %v, want %v", tc.configured, tc.resolved, got, tc.want)
			}
		})
	}
}
