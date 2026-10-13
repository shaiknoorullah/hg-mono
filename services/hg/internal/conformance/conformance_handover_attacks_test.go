package conformance

// Handover codes under attack: each role tries to get past the pickup code, the
// delivery code or the support override, through the real HTTP handlers and
// the role middleware, against a live migrated Postgres.
//
// Contract: contracts/README.md, "Neither code can be bypassed" (security review
// on https://github.com/shaiknoorullah/hg-mono/issues/183). Backend:
// https://github.com/shaiknoorullah/hg-mono/issues/310. Authorization audit of
// https://github.com/shaiknoorullah/hg-mono/pull/315.
//
//   - TestHandoverCodes_OverrideRefusesPartiesToTheOrder: one person is one
//     account whatever roles it holds (contracts/openapi.yaml, Role), so the
//     order's rider, customer or restaurant staff can also be support or an
//     admin. None of them can confirm a handover on that order; support confirms
//     after checking with the people involved, and is never one of them.
//   - TestHandoverCodes_OverrideRefusesInactiveStaff: a token outlives a
//     suspension and a revoked role, so the override reads both from Postgres in
//     its own transaction.
//   - TestHandoverCodes_RiderAttacks: another rider gets the same 404 as an
//     assignment that does not exist and counts nothing; nobody signed in gets
//     401; another restaurant and another customer see no code; the delivery
//     code is compared and counted only at the drop-off.
//   - TestHandoverCodes_RiderMovedOffTheOrder: a rider moved off the order
//     loses the handover at once, and cannot test guesses or spend the order's
//     attempts with the old assignment id.

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const roleSupportAgent = "SUPPORT_AGENT"

// hoStaff makes accountID (a new account when "") a staff member: a live global
// grant of role and, unless status is "", a staff_profile in that status.
func hoStaff(t *testing.T, pool *pgxpool.Pool, accountID, role, status string) string {
	t.Helper()
	if accountID == "" {
		mustScan(t, pool, `
			INSERT INTO account (email, status)
			VALUES ('ho-staff-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`, &accountID)
	} else {
		// A staff account signs in with an email; the rider's or customer's
		// phone account gains one, as the same person's one account would.
		mustExecGaps(t, pool, `
			UPDATE account SET email = COALESCE(email, 'ho-staff-'||substr(md5(random()::text),1,10)||'@hg.test')
			 WHERE id = $1`, accountID)
	}
	mustExecGaps(t, pool, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, $2::role_name, 'GLOBAL')`, accountID, role)
	if status != "" {
		mustExecGaps(t, pool, `INSERT INTO staff_profile (account_id, full_name, status) VALUES ($1, 'Handover Staff', $2::staff_status)`, accountID, status)
	}
	// Leave no staff behind for the staff list other tests read.
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM staff_profile WHERE account_id = $1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id = $1 AND role = $2::role_name`, accountID, role)
	})
	return accountID
}

// hoRider seeds a second approved, online rider.
func hoRider(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES ('+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0')) RETURNING id`, &id)
	mustExecGaps(t, pool, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, id)
	mustExecGaps(t, pool, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
		                           onboarding_state, account_status, availability_state, is_online, approved_at)
		VALUES ($1, 'Other', 'Rider', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, id)
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM rider_profile WHERE account_id=$1`, id)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, id)
	})
	return id
}

// hoOverride asks for a support override of the order's handover as who.
func hoOverride(t *testing.T, h *Harness, f hoFixture, who string, roles []string, handover string, wantStatus int) map[string]any {
	t.Helper()
	return hoCall(t, h, nil, Request{
		Method: "POST", Path: "/v1/admin/orders/" + f.orderID + "/handover-override",
		AccountID: who, Roles: roles, IdemKey: fmt.Sprintf("ho-attack-%d", time.Now().UnixNano()),
		Body: map[string]any{
			"handover": handover,
			"reason":   "Code locked after 5 tries. Called the kitchen: they handed the bag to the rider at the counter.",
			"case_id":  "dfac740c-a07b-42bd-ad21-c0279fb83b13",
		},
	}, wantStatus)
}

