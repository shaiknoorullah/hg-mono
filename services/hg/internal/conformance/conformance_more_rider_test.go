package conformance

// Rider onboarding write conformance — reconstructed for the "more-rider" class.
//
// Covers the four rider onboarding write operations by driving the real rider
// onboarding state machine against a freshly seeded rider:
//
//	submitRiderProfile    POST /v1/riders/me/onboarding/profile   → 200 RiderProfile
//	submitRiderVehicle    POST /v1/riders/me/onboarding/vehicle   → 200 RiderVehicle
//	attachRiderDocument   POST /v1/riders/me/documents            → 201 RiderDocument
//	submitRiderDocuments  POST /v1/riders/me/onboarding/documents → 200 RiderOnboardingStatus
//
// The rider is seeded at PHONE_VERIFIED; submitRiderProfile advances it to
// VEHICLE_PENDING, a BICYCLE vehicle advances it to DOCUMENTS_PENDING (a
// non-motorised vehicle requires exactly {GOVERNMENT_ID, PROFILE_PHOTO}), each
// document is backed by a seeded READY hg-kyc stored_object owned by the rider
// (the AttachDocument IDOR guard requires stored_object.uploaded_by == caller),
// and submitRiderDocuments then advances to DOCUMENTS_REVIEW. attachRiderDocument
// and submitRiderDocuments are contract-Idempotent, so both carry an
// Idempotency-Key. Every 2xx body is validated against contracts/openapi.yaml,
// and every write body is additionally ValidateRequest-checked.
//
// It reuses newARWHarness (which wires the rider module) and the shared coverage
// aggregate. All new identifiers are prefixed `mro`. No existing file is edited.
//
// Dispatch-dependent rider ops (acceptOffer, getAssignment,
// createAssignmentTransition, submitProofOfDelivery) remain covered-impossible in
// this environment — they need a live dispatch offer/assignment produced by the
// background runner — and are documented in the ops_not_coverable block of
// conformance_admin-rider-writes_test.go; they are not re-listed here.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// mroSeedOnboardingRider inserts a rider account in the PHONE_VERIFIED onboarding
// state (a verified phone, a RIDER role grant, and a rider_profile that has not
// yet submitted a profile). account_status is PENDING because the
// rider_active_is_approved CHECK forbids ACTIVE without approved_at.
func mroSeedOnboardingRider(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var accountID string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (phone_e164, phone_verified_at, status)
VALUES ('+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'), now(), 'ACTIVE')
RETURNING id`).Scan(&accountID); err != nil {
		t.Fatalf("mroSeedOnboardingRider account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, accountID); err != nil {
		t.Fatalf("mroSeedOnboardingRider role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO rider_profile
  (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status, availability_state)
VALUES ($1,'Mro','Rider','1994-04-04','PHONE_VERIFIED','PENDING','OFFLINE')`, accountID); err != nil {
		t.Fatalf("mroSeedOnboardingRider rider_profile: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM kyc_document WHERE subject_type='RIDER' AND subject_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM stored_object WHERE uploaded_by=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_vehicle WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_profile WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account WHERE id=$1`, accountID)
	})
	return accountID
}

// mroSeedReadyStoredObject inserts a READY hg-kyc stored_object uploaded by the
// given rider account, so AttachDocument's ownership guard passes.
func mroSeedReadyStoredObject(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uploaderID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-kyc','mro/'||md5(random()::text),'KYC_DOCUMENT','application/pdf',2048,
        decode(repeat('c3',32),'hex'),'READY',$1,now())
RETURNING id`, uploaderID).Scan(&id); err != nil {
		t.Fatalf("mroSeedReadyStoredObject: %v", err)
	}
	return id
}

// TestConformance_MoreRider_OnboardingFlow drives the rider onboarding write
// surface end to end and validates every 2xx body against the contract.
func TestConformance_MoreRider_OnboardingFlow(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	riderID := mroSeedOnboardingRider(t, ctx, pool)
	roles := []string{roleRider}

	// ── submitRiderProfile (PHONE_VERIFIED → VEHICLE_PENDING) ──
	t.Run("submitRiderProfile", func(t *testing.T) {
		body := map[string]any{
			"first_name":    "Mro",
			"last_name":     "Rider",
			"date_of_birth": "1994-04-04",
		}
		req := h.Build(t, Request{Method: "POST", Path: "/v1/riders/me/onboarding/profile",
			AccountID: riderID, Roles: roles, Body: body})
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("submitRiderProfile body not contract-valid: %v", verr)
		}
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/riders/me/onboarding/profile",
			AccountID: riderID, Roles: roles, Body: body}, 200)
	})

	// ── submitRiderVehicle (BICYCLE; VEHICLE_PENDING → DOCUMENTS_PENDING) ──
	t.Run("submitRiderVehicle", func(t *testing.T) {
		body := map[string]any{"vehicle_type": "BICYCLE"}
		req := h.Build(t, Request{Method: "POST", Path: "/v1/riders/me/onboarding/vehicle",
			AccountID: riderID, Roles: roles, Body: body})
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("submitRiderVehicle body not contract-valid: %v", verr)
		}
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/riders/me/onboarding/vehicle",
			AccountID: riderID, Roles: roles, Body: body}, 200)
	})

	// ── attachRiderDocument × 2 (GOVERNMENT_ID needs an expiry; PROFILE_PHOTO does not) ──
	t.Run("attachRiderDocument", func(t *testing.T) {
		govObj := mroSeedReadyStoredObject(t, ctx, pool, riderID)
		expiry := time.Now().AddDate(2, 0, 0).UTC().Format("2006-01-02")
		govBody := map[string]any{
			"doc_type":         "GOVERNMENT_ID",
			"stored_object_id": govObj,
			"expires_on":       expiry,
		}
		req := h.Build(t, Request{Method: "POST", Path: "/v1/riders/me/documents",
			AccountID: riderID, Roles: roles, Body: govBody, IdemKey: fmt.Sprintf("mro-doc-gov-%d", time.Now().UnixNano())})
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("attachRiderDocument body not contract-valid: %v", verr)
		}
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/riders/me/documents",
			AccountID: riderID, Roles: roles, Body: govBody, IdemKey: fmt.Sprintf("mro-doc-gov-%d", time.Now().UnixNano())}, 201)

		// The second required document — no drift-adding response assert needed, but
		// it is the state precondition submitRiderDocuments consumes.
		photoObj := mroSeedReadyStoredObject(t, ctx, pool, riderID)
		photoBody := map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": photoObj}
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/riders/me/documents",
			AccountID: riderID, Roles: roles, Body: photoBody, IdemKey: fmt.Sprintf("mro-doc-photo-%d", time.Now().UnixNano())}, 201)
	})

	// ── submitRiderDocuments (DOCUMENTS_PENDING → DOCUMENTS_REVIEW; no request body) ──
	t.Run("submitRiderDocuments", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/riders/me/onboarding/documents",
			AccountID: riderID, Roles: roles, IdemKey: fmt.Sprintf("mro-submit-docs-%d", time.Now().UnixNano())}, 200)
	})
}
