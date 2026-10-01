// Package rider_test provides integration and unit tests for the rider
// self-service surface (D-02, D-03, D-04, D-05, D-06, D-18).
//
// STAGE 1 — RED: every test is written against the intended behaviour of the
// unimplemented package. Running `go test` must fail because the package does
// not yet exist — the tests must not merely fail to compile, they must fail for
// the right reason (handler returns 404 / function not declared / etc.).
//
// Gate rules (from the task brief):
//  1. Happy path returning the exact contract shape
//  2. Every documented error code for the op
//  3. Authz: RIDER allowed; at least one non-RIDER role denied (403); unauthenticated → 401
//  4. Input validation: unknown fields rejected; price fields rejected on writes
//  5. Ownership/IDOR: another account's resource returns 404, never their data
//  6. Idempotency for writes
//  7. Domain invariant relevant to the op (state-machine, age gate, etc.)
package rider

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

// openTestDB returns a pool against HG_TEST_POSTGRES_DSN or skips.
func openTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set — skipping rider integration test")
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

// testKeyPair generates a fresh Ed25519 key pair for signing test JWTs.
func testKeyPair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

// buildRouter constructs a fully-wired test router with the rider routes
// registered, a real auth matrix, and the given pool.
func buildRouter(t *testing.T, pool *pgxpool.Pool) (*httpx.Router, *session.Issuer) {
	t.Helper()
	pub, priv := testKeyPair(t)
	iss := session.NewIssuer("k1", priv, "hg-api")
	ver := session.NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	deny := session.NewDenySet()
	authenticator := auth.NewAuthenticator(ver, deny)
	authorizer := auth.Matrix{}

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		CORSOrigins:   []string{"http://localhost:3000"},
		Authenticator: authenticator,
		Authorizer:    authorizer,
	})

	repo := NewRepo(pool)
	svc := NewService(repo)
	Routes(router, NewHandler(svc))
	return router, iss
}

// bearerFor mints a short-lived JWT for the given accountID and roles.
func bearerFor(t *testing.T, iss *session.Issuer, accountID string, roles []string) string {
	t.Helper()
	tok, err := iss.Issue(accountID, "sess-"+accountID, roles, []string{"otp"}, 15*time.Minute)
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	return "Bearer " + tok
}

// do executes an HTTP request against the router using httptest.
func do(t *testing.T, router http.Handler, method, path string, body any, authHeader string, extraHeaders ...string) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *bytes.Buffer
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		bodyReader = bytes.NewBuffer(b)
	} else {
		bodyReader = bytes.NewBuffer(nil)
	}
	req, err := http.NewRequest(method, path, bodyReader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	for i := 0; i+1 < len(extraHeaders); i += 2 {
		req.Header.Set(extraHeaders[i], extraHeaders[i+1])
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// mustJSON decodes rec's body into v; fails the test on error.
func mustJSON(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.NewDecoder(rec.Body).Decode(v); err != nil {
		t.Fatalf("decode response (%d): %v — body: %s", rec.Code, err, rec.Body)
	}
}

// errorCode extracts the error.code string from a non-2xx response.
func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	mustJSON(t, rec, &env)
	return env.Error.Code
}

// ─────────────────────────────────────────────────────────────────────────────
// DB seed helpers
// ─────────────────────────────────────────────────────────────────────────────

// uniquePhone returns a unique E.164 test number. Uses time + random offset to
// avoid collisions across parallel sub-tests.
func uniquePhone() string {
	n := time.Now().UnixNano() % 9_000_000
	if n < 0 {
		n = -n
	}
	return fmt.Sprintf("+14165%07d", n)
}

// seedRiderAccount inserts an account with a RIDER role and a rider_profile row
// in the given onboardingState, returning the account's UUID string.
func seedRiderAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, onboardingState, accountStatus string) string {
	t.Helper()
	phone := uniquePhone()

	var accountID string
	err := pool.QueryRow(ctx, `
		INSERT INTO account (phone_e164, phone_verified_at, status)
		VALUES ($1, now(), 'ACTIVE')
		RETURNING id`, phone).Scan(&accountID)
	if err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, 'RIDER', 'GLOBAL')`, accountID); err != nil {
		t.Fatalf("grant RIDER role: %v", err)
	}

	// rider_profile has a CONSTRAINT rider_is_adult requiring date_of_birth <= current_date - 18 years.
	// Use a fixed DOB that is always 25 years in the past.
	// CONSTRAINT rider_active_is_approved requires approved_at when account_status='ACTIVE'.
	if accountStatus == "ACTIVE" {
		if _, err := pool.Exec(ctx, `
			INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
			                           onboarding_state, account_status, approved_at)
			VALUES ($1, 'Test', 'Rider', current_date - interval '25 years', $2, $3, now())`,
			accountID, onboardingState, accountStatus); err != nil {
			t.Fatalf("seed rider_profile(%s/%s): %v", onboardingState, accountStatus, err)
		}
	} else {
		if _, err := pool.Exec(ctx, `
			INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
			                           onboarding_state, account_status)
			VALUES ($1, 'Test', 'Rider', current_date - interval '25 years', $2, $3)`,
			accountID, onboardingState, accountStatus); err != nil {
			t.Fatalf("seed rider_profile(%s/%s): %v", onboardingState, accountStatus, err)
		}
	}
	t.Cleanup(func() {
		// Best-effort cleanup; failures here do not fail the test.
		pool.Exec(context.Background(), `DELETE FROM rider_profile WHERE account_id=$1`, accountID)
		pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id=$1`, accountID)
		pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, accountID)
	})
	return accountID
}

// seedRiderVehicle inserts a vehicle row for the given rider account, returning its ID.
func seedRiderVehicle(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountID string, vehicleType string) string {
	t.Helper()
	plate := ""
	switch vehicleType {
	case "CAR", "SCOOTER", "MOTORCYCLE":
		plate = "TEST" + fmt.Sprintf("%04d", time.Now().UnixNano()%10000)
	}
	var vehicleID string
	var err error
	if plate != "" {
		err = pool.QueryRow(ctx, `
			INSERT INTO rider_vehicle (account_id, vehicle_type, make, model, year, colour, licence_plate)
			VALUES ($1, $2, 'Toyota', 'Corolla', 2020, 'Silver', $3)
			RETURNING id`, accountID, vehicleType, plate).Scan(&vehicleID)
	} else {
		err = pool.QueryRow(ctx, `
			INSERT INTO rider_vehicle (account_id, vehicle_type)
			VALUES ($1, $2)
			RETURNING id`, accountID, vehicleType).Scan(&vehicleID)
	}
	if err != nil {
		t.Fatalf("seed rider_vehicle: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rider_vehicle WHERE id=$1`, vehicleID)
	})
	return vehicleID
}

