package orders

// ordersread_boundary_test.go — STAGE 3 boundary & leak analysis for FEATURE
// 'ordersread' (getOrderTracking, getOrderReceipt, getOrderRiderPublicProfile).
//
// These tests close the gaps the RED/GREEN suite left open. They are deliberately
// adversarial: they assume the implementation leaks and force it to prove it does
// not. Categories (per the STAGE-3 brief):
//
//   A) CONTRACT CONFORMANCE — closed-shape (golden) assertions: the response
//      carries EXACTLY the contract's field set at every level, correct types,
//      closed enums, correct nullability. The RED suite decoded into partial
//      structs, so an extra leaked field would have passed unnoticed; these
//      tests fail on any unexpected key.
//   B) AUTHZ LEAK — each x-role (CUSTOMER) is allowed on every op; each
//      non-x-role (RIDER, ADMIN) is denied 403; the routes are never public;
//      the actions are contract-derived (CUSTOMER-only).
//   C) DATA ISOLATION / IDOR — a stranger's read returns 404 and the body
//      leaks no field of the real resource.
//   D) MONEY — the receipt's cents fields are integers (no float in the wire),
//      server-computed, and decompose to zero residual.
//   F) CONCURRENCY / IDEMPOTENCY — reads run twice and concurrently produce
//      byte-identical bodies with no side effect.
//   G) ERROR TAXONOMY — every expected failure carries a contract ErrorCode,
//      never a bare 500.

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ---- closed-shape helpers --------------------------------------------------

// keysOf returns the sorted JSON object keys of a decoded map.
func keysOf(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// assertExactKeys fails when the object's key set differs from want in either
// direction (extra field leaked OR required field missing).
func assertExactKeys(t *testing.T, where string, obj map[string]json.RawMessage, want []string) {
	t.Helper()
	got := keysOf(obj)
	wantSorted := append([]string(nil), want...)
	sort.Strings(wantSorted)
	if strings.Join(got, ",") != strings.Join(wantSorted, ",") {
		t.Errorf("%s: key set mismatch\n  got:  %v\n  want: %v", where, got, wantSorted)
	}
}

// decodeData decodes the {"data": {...}} envelope into a raw key map.
func decodeData(t *testing.T, body []byte) map[string]json.RawMessage {
	t.Helper()
	var env struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode envelope: %v (body: %s)", err, body)
	}
	if env.Data == nil {
		t.Fatalf("response has no data object (body: %s)", body)
	}
	return env.Data
}

// decodeObject decodes a raw sub-object into a key map.
func decodeObject(t *testing.T, raw json.RawMessage, where string) map[string]json.RawMessage {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("%s: not an object: %v (raw: %s)", where, err, raw)
	}
	return m
}

// isJSONNull reports whether a raw message is literal null.
func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

