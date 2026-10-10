package restaurant_test

// attachRestaurantDocument takes only the caller's own confirmed compliance
// upload, and attaches one file once.
//
//   - A file another account uploaded, an unconfirmed or deleted upload, a file
//     uploaded for another purpose, and a file already attached to another
//     subject are all 404 with nothing written: a download link is granted to
//     whoever owns the document, so attaching someone else's file would hand
//     them its bytes (https://github.com/shaiknoorullah/hg-mono/issues/359).
//   - Two attaches of one file, at once or one after the other, leave one
//     document row and one halal certificate, and both callers get the same
//     document (https://github.com/shaiknoorullah/hg-mono/issues/360).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// seedUpload inserts a stored_object in the given state and purpose, uploaded
// by uploader, and removes it (and anything attached to it) at cleanup.
func seedUpload(t *testing.T, pool *pgxpool.Pool, uploader, purpose, state string) string {
	t.Helper()
	ctx := context.Background()
	bucket := map[string]string{"KYC_DOCUMENT": "hg-kyc", "MENU_IMAGE": "hg-media", "POD": "hg-pod", "AVATAR": "hg-tmp"}[purpose]
	var id string
	var q string
	switch state {
	case "READY":
		q = `INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		     VALUES ($1, 'att/'||md5(random()::text), $2::stored_object_purpose, 'application/pdf', 1024,
		             decode(repeat('a1',32),'hex'), 'READY', $3, now()) RETURNING id`
	case "PENDING":
		q = `INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by,
		                            deadline_at, deadline_action)
		     VALUES ($1, 'att/'||md5(random()::text), $2::stored_object_purpose, 'application/pdf', 1024,
		             decode(repeat('a1',32),'hex'), 'PENDING', $3, now()+interval '1 hour', 'DELETE_UNCONFIRMED') RETURNING id`
	case "DELETED":
		q = `INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by,
		                            confirmed_at, deleted_at)
		     VALUES ($1, 'att/'||md5(random()::text), $2::stored_object_purpose, 'application/pdf', 1024,
		             decode(repeat('a1',32),'hex'), 'DELETED', $3, now(), now()) RETURNING id`
	default:
		t.Fatalf("seedUpload: unknown state %q", state)
	}
	if err := pool.QueryRow(ctx, q, bucket, purpose, uploader).Scan(&id); err != nil {
		t.Fatalf("seed stored_object (%s, %s): %v", purpose, state, err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM halal_certificate_check WHERE halal_certificate_id IN
			(SELECT hc.id FROM halal_certificate hc JOIN kyc_document d ON d.id = hc.document_id WHERE d.stored_object_id=$1)`, id)
		_, _ = pool.Exec(c, `DELETE FROM halal_certificate WHERE document_id IN (SELECT id FROM kyc_document WHERE stored_object_id=$1)`, id)
		_, _ = pool.Exec(c, `DELETE FROM kyc_document WHERE stored_object_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
	})
	return id
}

// seedAccount inserts a bare account and removes it at cleanup.
func seedAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO account (email, status) VALUES ('att-'||replace(uuid_generate_v7()::text,'-','')||'@test.local','ACTIVE') RETURNING id`,
	).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, id) })
	return id
}

// attachDoc posts one attachRestaurantDocument as the given owner.
func attachDoc(t *testing.T, pool *pgxpool.Pool, accountID string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/documents", strings.NewReader(string(raw)))
	req = withPrincipal(req, principalWith(accountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	newHandler(pool).AttachRestaurantDocument(rec, req)
	return rec
}

func countDocsForFile(t *testing.T, pool *pgxpool.Pool, objectID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM kyc_document WHERE stored_object_id=$1`, objectID).Scan(&n); err != nil {
		t.Fatalf("count kyc_document: %v", err)
	}
	return n
}

