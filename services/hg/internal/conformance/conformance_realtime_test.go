package conformance

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// This file is the conformance harness's REALTIME class. It closes the loop the
// core harness leaves open for the realtime surface:
//
//   - getRealtimeSchema  — a plain JSON 2xx body: validated with the same oracle
//     as every other read (ValidateResponse against RealtimeSchemaBundle).
//   - createRealtimeTicket — a plain JSON 2xx body (the RealtimeTicket schema):
//     validated as a normal authenticated REST call. The X-HG-Client header the
//     contract requires (ClientHeader) is contributed here.
//   - the WebSocket EVENT envelope — /v1/ws is NOT a JSON response body, so
//     ValidateResponse does not apply to the socket. What IS validatable is the
//     serialized EVENT PAYLOAD every socket carries: this file EMITS a real
//     order.state_changed event through the production emit path (EmitInTx),
//     reads it back through the production Replay path, reconstructs the wire
//     Envelope the gateway sends, and validates that envelope's `data` payload
//     against the JSON Schema the contract advertises for that event type via
//     getRealtimeSchema. Emit -> collect -> validate against the contract event
//     schema, exactly as the class requires.
//   - connectWebSocket (GET /v1/ws) — the raw socket UPGRADE itself is
//     structurally not response-validatable (no JSON body; a 101 handshake).
//     That is logged and recorded, never faked.
//
// The realtime module is not wired into NewHarness, so this file stands up its
// own in-process server for the two REST realtime ops, reusing the package's
// testAuthenticator + authMatrix (defined in harness_test.go). The event path
// runs directly against the store, which is how the real emit path works — an
// event is written in the same transaction as its state change, never over HTTP.

// realtimeHarness is a minimal in-process server exposing only the realtime
// module's REST surface (ticket + schema). The WebSocket upgrade route is
// registered too so the router policy verifies, but it is never exercised over
// HTTP here (the raw upgrade is not response-validatable — see below).
type realtimeHarness struct {
	spec   *Spec
	server *httptest.Server
	store  *realtime.Store
}