// seedKycDocument inserts a stored_object + kyc_document for a rider and returns the document ID.
func seedKycDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uploaderID, subjectID, docType, state string) string {
	t.Helper()
	var soID string
	err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at, virus_scan_state)
		VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'image/jpeg', 512000,
		        decode(repeat('ab',32),'hex'), 'READY', $1, now(), 'CLEAN')
		RETURNING id`, uploaderID).Scan(&soID)
	if err != nil {
		t.Fatalf("seed stored_object: %v", err)
	}

	var docID string
	switch state {
	case "SUBMITTED", "IN_REVIEW":
		err = pool.QueryRow(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state,
			                          deadline_at, deadline_action)
			VALUES ('RIDER', $1, $2::rider_doc_type, $3, $4, now()+interval '72 hours', 'ESCALATE')
			RETURNING id`, subjectID, docType, soID, state).Scan(&docID)
	case "APPROVED":
		err = pool.QueryRow(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state,
			                          reviewed_by, reviewed_at, valid_until)
			VALUES ('RIDER', $1, $2::rider_doc_type, $3, 'APPROVED', $1, now(), now()::date + 365)
			RETURNING id`, subjectID, docType, soID).Scan(&docID)
	default:
		err = pool.QueryRow(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state,
			                          deadline_at, deadline_action)
			VALUES ('RIDER', $1, $2::rider_doc_type, $3, $4, now()+interval '72 hours', 'ESCALATE')
			RETURNING id`, subjectID, docType, soID, state).Scan(&docID)
	}
	if err != nil {
		t.Fatalf("seed kyc_document(%s %s): %v", docType, state, err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM kyc_document WHERE id=$1`, docID)
		pool.Exec(context.Background(), `DELETE FROM stored_object WHERE id=$1`, soID)
	})
	return docID
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit test: route registration and policy verification
// ─────────────────────────────────────────────────────────────────────────────

// TestRoutesVerify ensures every rider route carries a coherent Policy with a
// declared Action (never Public — rider surface is always authenticated).
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	if err := r.Verify(); err != nil {
		t.Fatalf("rider routes failed policy verification: %v", err)
	}
	// No rider route may be public — x-roles:[RIDER] means authenticated.
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("rider routes must never be public, found: %v", pub)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// getRiderMe — GET /v1/riders/me
// ─────────────────────────────────────────────────────────────────────────────

// TestGetRiderMe_Happy verifies the 200 response shape matches the contract's
// RiderMe schema, scoped to the authenticated caller's own account.
func TestGetRiderMe_Happy(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/riders/me status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			AccountID         string `json:"account_id"`
			OnboardingState   string `json:"onboarding_state"`
			AccountStatus     string `json:"account_status"`
			AvailabilityState string `json:"availability_state"`
			NextRoute         string `json:"next_route"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)

	if env.Data.AccountID != riderID {
		t.Errorf("account_id=%q, want %q", env.Data.AccountID, riderID)
	}
	if env.Data.OnboardingState == "" {
		t.Error("onboarding_state must be present")
	}
	if env.Data.AccountStatus == "" {
		t.Error("account_status must be present")
	}
	if env.Data.AvailabilityState == "" {
		t.Error("availability_state must be present")
	}
	if env.Data.NextRoute == "" {
		t.Error("next_route must be present")
	}
}

// TestGetRiderMe_Unauthenticated verifies 401 when no token is present.
func TestGetRiderMe_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "GET", "/v1/riders/me", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rec.Code, rec.Body)
	}
}

