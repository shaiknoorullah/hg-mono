package admin

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// An approval and a verdict that finds the file INFECTED race for the same
// document. Whatever the order, the document must never end APPROVED over an
// INFECTED file (https://github.com/shaiknoorullah/hg-mono/issues/218). Each
// side runs in its own transaction on its own connection. The verdict is
// recorded the way a re-scan with newer signatures records it.

// seedReviewableDocument inserts a rider document in IN_REVIEW over a file
// whose CLEAN verdict is bound to its bytes, and returns both ids.
func seedReviewableDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uploader string) (docID, fileID string) {
	t.Helper()
	var subject string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('race-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
RETURNING id`).Scan(&subject); err != nil {
		t.Fatalf("seed subject: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at,
                           virus_scan_state, virus_scan_sha256, virus_scan_version)
VALUES ('hg-kyc', 'race/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('d4',32),'hex'),
        'READY', $1, now(), 'CLEAN', decode(repeat('d4',32),'hex'), 1)
RETURNING id`, uploader).Scan(&fileID); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RIDER', $1, 'GOVERNMENT_ID', $2, 'IN_REVIEW', now() + interval '72 hours', 'ESCALATE')
RETURNING id`, subject, fileID).Scan(&docID); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	return docID, fileID
}

// conn is one dedicated connection with its backend pid.
type conn struct {
	c   *pgxpool.Conn
	pid uint32
}

func acquire(t *testing.T, ctx context.Context, pool *pgxpool.Pool) conn {
	t.Helper()
	c, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	t.Cleanup(c.Release)
	return conn{c: c, pid: c.Conn().PgConn().PID()}
}

// recordInfected records a late INFECTED verdict for file in tx, as a re-scan
// does: the recorded reason first, then the verdict.
func recordInfected(ctx context.Context, tx pgx.Tx, fileID string) error {
	if _, err := tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', 'race test: newer signatures', true)`); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
UPDATE stored_object SET virus_scan_state='INFECTED', virus_scan_detail='Win.Test.Race' WHERE id=$1`, fileID)
	return err
}

// lockWait is how long a step waits for the other transaction to queue up
// behind a lock before it carries on regardless.
const lockWait = 3 * time.Second

// waitBlockedBy waits until some backend is waiting on a lock held by pid. If
// none does, the lock that should hold the other side back is missing: the test
// says so and carries on, so the outcome check shows what that costs.
func waitBlockedBy(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid uint32) {
	t.Helper()
	waitFor(t, ctx, pool, `SELECT count(*) FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))`, pid,
		"nothing waited on backend %d: the lock that should hold the other transaction back is missing")
}

// waitBlocked waits until backend pid is waiting on a lock, with the same
// carry-on rule as waitBlockedBy.
func waitBlocked(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid uint32) {
	t.Helper()
	waitFor(t, ctx, pool, `SELECT cardinality(pg_blocking_pids($1::int))`, pid,
		"backend %d never waited: the lock that should hold it back is missing")
}

func waitFor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, q string, pid uint32, msg string) {
	t.Helper()
	deadline := time.Now().Add(lockWait)
	for time.Now().Before(deadline) {
		var n int
		if err := pool.QueryRow(ctx, q, int(pid)).Scan(&n); err != nil {
			t.Fatalf("read lock waits: %v", err)
		}
		if n > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Errorf(msg, pid)
}

// outcome reads the document's state and its file's verdict, and fails the
// test if the document is APPROVED over an INFECTED file.
func outcome(t *testing.T, ctx context.Context, pool *pgxpool.Pool, docID, fileID string) (doc, verdict string) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
SELECT kd.state::text, so.virus_scan_state FROM kyc_document kd JOIN stored_object so ON so.id = kd.stored_object_id
 WHERE kd.id=$1 AND so.id=$2`, docID, fileID).Scan(&doc, &verdict); err != nil {
		t.Fatalf("read outcome: %v", err)
	}
	if doc == "APPROVED" && verdict != "CLEAN" {
		t.Fatalf("the document ended APPROVED over a file whose verdict is %s", verdict)
	}
	return doc, verdict
}

