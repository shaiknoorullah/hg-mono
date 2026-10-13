// Package rider_test — contract-conformance + boundary/leak analysis.
//
// The CONTRACT CONFORMANCE tests (TestShape_*) validate the LIVE server response
// against contracts/openapi.yaml via the kin-openapi oracle
// (checkConformant → internal/conformance.ValidateResponse). This replaces the
// former hand-transcribed enum var lists (enumOnboardingState, enumNextRoute, …)
// and hand-coded closed-object key sets (assertClosedObject, the RiderMe literal
// key list, assertKycDocumentShape) — a "closed shape" check is only as correct
// as the transcription behind it, and a stale/over-permissive list lets drift
// through. The loaded contract — additionalProperties:false + required[] + closed
// enums — is now the sole oracle.
//
// The AUTHZ (B), ERROR TAXONOMY (G) and CONCURRENCY (F) tests below are retained
// unchanged: they pin invariants the schema oracle does not (deny-by-default role
// sweep, typed error codes, single-effect concurrency).
package rider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─────────────────────────────────────────────────────────────────────────────
// A) CONTRACT CONFORMANCE — the live response is validated against the contract
// ─────────────────────────────────────────────────────────────────────────────

// TestShape_GetRiderMe pins RiderMe: the live body must conform exactly. The
// NextRoute enum (previously a raw client path — a conformance leak) is enforced
// by the contract's closed enum, so a "/dashboard"-style value now fails here.
func TestShape_GetRiderMe(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	obj := checkConformant(t, router, "GET", "/v1/riders/me", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
	if obj["account_id"] != riderID {
		t.Errorf("account_id=%v, want %q (self-scope)", obj["account_id"], riderID)
	}
}

// TestShape_GetRiderMe_NextRouteEnumForEveryState guards specifically against the
// leak where next_route was a client path rather than a NextRoute enum value,
// across every onboarding state. The contract enum membership is enforced by
// checkConformant; this test also rejects any leading-slash path defensively.
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
			obj := checkConformant(t, router, "GET", "/v1/riders/me", nil,
				bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
			if nr, _ := obj["next_route"].(string); len(nr) > 0 && nr[0] == '/' {
				t.Errorf("next_route=%q is a client path, not a NextRoute enum value", nr)
			}
		})
	}
}

// TestShape_SubmitRiderProfile pins RiderProfile (the write's narrower shape). A
// RiderMe-shaped body here (onboarding_state/next_route/timestamps) is an
// additionalProperties:false violation the contract oracle catches.
func TestShape_SubmitRiderProfile(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	email := fmt.Sprintf("shape.%d@example.com", time.Now().UnixNano())
	body := map[string]any{"first_name": "Imran", "last_name": "Cheema", "date_of_birth": "1995-03-15", "email": email}
	obj := checkConformant(t, router, "POST", "/v1/riders/me/onboarding/profile", body,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
	if dob, _ := obj["date_of_birth"].(string); dob != "1995-03-15" {
		t.Errorf("date_of_birth=%q, want 1995-03-15", dob)
	}
}

// TestShape_GetRiderOnboardingStatus pins RiderOnboardingStatus including the
// nested steps_completed object and the documents array element (KycDocument).
func TestShape_GetRiderOnboardingStatus(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedKycDocument(t, ctx, pool, riderID, riderID, "PROFILE_PHOTO", "SUBMITTED")

	obj := checkConformant(t, router, "GET", "/v1/riders/me/onboarding/status", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
	docs, _ := obj["documents"].([]any)
	if len(docs) == 0 {
		t.Fatal("expected the seeded document to appear")
	}
}

// TestShape_SubmitRiderVehicle pins RiderVehicle.
func TestShape_SubmitRiderVehicle(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	plate := fmt.Sprintf("SH%04d", time.Now().UnixNano()%9999)
	body := map[string]any{"vehicle_type": "CAR", "make": "Toyota", "model": "Corolla", "year": 2020, "colour": "Silver", "licence_plate": plate}
	obj := checkConformant(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
	if _, ok := obj["is_active"].(bool); !ok {
		t.Errorf("is_active: expected bool, got %T", obj["is_active"])
	}
}

// TestShape_SubmitRiderVehicle_BicycleOmitsFields verifies a BICYCLE payload does
// not leak a fabricated "N/A" plate/make/model — the optional fields must be JSON
// null or absent, never a placeholder string. (A placeholder is contract-legal
// as a string, so this stays an explicit semantic check on top of the schema.)
func TestShape_SubmitRiderVehicle_BicycleOmitsFields(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	obj := checkConformant(t, router, "POST", "/v1/riders/me/onboarding/vehicle",
		map[string]any{"vehicle_type": "BICYCLE"},
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
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

	// A bare-array (non-envelope) body still validates against the operation's
	// declared response schema; checkConformant runs ValidateResponse on it.
	checkConformant(t, router, "GET", "/v1/riders/me/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
}

// TestShape_GetRiderDashboard pins RiderDashboard and its nested today object.
func TestShape_GetRiderDashboard(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	obj := checkConformant(t, router, "GET", "/v1/riders/me/dashboard", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK)
	// active_assignment / current_offer are oneOf[…, null]; a freshly-seeded rider
	// has neither, so both must be JSON null.
	if obj["active_assignment"] != nil {
		t.Errorf("active_assignment: want null, got %T", obj["active_assignment"])
	}
	if obj["current_offer"] != nil {
		t.Errorf("current_offer: want null, got %T", obj["current_offer"])
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
	obj := checkConformant(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusOK,
		"Idempotency-Key", fmt.Sprintf("idem-shape-%d", time.Now().UnixNano()))
	if st, _ := obj["onboarding_state"].(string); st != "DOCUMENTS_REVIEW" {
		t.Errorf("onboarding_state=%q, want DOCUMENTS_REVIEW", st)
	}
}

// TestShape_AttachRiderDocument pins the 201 KycDocument shape.
func TestShape_AttachRiderDocument(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	checkConformant(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID},
		bearerFor(t, iss, riderID, []string{"RIDER"}), http.StatusCreated,
		"Idempotency-Key", fmt.Sprintf("idem-att-%d", time.Now().UnixNano()))
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
// concurrently (distinct idempotency keys, same object) and asserts a single
// row, returned to both callers — no double effect under a race (#229).
func TestConcurrency_AttachDocumentNoDoubleRow(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	body := map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID}

	type res struct {
		code int
		id   string
	}
	ch := make(chan res, 2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			rec := do(t, router, "POST", "/v1/riders/me/documents", body, tok,
				"Idempotency-Key", fmt.Sprintf("cc-%d-%d", time.Now().UnixNano(), i))
			var env struct {
				Data struct {
					ID string `json:"id"`
				} `json:"data"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &env)
			ch <- res{rec.Code, env.Data.ID}
		}(i)
	}
	ids := map[string]bool{}
	for i := 0; i < 2; i++ {
		r := <-ch
		if r.code != http.StatusCreated {
			t.Errorf("concurrent attach got %d, want 201", r.code)
		}
		ids[r.id] = true
	}
	if len(ids) != 1 {
		t.Errorf("concurrent attach returned document ids %v, want the same one twice", ids)
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