// TestGetRiderMe_WrongRole verifies 403 for a CUSTOMER token on a RIDER-only route.
func TestGetRiderMe_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	// Seed a customer account (no rider_profile required; auth check happens first).
	phone := uniquePhone()
	var customerID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account (phone_e164, phone_verified_at, status) VALUES ($1, now(), 'ACTIVE') RETURNING id`, phone,
	).Scan(&customerID); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, customerID)
	})
	rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, customerID, []string{"CUSTOMER"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body)
	}
}

// TestGetRiderMe_ScopeOwn verifies the endpoint only ever returns the caller's
// own record — a second rider cannot access another's data through this path.
// (IDOR guard: there is no :id in the path; the server derives identity from the
// JWT, so there is nothing to inject. The test asserts account_id matches the caller.)
func TestGetRiderMe_ScopeOwn(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rider2 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")

	// rider2's token must return rider2's data, not rider1's.
	rec := do(t, router, "GET", "/v1/riders/me", nil, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			AccountID string `json:"account_id"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.AccountID == rider1 {
		t.Errorf("rider2's token returned rider1's data — IDOR")
	}
	if env.Data.AccountID != rider2 {
		t.Errorf("account_id=%q, want rider2=%q", env.Data.AccountID, rider2)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// getRiderOnboardingStatus — GET /v1/riders/me/onboarding/status
// ─────────────────────────────────────────────────────────────────────────────

func TestGetRiderOnboardingStatus_Happy(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			OnboardingState string `json:"onboarding_state"`
			AccountStatus   string `json:"account_status"`
			ProgressPercent int    `json:"progress_percent"`
			NextStep        string `json:"next_step"`
			Documents       []any  `json:"documents"`
			StepsCompleted  struct {
				PhoneVerified      bool `json:"phone_verified"`
				Profile            bool `json:"profile"`
				Vehicle            bool `json:"vehicle"`
				DocumentsSubmitted bool `json:"documents_submitted"`
				DocumentsApproved  bool `json:"documents_approved"`
				PayoutOnboarded    bool `json:"payout_onboarded"`
			} `json:"steps_completed"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.OnboardingState == "" {
		t.Error("onboarding_state must be present")
	}
	if env.Data.NextStep == "" {
		t.Error("next_step must be present")
	}
	if env.Data.ProgressPercent < 0 || env.Data.ProgressPercent > 100 {
		t.Errorf("progress_percent=%d out of [0,100]", env.Data.ProgressPercent)
	}
}

func TestGetRiderOnboardingStatus_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestGetRiderOnboardingStatus_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil,
		bearerFor(t, iss, riderID, []string{"RESTAURANT_OWNER"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestGetRiderOnboardingStatus_ProgressPercent checks that progress_percent is
// server-computed and within the valid range for every onboarding state.
func TestGetRiderOnboardingStatus_ProgressPercent(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	for _, state := range []string{"PHONE_VERIFIED", "PROFILE_PENDING", "VEHICLE_PENDING", "DOCUMENTS_PENDING"} {
		t.Run(state, func(t *testing.T) {
			riderID := seedRiderAccount(t, ctx, pool, state, "PENDING")
			rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil,
				bearerFor(t, iss, riderID, []string{"RIDER"}))
			if rec.Code != http.StatusOK {
				t.Fatalf("state=%s status=%d body=%s", state, rec.Code, rec.Body)
			}
			var env struct {
				Data struct {
					ProgressPercent int `json:"progress_percent"`
				} `json:"data"`
			}
			mustJSON(t, rec, &env)
			if env.Data.ProgressPercent < 0 || env.Data.ProgressPercent > 100 {
				t.Errorf("state=%s progress_percent=%d", state, env.Data.ProgressPercent)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// submitRiderProfile — POST /v1/riders/me/onboarding/profile
// ─────────────────────────────────────────────────────────────────────────────

func TestSubmitRiderProfile_Happy(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":    "Imran",
		"last_name":     "Cheema",
		"date_of_birth": "1995-03-15",
		"email":         fmt.Sprintf("imran.cheema.%d@example.com", time.Now().UnixNano()),
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			AccountID   string `json:"account_id"`
			FirstName   string `json:"first_name"`
			LastName    string `json:"last_name"`
			DateOfBirth string `json:"date_of_birth"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.AccountID != riderID {
		t.Errorf("account_id=%q, want %q", env.Data.AccountID, riderID)
	}
	if env.Data.FirstName != "Imran" {
		t.Errorf("first_name=%q", env.Data.FirstName)
	}
	if env.Data.DateOfBirth != "1995-03-15" {
		t.Errorf("date_of_birth=%q", env.Data.DateOfBirth)
	}
}

// TestSubmitRiderProfile_Underage verifies that a DOB making the rider < 18
// returns 422 UNDERAGE, per D-03.
func TestSubmitRiderProfile_Underage(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	// A DOB that makes the rider 17 years and 364 days old.
	dob := time.Now().AddDate(-18, 0, 1).Format("2006-01-02")
	body := map[string]any{
		"first_name":    "Young",
		"last_name":     "Rider",
		"date_of_birth": dob,
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "UNDERAGE" {
		t.Errorf("error.code=%q, want UNDERAGE", code)
	}
}

// TestSubmitRiderProfile_EmailInUse verifies 409 EMAIL_IN_USE when the email
// is already registered to another active rider (D-03).
func TestSubmitRiderProfile_EmailInUse(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	// Seed an existing rider who already owns the email.
	existingEmail := fmt.Sprintf("taken.%d@example.com", time.Now().UnixNano())
	rider1 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	if _, err := pool.Exec(ctx,
		`UPDATE account SET email=$1 WHERE id=$2`, existingEmail, rider1); err != nil {
		t.Fatalf("set email: %v", err)
	}

	rider2 := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":    "Ali",
		"last_name":     "Khan",
		"date_of_birth": "1990-01-01",
		"email":         existingEmail,
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "EMAIL_IN_USE" {
		t.Errorf("error.code=%q, want EMAIL_IN_USE", code)
	}
}

// TestSubmitRiderProfile_ImmutableDOBAfterApproval verifies 409
// IMMUTABLE_AFTER_APPROVAL when an ACTIVE rider tries to change their DOB (D-03).
func TestSubmitRiderProfile_ImmutableDOBAfterApproval(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	// Mark documents as approved.
	if _, err := pool.Exec(ctx,
		`UPDATE rider_profile SET approved_at=now() WHERE account_id=$1`, riderID); err != nil {
		t.Fatalf("set approved_at: %v", err)
	}

	body := map[string]any{
		"first_name":    "Imran",
		"last_name":     "Cheema",
		"date_of_birth": "1994-01-01", // different DOB
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "IMMUTABLE_AFTER_APPROVAL" {
		t.Errorf("error.code=%q, want IMMUTABLE_AFTER_APPROVAL", code)
	}
}

// TestSubmitRiderProfile_UnknownFieldsRejected verifies DisallowUnknownFields is
// enforced — an extra field in the body must return 400/422, not be silently ignored.
func TestSubmitRiderProfile_UnknownFieldsRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":     "Test",
		"last_name":      "Rider",
		"date_of_birth":  "1995-01-01",
		"admin_override": true, // unknown field
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code >= 200 && rec.Code < 300 {
		t.Fatal("unknown fields must not be silently accepted")
	}
}

// TestSubmitRiderProfile_PriceFieldRejected ensures inbound bodies may not carry
// price fields (invariant: the server computes prices, not the client).
func TestSubmitRiderProfile_PriceFieldRejected(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":    "Test",
		"last_name":     "Rider",
		"date_of_birth": "1995-01-01",
		"amount_cents":  1000, // price field — forbidden
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code >= 200 && rec.Code < 300 {
		t.Fatal("price fields in inbound body must be rejected")
	}
}

func TestSubmitRiderProfile_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	body := map[string]any{"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01"}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestSubmitRiderProfile_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01"}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body,
		bearerFor(t, iss, riderID, []string{"ADMIN"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestSubmitRiderProfile_Idempotent verifies that posting the same profile twice
// returns the same result (no duplicate row, no error on the second call).
func TestSubmitRiderProfile_Idempotent(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":    "Idempotent",
		"last_name":     "Test",
		"date_of_birth": "1990-06-01",
	}
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	rec1 := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, tok)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first call: status=%d body=%s", rec1.Code, rec1.Body)
	}
	rec2 := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, tok)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second (idempotent) call: status=%d body=%s", rec2.Code, rec2.Body)
	}
}

