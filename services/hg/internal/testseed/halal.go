package testseed

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CertifyRestaurant gives a restaurant a halal certificate the way an admin
// does: an uploaded certificate document, then an APPROVED halal_certificate
// from an ACCEPTED issuing body, verified by a reviewer account, with all seven
// checks at PASS. The certificate trigger in migration 00009 derives
// restaurant.halal_status from it. Nothing is hand-set: the derived status is
// never written directly.
//
// expiresInDays is the last valid day relative to the database's current date:
// 300 is a certificate in good standing, -2 one that lapsed two days ago in
// every timezone. It returns the certificate id.
//
// It needs the halal issuing bodies from the reference seed (Seed, or
// migrations/seed/seed.sql). Everything it writes is removed by t.Cleanup,
// which runs before the cleanup the caller registered for the restaurant.
func CertifyRestaurant(t testing.TB, pool *pgxpool.Pool, restaurantID string, expiresInDays int) string {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("certify restaurant: begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var reviewerID, objectID, documentID, certificateID string
	// The reviewer is the admin who verified the certificate; the database
	// refuses an approval nobody is accountable for.
	if err := tx.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('halal-reviewer-'||uuid_generate_v7()::text||'@test.local', 'ACTIVE')
		RETURNING id`).Scan(&reviewerID); err != nil {
		t.Fatalf("certify restaurant: reviewer: %v", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
		                           state, uploaded_by, confirmed_at)
		VALUES ('hg-kyc', 'test/halal-'||uuid_generate_v7()::text||'.pdf', 'KYC_DOCUMENT',
		        'application/pdf', 2048, decode(repeat('c3', 32), 'hex'), 'READY', $1, now())
		RETURNING id`, reviewerID).Scan(&objectID); err != nil {
		t.Fatalf("certify restaurant: stored object: %v", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
		                          halal_issuing_body_id, state, reviewed_by, reviewed_at)
		SELECT 'RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, b.id, 'APPROVED', $3, now()
		  FROM halal_issuing_body b WHERE b.status = 'ACCEPTED' ORDER BY b.name LIMIT 1
		RETURNING id`, restaurantID, objectID, reviewerID).Scan(&documentID); err != nil {
		t.Fatalf("certify restaurant: document (is the reference seed loaded?): %v", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
		                               certified_legal_name, certified_address, scope, issued_on, expires_on,
		                               status, checklist_version, verified_by, verified_at)
		SELECT $1, d.id, 'TEST-'||uuid_generate_v7()::text, d.halal_issuing_body_id,
		       'Test Co', '1 King St Toronto', 'WHOLE_ESTABLISHMENT',
		       current_date + $3::int - 365, current_date + $3::int, 'APPROVED', 1, $4, now()
		  FROM kyc_document d WHERE d.id = $2
		RETURNING id`, restaurantID, documentID, expiresInDays, reviewerID).Scan(&certificateID); err != nil {
		t.Fatalf("certify restaurant: certificate: %v", err)
	}
	// H5 and H7 are computed by the server and cannot be overridden, so their
	// recorded result must equal the computed one.
	if _, err := tx.Exec(ctx, `
		INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result,
		                                     overridable, checked_by, checked_at)
		SELECT $1, k::halal_check_key, 'PASS', 'PASS',
		       k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'), $2, now()
		  FROM unnest(ARRAY['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH',
		                    'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED']) AS k`,
		certificateID, reviewerID); err != nil {
		t.Fatalf("certify restaurant: checks: %v", err)
	}
	// The seven-checks rule is a deferred constraint: it is checked here.
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("certify restaurant: commit: %v", err)
	}

	t.Cleanup(func() {
		c := context.Background()
		// Unlink first: the restaurant row points at the certificate.
		for _, q := range []struct{ sql, arg string }{
			{`UPDATE restaurant SET halal_certificate_id = NULL WHERE id = $1`, restaurantID},
			{`DELETE FROM halal_certificate WHERE id = $1`, certificateID},
			{`DELETE FROM kyc_document WHERE id = $1`, documentID},
			{`DELETE FROM stored_object WHERE id = $1`, objectID},
			{`DELETE FROM account WHERE id = $1`, reviewerID},
		} {
			if _, err := pool.Exec(c, q.sql, q.arg); err != nil {
				t.Errorf("certify restaurant cleanup: %s: %v", q.sql, err)
			}
		}
	})
	return certificateID
}
