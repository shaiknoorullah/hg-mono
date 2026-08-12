package httpx

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

func testRouter(opts ...func(*Options)) *Router {
	o := Options{
		Logger:        discardLogger(),
		Env:           "local",
		CORSOrigins:   []string{"http://localhost:5173"},
		Authenticator: AnonymousAuthenticator{},
		Authorizer:    DenyAllAuthorizer{},
	}
	for _, f := range opts {
		f(&o)
	}
	return NewRouter(o)
}

// entryCounter records whether a handler was reached. P-06 acceptance criterion
// 2 requires asserting that a denied request never enters the handler, not
// merely that the status is 401.
type entryCounter struct{ entered int }

func (e *entryCounter) handler(w http.ResponseWriter, r *http.Request) {
	e.entered++
	Respond(w, r, http.StatusOK, map[string]string{"ok": "true"})
}

func decodeError(t *testing.T, body []byte) errBody {
	t.Helper()
	var env errEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("response is not the error envelope: %v (body: %s)", err, body)
	}
	return env.Error
}

// ---------------------------------------------------------------------------
// Deny by default (G-4 / P-06)
// ---------------------------------------------------------------------------

// TestGuardDeniesUnregisteredRoute is the headline default-deny case: a path
// nobody registered is refused, and no handler runs.
func TestGuardDeniesUnregisteredRoute(t *testing.T) {
	var counter entryCounter
	rt := testRouter()
	rt.Get("/registered", Policy{Public: true, Class: ClassRead}, counter.handler)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/not-registered", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for an unregistered route", rec.Code)
	}
	if counter.entered != 0 {
		t.Errorf("a handler ran for an unregistered route")
	}
	if code := decodeError(t, rec.Body.Bytes()).Code; code != CodeNotFound {
		t.Errorf("error code = %q, want NOT_FOUND", code)
	}
}

// TestGuardDeniesRouteRegisteredWithoutAPolicy is the belt-and-braces case.
//
// Router.Verify already refuses to boot on a policy-less route, so this
// simulates the only way one could exist at runtime: a handler attached to the
// underlying mux without going through Handle. The guard must still deny it.
// Without this, "deny by default" would depend on everyone remembering to use
// the right registration function.
func TestGuardDeniesRouteRegisteredWithoutAPolicy(t *testing.T) {
	var counter entryCounter
	rt := testRouter()
	rt.Get("/registered", Policy{Public: true, Class: ClassRead}, counter.handler)

	// Bypass Handle entirely — this is what the guard is defending against.
	rt.mux.Method(http.MethodGet, "/smuggled", http.HandlerFunc(counter.handler))

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/smuggled", nil))

	if counter.entered != 0 {
		t.Fatalf("a handler with no registered policy was executed — deny-by-default is not real")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 for a route with no policy", rec.Code)
	}
}

// TestGuardDeniesAnonymousOnANonPublicRoute is P-06 acceptance criterion 2.
func TestGuardDeniesAnonymousOnANonPublicRoute(t *testing.T) {
	var counter entryCounter
	rt := testRouter()
	rt.Get("/v1/orders/{id}", Policy{Action: "order.read", Class: ClassRead}, counter.handler)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/orders/01J0000000000000000000000", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if counter.entered != 0 {
		t.Error("the handler was entered despite an anonymous caller")
	}
	if code := decodeError(t, rec.Body.Bytes()).Code; code != CodeAuthenticationRequired {
		t.Errorf("error code = %q, want AUTHENTICATION_REQUIRED", code)
	}
}

// TestGuardDeniesAuthenticatedPrincipalLackingTheAction covers the 403 arm: the
// caller is known but the role does not grant the action.
func TestGuardDeniesAuthenticatedPrincipalLackingTheAction(t *testing.T) {
	var counter entryCounter
	rt := testRouter(func(o *Options) {
		o.Authenticator = fixedAuthenticator{Principal{AccountID: "acct-1", Roles: []Role{RoleCustomer}}}
	})
	rt.Get("/v1/admin/refunds", Policy{Action: "refund.issue", Class: ClassRead}, counter.handler)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/admin/refunds", nil))

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
	if counter.entered != 0 {
		t.Error("the handler was entered without the required action")
	}
	body := decodeError(t, rec.Body.Bytes())
	if body.Code != CodeForbidden {
		t.Errorf("error code = %q, want FORBIDDEN", body.Code)
	}
	details, _ := body.Details.(map[string]any)
	if details["required"] != "refund.issue" {
		t.Errorf("403 should name the required action, got details %v", body.Details)
	}
}