// TestSubmitRiderProfile_StateMachineAdvance verifies that a successful profile
// submission moves onboarding_state from PHONE_VERIFIED to VEHICLE_PENDING (D-03).
func TestSubmitRiderProfile_StateMachineAdvance(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
	body := map[string]any{
		"first_name":    "State",
		"last_name":     "Machine",
		"date_of_birth": "1990-01-01",
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	// Verify DB state advanced.
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "VEHICLE_PENDING" {
		t.Errorf("onboarding_state=%q after profile submit, want VEHICLE_PENDING", state)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// submitRiderVehicle — POST /v1/riders/me/onboarding/vehicle
// ─────────────────────────────────────────────────────────────────────────────

func TestSubmitRiderVehicle_Happy_CAR(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	plate := fmt.Sprintf("HG%04d", time.Now().UnixNano()%9999)
	body := map[string]any{
		"vehicle_type":  "CAR",
		"make":          "Toyota",
		"model":         "Corolla",
		"year":          2020,
		"colour":        "Silver",
		"licence_plate": plate,
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			ID           string `json:"id"`
			VehicleType  string `json:"vehicle_type"`
			LicencePlate string `json:"licence_plate"`
			IsActive     bool   `json:"is_active"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.VehicleType != "CAR" {
		t.Errorf("vehicle_type=%q", env.Data.VehicleType)
	}
	if env.Data.LicencePlate != plate {
		t.Errorf("licence_plate=%q", env.Data.LicencePlate)
	}
	if !env.Data.IsActive {
		t.Error("is_active must be true")
	}
}

func TestSubmitRiderVehicle_Happy_BICYCLE(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{
		"vehicle_type": "BICYCLE",
		// No plate, make, model, year — as required by D-04.
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
}

// TestSubmitRiderVehicle_BicycleWithPlate verifies BICYCLE + licence_plate = 422
// FIELD_NOT_APPLICABLE (D-04).
func TestSubmitRiderVehicle_BicycleWithPlate(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{
		"vehicle_type":  "BICYCLE",
		"licence_plate": "BIKE123",
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "FIELD_NOT_APPLICABLE" {
		t.Errorf("error.code=%q, want FIELD_NOT_APPLICABLE", code)
	}
}

// TestSubmitRiderVehicle_CarWithoutPlate verifies CAR without a plate = 422
// FIELD_REQUIRED (D-04).
func TestSubmitRiderVehicle_CarWithoutPlate(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{
		"vehicle_type": "CAR",
		"make":         "Toyota",
		"model":        "Camry",
		"year":         2021,
		"colour":       "Blue",
		// licence_plate absent
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "FIELD_REQUIRED" {
		t.Errorf("error.code=%q, want FIELD_REQUIRED", code)
	}
}

// TestSubmitRiderVehicle_PlateInUse verifies 409 PLATE_IN_USE for a duplicate plate.
func TestSubmitRiderVehicle_PlateInUse(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	// Seed a rider who already owns the plate. The plate uniqueness index is
	// scoped to active, non-deleted rows, so the colliding vehicle must be
	// rider1's *sole active* vehicle — inserting a second active vehicle would
	// instead trip the one-active-per-rider index and leave no active plate to
	// collide against (which previously made this test a false pass).
	rider1 := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	plate := fmt.Sprintf("DUP%04d", time.Now().UnixNano()%9999)
	if _, err := pool.Exec(ctx,
		`INSERT INTO rider_vehicle (account_id, vehicle_type, make, model, year, colour, licence_plate)
		 VALUES ($1, 'CAR', 'Honda', 'Civic', 2019, 'Red', $2)`, rider1, plate); err != nil {
		t.Fatalf("seed colliding plate: %v", err)
	}

	rider2 := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{
		"vehicle_type":  "CAR",
		"make":          "Nissan",
		"model":         "Sentra",
		"year":          2020,
		"colour":        "Black",
		"licence_plate": plate,
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "PLATE_IN_USE" {
		t.Errorf("error.code=%q, want PLATE_IN_USE", code)
	}
}

// TestSubmitRiderVehicle_UnknownFields verifies unknown fields are rejected.
func TestSubmitRiderVehicle_UnknownFields(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{
		"vehicle_type": "BICYCLE",
		"secret_field": "hacked",
	}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code >= 200 && rec.Code < 300 {
		t.Fatal("unknown fields must not be silently accepted")
	}
}

func TestSubmitRiderVehicle_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", map[string]any{"vehicle_type": "BICYCLE"}, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestSubmitRiderVehicle_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle",
		map[string]any{"vehicle_type": "BICYCLE"},
		bearerFor(t, iss, riderID, []string{"SUPPORT_AGENT"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestSubmitRiderVehicle_StateMachineAdvance verifies VEHICLE_PENDING → DOCUMENTS_PENDING.
func TestSubmitRiderVehicle_StateMachineAdvance(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	body := map[string]any{"vehicle_type": "BICYCLE"}
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "DOCUMENTS_PENDING" {
		t.Errorf("onboarding_state=%q after vehicle submit, want DOCUMENTS_PENDING", state)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// listRiderDocuments — GET /v1/riders/me/documents
// ─────────────────────────────────────────────────────────────────────────────

func TestListRiderDocuments_Happy(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedKycDocument(t, ctx, pool, riderID, riderID, "PROFILE_PHOTO", "SUBMITTED")

	rec := do(t, router, "GET", "/v1/riders/me/documents", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data []struct {
			ID          string `json:"id"`
			SubjectType string `json:"subject_type"`
			DocType     string `json:"doc_type"`
			State       string `json:"state"`
			Version     int    `json:"version"`
			CreatedAt   string `json:"created_at"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if len(env.Data) == 0 {
		t.Error("want at least one document in response")
	}
	for _, d := range env.Data {
		if d.SubjectType != "RIDER" {
			t.Errorf("document subject_type=%q, want RIDER", d.SubjectType)
		}
		if d.ID == "" {
			t.Error("document id must be non-empty")
		}
	}
}

func TestListRiderDocuments_Empty(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rec := do(t, router, "GET", "/v1/riders/me/documents", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data []any `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data == nil {
		t.Error("data must be an array (possibly empty), not null")
	}
}

// TestListRiderDocuments_IDOR verifies a rider only sees their own documents.
func TestListRiderDocuments_IDOR(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rider2 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	// rider1 has a document; rider2 should NOT see it.
	seedKycDocument(t, ctx, pool, rider1, rider1, "PROFILE_PHOTO", "SUBMITTED")

	rec := do(t, router, "GET", "/v1/riders/me/documents", nil, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data []struct {
			SubjectID string `json:"subject_id"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	for _, d := range env.Data {
		if d.SubjectID == rider1 {
			t.Errorf("rider2 can see rider1's document — IDOR violation")
		}
	}
}

func TestListRiderDocuments_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "GET", "/v1/riders/me/documents", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestListRiderDocuments_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rec := do(t, router, "GET", "/v1/riders/me/documents", nil,
		bearerFor(t, iss, riderID, []string{"RESTAURANT_MANAGER"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// attachRiderDocument — POST /v1/riders/me/documents
// ─────────────────────────────────────────────────────────────────────────────

// seedReadyObject inserts a READY stored_object for the given uploader and returns its ID.
func seedReadyObject(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uploaderID string) string {
	t.Helper()
	var soID string
	err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
		                           state, uploaded_by, confirmed_at)
		VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'image/jpeg', 512000,
		        decode(repeat('ab',32),'hex'), 'READY', $1, now())
		RETURNING id`, uploaderID).Scan(&soID)
	if err != nil {
		t.Fatalf("seed stored_object: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM stored_object WHERE id=$1`, soID)
	})
	return soID
}

func TestAttachRiderDocument_Happy_ProfilePhoto(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)

	body := map[string]any{
		"doc_type":         "PROFILE_PHOTO",
		"stored_object_id": soID,
		// No expires_on — PROFILE_PHOTO exemption.
	}
	idempotencyKey := fmt.Sprintf("idem-%d", time.Now().UnixNano())
	rec := do(t, router, "POST", "/v1/riders/me/documents", body,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", idempotencyKey)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			ID      string `json:"id"`
			DocType string `json:"doc_type"`
			State   string `json:"state"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.DocType != "PROFILE_PHOTO" {
		t.Errorf("doc_type=%q", env.Data.DocType)
	}
}

// TestAttachRiderDocument_ExpiryTooSoon verifies 422 DOCUMENT_EXPIRES_TOO_SOON
// when expires_on is < 30 days in the future (D-05).
func TestAttachRiderDocument_ExpiryTooSoon(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)

	body := map[string]any{
		"doc_type":         "DRIVERS_LICENCE",
		"stored_object_id": soID,
		"expires_on":       time.Now().AddDate(0, 0, 10).Format("2006-01-02"), // only 10 days out
	}
	rec := do(t, router, "POST", "/v1/riders/me/documents", body,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "DOCUMENT_EXPIRES_TOO_SOON" {
		t.Errorf("error.code=%q, want DOCUMENT_EXPIRES_TOO_SOON", code)
	}
}

// TestAttachRiderDocument_Idempotent verifies that the same Idempotency-Key
// replays the stored response rather than creating a second document row.
func TestAttachRiderDocument_Idempotent(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	idempotencyKey := fmt.Sprintf("idem-photo-%d", time.Now().UnixNano())

	body := map[string]any{
		"doc_type":         "PROFILE_PHOTO",
		"stored_object_id": soID,
	}
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	rec1 := do(t, router, "POST", "/v1/riders/me/documents", body, tok, "Idempotency-Key", idempotencyKey)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first attach: status=%d body=%s", rec1.Code, rec1.Body)
	}
	rec2 := do(t, router, "POST", "/v1/riders/me/documents", body, tok, "Idempotency-Key", idempotencyKey)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("second (idempotent) attach: status=%d body=%s", rec2.Code, rec2.Body)
	}
	// Confirm only one document row exists.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM kyc_document WHERE subject_id=$1 AND rider_doc_type='PROFILE_PHOTO'`,
		riderID).Scan(&count); err != nil {
		t.Fatalf("count documents: %v", err)
	}
	if count != 1 {
		t.Errorf("idempotent attach created %d rows, want 1", count)
	}
}

// TestAttachRiderDocument_UnknownFields verifies DisallowUnknownFields.
func TestAttachRiderDocument_UnknownFields(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	body := map[string]any{
		"doc_type":         "PROFILE_PHOTO",
		"stored_object_id": soID,
		"sneaky_field":     "evil",
	}
	rec := do(t, router, "POST", "/v1/riders/me/documents", body,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-%d", time.Now().UnixNano()))
	if rec.Code >= 200 && rec.Code < 300 {
		t.Fatal("unknown fields must not be silently accepted")
	}
}

func TestAttachRiderDocument_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": "00000000-0000-0000-0000-000000000001"},
		"", "Idempotency-Key", "idem-anon")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestAttachRiderDocument_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": "00000000-0000-0000-0000-000000000001"},
		bearerFor(t, iss, riderID, []string{"CUSTOMER"}),
		"Idempotency-Key", "idem-wrong")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestAttachRiderDocument_IDOR verifies a rider cannot attach to another
// rider's stored_object by presenting an object uploaded by another account.
func TestAttachRiderDocument_IDOR(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rider2 := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, rider1) // uploaded by rider1

	// rider2 tries to attach rider1's object.
	body := map[string]any{
		"doc_type":         "PROFILE_PHOTO",
		"stored_object_id": soID,
	}
	rec := do(t, router, "POST", "/v1/riders/me/documents", body,
		bearerFor(t, iss, rider2, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-idor-%d", time.Now().UnixNano()))
	if rec.Code == http.StatusCreated {
		t.Fatal("rider2 attached rider1's object — IDOR violation")
	}
	// Must return 404 (not 403 — ownership violations are 404 per invariant).
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 for IDOR, got %d: %s", rec.Code, rec.Body)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// submitRiderDocuments — POST /v1/riders/me/onboarding/documents
// ─────────────────────────────────────────────────────────────────────────────

// seedCompleteDocumentSet seeds all required documents for a BICYCLE rider.
func seedCompleteDocumentSet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, riderID string) {
	t.Helper()
	for _, docType := range []string{"GOVERNMENT_ID", "PROFILE_PHOTO"} {
		seedKycDocument(t, ctx, pool, riderID, riderID, docType, "SUBMITTED")
	}
}

// seedCompleteCarDocumentSet seeds all required documents for a CAR rider.
func seedCompleteCarDocumentSet(t *testing.T, ctx context.Context, pool *pgxpool.Pool, riderID string) {
	t.Helper()
	for _, docType := range []string{"DRIVERS_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSURANCE", "PROFILE_PHOTO"} {
		seedKycDocument(t, ctx, pool, riderID, riderID, docType, "SUBMITTED")
	}
}

func TestSubmitRiderDocuments_Happy_BICYCLE(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	seedCompleteDocumentSet(t, ctx, pool, riderID)

	idempotencyKey := fmt.Sprintf("idem-docs-%d", time.Now().UnixNano())
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", idempotencyKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			OnboardingState string `json:"onboarding_state"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.OnboardingState != "DOCUMENTS_REVIEW" {
		t.Errorf("onboarding_state=%q, want DOCUMENTS_REVIEW", env.Data.OnboardingState)
	}
}

// TestSubmitRiderDocuments_Incomplete verifies 422 DOCUMENTS_INCOMPLETE with
// details.missing[] naming each missing type (D-05).
func TestSubmitRiderDocuments_Incomplete(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "CAR")
	// Only profile photo, missing DRIVERS_LICENCE, VEHICLE_REGISTRATION, VEHICLE_INSURANCE.
	seedKycDocument(t, ctx, pool, riderID, riderID, "PROFILE_PHOTO", "SUBMITTED")

	idempotencyKey := fmt.Sprintf("idem-incomplete-%d", time.Now().UnixNano())
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", idempotencyKey)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d: %s", rec.Code, rec.Body)
	}
	if code := errorCode(t, rec); code != "DOCUMENTS_INCOMPLETE" {
		t.Errorf("error.code=%q, want DOCUMENTS_INCOMPLETE", code)
	}
}

