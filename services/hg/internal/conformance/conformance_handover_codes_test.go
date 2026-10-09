package conformance

// Handover codes — the pickup code and the delivery code, end to end against a
// live migrated Postgres, every response validated against the contract.
//
// Contract: contracts/README.md, "Neither code can be bypassed" (security review
// on https://github.com/shaiknoorullah/hg-mono/issues/183; contract
// https://github.com/shaiknoorullah/hg-mono/pull/290). Backend:
// https://github.com/shaiknoorullah/hg-mono/issues/310 and
// https://github.com/shaiknoorullah/hg-mono/issues/259.
//
//   - TestHandoverCodes_RiderFlow: the restaurant's acceptance mints the pickup
//     code and only the restaurant view shows it; a wrong code costs an
//     attempt; the right code picks the order up and mints the delivery code,
//     which only the customer's own views show (support gets null); a photo
//     with a statement is refused at the met handover; the right delivery code
//     delivers. Every response the rider received, errors included, is checked
//     once for either code.
//   - TestHandoverCodes_LockThenSupportOverride: four wrong pickup codes count
//     down, the fifth locks and alerts support on admin:ops, and from then on
//     even the right code is refused. Only support or an admin, signed in with
//     two-step sign-in, can confirm the pickup, and that writes the audit
//     records in the same transaction.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/admin"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// riderLifecycle is the dispatch half of cmd/hg/main.go's orderLifecycleAdapter
// (unexported there): the rider's PICKED_UP, ARRIVED_AT_DROPOFF and DELIVERED
// move the real order.
type riderLifecycle struct{ store *orders.Store }

// ConfirmPickupTx mirrors cmd/hg/pickup.go: the order moves to PICKED_UP in
// the rider's step's own transaction, and a refusal refuses the step.
func (a riderLifecycle) ConfirmPickupTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error {
	err := a.store.PickUpTx(ctx, tx, orderID, riderAccountID)
	var illegal *orders.IllegalTransitionError
	switch {
	case errors.As(err, &illegal):
		return &dispatch.OrderNotCollectableError{OrderState: string(illegal.From)}
	case errors.Is(err, orders.ErrRiderDoesNotHoldOrder):
		return dispatch.ErrRiderDoesNotHoldOrder
	}
	return err
}

func (a riderLifecycle) MarkArrived(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateArrived, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider arrived at the drop-off",
	})
}

func (a riderLifecycle) CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider completed delivery",
	})
}

// newHandoverHarness wires everyone who touches a handover code: the
// restaurant (sees the pickup code), the customer (sees the delivery code),
// the rider (types both, through dispatch with the real order bridge) and
// support (sees neither, can override).
func newHandoverHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})
	ordersStore := orders.NewStore(pool)
	orders.Routes(router, orders.NewHandler(ordersStore, nil, nil))
	restaurant.Routes(router, restaurant.NewHandler(restaurant.NewRepo(pool), nil, nil))
	admin.Routes(router, admin.NewHandler(admin.NewRepo(pool).WithOrdersStore(ordersStore), admin.DefaultConfig()))
	dispatch.Routes(router, dispatch.NewHandler(dispatch.NewService(dispatch.NewStore(pool), riderLifecycle{store: ordersStore})))
	if err := router.Verify(); err != nil {
		t.Fatalf("handover harness router verify: %v", err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// hoFixture is one met-handover order at a live restaurant, and a rider.
type hoFixture struct {
	orderID      string
	customerID   string
	managerID    string
	riderID      string
	restaurantID string
}

// hoSeed seeds a met-handover (MEET_AT_DOOR) delivery order waiting on the
// restaurant (RESTAURANT_PENDING), and an online rider near the restaurant.
func hoSeed(t *testing.T, pool *pgxpool.Pool) hoFixture {
	t.Helper()
	b := mrSeedRestaurant(t, pool, "ACTIVE")
	f := hoFixture{restaurantID: b.restaurantID, managerID: b.managerID}
	f.orderID = mrSeedPreparingOrder(t, pool, b.restaurantID, b.itemID)
	mustExecGaps(t, pool, `
		UPDATE "order"
		   SET state = 'RESTAURANT_PENDING', accepted_at = NULL,
		       deadline_at = now() + interval '3 minutes', deadline_action = 'RESTAURANT_TIMEOUT',
		       delivery_instructions = '{MEET_AT_DOOR}'
		 WHERE id = $1`, f.orderID)
	mustScan(t, pool, `SELECT account_id::text FROM "order" WHERE id = $1`, &f.customerID, f.orderID)

	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES ('+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0')) RETURNING id`, &f.riderID)
	mustExecGaps(t, pool, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, f.riderID)
	mustExecGaps(t, pool, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
		                           onboarding_state, account_status, availability_state, is_online, approved_at)
		VALUES ($1, 'Handover', 'Rider', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, f.riderID)
	mustExecGaps(t, pool, `
		INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3785, 43.6440),4326)::geography, 10, now(), now())`, f.riderID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM assignment WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch_offer WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch_wave WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_availability_event WHERE account_id=$1`, f.riderID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_position WHERE account_id=$1`, f.riderID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_profile WHERE account_id=$1`, f.riderID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, f.riderID)
	})
	return f
}

