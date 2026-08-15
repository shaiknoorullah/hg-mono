package notify

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// insertAccount creates a minimal account row and returns its id, so
// notification's account_id FK is satisfiable in tests without depending on
// the auth module (which is not built in this isolated worktree). The phone
// number is suffixed with a fresh UUID so re-running the suite against a
// long-lived database (HG_TEST_POSTGRES_DSN, as opposed to the default
// fresh-per-test container) never collides with a previous run's rows.
var phoneSeq atomic.Int64

// insertAccount ignores the exact digits of phonePrefix beyond its use as a
// human-readable label in test names; the actual phone_e164 stored is always
// freshly generated so concurrent/rerun test cases never collide on the
// account.phone_e164 unique constraint.
func insertAccount(t *testing.T, pool *pgxpool.Pool, phonePrefix string) uuid.UUID {
	t.Helper()
	_ = phonePrefix
	n := phoneSeq.Add(1)
	phone := fmt.Sprintf("+1555%09d", n)
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO account (phone_e164) VALUES ($1) RETURNING id`, phone).Scan(&id)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	return id
}

// riverInserter builds an insert-only River client: no Queues, no Workers.
// River explicitly supports this for callers that only need InsertTx (river's
// NewClient doc: "an insert-only client can be initialized by omitting
// Queues"), which is exactly what Enqueuer needs in these tests.
func riverInserter(t *testing.T, pool *pgxpool.Pool) *river.Client[pgx.Tx] {
	t.Helper()
	c, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatalf("new river client: %v", err)
	}
	return c
}

// countRiverJobsFor scopes the count to one notification id, not the whole
// river_job table — tests share one long-lived database (see setupTestDB),
// so a bare `WHERE kind = ...` count leaks rows across unrelated test cases.
func countRiverJobsFor(t *testing.T, pool *pgxpool.Pool, notificationID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM river_job WHERE kind = $1 AND args->>'notification_id' = $2`,
		DeliverArgs{}.Kind(), notificationID.String()).Scan(&n); err != nil {
		t.Fatalf("count river jobs: %v", err)
	}
	return n
}