// hoNothingMoved asserts that a refused override left the order, the
// assignment and the audit trail as they were.
func hoNothingMoved(t *testing.T, pool *pgxpool.Pool, f hoFixture, assignmentID, orderState, asnState string) {
	t.Helper()
	var gotOrder, gotAsn string
	var records, audits int
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &gotOrder, f.orderID)
	mustScan(t, pool, `SELECT state::text FROM assignment WHERE id=$1`, &gotAsn, assignmentID)
	mustScan(t, pool, `SELECT count(*) FROM handover_override WHERE order_id=$1`, &records, f.orderID)
	mustScan(t, pool, `SELECT count(*) FROM audit_event WHERE action='order.handover_override' AND subject_id=$1`, &audits, f.orderID)
	if gotOrder != orderState || gotAsn != asnState || records != 0 || audits != 0 {
		t.Fatalf("a refused override changed something: order %s (want %s), assignment %s (want %s), %d override and %d audit rows (want 0 and 0)",
			gotOrder, orderState, gotAsn, asnState, records, audits)
	}
}

func TestHandoverCodes_OverrideRefusesPartiesToTheOrder(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	assignmentID, _ := hoReadyAndAssigned(t, h, &riderLog{}, pool, f)

	// Each party also holds a live staff grant and an ACTIVE staff profile, and
	// its session signed in with two-step sign-in: only being a party is wrong.
	parties := []struct {
		name  string
		id    string
		roles []string
	}{
		{"the order's rider, who is also support", hoStaff(t, pool, f.riderID, roleSupportAgent, "ACTIVE"), []string{roleRider, roleSupportAgent}},
		{"the order's customer, who is also an admin", hoStaff(t, pool, f.customerID, roleAdmin, "ACTIVE"), []string{roleCustomer, roleAdmin}},
		{"the restaurant's manager, who is also a super admin", hoStaff(t, pool, f.managerID, roleSuperAdmin, "ACTIVE"), []string{roleRestaurantManager, roleSuperAdmin}},
	}
	for _, p := range parties {
		env := hoOverride(t, h, f, p.id, p.roles, "PICKUP", http.StatusForbidden)
		if code, _ := hoError(t, env); code != "FORBIDDEN" {
			t.Errorf("override by %s: %s, want FORBIDDEN", p.name, code)
		}
		hoNothingMoved(t, pool, f, assignmentID, "READY_FOR_PICKUP", "ARRIVED_AT_PICKUP")
	}

	// Support who is not a party can.
	support := hoStaff(t, pool, "", roleSupportAgent, "ACTIVE")
	rec := hoData(t, hoOverride(t, h, f, support, []string{roleSupportAgent}, "PICKUP", http.StatusOK))
	if rec["order_state"] != "PICKED_UP" || rec["actor_account_id"] != support {
		t.Errorf("override by support who is not a party: %v", rec)
	}
}