func TestApprovalRacesAnInfectedVerdict(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-race"}
	approve := func(docID string) error {
		_, err := repo.ReviewDocument(ctx, actor, docID, "RIDER", "APPROVE", nil, nil, true)
		return err
	}

	// The verdict holds the file; the approval waits for it, then refuses.
	t.Run("verdict first", func(t *testing.T) {
		docID, fileID := seedReviewableDocument(t, ctx, pool, sa)
		v := acquire(t, ctx, pool)
		vtx, err := v.c.Begin(ctx)
		if err != nil {
			t.Fatalf("begin verdict: %v", err)
		}
		defer func() { _ = vtx.Rollback(ctx) }()
		if err := recordInfected(ctx, vtx, fileID); err != nil {
			t.Fatalf("record verdict: %v", err)
		}
		approved := make(chan error, 1)
		go func() { approved <- approve(docID) }()
		waitBlockedBy(t, ctx, pool, v.pid)
		if err := vtx.Commit(ctx); err != nil {
			t.Fatalf("commit verdict: %v", err)
		}
		if err := <-approved; !errors.Is(err, ErrDocNotScanned) {
			t.Errorf("approval after the verdict: err = %v, want ErrDocNotScanned", err)
		}
		if doc, verdict := outcome(t, ctx, pool, docID, fileID); doc != "IN_REVIEW" || verdict != "INFECTED" {
			t.Errorf("ended %s over %s, want IN_REVIEW over INFECTED", doc, verdict)
		}
	})

	// The approval holds the file; the verdict waits for it, then revokes it.
	// A third connection holds the document's row, so the approval stops with
	// the file locked and the verdict can be started behind it.
	t.Run("approval first", func(t *testing.T) {
		docID, fileID := seedReviewableDocument(t, ctx, pool, sa)
		gate := acquire(t, ctx, pool)
		gtx, err := gate.c.Begin(ctx)
		if err != nil {
			t.Fatalf("begin gate: %v", err)
		}
		defer func() { _ = gtx.Rollback(ctx) }()
		if _, err := gtx.Exec(ctx, `SELECT 1 FROM kyc_document WHERE id=$1 FOR UPDATE`, docID); err != nil {
			t.Fatalf("hold the document: %v", err)
		}
		approved := make(chan error, 1)
		go func() { approved <- approve(docID) }()
		waitBlockedBy(t, ctx, pool, gate.pid) // the approval now holds the file

		v := acquire(t, ctx, pool)
		verdict := make(chan error, 1)
		go func() {
			vtx, err := v.c.Begin(ctx)
			if err != nil {
				verdict <- err
				return
			}
			defer func() { _ = vtx.Rollback(ctx) }()
			if err := recordInfected(ctx, vtx, fileID); err != nil {
				verdict <- err
				return
			}
			verdict <- vtx.Commit(ctx)
		}()
		waitBlocked(t, ctx, pool, v.pid) // the verdict waits for the approval
		if err := gtx.Commit(ctx); err != nil {
			t.Fatalf("release the document: %v", err)
		}
		if err := <-approved; err != nil {
			t.Fatalf("approval while the file was still CLEAN: %v", err)
		}
		if err := <-verdict; err != nil {
			t.Fatalf("verdict after the approval: %v", err)
		}
		if doc, verdict := outcome(t, ctx, pool, docID, fileID); doc != "IN_REVIEW" || verdict != "INFECTED" {
			t.Errorf("ended %s over %s, want IN_REVIEW over INFECTED", doc, verdict)
		}
	})

	// Any writer: an approval written straight to the table, without the
	// admin path's own check, holds the file through the database trigger.
	t.Run("direct approval first", func(t *testing.T) {
		docID, fileID := seedReviewableDocument(t, ctx, pool, sa)
		a := acquire(t, ctx, pool)
		atx, err := a.c.Begin(ctx)
		if err != nil {
			t.Fatalf("begin approval: %v", err)
		}
		defer func() { _ = atx.Rollback(ctx) }()
		if _, err := atx.Exec(ctx, `
UPDATE kyc_document SET state='APPROVED', reviewed_by=$2, reviewed_at=now(), deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`, docID, sa); err != nil {
			t.Fatalf("approve: %v", err)
		}
		v := acquire(t, ctx, pool)
		verdict := make(chan error, 1)
		go func() {
			vtx, err := v.c.Begin(ctx)
			if err != nil {
				verdict <- err
				return
			}
			defer func() { _ = vtx.Rollback(ctx) }()
			if err := recordInfected(ctx, vtx, fileID); err != nil {
				verdict <- err
				return
			}
			verdict <- vtx.Commit(ctx)
		}()
		waitBlocked(t, ctx, pool, v.pid)
		if err := atx.Commit(ctx); err != nil {
			t.Fatalf("commit approval: %v", err)
		}
		if err := <-verdict; err != nil {
			t.Fatalf("verdict after the approval: %v", err)
		}
		if doc, verdict := outcome(t, ctx, pool, docID, fileID); doc != "IN_REVIEW" || verdict != "INFECTED" {
			t.Errorf("ended %s over %s, want IN_REVIEW over INFECTED", doc, verdict)
		}
	})

	t.Run("direct approval second", func(t *testing.T) {
		docID, fileID := seedReviewableDocument(t, ctx, pool, sa)
		v := acquire(t, ctx, pool)
		vtx, err := v.c.Begin(ctx)
		if err != nil {
			t.Fatalf("begin verdict: %v", err)
		}
		defer func() { _ = vtx.Rollback(ctx) }()
		if err := recordInfected(ctx, vtx, fileID); err != nil {
			t.Fatalf("record verdict: %v", err)
		}
		a := acquire(t, ctx, pool)
		approved := make(chan error, 1)
		go func() {
			_, err := a.c.Exec(ctx, `
UPDATE kyc_document SET state='APPROVED', reviewed_by=$2, reviewed_at=now(), deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`, docID, sa)
			approved <- err
		}()
		waitBlocked(t, ctx, pool, a.pid)
		if err := vtx.Commit(ctx); err != nil {
			t.Fatalf("commit verdict: %v", err)
		}
		if err := <-approved; err == nil {
			t.Errorf("the database approved a document after its file was found INFECTED")
		}
		if doc, verdict := outcome(t, ctx, pool, docID, fileID); doc == "APPROVED" || verdict != "INFECTED" {
			t.Errorf("ended %s over %s, want not APPROVED over INFECTED", doc, verdict)
		}
	})

	// Both started together behind a barrier, many times over, on two
	// connections: whichever wins, no round ends approved over INFECTED.
	t.Run("barrier", func(t *testing.T) {
		const rounds = 40
		approvedFirst, refused := 0, 0
		for range rounds {
			docID, fileID := seedReviewableDocument(t, ctx, pool, sa)
			v, err := pool.Acquire(ctx)
			if err != nil {
				t.Fatalf("acquire: %v", err)
			}
			barrier := make(chan struct{})
			var wg sync.WaitGroup
			var approveErr, verdictErr error
			wg.Add(2)
			go func() {
				defer wg.Done()
				<-barrier
				approveErr = approve(docID)
			}()
			go func() {
				defer wg.Done()
				<-barrier
				vtx, err := v.Begin(ctx)
				if err != nil {
					verdictErr = err
					return
				}
				defer func() { _ = vtx.Rollback(ctx) }()
				if err := recordInfected(ctx, vtx, fileID); err != nil {
					verdictErr = err
					return
				}
				verdictErr = vtx.Commit(ctx)
			}()
			close(barrier)
			wg.Wait()
			v.Release()
			if verdictErr != nil {
				t.Fatalf("verdict: %v", verdictErr)
			}
			switch {
			case approveErr == nil:
				approvedFirst++
			case errors.Is(approveErr, ErrDocNotScanned):
				refused++
			default:
				t.Fatalf("approval: %v", approveErr)
			}
			if doc, verdict := outcome(t, ctx, pool, docID, fileID); doc != "IN_REVIEW" || verdict != "INFECTED" {
				t.Fatalf("ended %s over %s, want IN_REVIEW over INFECTED", doc, verdict)
			}
		}
		t.Logf("%d rounds: approval first and then revoked %d, approval refused %d", rounds, approvedFirst, refused)
	})
}