// customerRouter builds a router authenticated as the given account (CUSTOMER).
func customerRouter(t *testing.T, pool *pgxpool.Pool, accountID string) *httpx.Router {
	t.Helper()
	r := httpx.NewRouter(httpx.Options{
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		Env:           "test",
		Authenticator: customerAuthenticator{accountID: accountID},
		Authorizer:    auth.Matrix{},
	})
	h := NewHandler(NewStore(pool), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	Routes(r, h)
	return r
}

func doGET(t *testing.T, r *httpx.Router, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// The closed contract key sets, transcribed from contracts/openapi.yaml and the
// reference fixtures in contracts/fixtures/orders/.
var (
	orderTrackingKeys = []string{
		"order_id", "state", "dispatch_state", "eta_at", "eta_window_minutes",
		"restaurant_location", "destination_location", "rider_location", "rider", "timeline",
	}
	geoPointKeys        = []string{"latitude", "longitude"}
	riderLocationKeys   = []string{"latitude", "longitude", "heading_deg", "speed_mps", "accuracy_m", "recorded_at", "is_coarse"}
	riderProfileKeys    = []string{"first_name", "last_initial", "photo_url", "vehicle_type", "rating_avg"}
	orderTransitionKeys = []string{"from_state", "to_state", "actor_kind", "reason", "at"}

	orderStateEnum = map[string]bool{
		"CREATED": true, "AUTHORIZED": true, "RESTAURANT_PENDING": true, "PREPARING": true,
		"READY_FOR_PICKUP": true, "PICKED_UP": true, "ARRIVED": true, "DELIVERED": true,
		"COMPLETED": true, "CANCELLED": true, "REJECTED": true, "FAILED": true,
		"DISPUTED": true, "RESOLVED": true,
	}
	orderActorKindEnum = map[string]bool{
		"CUSTOMER": true, "RESTAURANT": true, "RIDER": true, "SUPPORT": true, "ADMIN": true, "SYSTEM": true,
	}
	vehicleTypeEnum = map[string]bool{
		"CAR": true, "SCOOTER": true, "MOTORCYCLE": true, "BICYCLE": true, "ON_FOOT": true,
	}
	dispatchStateEnum = map[string]bool{
		"PENDING": true, "SEARCHING": true, "OFFERED": true, "ASSIGNED": true, "AT_RESTAURANT": true,
		"CARRYING": true, "AT_CUSTOMER": true, "COMPLETED": true, "UNASSIGNED": true, "NO_RIDER_FOUND": true,
	}
)

// ============================================================================
// A) CONTRACT CONFORMANCE — closed-shape golden assertions
// ============================================================================

// TestBoundaryTrackingClosedShapePreparing asserts the tracking response before
// pickup has EXACTLY the OrderTracking field set, null rider/rider_location, and
// closed enums — no extra field may leak.
func TestBoundaryTrackingClosedShapePreparing(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())
	assertExactKeys(t, "OrderTracking", data, orderTrackingKeys)

	// state is a closed OrderState enum member.
	var state string
	decodeJSON(t, data["state"], &state)
	if !orderStateEnum[state] {
		t.Errorf("state %q not in OrderState enum", state)
	}
	// restaurant_location is a closed GeoPoint.
	assertExactKeys(t, "restaurant_location", decodeObject(t, data["restaurant_location"], "restaurant_location"), geoPointKeys)

	// Before pickup: rider and rider_location MUST be null (C-32).
	if !isJSONNull(data["rider_location"]) {
		t.Errorf("rider_location must be null before pickup, got %s", data["rider_location"])
	}
	if !isJSONNull(data["rider"]) {
		t.Errorf("rider must be null before pickup, got %s", data["rider"])
	}

	// timeline entries are closed OrderTransition objects with closed enums.
	var timeline []json.RawMessage
	decodeJSON(t, data["timeline"], &timeline)
	if len(timeline) == 0 {
		t.Fatal("timeline must contain at least the CREATED transition")
	}
	for i, raw := range timeline {
		tr := decodeObject(t, raw, "timeline entry")
		assertExactKeys(t, "OrderTransition", tr, orderTransitionKeys)
		var toState, actorKind string
		decodeJSON(t, tr["to_state"], &toState)
		decodeJSON(t, tr["actor_kind"], &actorKind)
		if !orderStateEnum[toState] {
			t.Errorf("timeline[%d].to_state %q not in OrderState enum", i, toState)
		}
		if !orderActorKindEnum[actorKind] {
			t.Errorf("timeline[%d].actor_kind %q not in OrderActorKind enum", i, actorKind)
		}
		// from_state is nullable-but-present; when non-null it must be a valid enum.
		if !isJSONNull(tr["from_state"]) {
			var fromState string
			decodeJSON(t, tr["from_state"], &fromState)
			if !orderStateEnum[fromState] {
				t.Errorf("timeline[%d].from_state %q not in OrderState enum", i, fromState)
			}
		}
	}
	// dispatch_state, when present and non-null, is a closed DispatchState.
	if ds, ok := data["dispatch_state"]; ok && !isJSONNull(ds) {
		var s string
		decodeJSON(t, ds, &s)
		if !dispatchStateEnum[s] {
			t.Errorf("dispatch_state %q not in DispatchState enum", s)
		}
	}
}

// TestBoundaryTrackingClosedShapePickedUp asserts the picked-up response exposes
// exactly the rider_location and rider sub-objects with their closed key sets and
// is_coarse=false for a precise fix (the customer projection is precise).
func TestBoundaryTrackingClosedShapePickedUp(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())
	assertExactKeys(t, "OrderTracking", data, orderTrackingKeys)

	// rider_location: closed RiderLocation shape, is_coarse present.
	if isJSONNull(data["rider_location"]) {
		t.Fatal("rider_location must be present in PICKED_UP")
	}
	rl := decodeObject(t, data["rider_location"], "rider_location")
	assertExactKeys(t, "RiderLocation", rl, riderLocationKeys)

	// The seed uses accuracy_m=12 (< 100 m) → precise → is_coarse=false.
	var isCoarse bool
	decodeJSON(t, rl["is_coarse"], &isCoarse)
	if isCoarse {
		t.Error("is_coarse must be false for a precise (12 m) fix on the customer projection")
	}
	// recorded_at is a string timestamp.
	var recordedAt string
	decodeJSON(t, rl["recorded_at"], &recordedAt)
	if recordedAt == "" {
		t.Error("rider_location.recorded_at must be a non-empty timestamp")
	}

	// rider: closed RiderPublicProfile shape with a closed VehicleType and no PII.
	if isJSONNull(data["rider"]) {
		t.Fatal("rider must be present in PICKED_UP")
	}
	rp := decodeObject(t, data["rider"], "rider")
	assertExactKeys(t, "RiderPublicProfile", rp, riderProfileKeys)
	var vt string
	decodeJSON(t, rp["vehicle_type"], &vt)
	if !vehicleTypeEnum[vt] {
		t.Errorf("rider.vehicle_type %q not in VehicleType enum", vt)
	}
	var lastInitial string
	decodeJSON(t, rp["last_initial"], &lastInitial)
	if len(lastInitial) > 1 {
		t.Errorf("rider.last_initial maxLength=1, got %q", lastInitial)
	}
}