func TestHandoverCodes_OverrideRefusesInactiveStaff(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	assignmentID, _ := hoReadyAndAssigned(t, h, &riderLog{}, pool, f)

	suspendedAccount := hoStaff(t, pool, "", roleSupportAgent, "ACTIVE")
	mustExecGaps(t, pool, `UPDATE account SET status = 'SUSPENDED' WHERE id = $1`, suspendedAccount)
	revoked := hoStaff(t, pool, "", roleAdmin, "ACTIVE")
	mustExecGaps(t, pool, `UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, revoked)

	// Every session below still carries the staff role it was issued with, as a
	// token does until it expires.
	cases := []struct {
		name string
		id   string
		role string
		want string
	}{
		{"a suspended support agent", hoStaff(t, pool, "", roleSupportAgent, "SUSPENDED"), roleSupportAgent, "ACCOUNT_NOT_ACTIVE"},
		{"a deactivated admin", hoStaff(t, pool, "", roleAdmin, "DEACTIVATED"), roleAdmin, "ACCOUNT_NOT_ACTIVE"},
		{"a support agent who never accepted the invitation", hoStaff(t, pool, "", roleSupportAgent, "INVITED"), roleSupportAgent, "ACCOUNT_NOT_ACTIVE"},
		{"a support agent whose account is suspended", suspendedAccount, roleSupportAgent, "ACCOUNT_NOT_ACTIVE"},
		{"an admin whose role was revoked", revoked, roleAdmin, "FORBIDDEN"},
	}
	for _, c := range cases {
		env := hoOverride(t, h, f, c.id, []string{c.role}, "PICKUP", http.StatusForbidden)
		if code, _ := hoError(t, env); code != c.want {
			t.Errorf("override by %s: %s, want %s", c.name, code, c.want)
		}
		hoNothingMoved(t, pool, f, assignmentID, "READY_FOR_PICKUP", "ARRIVED_AT_PICKUP")
	}

	active := hoStaff(t, pool, "", roleSupportAgent, "ACTIVE")
	rec := hoData(t, hoOverride(t, h, f, active, []string{roleSupportAgent}, "PICKUP", http.StatusOK))
	if rec["actor_kind"] != "SUPPORT" || rec["order_state"] != "PICKED_UP" {
		t.Errorf("override by an active support agent: %v", rec)
	}
}

func TestHandoverCodes_RiderAttacks(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	log := &riderLog{}
	rider := []string{roleRider}
	assignmentID, pickupCode := hoReadyAndAssigned(t, h, log, pool, f)
	asnPath := "/v1/riders/me/assignments/" + assignmentID
	ghostPath := "/v1/riders/me/assignments/00000000-0000-4000-8000-0000000000aa"
	now := func() string { return time.Now().UTC().Format(time.RFC3339) }
	attempts := func(column string) int {
		var n int
		mustScan(t, pool, `SELECT `+column+` FROM "order" WHERE id=$1`, &n, f.orderID)
		return n
	}
	sameError := func(what string, a, b map[string]any) {
		t.Helper()
		ea, _ := a["error"].(map[string]any)
		eb, _ := b["error"].(map[string]any)
		if ea["code"] != eb["code"] || ea["message"] != eb["message"] || fmt.Sprint(ea["details"]) != fmt.Sprint(eb["details"]) {
			t.Errorf("%s: another rider's assignment answers %v, an assignment that does not exist answers %v", what, ea, eb)
		}
	}

	// Another rider, with the right pickup code: the same 404 as an assignment
	// that does not exist, and nothing counted.
	riderB := hoRider(t, pool)
	pickup := map[string]any{"to_state": "PICKED_UP", "occurred_at": now(), "pickup_code": pickupCode}
	sameError("pickup by another rider",
		hoCall(t, h, log, Request{Method: "POST", Path: asnPath + "/transitions", AccountID: riderB, Roles: rider, Body: pickup}, http.StatusNotFound),
		hoCall(t, h, log, Request{Method: "POST", Path: ghostPath + "/transitions", AccountID: riderB, Roles: rider, Body: pickup}, http.StatusNotFound))
	otp := map[string]any{"method": "OTP", "otp_code": "0000"}
	sameError("delivery code by another rider",
		hoCall(t, h, log, Request{Method: "POST", Path: asnPath + "/proof-of-delivery", AccountID: riderB, Roles: rider, Body: otp}, http.StatusNotFound),
		hoCall(t, h, log, Request{Method: "POST", Path: ghostPath + "/proof-of-delivery", AccountID: riderB, Roles: rider, Body: otp}, http.StatusNotFound))
	if n := attempts("pickup_code_attempts"); n != 0 {
		t.Fatalf("another rider's tries counted %d wrong pickup codes on the order, want 0", n)
	}

	// Nobody signed in.
	for _, p := range []string{asnPath + "/transitions", asnPath + "/proof-of-delivery", "/v1/admin/orders/" + f.orderID + "/handover-override"} {
		_, resp := h.Do(t, Request{Method: "POST", Path: p, IdemKey: fmt.Sprintf("ho-anon-%d", time.Now().UnixNano()), Body: pickup})
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("POST %s with no session: status = %d, want 401", p, resp.StatusCode)
		}
	}

	// Another restaurant's manager does not see this order, let alone its code.
	other := mrSeedRestaurant(t, pool, "ACTIVE")
	hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/restaurant/orders/" + f.orderID,
		AccountID: other.managerID, Roles: []string{roleRestaurantManager}}, http.StatusNotFound)

	// The rider picks up with the right code; the delivery code now exists.
	if asn := hoData(t, hoPickup(t, h, log, f, assignmentID, &pickupCode, http.StatusOK)); asn["state"] != "PICKED_UP" {
		t.Fatalf("right pickup code: assignment state = %v, want PICKED_UP", asn["state"])
	}
	cust := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/orders/" + f.orderID,
		AccountID: f.customerID, Roles: []string{roleCustomer}}, http.StatusOK))
	deliveryCode, _ := cust["delivery_code"].(string)
	if len(deliveryCode) != 4 {
		t.Fatalf("getOrder (customer): delivery_code = %v, want the 4-digit code", cust["delivery_code"])
	}

	// Another customer sees neither the order nor its code.
	var otherCustomer string
	mustScan(t, pool, `INSERT INTO account (phone_e164, status) VALUES ('+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0'), 'ACTIVE') RETURNING id`, &otherCustomer)
	for _, p := range []string{"/v1/orders/" + f.orderID, "/v1/orders/" + f.orderID + "/tracking"} {
		hoCall(t, h, nil, Request{Method: "GET", Path: p, AccountID: otherCustomer, Roles: []string{roleCustomer}}, http.StatusNotFound)
	}

	// The delivery code is heard at the drop-off and typed there. Away from it
	// the code is not compared, and nothing is counted: a rider cannot spend the
	// five tries, or lock the code, before reaching the customer.
	wrong := otherCode(t, deliveryCode)
	env := hoCall(t, h, log, Request{Method: "POST", Path: asnPath + "/proof-of-delivery", AccountID: f.riderID, Roles: rider,
		Body: map[string]any{"method": "OTP", "otp_code": wrong}}, http.StatusConflict)
	if code, details := hoError(t, env); code != "INVALID_TRANSITION" || details["current_state"] != "PICKED_UP" {
		t.Errorf("delivery code before the drop-off: %s %v, want INVALID_TRANSITION at PICKED_UP", code, details)
	}
	if n := attempts("delivery_code_attempts"); n != 0 {
		t.Fatalf("a delivery code typed before the drop-off was counted (%d), want 0", n)
	}

	assertNoCodeReachedRider(t, log, pickupCode, deliveryCode)
}

func TestHandoverCodes_RiderMovedOffTheOrder(t *testing.T) {
	pool := openPool(t)
	h := newHandoverHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	f := hoSeed(t, pool)
	log := &riderLog{}
	rider := []string{roleRider}
	assignmentID, pickupCode := hoReadyAndAssigned(t, h, log, pool, f)
	asnPath := "/v1/riders/me/assignments/" + assignmentID

	hoPickup(t, h, log, f, assignmentID, &pickupCode, http.StatusOK)
	cust := hoData(t, hoCall(t, h, nil, Request{Method: "GET", Path: "/v1/orders/" + f.orderID,
		AccountID: f.customerID, Roles: []string{roleCustomer}}, http.StatusOK))
	deliveryCode, _ := cust["delivery_code"].(string)
	if len(deliveryCode) != 4 {
		t.Fatalf("getOrder (customer): delivery_code = %v, want the 4-digit code", cust["delivery_code"])
	}
	hoStep(t, h, log, f, assignmentID, "EN_ROUTE_TO_DROPOFF", 43.6412, -79.3810)
	hoStep(t, h, log, f, assignmentID, "ARRIVED_AT_DROPOFF", 43.6412, -79.3810)

	// Operations move the order off this rider at the door (the assignment row
	// as a reassignment leaves it). The rider still has the assignment id; from
	// this moment it proves nothing, compares nothing and counts nothing, so the
	// rider cannot test guesses or spend the next rider's five tries.
	mustExecGaps(t, pool, `UPDATE assignment SET state = 'REASSIGNED', state_since = now(), terminated_at = now() WHERE id = $1`, assignmentID)
	for _, c := range []string{otherCode(t, deliveryCode), deliveryCode} {
		env := hoCall(t, h, log, Request{Method: "POST", Path: asnPath + "/proof-of-delivery", AccountID: f.riderID, Roles: rider,
			Body: map[string]any{"method": "OTP", "otp_code": c}}, http.StatusConflict)
		if code, details := hoError(t, env); code != "INVALID_TRANSITION" || details["current_state"] != "REASSIGNED" {
			t.Errorf("delivery code from a rider moved off the order: %s %v, want INVALID_TRANSITION at REASSIGNED", code, details)
		}
	}
	var attempts int
	var podRecorded bool
	mustScan(t, pool, `SELECT delivery_code_attempts FROM "order" WHERE id=$1`, &attempts, f.orderID)
	mustScan(t, pool, `SELECT pod_recorded FROM assignment WHERE id=$1`, &podRecorded, assignmentID)
	if attempts != 0 || podRecorded {
		t.Fatalf("a rider moved off the order: %d delivery codes counted and pod_recorded = %v, want 0 and false", attempts, podRecorded)
	}
	hoCall(t, h, log, Request{Method: "POST", Path: asnPath + "/transitions", AccountID: f.riderID, Roles: rider,
		Body: map[string]any{"to_state": "DELIVERED", "latitude": 43.6412, "longitude": -79.3810,
			"occurred_at": time.Now().UTC().Format(time.RFC3339)}}, http.StatusConflict)

	assertNoCodeReachedRider(t, log, pickupCode, deliveryCode)
}
