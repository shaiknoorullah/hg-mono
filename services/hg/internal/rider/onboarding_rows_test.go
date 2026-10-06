package rider

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// A rider who has only signed in by phone OTP has an account and a RIDER role,
// nothing else: sign-up creates no rider_profile. The onboarding status must
// still answer (the phone is verified, the profile is next) and the profile
// step must create the row; before, both answered 404 and no new rider could
// onboard (docs/spec/04-rider.md, "D-03").
func TestRiderOnboarding_NewRiderWithNoProfileCanStart(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	var riderID string
	if err := pool.QueryRow(ctx, `INSERT INTO account (phone_e164, phone_verified_at, status)
		VALUES ($1, now(), 'ACTIVE') RETURNING id`, uniquePhone()).Scan(&riderID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, 'RIDER', 'GLOBAL')`, riderID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rider_profile WHERE account_id=$1`, riderID)
		pool.Exec(context.Background(), `DELETE FROM account_role WHERE account_id=$1`, riderID)
		pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, riderID)
	})
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	rec := do(t, router, "GET", "/v1/riders/me/onboarding/status", nil, tok)
	var status struct {
		Data struct {
			OnboardingState string `json:"onboarding_state"`
			NextStep        string `json:"next_step"`
		} `json:"data"`
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status before a profile = %d %s, want 200", rec.Code, rec.Body)
	}
	mustJSON(t, rec, &status)
	if status.Data.OnboardingState != "PHONE_VERIFIED" || status.Data.NextStep != "PROFILE" {
		t.Fatalf("status before a profile = %+v, want PHONE_VERIFIED / PROFILE", status.Data)
	}

	rec = do(t, router, "POST", "/v1/riders/me/onboarding/profile", map[string]any{
		"first_name": "Yusuf", "last_name": "Rider", "date_of_birth": "1994-06-01",
	}, tok)
	if rec.Code != http.StatusOK {
		t.Fatalf("first profile = %d %s, want 200", rec.Code, rec.Body)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT onboarding_state::text FROM rider_profile WHERE account_id = $1`,
		riderID).Scan(&state); err != nil || state != "VEHICLE_PENDING" {
		t.Fatalf("rider_profile after the first profile: state=%q err=%v, want VEHICLE_PENDING", state, err)
	}
}

// Submitting the document pack queues the rider for admin review: the
// rider_application row is what decideRiderApplication locks, and nothing
// created it, so every rider decision answered 404 (docs/spec/05-admin.md,
// "A-23 — Rider onboarding review and approval"). A repeat submission keeps its place.
func TestSubmitRiderDocuments_QueuesTheApplicationOnce(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)

	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	seedRiderVehicle(t, ctx, pool, riderID, "BICYCLE")
	seedCompleteDocumentSet(t, ctx, pool, riderID)
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rider_application WHERE account_id=$1`, riderID)
	})
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})

	for i := 0; i < 2; i++ {
		rec := do(t, router, "POST", "/v1/riders/me/onboarding/documents", nil, tok,
			"Idempotency-Key", fmt.Sprintf("idem-queue-%d-%d", i, time.Now().UnixNano()))
		if rec.Code != http.StatusOK {
			t.Fatalf("submit %d = %d %s, want 200", i+1, rec.Code, rec.Body)
		}
	}
	var count int
	var submitted *time.Time
	if err := pool.QueryRow(ctx, `SELECT submission_count, submitted_at FROM rider_application
		WHERE account_id = $1 AND decided_at IS NULL`, riderID).Scan(&count, &submitted); err != nil {
		t.Fatalf("no rider_application waiting for review: %v", err)
	}
	if count != 1 || submitted == nil {
		t.Fatalf("rider_application submission_count=%d submitted_at=%v, want 1 and set", count, submitted)
	}
}
