package conformance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/admin"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/rider"
)

// openPool returns a pgx pool against HG_TEST_POSTGRES_DSN or skips the test.
// The conformance harness needs a migrated, seeded Postgres because it drives
// real read handlers whose responses are the bytes under test. Without a DB the
// harness cannot observe live drift, so it skips loudly rather than passing.
func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set — conformance harness needs a live migrated Postgres")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// testAuthenticator injects a Principal from two test headers, so a single
// server can act as any role without minting JWTs. This mirrors the
// fixedPrincipalAuth pattern the admin tests already use, but per-request:
//   - X-Test-Account-ID: the caller's account UUID.
//   - X-Test-Roles: comma-separated role names.
//
// With neither header the caller is anonymous (deny-by-default still holds:
// the authorizer decides). It is only ever wired into an in-process test
// server, never the real boot path.
type testAuthenticator struct{}

func (testAuthenticator) Authenticate(_ context.Context, r *http.Request) (httpx.Principal, error) {
	acct := r.Header.Get("X-Test-Account-ID")
	rolesHdr := r.Header.Get("X-Test-Roles")
	if acct == "" && rolesHdr == "" {
		return httpx.AnonymousPrincipal(), nil
	}
	var roles []httpx.Role
	for _, part := range strings.Split(rolesHdr, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			roles = append(roles, httpx.Role(part))
		}
	}
	return httpx.Principal{
		AccountID: acct,
		// A valid UUID: the audit trail persists session_id into a `uuid` column,
		// and admin write handlers append an audit row synchronously. A non-UUID
		// placeholder here would make every audited admin write 500 on the cast —
		// an artefact of the harness, not contract drift. Production always mints a
		// real UUID session, so a fixed valid UUID here mirrors that.
		SessionID: "00000000-0000-4000-8000-0000c0f0face",
		Roles:     roles,
		AMR:       []string{"pwd+totp"},
	}, nil
}

// credentialAuthenticator is testAuthenticator plus X-Test-Credential: the access
// token of a session the test opened, for the writers that check the session in
// the database themselves (a staff account action, migration 00045).
type credentialAuthenticator struct{ testAuthenticator }

func (a credentialAuthenticator) Authenticate(ctx context.Context, r *http.Request) (httpx.Principal, error) {
	p, err := a.testAuthenticator.Authenticate(ctx, r)
	if c := r.Header.Get("X-Test-Credential"); err == nil && !p.Anonymous && c != "" {
		p = p.WithCredential(c)
	}
	return p, err
}

// authMatrix returns the production role→action authorizer, so authz behaves
// exactly as it does in the running server.
func authMatrix() httpx.Authorizer { return auth.Matrix{} }

// Harness is a live in-process server wired with the real chi routers for the
// modules whose read paths carry the known drift. It reuses the production
// module constructors (the same ones cmd/hg/main.go calls), so the bytes it
// validates are the bytes the real server emits.
type Harness struct {
	Pool   *pgxpool.Pool
	Server *httptest.Server
	Spec   *Spec

	// covered records every operationId the harness successfully matched and
	// validated (i.e. ValidateResponse ran, whether it passed or failed).
	covered map[string]bool
}

