package rider

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// TestAttachRiderDocument_OnlyTheRidersOwnComplianceUpload: the rider attach
// already refused another account's file; it now also refuses the rider's own
// upload made for another purpose (a delivery photo is not a licence), and a
// file already attached to another subject's documents. Each is the same 404,
// and nothing is written (https://github.com/shaiknoorullah/hg-mono/issues/359).
func TestAttachRiderDocument_OnlyTheRidersOwnComplianceUpload(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")

	upload := func(purpose, bucket string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
			                           state, uploaded_by, confirmed_at)
			VALUES ($1, 'k/'||md5(random()::text), $2::stored_object_purpose, 'image/jpeg', 512000,
			        decode(repeat('ab',32),'hex'), 'READY', $3, now())
			RETURNING id`, bucket, purpose, riderID).Scan(&id); err != nil {
			t.Fatalf("seed stored_object: %v", err)
		}
		t.Cleanup(func() {
			c := context.Background()
			pool.Exec(c, `DELETE FROM kyc_document WHERE stored_object_id=$1`, id)
			pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
		})
		return id
	}

	// The rider's own compliance upload, already attached to a restaurant's
	// documents (the rider also runs a restaurant, say).
	var restaurantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (slug, legal_name, display_name)
		VALUES ('ra-'||substr(md5(random()::text),1,8), 'Rider Also Inc.', 'Rider Also') RETURNING id`).Scan(&restaurantID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM restaurant WHERE id=$1`, restaurantID) })
	onRestaurant := upload("KYC_DOCUMENT", "hg-kyc")
	if _, err := pool.Exec(ctx, `
		INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
		VALUES ('RESTAURANT', $1, 'OWNER_ID', $2, 'SUBMITTED', now()+interval '72h', 'ESCALATE')`,
		restaurantID, onRestaurant); err != nil {
		t.Fatalf("seed restaurant document: %v", err)
	}

	cases := []struct {
		name     string
		objectID string
	}{
		{"a delivery photo", upload("POD", "hg-pod")},
		{"an avatar", upload("AVATAR", "hg-tmp")},
		{"a menu photo", upload("MENU_IMAGE", "hg-media")},
		{"a file already on a restaurant's documents", onRestaurant},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := do(t, router, "POST", "/v1/riders/me/documents",
				map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": c.objectID},
				bearerFor(t, iss, riderID, []string{"RIDER"}),
				"Idempotency-Key", fmt.Sprintf("idem-own-%d", time.Now().UnixNano()))
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d, want 404: %s", rec.Code, rec.Body)
			}
			var n int
			_ = pool.QueryRow(ctx, `SELECT count(*) FROM kyc_document WHERE subject_type='RIDER' AND stored_object_id=$1`,
				c.objectID).Scan(&n)
			if n != 0 {
				t.Errorf("a refused attach wrote %d rider documents", n)
			}
		})
	}

	// The rider's own, unattached compliance upload still goes through.
	rec := do(t, router, "POST", "/v1/riders/me/documents",
		map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": upload("KYC_DOCUMENT", "hg-kyc")},
		bearerFor(t, iss, riderID, []string{"RIDER"}),
		"Idempotency-Key", fmt.Sprintf("idem-own-ok-%d", time.Now().UnixNano()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("own compliance upload: status=%d, want 201: %s", rec.Code, rec.Body)
	}
}
