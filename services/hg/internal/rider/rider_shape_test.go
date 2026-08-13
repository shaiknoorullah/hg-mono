// Package rider_test — STAGE 3 boundary & leak analysis.
//
// The Stage-1/2 tests assert that individual fields are *present*; they never
// assert that the payload is a strict, closed match against the contract
// schema. That leaves three whole classes of leak uncovered:
//
//	A) CONTRACT CONFORMANCE — an extra field (additionalProperties:false), a
//	   wrong type, an open enum, or wrong nullability sails straight through a
//	   "field X is non-empty" assertion.
//	B) AUTHZ — only one non-RIDER role was probed per op; a single mis-declared
//	   action could let, say, SUPPORT_AGENT through and no test would notice.
//	G) ERROR TAXONOMY — a bare 500 with no contract ErrorCode was never ruled
//	   out on the failure paths.
//
// This file closes those gaps with golden shape assertions (exact key sets +
// closed-enum membership), an exhaustive role sweep across every op, and an
// error-envelope shape check.
package rider

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─────────────────────────────────────────────────────────────────────────────
// Golden shape helpers
// ─────────────────────────────────────────────────────────────────────────────

// decodeData decodes the {"data": …} envelope of a 2xx response into a generic
// tree so the exact key set can be asserted against the contract schema.
func decodeData(t *testing.T, rec *httptest.ResponseRecorder) any {
	t.Helper()
	var env map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("response is not a JSON object: %v — body: %s", err, rec.Body)
	}
	raw, ok := env["data"]
	if !ok {
		t.Fatalf("2xx envelope missing top-level \"data\" key: %s", rec.Body)
	}
	// Every 2xx envelope is closed to {data} (+ optional {meta}). Assert no
	// stray top-level keys leaked in.
	for k := range env {
		if k != "data" && k != "meta" {
			t.Errorf("envelope carries unexpected top-level key %q", k)
		}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("data is not valid JSON: %v", err)
	}
	return v
}

// asObject asserts v is a JSON object and returns it.
func asObject(t *testing.T, where string, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("%s: expected a JSON object, got %T", where, v)
	}
	return m
}

// assertClosedObject asserts obj's keys are exactly a subset of allowed and
// that every key in required is present. This is the additionalProperties:false
// + required[...] contract, checked at runtime against the live payload.
func assertClosedObject(t *testing.T, where string, obj map[string]any, allowed, required []string) {
	t.Helper()
	allowedSet := make(map[string]bool, len(allowed))
	for _, k := range allowed {
		allowedSet[k] = true
	}
	for k := range obj {
		if !allowedSet[k] {
			t.Errorf("%s: unexpected field %q (additionalProperties:false violated) — keys present: %s",
				where, k, sortedKeys(obj))
		}
	}
	for _, k := range required {
		if _, ok := obj[k]; !ok {
			t.Errorf("%s: required field %q missing", where, k)
		}
	}
}

func sortedKeys(m map[string]any) string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return strings.Join(ks, ", ")
}

// assertEnum asserts the string value at obj[field] (when present and non-null)
// is one of the closed set. Absent or null is allowed here; presence/nullability
// is governed separately by assertClosedObject's required list.
func assertEnum(t *testing.T, where, field string, obj map[string]any, allowed ...string) {
	t.Helper()
	raw, ok := obj[field]
	if !ok || raw == nil {
		return
	}
	s, ok := raw.(string)
	if !ok {
		t.Errorf("%s.%s: expected string enum, got %T", where, field, raw)
		return
	}
	for _, a := range allowed {
		if s == a {
			return
		}
	}
	t.Errorf("%s.%s = %q is not in the closed enum {%s}", where, field, s, strings.Join(allowed, ", "))
}