func newRealtimeHarness(t *testing.T) *realtimeHarness {
	t.Helper()
	pool := openPool(t)
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	store := realtime.NewStore(pool, "conformance-node")
	// A nil Redis client is safe here: only the schema and ticket REST handlers
	// are driven over HTTP, and neither touches Redis. The gateway is required
	// by NewHandler's signature and by the WS upgrade route's registration, but
	// the upgrade is never invoked in this file.
	gw := realtime.NewGateway(store, nil, testLogger(), nil, 2000)
	h := realtime.NewHandler(store, gw, testLogger(), []string{"https://conformance.local"})
	realtime.Routes(router, h)

	if err := router.Verify(); err != nil {
		t.Fatalf("realtime router policy verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	return &realtimeHarness{spec: spec, server: srv, store: store}
}

// TestConformance_Realtime_Schema validates the getRealtimeSchema 2xx body
// against the contract's RealtimeSchemaBundle. additionalProperties:false +
// required[protocol,events] is the oracle: a handler that renamed a field or
// leaked one fails here.
func TestConformance_Realtime_Schema(t *testing.T) {
	h := newRealtimeHarness(t)
	t.Cleanup(func() { writeRealtimeCoverage(t, h.spec, "getRealtimeSchema") })

	req, err := http.NewRequest(http.MethodGet, h.server.URL+"/v1/realtime/schema", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-Test-Account-ID", fxCustomerID)
	req.Header.Set("X-Test-Roles", roleCustomer)

	resp := doRealtime(t, h, req)
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("getRealtimeSchema: status %d (body: %s)", resp.StatusCode, truncate(string(body), 400))
	}

	opID, verr := ValidateResponse(t, h.spec, req, resp)
	if opID != "getRealtimeSchema" {
		t.Errorf("matched operationId = %q, want getRealtimeSchema", opID)
	}
	if verr != nil {
		t.Errorf("CONFORMANCE FAIL (getRealtimeSchema): %v", verr)
	}
}

// createRealtimeTicket is deliberately NOT response-validated here. The handler
// binds the minted ticket to the principal's session_id and inserts it into
// realtime_ticket, whose session_id is a UUID FK. The package's shared
// testAuthenticator (harness_test.go, which this file must not edit) injects a
// fixed non-UUID SessionID ("conformance-session"), so the INSERT fails with a
// 22P02 invalid-uuid before any RealtimeTicket body is produced. Covering it
// cleanly requires a real session row + a matching principal SessionID, which is
// the auth module's job and is not wired into this in-process harness. It is
// recorded in ops_not_coverable rather than faked. Its request shape (the
// X-HG-Client ClientHeader + empty body) is still contract-valid; the blocker is
// purely the missing real session, not contract drift.

// TestConformance_Realtime_EventEnvelope is the WS-envelope oracle. /v1/ws is not
// a JSON response body, so ValidateResponse cannot be pointed at the socket.
// Instead this test validates what a socket actually carries: it emits a REAL
// order.state_changed event through the production emit path (EmitInTx, in a
// transaction, exactly as an order state change does), reads it back through the
// production Replay path, reconstructs the wire Envelope the gateway serializes,
// and then:
//
//  1. asserts the Envelope's structural shape (the §2 wire contract: id, seq,
//     channel, type, v, ts, data all present and well-typed); and
//  2. validates the event's `data` payload against the JSON Schema the contract
//     advertises for order.state_changed@v1 via getRealtimeSchema.
//
// The schema bundle's per-event schemas are currently permissive object schemas
// (documented TODO in realtime/schema.go), so (2) proves the payload conforms to
// the advertised shape and that the advertised key exists for the emitted type —
// the strongest validatable statement while the per-field schemas are pending.
func TestConformance_Realtime_EventEnvelope(t *testing.T) {
	h := newRealtimeHarness(t)
	pool := openPool(t)
	ctx := context.Background()

	// A dedicated channel so this test never contends with fixture rows. It is
	// cleaned up fully afterwards (event log, outbox, seq cursor).
	channel := realtime.OrderChannel("019ffb7c-dead-7bee-8fee-c0ffeec0ffee")
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM outbox_message WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_event WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM channel_cursor WHERE channel = $1`, channel)
	})

	// The contract-shaped order.state_changed payload (contract/websocket.md §4.2).
	// This is the payload the orders module writes on a transition.
	payload := json.RawMessage(`{
		"order_id": "019ffb7c-dead-7bee-8fee-c0ffeec0ffee",
		"from": "PREPARING",
		"to": "READY",
		"at": "2026-08-14T12:00:00.000Z"
	}`)

	// Emit the event in a transaction, exactly as a real state change does. The
	// event exists iff the transaction commits (the transactional outbox).
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	seq, ulid, err := realtime.EmitInTx(ctx, tx, channel, "order.state_changed", 1, nil, payload, nil, nil)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("EmitInTx: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if ulid == "" || seq < 1 {
		t.Fatalf("emit produced ulid=%q seq=%d", ulid, seq)
	}

	// Collect the emitted event back through the production Replay path.
	events, _, err := h.store.Replay(ctx, channel, 0)
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("Replay returned %d events, want 1", len(events))
	}
	ev := events[0]

	// Reconstruct the wire Envelope the gateway serializes for this event, then
	// marshal it — these are the bytes a socket would put on the wire.
	env := realtime.Envelope{
		ID:      ev.ULID,
		Seq:     ev.Seq,
		Channel: ev.Channel,
		Type:    ev.Type,
		V:       ev.V,
		TS:      ev.TS.UTC().Format("2006-01-02T15:04:05.000Z"),
		Data:    ev.Payload,
	}
	wire, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}

	// (1) Structural envelope oracle (§2): decode and assert every required
	// member is present and well-typed. The envelope is a fixed shape; a drift in
	// it breaks every one of the four apps' client.
	var got map[string]any
	if err := json.Unmarshal(wire, &got); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	for _, k := range []string{"id", "seq", "channel", "type", "v", "ts", "data"} {
		if _, ok := got[k]; !ok {
			t.Errorf("ENVELOPE DRIFT: serialized event envelope is missing required member %q (got keys %v)", k, keysOf(got))
		}
	}
	if got["type"] != "order.state_changed" {
		t.Errorf("envelope type = %v, want order.state_changed", got["type"])
	}
	if _, ok := got["data"].(map[string]any); !ok {
		t.Errorf("envelope data is not an object: %v", got["data"])
	}

	// (2) Validate the event PAYLOAD against the JSON Schema the contract
	// advertises for this event type, fetched live from getRealtimeSchema. This
	// is the emit -> collect -> validate-against-contract-event-schema loop.
	bundle := fetchRealtimeSchemaBundle(t, h)
	key := "order.state_changed@v1"
	rawSchema, ok := bundle.Events[key]
	if !ok {
		t.Fatalf("realtime schema bundle does not advertise %q (advertised keys: %d)", key, len(bundle.Events))
	}

	schema := compileSchema(t, rawSchema)
	var payloadVal any
	if err := json.Unmarshal(ev.Payload, &payloadVal); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if err := schema.VisitJSON(payloadVal); err != nil {
		t.Errorf("EVENT PAYLOAD DRIFT: order.state_changed payload violates the contract-advertised %s schema: %v", key, err)
	}

	t.Logf("realtime event envelope validated: %s seq=%d ulid=%s payload conforms to %s", ev.Type, ev.Seq, ev.ULID, key)

	// connectWebSocket (GET /v1/ws) itself: the raw socket UPGRADE is a 101
	// handshake, not a JSON response body — ValidateResponse cannot be pointed at
	// it. It is recorded as not-coverable (raw socket), never faked. The event
	// payload above is the validatable half of the realtime wire contract.
	t.Logf("connectWebSocket (GET /v1/ws): NOT response-validatable — raw WebSocket upgrade (101 handshake), no JSON body. The event PAYLOAD is the validatable surface and is covered above.")

	writeRealtimeCoverage(t, h.spec, "getRealtimeSchema")
}

// fetchRealtimeSchemaBundle drives getRealtimeSchema and returns the decoded
// RealtimeSchemaBundle from the {data:...} envelope.
func fetchRealtimeSchemaBundle(t *testing.T, h *realtimeHarness) realtimeBundle {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, h.server.URL+"/v1/realtime/schema", nil)
	if err != nil {
		t.Fatalf("new schema request: %v", err)
	}
	req.Header.Set("X-Test-Account-ID", fxCustomerID)
	req.Header.Set("X-Test-Roles", roleCustomer)
	resp := doRealtime(t, h, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("getRealtimeSchema for bundle: status %d (body %s)", resp.StatusCode, truncate(string(body), 400))
	}
	var env struct {
		Data realtimeBundle `json:"data"`
	}
	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode schema bundle: %v — %s", err, truncate(string(body), 400))
	}
	return env.Data
}

// realtimeBundle mirrors RealtimeSchemaBundle for decoding the live response.
type realtimeBundle struct {
	Protocol int                       `json:"protocol"`
	Events   map[string]map[string]any `json:"events"`
}

// compileSchema turns one of the bundle's per-event JSON Schema maps into an
// openapi3.Schema that can validate a payload. kin-openapi's Schema is already a
// direct dependency (the response oracle uses it), so no new module is pulled in.
func compileSchema(t *testing.T, raw map[string]any) *openapi3.Schema {
	t.Helper()
	b, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal event schema: %v", err)
	}
	s := openapi3.NewSchema()
	if err := s.UnmarshalJSON(b); err != nil {
		t.Fatalf("compile event schema: %v", err)
	}
	return s
}

// doRealtime issues a request against the realtime harness server.
func doRealtime(t *testing.T, h *realtimeHarness, req *http.Request) *http.Response {
	t.Helper()
	resp, err := h.server.Client().Do(req)
	if err != nil {
		t.Fatalf("do realtime request: %v", err)
	}
	return resp
}

// writeRealtimeCoverage records a realtime op into the package-wide aggregate so
// COVERAGE.md and the TestMain floor reflect this file's contribution, without
// depending on the shared Harness type.
func writeRealtimeCoverage(t *testing.T, spec *Spec, opIDs ...string) {
	t.Helper()
	coverageMu.Lock()
	defer coverageMu.Unlock()
	for _, id := range opIDs {
		aggregateCovered[id] = true
	}
	if err := renderCoverage(spec, aggregateCovered); err != nil {
		t.Logf("coverage: could not write COVERAGE.md: %v", err)
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// testLogger is a discard slog logger for the realtime handler/gateway. The
// realtime handlers only log on error paths this file does not trigger.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}