func countNotifications(t *testing.T, pool *pgxpool.Pool, accountID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM notification WHERE account_id = $1`, accountID).Scan(&n); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	return n
}

func testNew(accountID uuid.UUID, dedupe string) New {
	return New{
		AccountID:   accountID,
		RoleContext: RoleCustomer,
		Kind:        KindOrderAccepted,
		Title:       "Order accepted",
		Body:        "Your order was accepted.",
		Priority:    PriorityHigh,
		Channels:    []Channel{ChannelPush, ChannelSMS, ChannelInApp},
		DedupeKey:   dedupe,
	}
}

// TestEnqueueIsAtomicWithTheCallersTransaction is the central guarantee in
// doc.go: rolling back the caller's transaction must leave neither a
// notification row nor a River job behind, and committing must leave both.
func TestEnqueueIsAtomicWithTheCallersTransaction(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()
	client := riverInserter(t, pool)
	enq := NewEnqueuer(repo, client)

	account := insertAccount(t, pool, "+15550001111")

	// Roll back: nothing should exist afterward.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	rolledBack, err := enq.Enqueue(ctx, tx, testNew(account, "rollback-case"))
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if got := countNotifications(t, pool, account); got != 0 {
		t.Errorf("after rollback: %d notification rows, want 0", got)
	}
	if got := countRiverJobsFor(t, pool, rolledBack.NotificationID); got != 0 {
		t.Errorf("after rollback: %d river jobs, want 0", got)
	}

	// Commit: both the row and the job must exist.
	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	res, err := enq.Enqueue(ctx, tx, testNew(account, "commit-case"))
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if !res.Queued {
		t.Errorf("Queued = false, want true for a fresh dedupe key")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if got := countNotifications(t, pool, account); got != 1 {
		t.Errorf("after commit: %d notification rows, want 1", got)
	}
	if got := countRiverJobsFor(t, pool, res.NotificationID); got != 1 {
		t.Errorf("after commit: %d river jobs, want 1", got)
	}
}

// TestEnqueueIsIdempotentByDedupeKey proves the second half of "idempotent
// enqueue": calling Enqueue twice for the same (account, dedupe_key) produces
// exactly one notification row and one job, and the second call reports
// Queued=false with the first call's id.
func TestEnqueueIsIdempotentByDedupeKey(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()
	client := riverInserter(t, pool)
	enq := NewEnqueuer(repo, client)

	account := insertAccount(t, pool, "+15550001112")
	n := testNew(account, "same-key")

	tx1, _ := pool.Begin(ctx)
	first, err := enq.Enqueue(ctx, tx1, n)
	if err != nil {
		t.Fatalf("enqueue 1: %v", err)
	}
	if err := tx1.Commit(ctx); err != nil {
		t.Fatalf("commit 1: %v", err)
	}

	tx2, _ := pool.Begin(ctx)
	second, err := enq.Enqueue(ctx, tx2, n)
	if err != nil {
		t.Fatalf("enqueue 2: %v", err)
	}
	if err := tx2.Commit(ctx); err != nil {
		t.Fatalf("commit 2: %v", err)
	}

	if !first.Queued {
		t.Error("first call: Queued = false, want true")
	}
	if second.Queued {
		t.Error("second call: Queued = true, want false (idempotent no-op)")
	}
	if first.NotificationID != second.NotificationID {
		t.Errorf("ids differ: %s vs %s", first.NotificationID, second.NotificationID)
	}
	if got := countNotifications(t, pool, account); got != 1 {
		t.Errorf("%d notification rows after two Enqueue calls with the same dedupe key, want 1", got)
	}
	if got := countRiverJobsFor(t, pool, first.NotificationID); got != 1 {
		t.Errorf("%d river jobs after two Enqueue calls with the same dedupe key, want 1", got)
	}
}

// TestOTPBodyNeverPersistsTheCode is the halal-adjacent-but-really-security
// invariant from the contract: Notification.body must never contain an OTP
// code. BuildOTP's redacted Body is what gets persisted; the real code lives
// only in the per-channel override, which InsertNotification never touches.
func TestOTPBodyNeverPersistsTheCode(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()

	account := insertAccount(t, pool, "+15550009999")
	code := "482913"
	n := BuildOTP(OTPArgs{AccountID: account, PhoneE164: "+15550009999", Code: code, ChallengeKey: "chal-1"})

	tx, _ := pool.Begin(ctx)
	id, ok, err := repo.InsertNotification(ctx, tx, n)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if !ok {
		t.Fatal("expected a new row")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	got, err := repo.GetNotification(ctx, pool, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if strings.Contains(got.Body, code) || strings.Contains(got.Title, code) {
		t.Fatalf("persisted notification carries the OTP code: title=%q body=%q", got.Title, got.Body)
	}
	if n.Overrides[ChannelSMS].Body == "" || !strings.Contains(n.Overrides[ChannelSMS].Body, code) {
		t.Fatal("the SMS override must carry the real code, or the user never receives it")
	}
}

// TestMarkReadIsOwnershipScopedAndIdempotent covers P-07's second line of
// defence at the repository layer, and that reading twice is a safe no-op.
func TestMarkReadIsOwnershipScopedAndIdempotent(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()
	client := riverInserter(t, pool)
	enq := NewEnqueuer(repo, client)

	owner := insertAccount(t, pool, "+15550002221")
	stranger := insertAccount(t, pool, "+15550002222")

	tx, _ := pool.Begin(ctx)
	res, err := enq.Enqueue(ctx, tx, testNew(owner, "mark-read-case"))
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if found, err := repo.MarkRead(ctx, pool, stranger, res.NotificationID); err != nil {
		t.Fatalf("mark read (stranger): %v", err)
	} else if found {
		t.Error("a stranger's MarkRead reported found=true; ownership check did not filter it out")
	}

	if found, err := repo.MarkRead(ctx, pool, owner, res.NotificationID); err != nil {
		t.Fatalf("mark read (owner): %v", err)
	} else if !found {
		t.Error("owner's MarkRead reported found=false")
	}

	// Second call: still "found" (the row exists and belongs to them), not an
	// error, and read_at does not need to change again.
	if found, err := repo.MarkRead(ctx, pool, owner, res.NotificationID); err != nil {
		t.Fatalf("mark read (owner, second time): %v", err)
	} else if !found {
		t.Error("second MarkRead by the owner reported found=false, want true (idempotent)")
	}

	list, err := repo.ListInbox(ctx, pool, owner, false, 10, time.Time{})
	if err != nil {
		t.Fatalf("list inbox: %v", err)
	}
	if len(list) != 1 || list[0].ReadAt == nil {
		t.Fatalf("expected exactly one read notification in the inbox, got %+v", list)
	}
}

// TestListInboxIsNonDestructive is P-24's headline claim, tested directly:
// reading the inbox any number of times must not change what's in it.
func TestListInboxIsNonDestructive(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()
	client := riverInserter(t, pool)
	enq := NewEnqueuer(repo, client)

	account := insertAccount(t, pool, "+15550003331")
	for i := 0; i < 3; i++ {
		tx, _ := pool.Begin(ctx)
		if _, err := enq.Enqueue(ctx, tx, testNew(account, fmt.Sprintf("inbox-item-%d", i))); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit %d: %v", i, err)
		}
	}

	first, err := repo.ListInbox(ctx, pool, account, false, 10, time.Time{})
	if err != nil {
		t.Fatalf("list 1: %v", err)
	}
	second, err := repo.ListInbox(ctx, pool, account, false, 10, time.Time{})
	if err != nil {
		t.Fatalf("list 2: %v", err)
	}
	if len(first) != 3 || len(second) != 3 {
		t.Fatalf("got %d then %d rows, want 3 both times", len(first), len(second))
	}
	for i := range first {
		if first[i].ID != second[i].ID {
			t.Fatalf("row %d differs between reads: %s vs %s", i, first[i].ID, second[i].ID)
		}
	}
}