// assertIntNumber asserts obj[field] is a JSON number with an integer value
// (money/count invariant: no fractional cents, no float trips).
func assertIntNumber(t *testing.T, where, field string, obj map[string]any) {
	t.Helper()
	raw, ok := obj[field]
	if !ok {
		t.Errorf("%s.%s: missing", where, field)
		return
	}
	f, ok := raw.(float64)
	if !ok {
		t.Errorf("%s.%s: expected a JSON number, got %T", where, field, raw)
		return
	}
	if f != float64(int64(f)) {
		t.Errorf("%s.%s = %v is not an integer value", where, field, f)
	}
}

// Contract enum sets (mirrored from contracts/openapi.yaml).
var (
	enumOnboardingState  = []string{"REGISTERED", "PHONE_VERIFIED", "PROFILE_PENDING", "VEHICLE_PENDING", "DOCUMENTS_PENDING", "DOCUMENTS_REVIEW", "DOCUMENTS_APPROVED", "DOCUMENTS_REJECTED", "PAYOUT_PENDING", "ACTIVE"}
	enumAccountStatus    = []string{"PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"}
	enumAvailability     = []string{"OFFLINE", "ONLINE_IDLE", "ONLINE_STALE", "ON_DELIVERY"}
	enumNextRoute        = []string{"HOME", "PROFILE_CAPTURE", "ONBOARDING_PROFILE", "ONBOARDING_VEHICLE", "ONBOARDING_DOCUMENTS", "ONBOARDING_AWAITING_REVIEW", "ONBOARDING_REJECTED", "ONBOARDING_PAYOUT", "ONBOARDING_MENU", "ACTIVE_DELIVERY", "ORDER_TRACKING", "SUSPENDED", "APP_UPDATE_REQUIRED"}
	enumNextStep         = []string{"PROFILE", "VEHICLE", "DOCUMENTS", "AWAITING_REVIEW", "FIX_DOCUMENTS", "PAYOUT", "DONE"}
	enumVehicleType      = []string{"CAR", "SCOOTER", "MOTORCYCLE", "BICYCLE", "ON_FOOT"}
	enumRiderDocType     = []string{"DRIVERS_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSURANCE", "GOVERNMENT_ID", "WORK_ELIGIBILITY", "PROFILE_PHOTO"}
	enumKycDocumentState = []string{"SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED"}
	enumCurrency         = []string{"CAD"}
)

// ─────────────────────────────────────────────────────────────────────────────
// A) CONTRACT CONFORMANCE — golden shape per operation
// ─────────────────────────────────────────────────────────────────────────────

// TestShape_GetRiderMe pins the RiderMe schema: exact key set, closed enums,
// and the NextRoute enum (previously a raw client path — a conformance leak).
func TestShape_GetRiderMe(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderMe", decodeData(t, rec))

	assertClosedObject(t, "RiderMe", obj,
		[]string{"account_id", "first_name", "last_name", "phone_e164", "photo_url", "onboarding_state", "account_status", "availability_state", "vehicle", "active_assignment_id", "rating_avg", "timezone", "next_route"},
		[]string{"account_id", "onboarding_state", "account_status", "availability_state", "next_route"})

	assertEnum(t, "RiderMe", "onboarding_state", obj, enumOnboardingState...)
	assertEnum(t, "RiderMe", "account_status", obj, enumAccountStatus...)
	assertEnum(t, "RiderMe", "availability_state", obj, enumAvailability...)
	assertEnum(t, "RiderMe", "next_route", obj, enumNextRoute...)

	if obj["account_id"] != riderID {
		t.Errorf("account_id=%v, want %q (self-scope)", obj["account_id"], riderID)
	}
}

// TestShape_GetRiderMe_NextRouteEnumForEveryState guards specifically against
// the leak where next_route was a client path ("/dashboard") rather than a
// value from the closed NextRoute enum, across every onboarding state.
func TestShape_GetRiderMe_NextRouteEnumForEveryState(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	cases := []struct{ state, status string }{
		{"PHONE_VERIFIED", "PENDING"},
		{"VEHICLE_PENDING", "PENDING"},
		{"DOCUMENTS_PENDING", "PENDING"},
		{"DOCUMENTS_REVIEW", "PENDING"},
		{"DOCUMENTS_REJECTED", "PENDING"},
		{"ACTIVE", "ACTIVE"},
	}
	for _, c := range cases {
		t.Run(c.state, func(t *testing.T) {
			riderID := seedRiderAccount(t, ctx, pool, c.state, c.status)
			rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
			}
			obj := asObject(t, "RiderMe", decodeData(t, rec))
			nr, _ := obj["next_route"].(string)
			if strings.HasPrefix(nr, "/") {
				t.Errorf("next_route=%q is a client path, not a NextRoute enum value", nr)
			}
			assertEnum(t, "RiderMe", "next_route", obj, enumNextRoute...)
		})
	}
}

