package rider

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

// TestAttachRiderDocument_NewFileSupersedesPendingOfThatType: a second file of
// a document type marks the earlier pending upload SUPERSEDED (kept, off the
// review clock) and becomes version 2 pointing at it; an APPROVED row stays in
// force until its replacement is approved (docs/spec/04-rider.md, "D-05 —
// Document upload"; https://github.com/shaiknoorullah/hg-mono/issues/358).
func TestAttachRiderDocument_NewFileSupersedesPendingOfThatType(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	t.Cleanup(func() {
		pool.Exec(context.Background(), `UPDATE kyc_document SET supersedes_id = NULL WHERE subject_id = $1`, riderID)
	})

	attach := func(objectID string) {
		t.Helper()
		rec := do(t, router, "POST", "/v1/riders/me/documents",
			map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": objectID}, tok,
			"Idempotency-Key", fmt.Sprintf("sup-%d", time.Now().UnixNano()))
		if rec.Code != http.StatusCreated {
			t.Fatalf("attach: status=%d, want 201: %s", rec.Code, rec.Body)
		}
	}
	type row struct {
		object, state string
		version       int
		supersedes    *string
		deadline      *time.Time
	}
	rows := func() map[string]row {
		t.Helper()
		out := map[string]row{}
		rs, err := pool.Query(ctx, `
			SELECT id::text, stored_object_id::text, state::text, version, supersedes_id::text, deadline_at
			  FROM kyc_document
			 WHERE subject_type = 'RIDER' AND subject_id = $1 AND rider_doc_type = 'PROFILE_PHOTO'
			   AND deleted_at IS NULL`, riderID)
		if err != nil {
			t.Fatal(err)
		}
		defer rs.Close()
		for rs.Next() {
			var id string
			var r row
			if err := rs.Scan(&id, &r.object, &r.state, &r.version, &r.supersedes, &r.deadline); err != nil {
				t.Fatal(err)
			}
			out[id] = r
		}
		return out
	}
	byObject := func(m map[string]row, object string) (string, row) {
		for id, r := range m {
			if r.object == object {
				return id, r
			}
		}
		t.Fatalf("no row for object %s", object)
		return "", row{}
	}

	first := seedReadyObject(t, ctx, pool, riderID)
	attach(first)
	second := seedReadyObject(t, ctx, pool, riderID)
	attach(second)

	got := rows()
	if len(got) != 2 {
		t.Fatalf("rows = %d, want 2 (history kept)", len(got))
	}
	firstID, f := byObject(got, first)
	_, s := byObject(got, second)
	if f.state != "SUPERSEDED" || f.deadline != nil {
		t.Errorf("first upload: state=%s deadline=%v, want SUPERSEDED with no review deadline", f.state, f.deadline)
	}
	if s.state != "SUBMITTED" || s.version != 2 || s.supersedes == nil || *s.supersedes != firstID {
		t.Errorf("second upload: state=%s version=%d supersedes=%v, want SUBMITTED, 2, %s", s.state, s.version, s.supersedes, firstID)
	}

	// Attaching the first file again changes nothing (one file attaches once).
	attach(first)
	if n := len(rows()); n != 2 {
		t.Errorf("re-attaching a file already attached wrote a row: %d rows, want 2", n)
	}

	// Approve the second, then upload a third: the approved one stays in force.
	if _, err := pool.Exec(ctx, `
		UPDATE kyc_document SET state = 'APPROVED', reviewed_by = $1, reviewed_at = now(),
		       deadline_at = NULL, deadline_action = NULL
		 WHERE stored_object_id = $2`, riderID, second); err != nil {
		t.Fatal(err)
	}
	third := seedReadyObject(t, ctx, pool, riderID)
	attach(third)
	got = rows()
	secondID, s := byObject(got, second)
	_, th := byObject(got, third)
	if s.state != "APPROVED" {
		t.Errorf("approved upload: state=%s after a replacement was attached, want APPROVED until the replacement is approved", s.state)
	}
	if th.state != "SUBMITTED" || th.version != 3 || th.supersedes == nil || *th.supersedes != secondID {
		t.Errorf("third upload: state=%s version=%d supersedes=%v, want SUBMITTED, 3, %s", th.state, th.version, th.supersedes, secondID)
	}
}

// TestAttachRiderDocument_ConcurrentFilesLeaveOnePending: two different files
// of one type attached at once leave exactly one pending row.
func TestAttachRiderDocument_ConcurrentFilesLeaveOnePending(t *testing.T) {
	pool := openTestDB(t)
	ctx := context.Background()
	router, iss := buildRouter(t, pool)
	riderID := seedRiderAccount(t, ctx, pool, "DOCUMENTS_PENDING", "PENDING")
	tok := bearerFor(t, iss, riderID, []string{"RIDER"})
	t.Cleanup(func() {
		pool.Exec(context.Background(), `UPDATE kyc_document SET supersedes_id = NULL WHERE subject_id = $1`, riderID)
	})

	objects := []string{seedReadyObject(t, ctx, pool, riderID), seedReadyObject(t, ctx, pool, riderID)}
	var wg sync.WaitGroup
	for i, o := range objects {
		wg.Add(1)
		go func(i int, o string) {
			defer wg.Done()
			rec := do(t, router, "POST", "/v1/riders/me/documents",
				map[string]any{"doc_type": "PROFILE_PHOTO", "stored_object_id": o}, tok,
				"Idempotency-Key", fmt.Sprintf("supc-%d-%d", time.Now().UnixNano(), i))
			if rec.Code != http.StatusCreated {
				t.Errorf("attach %d: status=%d, want 201: %s", i, rec.Code, rec.Body)
			}
		}(i, o)
	}
	wg.Wait()

	var pending, superseded int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE state IN ('SUBMITTED', 'IN_REVIEW')),
		       count(*) FILTER (WHERE state = 'SUPERSEDED')
		  FROM kyc_document
		 WHERE subject_type = 'RIDER' AND subject_id = $1 AND rider_doc_type = 'PROFILE_PHOTO'
		   AND deleted_at IS NULL`, riderID).Scan(&pending, &superseded); err != nil {
		t.Fatal(err)
	}
	if pending != 1 || superseded != 1 {
		t.Errorf("pending=%d superseded=%d, want 1 and 1", pending, superseded)
	}
}