// TestBoundaryTrackingCoarseWhenGPSDegraded asserts is_coarse=true when the
// rider's fix is low-quality (accuracy worse than ~100 m), matching the
// tracking_degraded_gps fixture. This proves the field is computed, not a
// hard-coded constant.
func TestBoundaryTrackingCoarseWhenGPSDegraded(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")

	// Overwrite the seeded position with a degraded fix: 180 m accuracy, no
	// heading/speed — exactly the tracking_degraded_gps fixture shape.
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		UPDATE rider_position
		   SET accuracy_m = 180.0, heading_deg = NULL, speed_mps = NULL
		 WHERE account_id = $1`, seed.riderAccountID)
	if err != nil {
		t.Fatalf("degrade rider_position: %v", err)
	}

	r := customerRouter(t, pool, seed.ownerAccountID)
	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())
	rl := decodeObject(t, data["rider_location"], "rider_location")
	assertExactKeys(t, "RiderLocation", rl, riderLocationKeys)

	var isCoarse bool
	decodeJSON(t, rl["is_coarse"], &isCoarse)
	if !isCoarse {
		t.Error("is_coarse must be true when accuracy_m=180 (>100 m); the field must be computed from the fix")
	}
}

// TestBoundaryReceiptClosedShape asserts the receipt response carries exactly the
// Receipt field set and closed sub-objects, with no extra field leaking through
// the frozen snapshot re-marshal.
func TestBoundaryReceiptClosedShape(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "COMPLETED")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/receipt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())

	receiptKeys := []string{
		"order_id", "order_code", "receipt_number", "issued_at",
		"platform_legal_name", "platform_tax_registration_number",
		"restaurant_legal_name", "restaurant_tax_registration_number",
		"delivery_address", "lines", "money", "payment", "refunds",
		"placed_at", "delivered_at",
	}
	assertExactKeys(t, "Receipt", data, receiptKeys)

	// money sub-object: exact key set (no float leak — asserted below in the
	// money category test).
	money := decodeObject(t, data["money"], "money")
	moneyKeys := []string{
		"subtotal_cents", "discount_cents", "delivery_fee_cents", "service_fee_cents",
		"tax_lines", "tax_total_cents", "tip_cents", "total_cents", "currency",
	}
	assertExactKeys(t, "OrderMoney", money, moneyKeys)

	// payment sub-object: exact ReceiptPayment key set.
	payment := decodeObject(t, data["payment"], "payment")
	assertExactKeys(t, "ReceiptPayment", payment,
		[]string{"card_brand", "card_last4", "wallet", "amount_charged_cents", "currency"})

	// each line: exact OrderLine key set.
	var lines []json.RawMessage
	decodeJSON(t, data["lines"], &lines)
	if len(lines) == 0 {
		t.Fatal("receipt.lines must not be empty")
	}
	lineKeys := []string{
		"line_no", "menu_item_id", "name", "variant_name", "variants", "addons",
		"quantity", "special_request", "unit_price_cents", "line_total_cents", "currency",
	}
	for i, raw := range lines {
		assertExactKeys(t, "OrderLine["+string(rune('0'+i))+"]", decodeObject(t, raw, "line"), lineKeys)
	}
}

// TestBoundaryRiderProfileClosedShape asserts the standalone rider endpoint
// returns exactly the RiderPublicProfile field set with a closed VehicleType.
func TestBoundaryRiderProfileClosedShape(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/rider")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())
	assertExactKeys(t, "RiderPublicProfile", data, riderProfileKeys)

	var vt string
	decodeJSON(t, data["vehicle_type"], &vt)
	if !vehicleTypeEnum[vt] {
		t.Errorf("vehicle_type %q not in VehicleType enum", vt)
	}
}

// ============================================================================
// B) AUTHZ — positive (x-role allowed) + policy not public + action derived
// ============================================================================

// TestBoundaryCustomerAllowedOnAllReadOps asserts the CUSTOMER x-role is admitted
// (never 401/403) on all three ops. Combined with the RIDER/ADMIN 403 tests in
// ordersread_test.go this proves the full x-roles matrix for each op.
func TestBoundaryCustomerAllowedOnAllReadOps(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")
	r := customerRouter(t, pool, seed.ownerAccountID)

	for _, path := range []string{
		"/v1/orders/" + seed.orderID + "/tracking",
		"/v1/orders/" + seed.orderID + "/receipt", // PICKED_UP → 409 RECEIPT_NOT_READY, not an authz denial
		"/v1/orders/" + seed.orderID + "/rider",
	} {
		rec := doGET(t, r, path)
		if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
			t.Errorf("CUSTOMER must be admitted on %s, got %d (authz leak)", path, rec.Code)
		}
	}
}

// TestBoundaryReadOpsNeverPublic asserts none of the three routes is public and
// the router's policies verify. Deny-by-default: the contract marks none PUBLIC.
func TestBoundaryReadOpsNeverPublic(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	h := NewHandler(nil, nil, slog.Default())
	Routes(r, h)
	if err := r.Verify(); err != nil {
		t.Fatalf("route policies defective: %v", err)
	}
	public := make(map[string]bool)
	for _, p := range r.PublicRoutes() {
		public[p] = true
	}
	for _, route := range []string{
		"GET /v1/orders/{orderId}/tracking",
		"GET /v1/orders/{orderId}/receipt",
		"GET /v1/orders/{orderId}/rider",
	} {
		if public[route] {
			t.Errorf("route %q must NOT be public (deny-by-default)", route)
		}
	}
}

// TestBoundaryActionsAreCustomerOnly asserts the three new actions are granted to
// CUSTOMER and to no other role in the reconciled matrix (contract x-roles=[CUSTOMER]).
func TestBoundaryActionsAreCustomerOnly(t *testing.T) {
	m := auth.Matrix{}
	actions := []httpx.Action{
		ActionOrderTrackingRead, ActionOrderReceiptRead, ActionOrderRiderProfileRead,
	}
	// Every closed member of the Role enum.
	allRoles := []httpx.Role{
		httpx.RoleCustomer, httpx.RoleRider, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager,
		httpx.RoleRestaurantStaff, httpx.RoleSupportAgent, httpx.RoleAdmin, httpx.RoleSuperAdmin,
	}
	for _, a := range actions {
		for _, role := range allRoles {
			allowed := m.RoleHasAction([]httpx.Role{role}, a)
			if role == httpx.RoleCustomer && !allowed {
				t.Errorf("CUSTOMER must be granted %q", a)
			}
			if role != httpx.RoleCustomer && allowed {
				t.Errorf("role %q must NOT be granted %q (x-roles=[CUSTOMER] only)", role, a)
			}
		}
	}
}

// ============================================================================
// C) DATA ISOLATION / IDOR — 404 body leaks nothing
// ============================================================================

// TestBoundaryIDORLeaksNoField asserts that when a stranger reads someone else's
// order, the 404 body is a bare error envelope carrying no field of the real
// resource (no rider name, no order code, no money).
func TestBoundaryIDORLeaksNoField(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")

	stranger := customerRouter(t, pool, "00000000-0000-0000-0000-000000000002")
	for _, path := range []string{
		"/v1/orders/" + seed.orderID + "/tracking",
		"/v1/orders/" + seed.orderID + "/receipt",
		"/v1/orders/" + seed.orderID + "/rider",
	} {
		rec := doGET(t, stranger, path)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404 for a stranger (IDOR)", path, rec.Code)
		}
		body := rec.Body.String()
		if c := errCode(t, rec.Body.Bytes()); c != "NOT_FOUND" {
			t.Errorf("%s: error code = %q, want NOT_FOUND", path, c)
		}
		// The body must not leak the real order/rider identity or money.
		for _, leak := range []string{
			seed.orderID, "Bilal", "SCOOTER", `"total_cents"`, `"rider"`, `"receipt_number"`, `"latitude"`,
		} {
			if strings.Contains(body, leak) {
				t.Errorf("%s: 404 body leaks %q of the real resource: %s", path, leak, body)
			}
		}
	}
}

// ============================================================================
// D) MONEY — receipt cents are integers, no float, zero residual
// ============================================================================

// TestBoundaryReceiptMoneyIsIntegerCents asserts every *_cents value on the wire
// is a JSON integer (no decimal point, no exponent) — money is int64 minor units,
// never a float — and the decomposition balances to zero residual (P-10).
func TestBoundaryReceiptMoneyIsIntegerCents(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "COMPLETED")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/receipt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())

	assertIntCents := func(where string, raw json.RawMessage) int64 {
		s := strings.TrimSpace(string(raw))
		if strings.ContainsAny(s, ".eE") {
			t.Errorf("%s = %s must be an integer number of cents (no float on the wire)", where, s)
		}
		var n int64
		if err := json.Unmarshal(raw, &n); err != nil {
			t.Errorf("%s = %s is not an int64: %v", where, s, err)
		}
		return n
	}

	money := decodeObject(t, data["money"], "money")
	subtotal := assertIntCents("money.subtotal_cents", money["subtotal_cents"])
	discount := assertIntCents("money.discount_cents", money["discount_cents"])
	delivery := assertIntCents("money.delivery_fee_cents", money["delivery_fee_cents"])
	service := assertIntCents("money.service_fee_cents", money["service_fee_cents"])
	tax := assertIntCents("money.tax_total_cents", money["tax_total_cents"])
	tip := assertIntCents("money.tip_cents", money["tip_cents"])
	total := assertIntCents("money.total_cents", money["total_cents"])

	if got := subtotal - discount + delivery + service + tax + tip; got != total {
		t.Errorf("money does not decompose to zero residual: %d != total %d", got, total)
	}

	// Each line's cents fields are integers too.
	var lines []json.RawMessage
	decodeJSON(t, data["lines"], &lines)
	for i, raw := range lines {
		ln := decodeObject(t, raw, "line")
		assertIntCents("lines["+string(rune('0'+i))+"].unit_price_cents", ln["unit_price_cents"])
		assertIntCents("lines["+string(rune('0'+i))+"].line_total_cents", ln["line_total_cents"])
	}

	// Payment amount is integer cents.
	payment := decodeObject(t, data["payment"], "payment")
	assertIntCents("payment.amount_charged_cents", payment["amount_charged_cents"])
}

// ============================================================================
// F) CONCURRENCY / IDEMPOTENCY — reads are side-effect-free and stable
// ============================================================================

// TestBoundaryReceiptConcurrentReadsIdentical fires the receipt read from many
// goroutines at once and asserts every body is byte-identical (no double effect,
// no snapshot mutation under concurrency).
func TestBoundaryReceiptConcurrentReadsIdentical(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "COMPLETED")
	r := customerRouter(t, pool, seed.ownerAccountID)

	const n = 16
	bodies := make([][]byte, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/receipt")
			if rec.Code != http.StatusOK {
				t.Errorf("goroutine %d: status = %d, want 200", i, rec.Code)
				return
			}
			bodies[i] = append([]byte(nil), rec.Body.Bytes()...)
		}(i)
	}
	wg.Wait()

	first := string(bodies[0])
	for i := 1; i < n; i++ {
		if string(bodies[i]) != first {
			t.Fatalf("concurrent receipt read %d differs from read 0 (immutability under concurrency broken)", i)
		}
	}
}

// TestBoundaryTrackingConcurrentReadsStable fires tracking reads concurrently and
// asserts the state/order_id are stable (read op has no write side effect).
func TestBoundaryTrackingConcurrentReadsStable(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PICKED_UP")
	r := customerRouter(t, pool, seed.ownerAccountID)

	const n = 16
	states := make([]string, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
			if rec.Code != http.StatusOK {
				t.Errorf("goroutine %d: status = %d, want 200", i, rec.Code)
				return
			}
			data := decodeData(t, rec.Body.Bytes())
			var s string
			_ = json.Unmarshal(data["state"], &s)
			states[i] = s
		}(i)
	}
	wg.Wait()

	for i := 1; i < n; i++ {
		if states[i] != states[0] {
			t.Fatalf("tracking state unstable under concurrency: %q != %q", states[i], states[0])
		}
	}
}

// ============================================================================
// G) ERROR TAXONOMY — every expected failure carries a contract ErrorCode
// ============================================================================

// TestBoundaryReceiptNotReadyErrorCode asserts an order without a receipt yields
// 409 with the contract RECEIPT_NOT_READY code — never a bare 500.
func TestBoundaryReceiptNotReadyErrorCode(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING")
	r := customerRouter(t, pool, seed.ownerAccountID)

	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/receipt")
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for an order without a receipt (body: %s)", rec.Code, rec.Body.String())
	}
	if c := errCode(t, rec.Body.Bytes()); c != "RECEIPT_NOT_READY" {
		t.Errorf("code = %q, want RECEIPT_NOT_READY", c)
	}
}

// TestBoundaryNoBare500OnAllFailures sweeps the failure surface of the three ops
// (nonexistent id, malformed id, wrong owner, wrong state) and asserts none
// produces a bare 500 and every error body carries a code from the contract set.
func TestBoundaryNoBare500OnAllFailures(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING") // no rider, no receipt yet
	owner := customerRouter(t, pool, seed.ownerAccountID)
	stranger := customerRouter(t, pool, "00000000-0000-0000-0000-000000000002")

	contractCodes := map[string]bool{
		"NOT_FOUND": true, "RECEIPT_NOT_READY": true, "VALIDATION_FAILED": true,
	}

	type call struct {
		name   string
		r      *httpx.Router
		path   string
		expect int
	}
	calls := []call{
		{"tracking/nonexistent", owner, "/v1/orders/" + nonExistentOrderID + "/tracking", http.StatusNotFound},
		{"receipt/nonexistent", owner, "/v1/orders/" + nonExistentOrderID + "/receipt", http.StatusNotFound},
		{"rider/nonexistent", owner, "/v1/orders/" + nonExistentOrderID + "/rider", http.StatusNotFound},
		{"receipt/not-ready", owner, "/v1/orders/" + seed.orderID + "/receipt", http.StatusConflict},
		{"rider/before-pickup", owner, "/v1/orders/" + seed.orderID + "/rider", http.StatusNotFound},
		{"tracking/idor", stranger, "/v1/orders/" + seed.orderID + "/tracking", http.StatusNotFound},
		{"receipt/idor", stranger, "/v1/orders/" + seed.orderID + "/receipt", http.StatusNotFound},
		{"rider/idor", stranger, "/v1/orders/" + seed.orderID + "/rider", http.StatusNotFound},
	}
	for _, c := range calls {
		rec := doGET(t, c.r, c.path)
		if rec.Code >= 500 {
			t.Errorf("%s: bare %d — read ops must never 500 (body: %s)", c.name, rec.Code, rec.Body.String())
			continue
		}
		if rec.Code != c.expect {
			t.Errorf("%s: status = %d, want %d (body: %s)", c.name, rec.Code, c.expect, rec.Body.String())
		}
		code := errCode(t, rec.Body.Bytes())
		if !contractCodes[code] {
			t.Errorf("%s: error code %q is not a contract ErrorCode", c.name, code)
		}
	}
}