// hoOffer puts the ready order out to the fixture's rider: a SEARCHING
// dispatch, one wave and one pending offer.
func hoOffer(t *testing.T, pool *pgxpool.Pool, f hoFixture) string {
	t.Helper()
	var waveID, offerID string
	expires := time.Now().UTC().Add(5 * time.Minute)
	mustExecGaps(t, pool, `
		INSERT INTO dispatch (order_id, state, deadline_at, deadline_action)
		VALUES ($1, 'SEARCHING', now()+interval '20 s', 'NEXT_WAVE')`, f.orderID)
	mustScan(t, pool, `
		INSERT INTO dispatch_wave (order_id, wave_no, radius_m, expires_at)
		VALUES ($1, 1, 3000, $2) RETURNING id`, &waveID, f.orderID, expires)
	mustScan(t, pool, `
		INSERT INTO dispatch_offer (order_id, dispatch_wave_id, rider_account_id, wave, distance_m,
		                            earnings_cents, tip_estimate_cents, state, expires_at)
		VALUES ($1, $2, $3, 1, 100, 419, 500, 'PENDING', $4) RETURNING id`,
		&offerID, f.orderID, waveID, f.riderID, expires)
	return offerID
}

// riderLog keeps every body the rider received, for the one check that no
// handover code ever reached the rider.
type riderLog struct{ bodies []string }

// hoCall issues one request, validates the response against the contract,
// checks the status, and returns the decoded body. Rider calls are logged.
func hoCall(t *testing.T, h *Harness, log *riderLog, rq Request, wantStatus int) map[string]any {
	t.Helper()
	if rq.IdemKey == "" && rq.Method != http.MethodGet {
		rq.IdemKey = fmt.Sprintf("handover-%d", time.Now().UnixNano())
	}
	// A request the server accepts must be one the contract accepts too.
	if rq.Body != nil && wantStatus < 300 {
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, rq)); err != nil {
			t.Fatalf("%s %s: the request body is not contract-valid (fix the test): %v", rq.Method, rq.Path, err)
		}
	}
	req, resp := h.Do(t, rq)
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	resp.Body = io.NopCloser(strings.NewReader(string(raw)))
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: status = %d, want %d (body: %s)", rq.Method, rq.Path, resp.StatusCode, wantStatus, truncate(string(raw), 500))
	}
	if opID, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
		t.Errorf("CONFORMANCE FAIL: %v", err)
	} else {
		h.MarkCovered(opID)
	}
	if log != nil {
		log.bodies = append(log.bodies, string(raw))
	}
	var m map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("%s %s: decode body: %v", rq.Method, rq.Path, err)
		}
	}
	return m
}