// TestShape_SubmitRiderProfile pins the RiderProfile schema returned by the
// profile write — a distinct, narrower shape than RiderMe. The Stage-2 handler
// returned a RiderMe-shaped body here (onboarding_state/next_route/timestamps),
// which is an additionalProperties:false violation against RiderProfile.
func TestShape_SubmitRiderProfile(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	email := fmt.Sprintf("shape.%d@example.com", time.Now().UnixNano())
	body := map[string]any{"first_name": "Imran", "last_name": "Cheema", "date_of_birth": "1995-03-15", "email": email}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderProfile", decodeData(t, rec))
	assertClosedObject(t, "RiderProfile", obj,
		[]string{"account_id", "first_name", "last_name", "email", "date_of_birth", "timezone"},
		[]string{"account_id", "first_name", "last_name", "date_of_birth"})
	if dob, _ := obj["date_of_birth"].(string); dob != "1995-03-15" {
		t.Errorf("date_of_birth=%q, want 1995-03-15", dob)
	}
}

// TestShape_GetRiderOnboardingStatus pins RiderOnboardingStatus including the
// nested steps_completed object and the documents array element shape.
func TestShape_GetRiderOnboardingStatus(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedKycDocument(t, ctx, pool, riderID, riderID, "PROFILE_PHOTO", "SUBMITTED")

	rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderOnboardingStatus", decodeData(t, rec))
	assertClosedObject(t, "RiderOnboardingStatus", obj,
		[]string{"onboarding_state", "account_status", "progress_percent", "next_step", "next_route", "submitted_at", "decided_at", "attempt_number", "documents", "steps_completed"},
		[]string{"onboarding_state", "account_status", "progress_percent", "next_step", "documents", "steps_completed"})

	assertEnum(t, "RiderOnboardingStatus", "onboarding_state", obj, enumOnboardingState...)
	assertEnum(t, "RiderOnboardingStatus", "account_status", obj, enumAccountStatus...)
	assertEnum(t, "RiderOnboardingStatus", "next_step", obj, enumNextStep...)
	assertIntNumber(t, "RiderOnboardingStatus", "progress_percent", obj)

	steps := asObject(t, "steps_completed", obj["steps_completed"])
	assertClosedObject(t, "steps_completed", steps,
		[]string{"phone_verified", "profile", "vehicle", "documents_submitted", "documents_approved", "payout_onboarded"},
		[]string{"phone_verified", "profile", "vehicle", "documents_submitted", "documents_approved", "payout_onboarded"})
	for _, k := range []string{"phone_verified", "profile", "vehicle", "documents_submitted", "documents_approved", "payout_onboarded"} {
		if _, ok := steps[k].(bool); !ok {
			t.Errorf("steps_completed.%s: expected bool, got %T", k, steps[k])
		}
	}

	docs, ok := obj["documents"].([]any)
	if !ok {
		t.Fatalf("documents: expected array, got %T", obj["documents"])
	}
	if len(docs) == 0 {
		t.Fatal("expected the seeded document to appear")
	}
	assertKycDocumentShape(t, docs[0])
}

