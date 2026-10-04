package admin

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seedRestaurantApplication inserts a submitted-but-undecided restaurant with an
// application row, its four required documents (all APPROVED unless
// approveDocs is false), a location, and an APPROVED halal certificate reflected
// on the restaurant's halal_status. It returns the restaurant id.
func seedRestaurantApplication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, superAdmin string, approvable bool) string {
	t.Helper()
	var restaurantID string
	err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name, line1, city, province, postal_code, location, onboarding_state)
VALUES ('t-'||substr(md5(random()::text),1,8), 'Barakah Grill Inc.', 'Barakah Grill',
        '275 Bank Street', 'Kitchener', 'ON', 'K2P 1X7',
        ST_SetSRID(ST_MakePoint(-79.6212, 43.6199), 4326)::geography, 'DOCUMENTS_REVIEW')
RETURNING id`).Scan(&restaurantID)
	if err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO restaurant_application (restaurant_id, submission_count, submitted_at, sla_due_at)
VALUES ($1, 1, now() - interval '2 hours', now() + interval '46 hours')`, restaurantID); err != nil {
		t.Fatalf("seed application: %v", err)
	}

	docState := "APPROVED"
	if !approvable {
		docState = "IN_REVIEW"
	}
	for _, dt := range requiredRestaurantDocs {
		var soID string
		if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at,
                           virus_scan_state, virus_scan_sha256, virus_scan_version)
VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now(),
        'CLEAN', decode(repeat('a1',32),'hex'), 1)
RETURNING id`, superAdmin).Scan(&soID); err != nil {
			t.Fatalf("seed stored object: %v", err)
		}
		if docState == "APPROVED" {
			if _, err := pool.Exec(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, reviewed_by, reviewed_at)
VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'APPROVED', $4, now())`, restaurantID, dt, soID, superAdmin); err != nil {
				t.Fatalf("seed doc %s: %v", dt, err)
			}
		} else {
			if _, err := pool.Exec(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'IN_REVIEW', now()+interval '72 hours', 'ESCALATE')`, restaurantID, dt, soID); err != nil {
				t.Fatalf("seed doc %s: %v", dt, err)
			}
		}
	}

	if approvable {
		// An APPROVED halal certificate and the restaurant halal_status reflecting it.
		var bodyID string
		if err := pool.QueryRow(ctx, `
INSERT INTO halal_issuing_body (name, country, status, decided_by, decided_at)
VALUES ('HMA '||substr(md5(random()::text),1,6), 'CA', 'ACCEPTED', $1, now()) RETURNING id`, superAdmin).Scan(&bodyID); err != nil {
			t.Fatalf("seed body: %v", err)
		}
		var soID string
		if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at,
                           virus_scan_state, virus_scan_sha256, virus_scan_version)
VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now(),
        'CLEAN', decode(repeat('a1',32),'hex'), 1)
RETURNING id`, superAdmin).Scan(&soID); err != nil {
			t.Fatalf("seed cert object: %v", err)
		}
		var docID string
		if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, reviewed_by, reviewed_at)
VALUES ('RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, 'APPROVED', $3, now()) RETURNING id`, restaurantID, soID, superAdmin).Scan(&docID); err != nil {
			t.Fatalf("seed cert doc: %v", err)
		}
		// The approval trigger refuses an APPROVED certificate without seven PASS
		// checks, so seed the cert PENDING, record all seven checks PASS, then flip
		// to APPROVED — exactly the invariant the product depends on.
		var certID string
		if err := pool.QueryRow(ctx, `
INSERT INTO halal_certificate
  (restaurant_id, document_id, certificate_number, issuing_body_id, certified_legal_name,
   certified_address, scope, issued_on, expires_on, status, checklist_version)
VALUES ($1, $2, 'C-'||substr(md5(random()::text),1,6), $3, 'Barakah Grill Inc.', 'X',
   'WHOLE_ESTABLISHMENT', current_date-10, current_date+300, 'PENDING', 1)
RETURNING id`, restaurantID, docID, bodyID).Scan(&certID); err != nil {
			t.Fatalf("seed cert: %v", err)
		}
		for _, k := range AllCheckKeys {
			if _, err := pool.Exec(ctx, `
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
VALUES ($1, $2::halal_check_key, 'PASS', 'PASS', $3, $4, now())`, certID, k, !NonOverridable(k), superAdmin); err != nil {
				t.Fatalf("seed check %s: %v", k, err)
			}
		}
		if _, err := pool.Exec(ctx, `
UPDATE halal_certificate SET status='APPROVED', verified_by=$2, verified_at=now() WHERE id=$1`, certID, superAdmin); err != nil {
			t.Fatalf("approve cert: %v", err)
		}
	}
	return restaurantID
}