func hoData(t *testing.T, env map[string]any) map[string]any {
	t.Helper()
	d, ok := env["data"].(map[string]any)
	if !ok {
		t.Fatalf("envelope data is not an object: %v", env)
	}
	return d
}

func hoError(t *testing.T, env map[string]any) (code string, details map[string]any) {
	t.Helper()
	e, ok := env["error"].(map[string]any)
	if !ok {
		t.Fatalf("not an error envelope: %v", env)
	}
	code, _ = e["code"].(string)
	details, _ = e["details"].(map[string]any)
	return code, details
}

// otherCode is a well-formed code that is not code.
func otherCode(t *testing.T, code string) string {
	t.Helper()
	n, err := strconv.Atoi(code)
	if err != nil {
		t.Fatalf("code %q is not four digits", code)
	}
	return fmt.Sprintf("%04d", (n+1)%10000)
}

// hoStep sends one rider step that is not PICKED_UP, at the place it needs.
func hoStep(t *testing.T, h *Harness, log *riderLog, f hoFixture, assignmentID, to string, lat, lng float64) {
	t.Helper()
	hoCall(t, h, log, Request{Method: "POST", Path: "/v1/riders/me/assignments/" + assignmentID + "/transitions",
		AccountID: f.riderID, Roles: []string{roleRider},
		Body: map[string]any{"to_state": to, "latitude": lat, "longitude": lng,
			"occurred_at": time.Now().UTC().Format(time.RFC3339)}}, http.StatusOK)
}

func hoPickup(t *testing.T, h *Harness, log *riderLog, f hoFixture, assignmentID string, code *string, wantStatus int) map[string]any {
	t.Helper()
	body := map[string]any{"to_state": "PICKED_UP", "occurred_at": time.Now().UTC().Format(time.RFC3339)}
	if code != nil {
		body["pickup_code"] = *code
	}
	return hoCall(t, h, log, Request{Method: "POST", Path: "/v1/riders/me/assignments/" + assignmentID + "/transitions",
		AccountID: f.riderID, Roles: []string{roleRider}, Body: body}, wantStatus)
}

// hoReadyAndAssigned has the restaurant accept and mark the order ready, the
// rider accept the offer and walk to the counter. It returns the assignment id
// and the pickup code, read from the restaurant's own order view.
func hoReadyAndAssigned(t *testing.T, h *Harness, log *riderLog, pool *pgxpool.Pool, f hoFixture) (assignmentID, pickupCode string) {
	t.Helper()
	staff := []string{roleRestaurantManager}
	accepted := hoData(t, hoCall(t, h, nil, Request{Method: "POST", Path: "/v1/restaurant/orders/" + f.orderID + "/accept",
		AccountID: f.managerID, Roles: staff, Body: map[string]any{"prep_eta_minutes": 15}}, http.StatusOK))
	pickupCode, _ = accepted["pickup_code"].(string)
	if len(pickupCode) != 4 {
		t.Fatalf("acceptOrder: the restaurant view carries no 4-digit pickup_code: %v", accepted["pickup_code"])
	}
	hoCall(t, h, nil, Request{Method: "POST", Path: "/v1/restaurant/orders/" + f.orderID + "/ready",
		AccountID: f.managerID, Roles: staff}, http.StatusOK)
	got := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/restaurant/orders/" + f.orderID,
		AccountID: f.managerID, Roles: staff}, http.StatusOK))
	if got["pickup_code"] != pickupCode {
		t.Fatalf("getRestaurantOrder: pickup_code = %v, want the code minted at acceptance", got["pickup_code"])
	}

	offerID := hoOffer(t, pool, f)
	hoCall(t, h, log, Request{Method: "GET", Path: "/v1/riders/me/offers/current",
		AccountID: f.riderID, Roles: []string{roleRider}}, http.StatusOK)
	asn := hoData(t, hoCall(t, h, log, Request{Method: "POST", Path: "/v1/riders/me/offers/" + offerID + "/accept",
		AccountID: f.riderID, Roles: []string{roleRider}}, http.StatusOK))
	assignmentID, _ = asn["id"].(string)
	if asn["required_pod_method"] != "OTP" {
		t.Fatalf("a MEET_AT_DOOR order must need the delivery code: required_pod_method = %v", asn["required_pod_method"])
	}
	hoStep(t, h, log, f, assignmentID, "EN_ROUTE_TO_PICKUP", 43.6440, -79.3785)
	hoStep(t, h, log, f, assignmentID, "ARRIVED_AT_PICKUP", 43.6440, -79.3785)
	return assignmentID, pickupCode
}