// NewHarness builds the multi-module router and starts an httptest server.
// Read-only gateways/adapters are nil where the module tolerates it (orders and
// restaurant both accept a nil payment gateway and only 503/log on the money
// path, which the read operations under test never reach).
func NewHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	// Catalogue & discovery (public browse + owner menu). Media resolver nil →
	// images render as null (contract-legal). Scope resolver reads account_role.
	catalogRepo := catalog.NewRepo(pool)
	catalog.Routes(router, catalog.NewHandler(
		catalogRepo, nil, nil, catalog.NewPgScopeResolver(catalogRepo)))

	// Cart & customer orders. Nil gateway → the honest unwired gateway (503 on
	// the money mutation only); the read paths under test (getCart, getOrder)
	// never touch it.
	ordersStore := orders.NewStore(pool)
	orders.Routes(router, orders.NewHandler(ordersStore, nil, nil))

	// Restaurant partner portal (profile, hours, orders, menu — the drift
	// epicentre). Nil scope + nil pay: reads resolve scope via SQL/ownership;
	// pay side-effects are logged and skipped when nil.
	restaurant.Routes(router, restaurant.NewHandler(restaurant.NewRepo(pool), nil, nil))

	// Rider self-service.
	rider.Routes(router, rider.NewHandler(rider.NewService(rider.NewRepo(pool))))

	// Account self-service and delivery addresses.
	account.Routes(router, account.NewHandler(account.NewRepo(pool)))
	addresses.Routes(router, addresses.NewHandler(addresses.NewRepo(pool)))

	// Admin (orders oversight, menu review).
	admin.Routes(router, admin.NewHandler(admin.NewRepo(pool), admin.DefaultConfig()))

	if err := router.Verify(); err != nil {
		t.Fatalf("router policy verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// Request describes one live call the harness will issue and then validate.
type Request struct {
	Method    string
	Path      string // e.g. /v1/cart, /v1/restaurant/orders/<uuid>
	AccountID string // "" → anonymous
	Roles     []string
	Body      any    // marshaled to JSON when non-nil
	IdemKey   string // sets Idempotency-Key when non-nil
	Query     string // raw query string (without leading ?)
	// Credential is the caller's access token, for the operations whose database
	// writer checks the session itself (a staff account action, migration 00045).
	Credential string
}

// Do issues the request against the live server and returns the outgoing
// *http.Request and the *http.Response, both suitable for ValidateResponse /
// ValidateRequest. The response body is left readable.
func (h *Harness) Do(t *testing.T, rq Request) (*http.Request, *http.Response) {
	t.Helper()
	req := h.Build(t, rq)
	resp, err := h.Server.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	return req, resp
}

// Build constructs the *http.Request for rq without sending it, with a
// re-readable body (GetBody set). Use this when the request itself must be
// validated (ValidateRequest) before or without issuing it, since Client.Do
// consumes the body.
func (h *Harness) Build(t *testing.T, rq Request) *http.Request {
	t.Helper()
	var raw []byte
	if rq.Body != nil {
		b, err := json.Marshal(rq.Body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		raw = b
	}
	url := h.Server.URL + rq.Path
	if rq.Query != "" {
		url += "?" + rq.Query
	}
	var bodyReader io.Reader
	if raw != nil {
		bodyReader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(rq.Method, url, bodyReader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if raw != nil {
		req.Header.Set("Content-Type", "application/json")
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(raw)), nil
		}
	}
	if rq.AccountID != "" {
		req.Header.Set("X-Test-Account-ID", rq.AccountID)
	}
	if len(rq.Roles) > 0 {
		req.Header.Set("X-Test-Roles", strings.Join(rq.Roles, ","))
	}
	if rq.IdemKey != "" {
		req.Header.Set("Idempotency-Key", rq.IdemKey)
	}
	if rq.Credential != "" {
		req.Header.Set("X-Test-Credential", rq.Credential)
	}
	return req
}

// CheckResponse issues a request, validates the live 2xx body against the
// contract, records coverage for the matched operation, and reports the outcome.
// It fails the subtest on a validation error (that is the whole point: a
// non-conformant response must fail the gate). It returns the operationId and
// whether it conformed.
//
// wantStatus lets the caller assert the handler reached the intended state
// (e.g. 200). A status mismatch is reported but validation still runs so drift
// on an unexpected status is still surfaced.
func (h *Harness) CheckResponse(t *testing.T, rq Request, wantStatus int) (opID string, conformed bool) {
	t.Helper()
	req, resp := h.Do(t, rq)
	defer resp.Body.Close()

	if wantStatus != 0 && resp.StatusCode != wantStatus {
		body, _ := io.ReadAll(resp.Body)
		resp.Body = io.NopCloser(bytes.NewReader(body))
		t.Errorf("%s %s: status = %d, want %d (body: %s)",
			rq.Method, rq.Path, resp.StatusCode, wantStatus, truncate(string(body), 400))
	}

	id, err := ValidateResponse(t, h.Spec, req, resp)
	if id != "" {
		h.covered[id] = true
	}
	if err != nil {
		t.Errorf("CONFORMANCE FAIL: %v", err)
		return id, false
	}
	return id, true
}

// MarkCovered records that an operation was exercised even when the caller
// validated it directly (used for request-only or error-path coverage).
func (h *Harness) MarkCovered(opID string) {
	if opID != "" {
		h.covered[opID] = true
	}
}

// Covered returns the set of operationIds the harness validated.
func (h *Harness) Covered() map[string]bool {
	out := make(map[string]bool, len(h.covered))
	for k, v := range h.covered {
		out[k] = v
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// mustJSON decodes a response body into a generic map for ad-hoc assertions.
func mustJSONMap(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	body, _ := io.ReadAll(resp.Body)
	resp.Body = io.NopCloser(bytes.NewReader(body))
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode body: %v — %s", err, truncate(string(body), 400))
	}
	return m
}

// dataObject pulls the {data:{...}} object from a 2xx envelope.
func dataObject(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	env := mustJSONMap(t, resp)
	d, ok := env["data"].(map[string]any)
	if !ok {
		t.Fatalf("envelope data is not an object: %v", env)
	}
	return d
}

var _ = fmt.Sprintf