// TestSubmitRiderDocuments_Idempotent verifies replaying the same idempotency key
// returns the same result and does not transition state twice.
func TestSubmitRiderDocuments_Idempotent(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	seedCompleteDocumentSet(t, ctx, pool, riderID)

	idempotencyKey := fmt.Sprintf("idem-docs2-%d", time.Now().UnixNano())
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	rec1 := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil, tok, "Idempotency-Key", idempotencyKey)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first call: status=%d body=%s", rec1.Code, rec1.Body)
	}
	rec2 := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil, tok, "Idempotency-Key", idempotencyKey)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second (idempotent) call: status=%d body=%s", rec2.Code, rec2.Body)
	}
	// State must still be DOCUMENTS_REVIEW, not advanced further.
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "DOCUMENTS_REVIEW" {
		t.Errorf("onboarding_state=%q, want DOCUMENTS_REVIEW", state)
	}
}

func TestSubmitRiderDocuments_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil, "",
		"Idempotency-Key", "idem-anon")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestSubmitRiderDocuments_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"ADMIN"}),
		"Idempotency-Key", "idem-wrong-role")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestSubmitRiderDocuments_StateMachineAdvance verifies DOCUMENTS_PENDING → DOCUMENTS_REVIEW.
func TestSubmitRiderDocuments_StateMachineAdvance(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	seedCompleteDocumentSet(t, ctx, pool, riderID)

	rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil,
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-sm-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var state string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "DOCUMENTS_REVIEW" {
		t.Errorf("onboarding_state=%q after document submit, want DOCUMENTS_REVIEW", state)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// getRiderDashboard — GET /v1/riders/me/dashboard
// ─────────────────────────────────────────────────────────────────────────────

func TestGetRiderDashboard_Happy(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			Mode  string `json:"mode"`
			Today struct {
				GrossCents    int    `json:"gross_cents"`
				Currency      string `json:"currency"`
				Trips         int    `json:"trips"`
				OnlineSeconds int64  `json:"online_seconds"`
			} `json:"today"`
			ActiveAssignment any `json:"active_assignment"`
			CurrentOffer     any `json:"current_offer"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.Mode == "" {
		t.Error("mode must be present")
	}
	if env.Data.Today.Currency == "" {
		t.Error("today.currency must be present")
	}
	// today.gross_cents must be an integer (money invariant: no floats)
	// The raw JSON is already verified by the struct decode above (int type).
}

// TestGetRiderDashboard_TodayGrossIsIntCents verifies the money invariant:
// today.gross_cents must be an integer, not a float.
func TestGetRiderDashboard_TodayGrossIsIntCents(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	// Decode as raw JSON to check the type of gross_cents.
	var rawEnv map[string]any
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&rawEnv); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data, ok := rawEnv["data"].(map[string]any)
	if !ok {
		t.Fatal("data must be an object")
	}
	today, ok := data["today"].(map[string]any)
	if !ok {
		t.Fatal("today must be an object")
	}
	grossRaw := today["gross_cents"]
	// JSON numbers decode to float64 in Go; the value must be an integer value.
	grossFloat, ok := grossRaw.(float64)
	if !ok {
		t.Fatalf("gross_cents type=%T, want float64 (JSON number)", grossRaw)
	}
	if grossFloat != float64(int64(grossFloat)) {
		t.Errorf("gross_cents=%v is not an integer value — money invariant violated", grossFloat)
	}
}

func TestGetRiderDashboard_Unauthenticated(t *testing.T) {
	pool := openTestDB(t)
	router, _ := buildRouter(t, pool)
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestGetRiderDashboard_WrongRole(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil,
		bearerFor(t, iss, riderID, []string{"RESTAURANT_STAFF"}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

// TestGetRiderDashboard_ScopeOwn verifies the dashboard is always scoped to
// the authenticated caller's own account — no path param to inject.
func TestGetRiderDashboard_ScopeOwn(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rider2 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")

	// Set rider1 to ONLINE_IDLE so their mode is distinguishable.
	if _, err := pool.Exec(ctx,
		`UPDATE rider_profile SET availability_state='ONLINE_IDLE', is_online=true, availability_changed_at=now()
		 WHERE account_id=$1`, rider1); err != nil {
		t.Fatalf("set availability: %v", err)
	}

	// rider2 must get their own OFFLINE dashboard, not rider1's ONLINE_IDLE one.
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			Mode string `json:"mode"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.Mode == "ONLINE_IDLE" {
		// Could be a false positive if rider2 also happens to be online.
		// We seeded rider2 as OFFLINE (default), so ONLINE_IDLE here is rider1's data.
		t.Error("dashboard returned rider1's mode for rider2 — IDOR / scope violation")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting: deny-by-default invariant
// ─────────────────────────────────────────────────────────────────────────────

// TestAdminRoleDeniedOnAllRiderRoutes verifies that ADMIN tokens (non-RIDER)
// are denied on every rider self-service route, since x-roles is exclusively [RIDER].
func TestAdminRoleDeniedOnAllRiderRoutes(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	phone := uniquePhone()
	var adminID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO account (phone_e164, phone_verified_at, status) VALUES ($1, now(), 'ACTIVE') RETURNING id`, phone,
	).Scan(&adminID); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'ADMIN', 'GLOBAL')`, adminID); err != nil {
		t.Fatalf("grant admin: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id=$1`, adminID)
		pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, adminID)
	})

	adminToken := bearerFor(t, iss, adminID, []string{"ADMIN"})

	routes := []struct {
		method string
		path   string
		body   any
	}{
		{"GET", "/v1/riders/me", nil},
		{"GET", "/v1/riders/me/onboarding/status", nil},
		{"POST", "/v1/riders/me/onboarding/profile", map[string]any{"first_name": "A", "last_name": "B", "date_of_birth": "1990-01-01"}},
		{"POST", "/v1/riders/me/onboarding/vehicle", map[string]any{"vehicle_type": "BICYCLE"}},
		{"GET", "/v1/riders/me/documents", nil},
		{"GET", "/v1/riders/me/dashboard", nil},
	}
	for _, r := range routes {
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			rec := do(t, router, r.method, r.path, r.body, adminToken)
			if rec.Code != http.StatusForbidden {
				t.Errorf("ADMIN token got %d on %s %s, want 403", rec.Code, r.method, r.path)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4 — ADVERSARIAL REGRESSION TESTS
//
// Each test below reproduces a concrete bug found during adversarial review and
// asserts the fix. Before the fix the behaviour was a 500 leak, a swallowed
// error, or a silently stored out-of-contract value.
// ─────────────────────────────────────────────────────────────────────────────

// TestSubmitRiderVehicle_InvalidType_NotFiveHundred: an unknown vehicle_type
// must be a clean 422 VALIDATION_FAILED, never a 500 from the ::vehicle_type
// enum cast leaking as an internal error (enum drift must not leak).
func TestSubmitRiderVehicle_InvalidType_NotFiveHundred(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
	for _, vt := range []string{"TRUCK", "PLANE", "", "'; DROP TABLE rider_vehicle;--", "CAR; DROP"} {
		body := map[string]any{"vehicle_type": vt}
		rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", body, bearerFor(t, iss, riderID, []string{"RIDER"}))
		if rec.Code == http.StatusInternalServerError {
			t.Fatalf("vehicle_type=%q returned 500 (enum drift leaked): %s", vt, rec.Body)
		}
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("vehicle_type=%q got %d, want 422", vt, rec.Code)
			continue
		}
		if code := errorCode(t, rec); code != "VALIDATION_FAILED" {
			t.Errorf("vehicle_type=%q error.code=%q, want VALIDATION_FAILED", vt, code)
		}
	}
}

// TestSubmitRiderVehicle_YearAndPlateBounds: year < 1990 (contract minimum) and
// out-of-range plate length (contract 2–8) must be rejected 422, not stored.
func TestSubmitRiderVehicle_YearAndPlateBounds(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	cases := []struct {
		name string
		body map[string]any
	}{
		{"year_too_old", map[string]any{"vehicle_type": "CAR", "licence_plate": "AB123", "year": 1200}},
		{"year_negative", map[string]any{"vehicle_type": "CAR", "licence_plate": "AB123", "year": -5}},
		{"plate_too_long", map[string]any{"vehicle_type": "CAR", "licence_plate": "TOOLONGPLATE12345"}},
		{"plate_too_short", map[string]any{"vehicle_type": "CAR", "licence_plate": "A"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			riderID := seedRiderAccount(t, ctx, pool, "VEHICLE_PENDING", "PENDING")
			rec := do(t, router, "POST", "/v1/riders/me/onboarding/vehicle", tc.body, bearerFor(t, iss, riderID, []string{"RIDER"}))
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s got %d, want 422: %s", tc.name, rec.Code, rec.Body)
			}
			if code := errorCode(t, rec); code != "VALIDATION_FAILED" {
				t.Errorf("%s error.code=%q, want VALIDATION_FAILED", tc.name, code)
			}
		})
	}
}

// TestSubmitRiderProfile_NameBounds: empty/whitespace names (contract minLength 1)
// and over-length names (contract maxLength 50) must be rejected 422, not stored.
func TestSubmitRiderProfile_NameBounds(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	longName := ""
	for i := 0; i < 200; i++ {
		longName += "x"
	}
	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty_first", map[string]any{"first_name": "", "last_name": "Ok", "date_of_birth": "1990-01-01"}},
		{"whitespace_first", map[string]any{"first_name": "   ", "last_name": "Ok", "date_of_birth": "1990-01-01"}},
		{"empty_last", map[string]any{"first_name": "Ok", "last_name": "", "date_of_birth": "1990-01-01"}},
		{"long_first", map[string]any{"first_name": longName, "last_name": "Ok", "date_of_birth": "1990-01-01"}},
		{"bad_email", map[string]any{"first_name": "Ok", "last_name": "Ok", "date_of_birth": "1990-01-01", "email": "not-an-email"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			riderID := seedRiderAccount(t, ctx, pool, "PHONE_VERIFIED", "PENDING")
			rec := do(t, router, "POST", "/v1/riders/me/onboarding/profile", tc.body, bearerFor(t, iss, riderID, []string{"RIDER"}))
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("%s got %d, want 422: %s", tc.name, rec.Code, rec.Body)
			}
			if code := errorCode(t, rec); code != "VALIDATION_FAILED" {
				t.Errorf("%s error.code=%q, want VALIDATION_FAILED", tc.name, code)
			}
		})
	}
}

// TestAttachRiderDocument_InvalidDocType_NotFiveHundred: an unknown doc_type must
// be a clean 422, never a 500 from the ::rider_doc_type cast.
func TestAttachRiderDocument_InvalidDocType_NotFiveHundred(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	soID := seedReadyObject(t, ctx, pool, riderID)
	for _, dt := range []string{"FOO_BAR", "PASSPORT", "", "GOVERNMENT_ID; DROP"} {
		body := map[string]any{"doc_type": dt, "stored_object_id": soID}
		rec := do(t, router, "POST", "/v1/riders/me/documents", body,
			bearerFor(t, iss, riderID, []string{"RIDER"}),
			"Idempotency-Key", fmt.Sprintf("idem-dt-%d", time.Now().UnixNano()))
		if rec.Code == http.StatusInternalServerError {
			t.Fatalf("doc_type=%q returned 500 (enum drift leaked): %s", dt, rec.Body)
		}
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("doc_type=%q got %d, want 422", dt, rec.Code)
		}
	}
}