// TestShape_SubmitRiderVehicle pins the RiderVehicle schema.
func TestShape_SubmitRiderVehicle(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	plate := fmt.Sprintf("SH%04d", time.Now().UnixNano()%9999)
	body := map[string]any{"vehicle_type": "CAR", "make": "Toyota", "model": "Corolla", "year": 2020, "colour": "Silver", "licence_plate": plate}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderVehicle", decodeData(t, rec))
	assertClosedObject(t, "RiderVehicle", obj,
		[]string{"id", "vehicle_type", "make", "model", "year", "colour", "licence_plate", "is_active"},
		[]string{"id", "vehicle_type", "is_active"})
	assertEnum(t, "RiderVehicle", "vehicle_type", obj, enumVehicleType...)
	if _, ok := obj["is_active"].(bool); !ok {
		t.Errorf("is_active: expected bool, got %T", obj["is_active"])
	}
	if _, ok := obj["year"].(float64); ok {
		assertIntNumber(t, "RiderVehicle", "year", obj)
	}
}

// TestShape_SubmitRiderVehicle_BicycleOmitsFields verifies a BICYCLE payload
// does not leak a fabricated "N/A" plate/make/model — the optional fields must
// be JSON null or absent, never a placeholder string.
func TestShape_SubmitRiderVehicle_BicycleOmitsFields(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", map[string]any{"vehicle_type": "BICYCLE"}, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderVehicle", decodeData(t, rec))
	for _, f := range []string{"licence_plate", "make", "model", "year", "colour"} {
		if v, present := obj[f]; present && v != nil {
			t.Errorf("BICYCLE vehicle leaked %s=%v; motorised-only fields must be null/absent", f, v)
		}
	}
}