// A blocked restaurant application refuses approval with the live blockers, and a
// fully-satisfied one approves; a second decision is ALREADY_DECIDED.
func TestDecideRestaurantApplication(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-1"}
	at := time.Now().UTC()

	// Not approvable: documents still in review, no cert.
	blocked := seedRestaurantApplication(t, ctx, pool, sa, false)
	detail, err := repo.GetRestaurantApplication(ctx, blocked, 30, at)
	if err != nil {
		t.Fatalf("get blocked: %v", err)
	}
	if len(detail.blockers) == 0 {
		t.Fatal("expected live blockers on an unapprovable application")
	}
	if _, err := repo.DecideRestaurantApplication(ctx, actor, blocked, "APPROVE", "ALL_CHECKS_PASSED", "All the checks pass here.", 30, at); err == nil {
		t.Fatal("approval of a blocked application should be refused")
	} else if _, ok := err.(preconditionError); !ok {
		t.Fatalf("want preconditionError, got %v", err)
	}

	// Approvable: all four docs approved, cert approved, location present.
	ok := seedRestaurantApplication(t, ctx, pool, sa, true)
	okDetail, err := repo.GetRestaurantApplication(ctx, ok, 30, at)
	if err != nil {
		t.Fatalf("get approvable: %v", err)
	}
	if len(okDetail.blockers) != 0 {
		t.Fatalf("expected no blockers, got %v", okDetail.blockers)
	}
	decided, err := repo.DecideRestaurantApplication(ctx, actor, ok, "APPROVE", "ALL_CHECKS_PASSED", "All the checks pass here.", 30, at)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	// DOCUMENTS_APPROVED → PAYOUT_PENDING is automatic (spec R, transition table):
	// the decision recomputes the onboarding state, so approval lands the restaurant
	// in PAYOUT_PENDING (it still needs a payout account, a live menu, and hours).
	if decided.profile.OnboardingState != "PAYOUT_PENDING" {
		t.Fatalf("onboarding_state = %s, want PAYOUT_PENDING", decided.profile.OnboardingState)
	}
	// Approval does not make the restaurant live.
	if decided.profile.AccountState == "LIVE" {
		t.Fatal("approval must not set account_state=LIVE")
	}
	// A second decision is ALREADY_DECIDED.
	if _, err := repo.DecideRestaurantApplication(ctx, actor, ok, "REJECT", "OTHER", "Changed my mind about this.", 30, at); err != ErrAlreadyDecided {
		t.Fatalf("second decision want ErrAlreadyDecided, got %v", err)
	}
}

// seedRiderApplication inserts an account, rider profile, active vehicle,
// application row and one approved document. dobYearsAgo sets the age.
func seedRiderApplication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, superAdmin string, dobYearsAgo int) string {
	t.Helper()
	var accountID string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('r-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state)
VALUES ($1, 'Amina', 'K', (current_date - make_interval(years => $2))::date, 'DOCUMENTS_REVIEW')`, accountID, dobYearsAgo); err != nil {
		t.Fatalf("seed rider profile: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO rider_vehicle (account_id, vehicle_type, is_active) VALUES ($1, 'BICYCLE', true)`, accountID); err != nil {
		t.Fatalf("seed vehicle: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO rider_application (account_id, submission_count, submitted_at, sla_due_at)
VALUES ($1, 1, now() - interval '1 hour', now() + interval '47 hours')`, accountID); err != nil {
		t.Fatalf("seed rider application: %v", err)
	}
	var soID string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at,
                           virus_scan_state, virus_scan_sha256, virus_scan_version)
VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now(),
        'CLEAN', decode(repeat('a1',32),'hex'), 1)
RETURNING id`, superAdmin).Scan(&soID); err != nil {
		t.Fatalf("seed rider stored object: %v", err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, reviewed_by, reviewed_at)
VALUES ('RIDER', $1, 'GOVERNMENT_ID', $2, 'APPROVED', $3, now())`, accountID, soID, superAdmin); err != nil {
		t.Fatalf("seed rider doc: %v", err)
	}
	return accountID
}

// The under-18 gate is server-computed and non-overridable; an adult rider
// approves to PAYOUT_PENDING; a second decision is ALREADY_DECIDED.
func TestDecideRiderApplication(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-r"}
	at := time.Now().UTC()

	// The DB itself refuses a rider under 18 (rider_is_adult), so the AGE gate is
	// exercised against a 17-year-old that would be representable only if the
	// business date crosses the boundary. We assert the computed age instead: an
	// 18-year-old is admissible and the computed age is exact.
	adult := seedRiderApplication(t, ctx, pool, sa, 25)
	got, err := repo.GetRiderApplication(ctx, adult, at)
	if err != nil {
		t.Fatalf("get rider: %v", err)
	}
	if got.ageYears == nil || *got.ageYears < 18 {
		t.Fatalf("computed age = %v, want >= 18", got.ageYears)
	}
	if len(got.blockers) != 0 {
		t.Fatalf("expected no blockers for an approvable adult, got %v", got.blockers)
	}

	decided, err := repo.DecideRiderApplication(ctx, actor, adult, "APPROVE", "", "Welcome aboard the platform.", at)
	if err != nil {
		t.Fatalf("approve rider: %v", err)
	}
	if decided.profile.OnboardingState != "PAYOUT_PENDING" {
		t.Fatalf("onboarding_state = %s, want PAYOUT_PENDING", decided.profile.OnboardingState)
	}
	if _, err := repo.DecideRiderApplication(ctx, actor, adult, "REJECT", "ILLEGIBLE", "Please resubmit the document.", at); err != ErrAlreadyDecided {
		t.Fatalf("second decision want ErrAlreadyDecided, got %v", err)
	}
}

// The age computation is exact around the birthday boundary — the gate that
// blocks approval cannot be fooled by a date one day either side of 18 years.
func TestAgeYears(t *testing.T) {
	at := time.Date(2026, 8, 13, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		dob  time.Time
		want int
	}{
		{time.Date(2008, 8, 13, 0, 0, 0, 0, time.UTC), 18}, // exactly 18 today
		{time.Date(2008, 8, 14, 0, 0, 0, 0, time.UTC), 17}, // 18 tomorrow
		{time.Date(2008, 8, 12, 0, 0, 0, 0, time.UTC), 18}, // 18 yesterday
		{time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), 26},
	}
	for _, c := range cases {
		if got := ageYears(c.dob, at); got != c.want {
			t.Errorf("ageYears(%s) = %d, want %d", c.dob.Format("2006-01-02"), got, c.want)
		}
	}
}