// TestAttachRiderDocument_MalformedStoredObjectID_NotFiveHundred: a non-UUID
// stored_object_id must be a clean 422 (or 404), never a 500 from a 22P02 cast
// error on the uuid column.
func TestAttachRiderDocument_MalformedStoredObjectID_NotFiveHundred(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	for _, so := range []string{"not-a-uuid", "12345", "'; DROP TABLE stored_object;--", ""} {
		body := map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": so}
		rec := do(t, router, "POST", "/v1/riders/me/documents", body,
			bearerFor(t, iss, riderID, []string{"RIDER"}),
			"Idempotency-Key", fmt.Sprintf("idem-so-%d", time.Now().UnixNano()))
		if rec.Code == http.StatusInternalServerError {
			t.Fatalf("stored_object_id=%q returned 500: %s", so, rec.Body)
		}
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("stored_object_id=%q got %d, want 422", so, rec.Code)
		}
	}
}

// TestAttachRiderDocument_ExpiryRequiredForNonPhoto: every rider doc type except
// PROFILE_PHOTO must carry expires_on (contract RiderDocumentInput). Omitting it
// must be a 422, not a silently accepted document with a null valid_until.
func TestAttachRiderDocument_ExpiryRequiredForNonPhoto(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	for _, dt := range []string{"DRIVERS_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSURANCE", "GOVERNMENT_ID", "WORK_ELIGIBILITY"} {
		soID := seedReadyObject(t, ctx, pool, riderID)
		body := map[string]any{"doc_type": dt, "stored_object_id": soID}
		rec := do(t, router, "POST", "/v1/riders/me/documents", body,
			bearerFor(t, iss, riderID, []string{"RIDER"}),
			"Idempotency-Key", fmt.Sprintf("idem-exp-%d", time.Now().UnixNano()))
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("doc_type=%q without expires_on got %d, want 422: %s", dt, rec.Code, rec.Body)
		}
	}

	// PROFILE_PHOTO remains exempt: no expires_on must still succeed.
	soID := seedReadyObject(t, ctx, pool, riderID)
	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": soID},
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-photo-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusCreated {
		t.Errorf("PROFILE_PHOTO without expires_on got %d, want 201: %s", rec.Code, rec.Body)
	}
}