// TestGuardAllowsAnExplicitlyPublicRoute proves the only door through is the one
// the registration opens.
func TestGuardAllowsAnExplicitlyPublicRoute(t *testing.T) {
	var counter entryCounter
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, counter.handler)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if counter.entered != 1 {
		t.Errorf("handler entered %d times, want 1", counter.entered)
	}
	var env struct {
		Data map[string]string `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("2xx body is not {\"data\": …}: %v", err)
	}
	if env.Data["ok"] != "true" {
		t.Errorf("data payload = %v", env.Data)
	}
}

func TestGuardAllowsAPrincipalHoldingTheAction(t *testing.T) {
	var counter entryCounter
	rt := testRouter(func(o *Options) {
		o.Authenticator = fixedAuthenticator{Principal{AccountID: "acct-1", Roles: []Role{RoleAdmin}}}
		o.Authorizer = allowAuthorizer{"refund.issue"}
	})
	rt.Get("/v1/admin/refunds", Policy{Action: "refund.issue", Class: ClassRead}, counter.handler)

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/admin/refunds", nil))

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if counter.entered != 1 {
		t.Errorf("handler entered %d times, want 1", counter.entered)
	}
}

type fixedAuthenticator struct{ p Principal }

func (f fixedAuthenticator) Authenticate(context.Context, *http.Request) (Principal, error) {
	return f.p, nil
}

type allowAuthorizer struct{ action Action }

func (a allowAuthorizer) RoleHasAction(_ []Role, want Action) bool { return want == a.action }

// ---------------------------------------------------------------------------
// Boot-time policy verification (I-06.1)
// ---------------------------------------------------------------------------

// TestVerifyRejectsAPolicylessRoute is P-06 acceptance criterion 1: a route with
// neither an Action nor Public fails the *boot*, not the first request.
func TestVerifyRejectsAPolicylessRoute(t *testing.T) {
	rt := testRouter()
	rt.Get("/v1/orders", Policy{Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})

	err := rt.Verify()
	if err == nil {
		t.Fatal("Verify accepted a route with neither Action nor Public")
	}
	if !strings.Contains(err.Error(), "/v1/orders") || !strings.Contains(err.Error(), "GET") {
		t.Errorf("error must name the offending method and path: %v", err)
	}
}

func TestVerifyRejectsIncoherentPolicies(t *testing.T) {
	cases := map[string]struct {
		policy Policy
		wantIn string
	}{
		"no class":               {Policy{Public: true}, "no RateClass"},
		"action and public":      {Policy{Action: "order.read", Public: true, Class: ClassRead}, "mutually exclusive"},
		"money not idempotent":   {Policy{Action: "order.create", Class: ClassMoney}, "I-37.4"},
		"neither action nor pub": {Policy{Class: ClassWrite}, "G-4"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			rt := testRouter()
			rt.Post("/x", tc.policy, func(http.ResponseWriter, *http.Request) {})

			err := rt.Verify()
			if err == nil {
				t.Fatalf("Verify accepted %+v", tc.policy)
			}
			if !strings.Contains(err.Error(), tc.wantIn) {
				t.Errorf("error should explain the rule (%q): %v", tc.wantIn, err)
			}
		})
	}
}

func TestVerifyAcceptsCoherentPolicies(t *testing.T) {
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})
	rt.Get("/v1/orders/{id}", Policy{Action: "order.read", Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})
	rt.Post("/v1/orders", Policy{Action: "order.create", Class: ClassMoney, Idempotent: true}, func(http.ResponseWriter, *http.Request) {})

	if err := rt.Verify(); err != nil {
		t.Fatalf("Verify rejected valid policies: %v", err)
	}
	public := rt.PublicRoutes()
	if len(public) != 1 || public[0] != "GET /health" {
		t.Errorf("PublicRoutes() = %v, want exactly [GET /health]", public)
	}
}

func TestVerifyRejectsAnEmptyRouteTable(t *testing.T) {
	if err := testRouter().Verify(); err == nil {
		t.Fatal("Verify accepted a router with no routes")
	}
}

func TestHandlePanicsOnDuplicateRegistration(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("registering the same method and pattern twice must panic")
		}
	}()
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})
}

func TestHandlePanicsOnLocalOnlyRouteOutsideLocal(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("a LocalOnly route must not be registerable outside local")
		}
	}()
	rt := testRouter(func(o *Options) { o.Env = "production" })
	rt.Get("/debug/deps", Policy{Public: true, Class: ClassRead, LocalOnly: true}, func(http.ResponseWriter, *http.Request) {})
}

// ---------------------------------------------------------------------------
// The rest of the chain
// ---------------------------------------------------------------------------

func TestMethodNotAllowedUsesTheErrorEnvelope(t *testing.T) {
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(w http.ResponseWriter, r *http.Request) {})

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/health", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
	if code := decodeError(t, rec.Body.Bytes()).Code; code != CodeMethodNotAllowed {
		t.Errorf("error code = %q, want METHOD_NOT_ALLOWED", code)
	}
}

// TestIdempotencyKeyIsRequiredOnMoneyRoutes covers P-37 acceptance criterion 4.
func TestIdempotencyKeyIsRequiredOnMoneyRoutes(t *testing.T) {
	var counter entryCounter
	rt := testRouter(func(o *Options) {
		o.Authenticator = fixedAuthenticator{Principal{AccountID: "acct-1", Roles: []Role{RoleCustomer}}}
		o.Authorizer = allowAuthorizer{"order.create"}
	})
	rt.Post("/v1/orders", Policy{Action: "order.create", Class: ClassMoney, Idempotent: true}, counter.handler)

	t.Run("missing", func(t *testing.T) {
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/orders", nil))

		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
		if code := decodeError(t, rec.Body.Bytes()).Code; code != CodeIdempotencyKeyRequired {
			t.Errorf("error code = %q, want IDEMPOTENCY_KEY_REQUIRED", code)
		}
		if counter.entered != 0 {
			t.Error("a money route ran without an idempotency key")
		}
	})

	t.Run("too short", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/orders", nil)
		req.Header.Set("Idempotency-Key", "short")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400 for a key under 16 characters", rec.Code)
		}
	})

	t.Run("accepted", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/orders", nil)
		req.Header.Set("Idempotency-Key", "01J8Z5N9K3QW7YB2VC4XD6EFGH")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
		}
		if counter.entered != 1 {
			t.Errorf("handler entered %d times, want 1", counter.entered)
		}
	})
}

func TestRequestIDIsGeneratedAndEchoed(t *testing.T) {
	rt := testRouter()
	var seen string
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(w http.ResponseWriter, r *http.Request) {
		seen = RequestIDFrom(r.Context())
		Respond(w, r, http.StatusOK, map[string]string{})
	})

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

	header := rec.Header().Get("X-Request-ID")
	if header == "" {
		t.Fatal("no X-Request-ID header")
	}
	if !validULID(header) {
		t.Errorf("X-Request-ID %q is not a ULID (G-8)", header)
	}
	if seen != header {
		t.Errorf("context request id %q differs from the header %q", seen, header)
	}
}

func TestRequestIDDiscardsAMalformedInboundValue(t *testing.T) {
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(w http.ResponseWriter, r *http.Request) {
		Respond(w, r, http.StatusOK, map[string]string{})
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("X-Request-ID", "'; DROP TABLE orders; --")
	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-ID"); got == "'; DROP TABLE orders; --" {
		t.Error("a client-supplied non-ULID request id was trusted into the response and the logs")
	}
}

func TestErrorBodyCarriesTheRequestID(t *testing.T) {
	rt := testRouter()
	rt.Get("/v1/orders", Policy{Action: "order.read", Class: ClassRead}, func(http.ResponseWriter, *http.Request) {})

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/orders", nil))

	body := decodeError(t, rec.Body.Bytes())
	if body.RequestID == "" {
		t.Error("error body has no request_id")
	}
	if body.RequestID != rec.Header().Get("X-Request-ID") {
		t.Error("error body request_id disagrees with the X-Request-ID header")
	}
}

func TestPanicBecomesA500AndNotADroppedConnection(t *testing.T) {
	rt := testRouter()
	rt.Get("/boom", Policy{Public: true, Class: ClassRead}, func(http.ResponseWriter, *http.Request) {
		panic("handler exploded")
	})

	rec := httptest.NewRecorder()
	rt.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
	if code := decodeError(t, rec.Body.Bytes()).Code; code != CodeInternalError {
		t.Errorf("error code = %q, want INTERNAL_ERROR", code)
	}
}

// TestCORSNeverEmitsAWildcard covers I-06.5 / P-06 acceptance criterion 5.
func TestCORSNeverEmitsAWildcard(t *testing.T) {
	rt := testRouter()
	rt.Get("/health", Policy{Public: true, Class: ClassRead}, func(w http.ResponseWriter, r *http.Request) {
		Respond(w, r, http.StatusOK, map[string]string{})
	})

	t.Run("disallowed origin gets no ACAO header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		req.Header.Set("Origin", "https://evil.example")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("Access-Control-Allow-Origin = %q for a disallowed origin, want absent", got)
		}
	})

	t.Run("allowed origin is echoed exactly", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		req.Header.Set("Origin", "http://localhost:5173")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)

		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
			t.Errorf("Access-Control-Allow-Origin = %q, want the exact origin", got)
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
			t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
		}
	})

	t.Run("preflight from a disallowed origin is refused", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodOptions, "/health", nil)
		req.Header.Set("Origin", "https://evil.example")
		req.Header.Set("Access-Control-Request-Method", "GET")
		rec := httptest.NewRecorder()
		rt.ServeHTTP(rec, req)

		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Error("a disallowed preflight received CORS headers")
		}
	})
}

func TestULIDsAreWellFormedAndTimeOrdered(t *testing.T) {
	seen := map[string]bool{}
	prev := ""
	for i := 0; i < 1000; i++ {
		id := NewULID()
		if !validULID(id) {
			t.Fatalf("NewULID produced %q, which is not a valid ULID", id)
		}
		if seen[id] {
			t.Fatalf("NewULID produced a duplicate: %q", id)
		}
		seen[id] = true
		// The timestamp prefix must be non-decreasing within a run.
		if prev != "" && id[:10] < prev[:10] {
			t.Fatalf("ULID timestamp prefix went backwards: %q then %q", prev, id)
		}
		prev = id
	}
}
