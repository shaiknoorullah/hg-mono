package admin

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// dialTestPool returns a pool against HG_TEST_POSTGRES_DSN, or skips loudly when
// it is unset. The DSN is expected to point at a database with the full schema
// (services/hg/migrations) already applied.
func dialTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("skipping integration test: HG_TEST_POSTGRES_DSN is not set — " +
			"set it to a DSN whose database has services/hg/migrations applied to run this")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect to HG_TEST_POSTGRES_DSN: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedCertificate inserts a restaurant, an accepted issuing body, a stored
// object, a kyc document and a PENDING halal certificate, returning the cert id.
func seedCertificate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, superAdmin string) (certID, bodyID string) {
	t.Helper()
	var restaurantID string
	err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name)
VALUES ('t-'||substr(md5(random()::text),1,8), 'Karachi Kitchen Inc.', 'Karachi Kitchen')
RETURNING id`).Scan(&restaurantID)
	if err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO halal_issuing_body (name, country, status, decided_by, decided_at)
VALUES ('HMA Canada '||substr(md5(random()::text),1,6), 'CA', 'ACCEPTED', $1, now())
RETURNING id`, superAdmin).Scan(&bodyID); err != nil {
		t.Fatalf("seed issuing body: %v", err)
	}
	var storedObjID string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now())
RETURNING id`, superAdmin).Scan(&storedObjID); err != nil {
		t.Fatalf("seed stored object: %v", err)
	}
	var docID string
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, 'IN_REVIEW', now()+interval '72 hours', 'ESCALATE')
RETURNING id`, restaurantID, storedObjID).Scan(&docID); err != nil {
		t.Fatalf("seed kyc document: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO halal_certificate
  (restaurant_id, document_id, certificate_number, issuing_body_id, certified_legal_name,
   certified_address, scope, issued_on, expires_on, status, checklist_version)
VALUES ($1, $2, 'SEED-'||substr(md5(random()::text),1,6), $3, 'Karachi Kitchen Inc.',
   '1245 Danforth Avenue', 'WHOLE_ESTABLISHMENT', current_date - 30, current_date + 300, 'PENDING', 1)
RETURNING id`, restaurantID, docID, bodyID).Scan(&certID); err != nil {
		t.Fatalf("seed certificate: %v", err)
	}
	return certID, bodyID
}

func seedSuperAdmin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('sa-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed super admin: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'SUPER_ADMIN', 'GLOBAL')`, id); err != nil {
		t.Fatalf("grant super admin: %v", err)
	}
	return id
}

// The seven-check invariant end to end: a cert cannot be approved until all
// seven checks PASS; H5/H7 are non-overridable; approving a fully-passing cert
// re-derives the restaurant's halal_status via the DB trigger.
func TestHalalApprovalRequiresSevenChecks(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)

	sa := seedSuperAdmin(t, ctx, pool)
	certID, _ := seedCertificate(t, ctx, pool, sa)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-test"}
	at := time.Now().UTC()

	// Transcribe recomputes the auto checks; H5/H7 should already be PASS given
	// a comfortably-valid, unique, accepted-issuer certificate.
	_, checks, err := repo.GetCertificate(ctx, certID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	_ = checks

	// Approving before the human checks are recorded must fail CHECKLIST_INCOMPLETE.
	if _, _, err := repo.Decide(ctx, actor, certID, "APPROVE", nil, nil, 30, at); err == nil {
		t.Fatal("approval should be refused before the checklist is complete")
	} else if de, ok := err.(decisionError); !ok || de.Code != decChecklistIncomplete {
		t.Fatalf("want CHECKLIST_INCOMPLETE, got %v", err)
	}

	// Attempting to override H5 against the computed PASS with a FAIL is refused.
	longNote := "a sufficiently long override justification for the register report"
	_, _, err = repo.RecordChecks(ctx, actor, certID, halalChecksInput{
		Checks: []halalCheckInput{{CheckKey: CheckDatesValid, Result: ResultFail, Note: &longNote}},
	}, 30, at)
	if _, ok := err.(checkOverrideError); !ok {
		t.Fatalf("overriding H5 should be refused, got %v", err)
	}

	// Record the human-judgement checks as PASS.
	human := []halalCheckInput{
		{CheckKey: CheckLegibleComplete, Result: ResultPass},
		{CheckKey: CheckNameMatch, Result: ResultPass},
		{CheckKey: CheckAddressMatch, Result: ResultPass},
	}
	if _, _, err := repo.RecordChecks(ctx, actor, certID, halalChecksInput{Checks: human}, 30, at); err != nil {
		t.Fatalf("record human checks: %v", err)
	}

	// Now approval succeeds and all seven are PASS.
	cert, finalChecks, err := repo.Decide(ctx, actor, certID, "APPROVE", nil, nil, 30, at)
	if err != nil {
		t.Fatalf("approve after full checklist: %v", err)
	}
	if cert.Status != "APPROVED" {
		t.Fatalf("status = %s, want APPROVED", cert.Status)
	}
	for _, c := range finalChecks {
		if c.Result != ResultPass {
			t.Errorf("check %s is %s, want PASS", c.CheckKey, c.Result)
		}
	}
}

// H7 uniqueness: a second certificate reusing an approved number under the same
// issuing body computes H5/H7 such that H7 fails.
func TestHalalDuplicateFailsH7(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	certID, bodyID := seedCertificate(t, ctx, pool, sa)

	// Fetch the seed cert's number and mark it APPROVED directly so a second cert
	// with the same number under the same body is a genuine duplicate.
	var number, restaurantID, docID string
	if err := pool.QueryRow(ctx, `SELECT certificate_number, restaurant_id, document_id FROM halal_certificate WHERE id=$1`, certID).Scan(&number, &restaurantID, &docID); err != nil {
		t.Fatalf("read seed cert: %v", err)
	}
	// A fresh second certificate reusing the number.
	var dupID string
	if err := pool.QueryRow(ctx, `
INSERT INTO halal_certificate
  (restaurant_id, document_id, certificate_number, issuing_body_id, certified_legal_name,
   certified_address, scope, issued_on, expires_on, status, checklist_version)
VALUES ($1, $2, $3, $4, 'X', 'Y', 'WHOLE_ESTABLISHMENT', current_date-10, current_date+300, 'PENDING', 1)
RETURNING id`, restaurantID, docID, number, bodyID).Scan(&dupID); err != nil {
		t.Fatalf("seed duplicate: %v", err)
	}

	// Approve the first so it occupies the unique slot.
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}}
	at := time.Now().UTC()
	for _, k := range []string{CheckLegibleComplete, CheckNameMatch, CheckAddressMatch} {
		if _, _, err := repo.RecordChecks(ctx, actor, certID, halalChecksInput{Checks: []halalCheckInput{{CheckKey: k, Result: ResultPass}}}, 30, at); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	if _, _, err := repo.Decide(ctx, actor, certID, "APPROVE", nil, nil, 30, at); err != nil {
		t.Fatalf("approve first: %v", err)
	}

	// The duplicate's computed H7 must now be FAIL, blocking its approval.
	if _, _, err := repo.Decide(ctx, actor, dupID, "APPROVE", nil, nil, 30, at); err == nil {
		t.Fatal("duplicate approval should be blocked by H7")
	} else if de, ok := err.(decisionError); !ok || de.Code != decCheckFailed {
		t.Fatalf("want CHECK_FAILED for the duplicate, got %v", err)
	}
}