// TestShape_ListRiderDocuments pins the KycDocument array element shape.
func TestShape_ListRiderDocuments(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedKycDocument(t, ctx, pool, riderID, riderID, "GOVERNMENT_ID", "SUBMITTED")

	rec := do(t, router, "GET", "/v1/riders/me/documents", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	arr, ok := decodeData(t, rec).([]any)
	if !ok {
		t.Fatalf("documents: expected array")
	}
	if len(arr) == 0 {
		t.Fatal("expected a document")
	}
	for _, d := range arr {
		assertKycDocumentShape(t, d)
	}
}

// assertKycDocumentShape pins a single KycDocument element: exact keys, closed
// doc_type / state enums, and RIDER-scoped subject_type.
func assertKycDocumentShape(t *testing.T, v any) {
	t.Helper()
	obj := asObject(t, "KycDocument", v)
	assertClosedObject(t, "KycDocument", obj,
		[]string{"id", "subject_type", "subject_id", "doc_type", "state", "issuer", "certificate_number", "issued_on", "valid_until", "version", "rejection_reason_code", "review_note", "reviewed_at", "created_at"},
		[]string{"id", "subject_type", "doc_type", "state", "version", "created_at"})
	assertEnum(t, "KycDocument", "subject_type", obj, "RESTAURANT", "RIDER")
	// A rider's document must be RIDER-subject and a rider doc type.
	if st, _ := obj["subject_type"].(string); st != "RIDER" {
		t.Errorf("KycDocument.subject_type=%q, want RIDER on the rider surface", st)
	}
	assertEnum(t, "KycDocument", "doc_type", obj, enumRiderDocType...)
	assertEnum(t, "KycDocument", "state", obj, enumKycDocumentState...)
	assertIntNumber(t, "KycDocument", "version", obj)
}

// TestShape_GetRiderDashboard pins RiderDashboard, its nested today object, and
// the money/count invariants (int cents, closed currency).
func TestShape_GetRiderDashboard(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderDashboard", decodeData(t, rec))
	assertClosedObject(t, "RiderDashboard", obj,
		[]string{"mode", "today", "active_assignment", "current_offer", "tracking_health", "blocking_reasons"},
		[]string{"mode", "today", "active_assignment", "current_offer"})
	assertEnum(t, "RiderDashboard", "mode", obj, enumAvailability...)

	today := asObject(t, "today", obj["today"])
	assertClosedObject(t, "today", today,
		[]string{"gross_cents", "currency", "trips", "online_seconds"},
		[]string{"gross_cents", "currency", "trips", "online_seconds"})
	assertIntNumber(t, "today", "gross_cents", today)
	assertIntNumber(t, "today", "trips", today)
	assertIntNumber(t, "today", "online_seconds", today)
	assertEnum(t, "today", "currency", today, enumCurrency...)

	// active_assignment and current_offer are oneOf[…, null]; the server has no
	// live assignment for a freshly-seeded rider, so both must be JSON null.
	if obj["active_assignment"] != nil {
		t.Errorf("active_assignment: want null for a rider with no assignment, got %T", obj["active_assignment"])
	}
	if obj["current_offer"] != nil {
		t.Errorf("current_offer: want null for a rider with no offer, got %T", obj["current_offer"])
	}
}

// TestShape_SubmitRiderDocuments pins that the write returns a full
// RiderOnboardingStatus (the contract shape) — not a bare {onboarding_state}.
func TestShape_SubmitRiderDocuments(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	for _, dt := range []string{"GOVERNMENT_ID", "PROFILE_PHOTO"} {
		seedKycDocument(t, ctx, pool, riderID, riderID, dt, "SUBMITTED")
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-shape-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	obj := asObject(t, "RiderOnboardingStatus", decodeData(t, rec))
	assertClosedObject(t, "RiderOnboardingStatus", obj,
		[]string{"onboarding_state", "account_status", "progress_percent", "next_step", "next_route", "submitted_at", "decided_at", "attempt_number", "documents", "steps_completed"},
		[]string{"onboarding_state", "account_status", "progress_percent", "next_step", "documents", "steps_completed"})
	if st, _ := obj["onboarding_state"].(string); st != "DOCUMENTS_REVIEW" {
		t.Errorf("onboarding_state=%q, want DOCUMENTS_REVIEW", st)
	}
	if _, ok := obj["steps_completed"]; !ok {
		t.Error("submit-documents response is not a full RiderOnboardingStatus (steps_completed missing)")
	}
}

// TestShape_AttachRiderDocument pins the 201 KycDocument shape.
func TestShape_AttachRiderDocument(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID},
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-att-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	assertKycDocumentShape(t, decodeData(t, rec))
}

// ─────────────────────────────────────────────────────────────────────────────
// B) AUTHZ LEAK — exhaustive role sweep across every op
// ─────────────────────────────────────────────────────────────────────────────

// riderOp is one operation under test with a body that passes validation far
// enough to prove the authz decision (never a 422 that masks a missing 403).
type riderOp struct {
	name   string
	method string
	path   string
	body   any
	idem   bool
}

func riderOps() []riderOp {
	return []riderOp{
		{"getRiderMe", "GET", "/v1/riders/me", nil, false},
		{"getRiderOnboardingStatus", "GET", "/v1/riders/me/onboarding/status", nil, false},
		{"submitRiderProfile", "POST", "/v1/riders/me/onboarding/profile", map[string]any{"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01"}, false},
		{"submitRiderVehicle", "POST", "/v1/riders/me/onboarding/vehicle", map[string]any{"vehicle_type": "BICYCLE"}, false},
		{"listRiderDocuments", "GET", "/v1/riders/me/documents", nil, false},
		{"attachRiderDocument", "POST", "/v1/riders/me/documents", map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": "00000000-0000-0000-0000-000000000001"}, true},
		{"submitRiderDocuments", "POST", "/v1/riders/me/onboarding/documents", nil, true},
		{"getRiderDashboard", "GET", "/v1/riders/me/dashboard", nil, false},
	}
}

// nonRiderRoles is every role in the matrix except RIDER. Each must be denied
// (403) on every rider op, since x-roles is exclusively [RIDER].
var nonRiderRoles = []string{
	"CUSTOMER", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF",
	"SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN",
}

// TestAuthz_EveryNonRiderRoleDeniedOnEveryOp is the full deny matrix: 7 roles ×
// 8 ops, every cell must be 403. A single mis-declared action would surface as
// one non-403 cell.
func TestAuthz_EveryNonRiderRoleDeniedOnEveryOp(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	for _, role := range nonRiderRoles {
		acctID := seedBareAccount(t, ctx, pool, role)
		tok := bearerFor(t, iss, acctID, []string{role})
		for _, op := range riderOps() {
			t.Run(role+"/"+op.name, func(t *testing.T) {
				extra := []string{}
				if op.idem {
					extra = []string{"Idempotency-Key", fmt.Sprintf("k-%d", time.Now().UnixNano())}
				}
				rec := do(t, router, op.method, op.path, op.body, tok, extra...)
				if rec.Code != http.StatusForbidden {
					t.Errorf("%s on %s %s: got %d, want 403", role, op.method, op.path, rec.Code)
				}
			})
		}
	}
}

// TestAuthz_RiderAllowedOnEveryOp is the positive half: a RIDER token must not
// be denied (never 401/403) on any op — it may 2xx or a domain 4xx, but authz
// must pass. This proves no op is accidentally locked out of its own role.
func TestAuthz_RiderAllowedOnEveryOp(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	for _, op := range riderOps() {
		t.Run(op.name, func(t *testing.T) {
			extra := []string{}
			if op.idem {
				extra = []string{"Idempotency-Key", fmt.Sprintf("k-%d", time.Now().UnixNano())}
			}
			rec := do(t, router, op.method, op.path, op.body, tok, extra...)
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Errorf("%s: RIDER got %d, want authz to pass", op.name, rec.Code)
			}
		})
	}
}

// TestAuthz_NoRiderRouteIsPublic re-asserts the deny-by-default invariant: not
// one of the eight rider routes may be registered public.
func TestAuthz_NoRiderRouteIsPublic(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	if err := r.Verify(); err != nil {
		t.Fatalf("route policy verification failed: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Fatalf("rider routes must never be public; found public: %v", pub)
	}
}

// TestAuthz_UnauthenticatedDeniedOnEveryOp: no token → 401 on every op.
func TestAuthz_UnauthenticatedDeniedOnEveryOp(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	for _, op := range riderOps() {
		t.Run(op.name, func(t *testing.T) {
			extra := []string{}
			if op.idem {
				extra = []string{"Idempotency-Key", "anon"}
			}
			rec := do(t, router, op.method, op.path, op.body, "", extra...)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s: unauthenticated got %d, want 401", op.name, rec.Code)
			}
		})
	}
}

// seedBareAccount inserts an account with the given role but no domain rows,
// enough to mint a token and probe an authz decision.
func seedBareAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, role string) string {
	t.Helper()
	phone := uniquePhone()
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account (phone_e164, phone_verified_at, status) VALUES ($1, now(), 'ACTIVE') RETURNING id`, phone,
	).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, $2, 'GLOBAL')`, id, role); err != nil {
		t.Fatalf("grant %s: %v", role, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id=$1`, id)
		pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, id)
	})
	return id
}

// ─────────────────────────────────────────────────────────────────────────────
// G) ERROR TAXONOMY — every failure is a contract ErrorCode, never a bare 500
// ─────────────────────────────────────────────────────────────────────────────

// errorEnvelope is the shape every non-2xx must carry.
type errorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// assertErrorEnvelope decodes a failure body and asserts it carries a non-empty
// error.code and message — i.e. it is a typed ErrorEnvelope, not a bare 500 or
// an empty body.
func assertErrorEnvelope(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code == http.StatusInternalServerError {
		t.Errorf("got a bare 500 (%s) — every expected failure must be a typed 4xx ErrorCode", rec.Body)
	}
	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("error body is not an ErrorEnvelope: %v — body: %s", err, rec.Body)
	}
	if env.Error.Code == "" {
		t.Errorf("error.code empty — not a contract ErrorCode: %s", rec.Body)
	}
	return env.Error.Code
}

// TestErrorTaxonomy_ProfileFailures walks the documented failure codes for the
// profile op and asserts each is a typed envelope with the right code.
func TestErrorTaxonomy_ProfileFailures(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	// UNDERAGE (422)
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile",
		map[string]any{"first_name": "Y", "last_name": "R", "date_of_birth": time.Now().AddDate(-17, 0, 0).Format("2006-01-02")}, tok)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("underage: want 422, got %d", rec.Code)
	}
	if c := assertErrorEnvelope(t, rec); c != "UNDERAGE" {
		t.Errorf("underage code=%q", c)
	}

	// VALIDATION_FAILED (malformed date, 422) — must be typed, not 500.
	rec = do(t, router, "POST", "/v1/riders/me/onboarding/profile",
		map[string]any{"first_name": "A", "last_name": "B", "date_of_birth": "not-a-date"}, tok)
	if c := assertErrorEnvelope(t, rec); c == "" {
		t.Error("malformed date produced no error code")
	}
}

// TestErrorTaxonomy_AttachDocumentIDORIsTypedNotFound verifies the IDOR path
// returns a typed 404 NOT_FOUND envelope, never a bare 500 or a 403 that leaks
// the object's existence.
func TestErrorTaxonomy_AttachDocumentIDORIsTypedNotFound(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rider2 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, rider1)

	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID},
		bearerFor(t, iss, rider2, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idor-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("IDOR: want 404, got %d: %s", rec.Code, rec.Body)
	}
	if c := assertErrorEnvelope(t, rec); c != "NOT_FOUND" {
		t.Errorf("IDOR code=%q, want NOT_FOUND (never a 403 existence leak)", c)
	}
}

// TestErrorTaxonomy_MissingProfileIsTypedNotFound: a RIDER token whose account
// has no rider_profile row must get a typed 404, not a 500.
func TestErrorTaxonomy_MissingProfileIsTypedNotFound(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	// Account with the RIDER role but NO rider_profile row.
	riderID := seedBareAccount(t, ctx, pool, "RIDER")
	rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing profile: want 404, got %d: %s", rec.Code, rec.Body)
	}
	if c := assertErrorEnvelope(t, rec); c != "NOT_FOUND" {
		t.Errorf("missing profile code=%q, want NOT_FOUND", c)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// F) CONCURRENCY / IDEMPOTENCY — a write op run concurrently has no double effect
// ─────────────────────────────────────────────────────────────────────────────

// TestConcurrency_AttachDocumentNoDoubleRow fires the same attach twice
// concurrently (distinct idempotency keys, same object) and asserts the repo's
// dedup keeps a single row — no double effect under a race.
func TestConcurrency_AttachDocumentNoDoubleRow(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	body := map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID}

	type res struct{ code int }
	ch := make(chan res, 2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			rec := do(t, router, "POST", "/v1/riders/me/documents", body, tok,
				"Idempotency-Key", fmt.Sprintf("cc-%d-%d", time.Now().UnixNano(), i))
			ch <- res{rec.Code}
		}(i)
	}
	for i := 0; i < 2; i++ {
		<-ch
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM kyc_document WHERE subject_id=$1 AND rider_doc_type='PROFILE_PHOTO' AND deleted_at IS NULL`,
		riderID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("concurrent attach produced %d rows, want 1 (no double effect)", count)
	}
}

// TestConcurrency_SubmitDocumentsSingleTransition runs the terminal document
// submission twice concurrently and asserts the state lands exactly on
// DOCUMENTS_REVIEW with no error and no skipped/duplicated transition.
func TestConcurrency_SubmitDocumentsSingleTransition(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	for _, dt := range []string{"GOVERNMENT_ID", "PROFILE_PHOTO"} {
		seedKycDocument(t, ctx, pool, riderID, riderID, dt, "SUBMITTED")
	}
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	ch := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil, tok,
				"Idempotency-Key", fmt.Sprintf("cs-%d-%d", time.Now().UnixNano(), i))
			ch <- rec.Code
		}(i)
	}
	for i := 0; i < 2; i++ {
		if code := <-ch; code != http.StatusOK {
			t.Errorf("concurrent submit got %d, want 200", code)
		}
	}
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "DOCUMENTS_REVIEW" {
		t.Errorf("state=%q after concurrent submit, want DOCUMENTS_REVIEW", state)
	}
}