// TestAttachDocument_RefusesAFileThatIsNotTheCallers: every upload the caller
// may not attach is the same 404, and nothing is written, so a document (and a
// download link) never exists for it.
func TestAttachDocument_RefusesAFileThatIsNotTheCallers(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	rider := seedAccount(t, pool)

	// A file already attached to another restaurant's documents, uploaded by
	// this owner: one upload backs one subject's documents, never two.
	elsewhere := seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "READY")
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
		VALUES ('RESTAURANT', $1, 'OWNER_ID', $2, 'SUBMITTED', now()+interval '72h', 'ESCALATE')`,
		f.otherRestID, elsewhere); err != nil {
		t.Fatalf("seed document elsewhere: %v", err)
	}

	cases := []struct {
		name     string
		objectID string
		before   int // documents on the file before the attach
	}{
		{"a rider's licence", seedUpload(t, pool, rider, "KYC_DOCUMENT", "READY"), 0},
		{"another restaurant owner's upload", seedUpload(t, pool, f.otherAccountID, "KYC_DOCUMENT", "READY"), 0},
		{"this restaurant's manager's upload", seedUpload(t, pool, f.managerAccountID, "KYC_DOCUMENT", "READY"), 0},
		{"the caller's unconfirmed upload", seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "PENDING"), 0},
		{"the caller's deleted upload", seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "DELETED"), 0},
		{"the caller's file already on another restaurant", elsewhere, 1},
		{"an id no upload has", "0199b1c4-0000-7000-8000-000000000359", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := attachDoc(t, pool, f.ownerAccountID, map[string]any{
				"doc_type": "BUSINESS_LICENCE", "stored_object_id": c.objectID,
			})
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
			}
			if n := countDocsForFile(t, pool, c.objectID); n != c.before {
				t.Errorf("documents on the file = %d, want %d: a refused attach wrote a row", n, c.before)
			}
		})
	}

	var mine int
	_ = pool.QueryRow(context.Background(),
		`SELECT count(*) FROM kyc_document WHERE subject_type='RESTAURANT' AND subject_id=$1`, f.restaurantID).Scan(&mine)
	if mine != 0 {
		t.Errorf("the restaurant has %d documents after only refused attaches, want 0", mine)
	}
}

// TestAttachDocument_RefusesAnUploadForAnotherPurpose: the caller's own menu
// photo or delivery photo is not a compliance document.
func TestAttachDocument_RefusesAnUploadForAnotherPurpose(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)

	for _, purpose := range []string{"MENU_IMAGE", "POD", "AVATAR"} {
		obj := seedUpload(t, pool, f.ownerAccountID, purpose, "READY")
		rec := attachDoc(t, pool, f.ownerAccountID, map[string]any{
			"doc_type": "FOOD_SAFETY", "stored_object_id": obj, "valid_until": "2099-01-01",
		})
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s upload: status=%d, want 404 (body: %s)", purpose, rec.Code, rec.Body.String())
		}
		if n := countDocsForFile(t, pool, obj); n != 0 {
			t.Errorf("%s upload: %d documents written, want 0", purpose, n)
		}
	}

	// The caller's own compliance upload is accepted: the refusals above are
	// about the file, not the caller.
	own := seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "READY")
	if rec := attachDoc(t, pool, f.ownerAccountID, map[string]any{
		"doc_type": "FOOD_SAFETY", "stored_object_id": own, "valid_until": "2099-01-01",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("own KYC upload: status=%d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestAttachDocument_MalformedFileIDIs422: a stored_object_id that is not a
// UUID is a validation failure, not a 500 from the uuid cast.
func TestAttachDocument_MalformedFileIDIs422(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	rec := attachDoc(t, pool, f.ownerAccountID, map[string]any{
		"doc_type": "BUSINESS_LICENCE", "stored_object_id": "obj-1",
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestAttachDocument_OneFileAttachedTwiceAtOnce_OneRow fires the same halal
// certificate attach twice at once, then a third time, and expects one document
// row and one certificate, with every caller handed the same document.
func TestAttachDocument_OneFileAttachedTwiceAtOnce_OneRow(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()

	var bodyID string
	if err := pool.QueryRow(ctx,
		`SELECT id FROM halal_issuing_body WHERE deleted_at IS NULL AND status='ACCEPTED' ORDER BY name LIMIT 1`).Scan(&bodyID); err != nil {
		t.Fatalf("no seeded halal issuing body (run migrations/seed): %v", err)
	}
	obj := seedUpload(t, pool, f.ownerAccountID, "KYC_DOCUMENT", "READY")
	body := map[string]any{
		"doc_type":           "HALAL_CERTIFICATE",
		"stored_object_id":   obj,
		"issuer_body_id":     bodyID,
		"certificate_number": fmt.Sprintf("HC-%d", time.Now().UnixNano()),
		"valid_until":        time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
	}

	type result struct {
		code int
		id   string
		body string
	}
	attach := func() result {
		rec := attachDoc(t, pool, f.ownerAccountID, body)
		var env struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		return result{rec.Code, env.Data.ID, rec.Body.String()}
	}

	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]result, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i] = attach()
		}(i)
	}
	close(start)
	wg.Wait()
	results = append(results, attach()) // a later retry with a new idempotency key

	ids := map[string]bool{}
	for i, r := range results {
		if r.code != http.StatusCreated {
			t.Errorf("attach %d: status=%d, want 201 (body: %s)", i, r.code, r.body)
		}
		ids[r.id] = true
	}
	if len(ids) != 1 {
		t.Errorf("attaches returned document ids %v, want the same one every time", ids)
	}
	if n := countDocsForFile(t, pool, obj); n != 1 {
		t.Errorf("document rows for the file = %d, want 1", n)
	}
	var certs, superseded int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status='SUPERSEDED')
		  FROM halal_certificate WHERE restaurant_id=$1`, f.restaurantID).Scan(&certs, &superseded); err != nil {
		t.Fatalf("count certificates: %v", err)
	}
	if certs != 1 || superseded != 0 {
		t.Errorf("halal certificates = %d (%d superseded), want 1 (0 superseded)", certs, superseded)
	}
}