// uuidOrTimestamp matches the ids and timestamps a body legitimately carries,
// so the check for a code does not trip on digits inside them.
var uuidOrTimestamp = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z`)

// assertNoCodeReachedRider is the one assertion across every rider endpoint:
// no response the rider received — offer, assignment, each transition, each
// proof of delivery, every error — names a code field or carries either code.
func assertNoCodeReachedRider(t *testing.T, log *riderLog, codes ...string) {
	t.Helper()
	if len(log.bodies) == 0 {
		t.Fatal("no rider responses were recorded")
	}
	for i, body := range log.bodies {
		for _, field := range []string{`"pickup_code"`, `"delivery_code"`, `"otp_code"`} {
			if strings.Contains(body, field) {
				t.Errorf("rider response %d carries %s: %s", i, field, truncate(body, 400))
			}
		}
		scrubbed := uuidOrTimestamp.ReplaceAllString(body, "")
		for _, code := range codes {
			if regexp.MustCompile(`\b` + code + `\b`).MatchString(scrubbed) {
				t.Errorf("rider response %d carries a handover code: %s", i, truncate(body, 400))
			}
		}
	}
}

func TestHandoverCodes_RiderFlow(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	log := &riderLog{}
	customer := []string{roleCustomer}

	assignmentID, pickupCode := hoReadyAndAssigned(t, h, log, pool, f)
	transitions := "/v1/riders/me/assignments/" + assignmentID + "/transitions"

	// No code: refused, nothing counted. An override_reason never stands in.
	code, _ := hoError(t, hoPickup(t, h, log, f, assignmentID, nil, http.StatusUnprocessableEntity))
	if code != "PICKUP_CODE_REQUIRED" {
		t.Errorf("PICKED_UP without a code: error = %s, want PICKUP_CODE_REQUIRED", code)
	}
	env := hoCall(t, h, log, Request{Method: "POST", Path: transitions, AccountID: f.riderID, Roles: []string{roleRider},
		Body: map[string]any{"to_state": "PICKED_UP", "occurred_at": time.Now().UTC().Format(time.RFC3339),
			"override_reason": "The kitchen is closed"}}, http.StatusUnprocessableEntity)
	if code, _ := hoError(t, env); code != "VALIDATION_FAILED" {
		t.Errorf("PICKED_UP with an override_reason: error = %s, want VALIDATION_FAILED", code)
	}

	// A wrong code costs one of the five attempts.
	wrong := otherCode(t, pickupCode)
	code, details := hoError(t, hoPickup(t, h, log, f, assignmentID, &wrong, http.StatusUnprocessableEntity))
	if code != "PICKUP_CODE_INCORRECT" || details["attempts_remaining"] != float64(4) {
		t.Errorf("wrong pickup code: %s %v, want PICKUP_CODE_INCORRECT with 4 attempts remaining", code, details)
	}

	// The right code picks the order up.
	asn := hoData(t, hoPickup(t, h, log, f, assignmentID, &pickupCode, http.StatusOK))
	if asn["state"] != "PICKED_UP" {
		t.Fatalf("right pickup code: assignment state = %v, want PICKED_UP", asn["state"])
	}
	var orderState string
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &orderState, f.orderID)
	if orderState != "PICKED_UP" {
		t.Fatalf("order state after pickup = %s, want PICKED_UP", orderState)
	}

	// The delivery code now exists, for the customer's own views only.
	cust := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/orders/" + f.orderID,
		AccountID: f.customerID, Roles: customer}, http.StatusOK))
	deliveryCode, _ := cust["delivery_code"].(string)
	if len(deliveryCode) != 4 {
		t.Fatalf("getOrder (customer): delivery_code = %v, want the 4-digit code", cust["delivery_code"])
	}
	track := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/orders/" + f.orderID + "/tracking",
		AccountID: f.customerID, Roles: customer}, http.StatusOK))
	if track["delivery_code"] != deliveryCode {
		t.Errorf("getOrderTracking: delivery_code = %v, want the customer's code", track["delivery_code"])
	}
	staffView := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/admin/orders/" + f.orderID,
		AccountID: f.managerID, Roles: []string{roleSuperAdmin}}, http.StatusOK))
	if v, present := staffView["delivery_code"]; !present || v != nil {
		t.Errorf("getOrderAdmin: delivery_code = %v (present %v), want null", v, present)
	}
	restView := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/restaurant/orders/" + f.orderID,
		AccountID: f.managerID, Roles: []string{roleRestaurantManager}}, http.StatusOK))
	if restView["pickup_code"] != nil {
		t.Errorf("getRestaurantOrder after pickup: pickup_code = %v, want null", restView["pickup_code"])
	}

	hoStep(t, h, log, f, assignmentID, "EN_ROUTE_TO_DROPOFF", 43.6412, -79.3810)
	hoStep(t, h, log, f, assignmentID, "ARRIVED_AT_DROPOFF", 43.6412, -79.3810)
	pod := "/v1/riders/me/assignments/" + assignmentID + "/proof-of-delivery"

	// A met handover takes no photo and no statement in place of the code.
	env = hoCall(t, h, log, Request{Method: "POST", Path: pod, AccountID: f.riderID, Roles: []string{roleRider},
		Body: map[string]any{"method": "PHOTO_WITH_ATTESTATION", "photo_object_id": "00000000-0000-4000-8000-000000000004",
			"attestation_reason": "The customer did not answer the door."}}, http.StatusUnprocessableEntity)
	if code, details := hoError(t, env); code != "POD_METHOD_MISMATCH" || details["required_pod_method"] != "OTP" {
		t.Errorf("photo at a met handover: %s %v, want POD_METHOD_MISMATCH requiring OTP", code, details)
	}

	wrong = otherCode(t, deliveryCode)
	env = hoCall(t, h, log, Request{Method: "POST", Path: pod, AccountID: f.riderID, Roles: []string{roleRider},
		Body: map[string]any{"method": "OTP", "otp_code": wrong}}, http.StatusUnprocessableEntity)
	if code, details := hoError(t, env); code != "DELIVERY_CODE_INCORRECT" || details["attempts_remaining"] != float64(4) {
		t.Errorf("wrong delivery code: %s %v, want DELIVERY_CODE_INCORRECT with 4 attempts remaining", code, details)
	}
	asn = hoData(t, hoCall(t, h, log, Request{Method: "POST", Path: pod, AccountID: f.riderID, Roles: []string{roleRider},
		Body: map[string]any{"method": "OTP", "otp_code": deliveryCode, "handover_method": "HANDED_TO_CUSTOMER"}}, http.StatusOK))
	if asn["pod_recorded"] != true {
		t.Fatalf("right delivery code: pod_recorded = %v, want true", asn["pod_recorded"])
	}
	hoStep(t, h, log, f, assignmentID, "DELIVERED", 43.6412, -79.3810)
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &orderState, f.orderID)
	if orderState != "DELIVERED" {
		t.Fatalf("order state after delivery = %s, want DELIVERED", orderState)
	}
	hoCall(t, h, log, Request{Method: "GET", Path: "/v1/riders/me/assignments/" + assignmentID,
		AccountID: f.riderID, Roles: []string{roleRider}}, http.StatusOK)

	// Both codes are spent and deleted.
	var left int
	mustScan(t, pool, `SELECT (pickup_code_enc IS NOT NULL)::int + (delivery_code_enc IS NOT NULL)::int FROM "order" WHERE id=$1`, &left, f.orderID)
	if left != 0 {
		t.Errorf("%d handover code(s) still stored after delivery, want none", left)
	}

	assertNoCodeReachedRider(t, log, pickupCode, deliveryCode)
}

func TestHandoverCodes_LockThenSupportOverride(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	log := &riderLog{}

	assignmentID, pickupCode := hoReadyAndAssigned(t, h, log, pool, f)
	wrong := otherCode(t, pickupCode)

	// Four wrong codes count down; the fifth locks.
	for want := 4; want >= 1; want-- {
		code, details := hoError(t, hoPickup(t, h, log, f, assignmentID, &wrong, http.StatusUnprocessableEntity))
		if code != "PICKUP_CODE_INCORRECT" || details["attempts_remaining"] != float64(want) {
			t.Fatalf("wrong code with %d left: %s %v", want, code, details)
		}
	}
	if code, _ := hoError(t, hoPickup(t, h, log, f, assignmentID, &wrong, http.StatusLocked)); code != "PICKUP_CODE_LOCKED" {
		t.Fatalf("fifth wrong code: %s, want PICKUP_CODE_LOCKED", code)
	}
	// From then on nothing is compared or counted: the right code and no code
	// get the same answer.
	for _, c := range []*string{&pickupCode, nil} {
		if code, _ := hoError(t, hoPickup(t, h, log, f, assignmentID, c, http.StatusLocked)); code != "PICKUP_CODE_LOCKED" {
			t.Errorf("after the lock: %s, want PICKUP_CODE_LOCKED", code)
		}
	}
	var attempts int
	var asnState string
	mustScan(t, pool, `SELECT pickup_code_attempts FROM "order" WHERE id=$1`, &attempts, f.orderID)
	mustScan(t, pool, `SELECT state::text FROM assignment WHERE id=$1`, &asnState, assignmentID)
	if attempts != 5 || asnState != "ARRIVED_AT_PICKUP" {
		t.Fatalf("after the lock: attempts = %d (want 5 committed), assignment = %s (want ARRIVED_AT_PICKUP)", attempts, asnState)
	}

	// The lock handed the order to support: one alert on admin:ops, naming the
	// order and never the code.
	var alerts int
	var alert string
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*), coalesce(max(payload::text), '') FROM realtime_event
		 WHERE channel = 'admin:ops' AND type = 'admin.alert' AND order_id = $1`, f.orderID).Scan(&alerts, &alert); err != nil {
		t.Fatalf("read lock alert: %v", err)
	}
	if alerts != 1 || !strings.Contains(alert, `"HANDOVER_CODE_LOCKED"`) || strings.Contains(alert, pickupCode) {
		t.Errorf("lock alert: %d alert(s) %s, want one HANDOVER_CODE_LOCKED without the code", alerts, alert)
	}
	restView := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/restaurant/orders/" + f.orderID,
		AccountID: f.managerID, Roles: []string{roleRestaurantManager}}, http.StatusOK))
	if restView["pickup_code"] != nil {
		t.Errorf("getRestaurantOrder after the lock: pickup_code = %v, want null", restView["pickup_code"])
	}
	assertNoCodeReachedRider(t, log, pickupCode)

	// Only support or an admin can move the order on.
	var supportID string
	mustScan(t, pool, `INSERT INTO account (email, status) VALUES ('ho-support-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE') RETURNING id`, &supportID)
	mustExecGaps(t, pool, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'SUPPORT_AGENT', 'GLOBAL')`, supportID)
	override := "/v1/admin/orders/" + f.orderID + "/handover-override"
	body := map[string]any{
		"handover": "PICKUP",
		"reason":   "Code locked after 5 tries. Called the kitchen: they handed the bag to the rider at the counter.",
		"case_id":  "dfac740c-a07b-42bd-ad21-c0279fb83b13",
	}
	for _, who := range []struct{ id, role string }{
		{f.riderID, roleRider}, {f.customerID, roleCustomer}, {f.managerID, roleRestaurantManager},
	} {
		_, resp := h.Do(t, Request{Method: "POST", Path: override, AccountID: who.id, Roles: []string{who.role},
			IdemKey: fmt.Sprintf("ho-deny-%d", time.Now().UnixNano()), Body: body})
		resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("overrideHandoverCode as %s: status = %d, want 403", who.role, resp.StatusCode)
		}
	}
	env := hoCall(t, h, nil, Request{Method: "POST", Path: override, AccountID: supportID, Roles: []string{"SUPPORT_AGENT"},
		AMR: "pwd", Body: body}, http.StatusForbidden)
	if code, _ := hoError(t, env); code != "MFA_REQUIRED" {
		t.Errorf("override from a password-only session: %s, want MFA_REQUIRED", code)
	}
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &asnState, f.orderID)
	if asnState != "READY_FOR_PICKUP" {
		t.Fatalf("a refused override moved the order to %s", asnState)
	}

	key := fmt.Sprintf("ho-override-%d", time.Now().UnixNano())
	rec := hoData(t, hoCall(t, h, nil, Request{Method: "POST", Path: override, AccountID: supportID,
		Roles: []string{"SUPPORT_AGENT"}, IdemKey: key, Body: body}, http.StatusOK))
	if rec["actor_kind"] != "SUPPORT" || rec["wrong_code_attempts"] != float64(5) ||
		rec["order_state"] != "PICKED_UP" || rec["actor_account_id"] != supportID || rec["case_id"] != body["case_id"] {
		t.Errorf("override record = %v", rec)
	}

	// The order and the assignment moved, as SUPPORT with the reason, and the
	// audit records were written in the same transaction.
	var orderState, actor, reason string
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &orderState, f.orderID)
	if err := pool.QueryRow(context.Background(),
		`SELECT actor_kind::text, reason FROM order_transition WHERE order_id=$1 AND to_state='PICKED_UP'`,
		f.orderID).Scan(&actor, &reason); err != nil {
		t.Fatalf("read the pickup transition: %v", err)
	}
	mustScan(t, pool, `SELECT state::text FROM assignment WHERE id=$1`, &asnState, assignmentID)
	if orderState != "PICKED_UP" || actor != "SUPPORT" || reason != body["reason"] || asnState != "PICKED_UP" {
		t.Errorf("after the override: order %s by %s (%q), assignment %s", orderState, actor, reason, asnState)
	}
	var records, audits int
	mustScan(t, pool, `SELECT count(*) FROM handover_override WHERE order_id=$1`, &records, f.orderID)
	mustScan(t, pool, `SELECT count(*) FROM audit_event WHERE action='order.handover_override' AND subject_id=$1 AND actor_account_id=$2`,
		&audits, f.orderID, supportID)
	if records != 1 || audits != 1 {
		t.Errorf("override wrote %d handover_override and %d audit_event rows, want 1 and 1", records, audits)
	}
	if _, err := pool.Exec(context.Background(), `DELETE FROM handover_override WHERE order_id=$1`, f.orderID); err == nil {
		t.Error("handover_override accepted a DELETE; it must be append-only")
	}

	// A retry of the same request gets the same record; a second override of a
	// handover that already happened is refused.
	again := hoData(t, hoCall(t, h, nil, Request{Method: "POST", Path: override, AccountID: supportID,
		Roles: []string{"SUPPORT_AGENT"}, IdemKey: key, Body: body}, http.StatusOK))
	if again["id"] != rec["id"] {
		t.Errorf("retry with the same Idempotency-Key: id = %v, want %v", again["id"], rec["id"])
	}
	env = hoCall(t, h, nil, Request{Method: "POST", Path: override, AccountID: supportID, Roles: []string{"SUPPORT_AGENT"},
		Body: body}, http.StatusConflict)
	if code, details := hoError(t, env); code != "ILLEGAL_TRANSITION" || details["from"] != "PICKED_UP" {
		t.Errorf("second override: %s %v, want ILLEGAL_TRANSITION from PICKED_UP", code, details)
	}
}