// TestGetRiderDashboard_ReportsTodaysEarnings is the regression for the dashboard
// earnings bug: the query targeted a non-existent table (rider_earning) and the
// error was swallowed, so gross_cents/trips were ALWAYS 0. This test seeds real
// earning_entry rows for today and asserts the dashboard reports them.
func TestGetRiderDashboard_ReportsTodaysEarnings(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")

	// Two DELIVERY entries earned today: 1200 + 800 = 2000 cents, 2 trips.
	// gross_cents must equal SUM(gross_cents) and each row satisfies the
	// gross identity (base + distance + wait + guarantee + tip + adjustment).
	for _, e := range []struct{ base, tip int64 }{{1000, 200}, {600, 200}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO earning_entry (account_id, type, status, base_cents, tip_cents, gross_cents, currency, earned_at)
			VALUES ($1, 'DELIVERY', 'AVAILABLE', $2, $3, $4, 'CAD', now())`,
			riderID, e.base, e.tip, e.base+e.tip); err != nil {
			t.Fatalf("seed earning_entry: %v", err)
		}
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM earning_entry WHERE account_id=$1`, riderID)
	})

	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, riderID, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			Today struct {
				GrossCents int64 `json:"gross_cents"`
				Trips      int   `json:"trips"`
			} `json:"today"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.Today.GrossCents != 2000 {
		t.Errorf("today.gross_cents=%d, want 2000 (dashboard swallowed earnings)", env.Data.Today.GrossCents)
	}
	if env.Data.Today.Trips != 2 {
		t.Errorf("today.trips=%d, want 2", env.Data.Today.Trips)
	}
}

// TestGetRiderDashboard_ScopesEarningsToCaller: earnings must be scoped to the
// caller's own account_id in SQL — another rider's earnings must never leak.
func TestGetRiderDashboard_ScopesEarningsToCaller(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	rider1 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")
	rider2 := seedRiderAccount(t, ctx, pool, "ACTIVE", "ACTIVE")

	if _, err := pool.Exec(ctx, `
		INSERT INTO earning_entry (account_id, type, status, base_cents, gross_cents, currency, earned_at)
		VALUES ($1, 'DELIVERY', 'AVAILABLE', 5000, 5000, 'CAD', now())`, rider1); err != nil {
		t.Fatalf("seed rider1 earning: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM earning_entry WHERE account_id=$1`, rider1)
	})

	// rider2 has no earnings — must see 0, not rider1's 5000.
	rec := do(t, router, "GET", "/v1/riders/me/dashboard", nil, bearerFor(t, iss, rider2, []string{"RIDER"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body)
	}
	var env struct {
		Data struct {
			Today struct {
				GrossCents int64 `json:"gross_cents"`
				Trips      int   `json:"trips"`
			} `json:"today"`
		} `json:"data"`
	}
	mustJSON(t, rec, &env)
	if env.Data.Today.GrossCents != 0 {
		t.Errorf("rider2 saw gross_cents=%d — earnings leaked across accounts (IDOR)", env.Data.Today.GrossCents)
	}
}
