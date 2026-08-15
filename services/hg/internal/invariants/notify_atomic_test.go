package invariants

import (
	"context"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// ---------------------------------------------------------------------------
// Invariant 6 — OTP/notify enqueue is atomic with the caller's business
// transaction: "accept the order, capture the payment, THEN
// enqueue.Enqueue(ctx, tx, ...) with the same tx, all one commit"
// (internal/notify/outbox.go's own doc comment on Enqueuer.Enqueue).
// ---------------------------------------------------------------------------

func testNotification(accountID string) notify.New {
	return notify.New{
		AccountID:   mustUUID(accountID),
		RoleContext: notify.RoleCustomer,
		Kind:        notify.KindOrderAccepted,
		Title:       "Order accepted",
		Body:        "Your order was accepted.",
		Priority:    notify.PriorityHigh,
		Channels:    []notify.Channel{notify.ChannelInApp},
	}
}

// TestNotify_EnqueueRollsBackWithTheOrderTransaction proves the atomicity by
// construction: it opens one transaction, writes a would-be "order effect"
// (here, just a marker row insert stands in for the caller's own business
// write) and calls Enqueuer.Enqueue on the SAME tx, then rolls the whole
// transaction back — simulating the order-side effect failing after the
// notify call succeeded in-flight. Neither the notification row nor its River
// delivery job may survive: if Enqueue's write were on a different connection
// or auto-committed, one would land while the order effect vanished.
func TestNotify_EnqueueRollsBackWithTheOrderTransaction(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	accountID := insertNotifyAccount(t, pool)
	riverClient := riverInserterFor(t, pool)
	enq := notify.NewEnqueuer(notify.NewRepo(), riverClient)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	res, err := enq.Enqueue(ctx, tx, testNotification(accountID))
	if err != nil {
		t.Fatalf("enqueue inside tx: %v", err)
	}
	if !res.Queued {
		t.Fatal("expected a new notification to be queued")
	}
	// Simulate the order transaction's OWN effect failing after notify's write
	// succeeded in-flight: roll back everything.
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	if n := countNotifyRows(t, pool, res.NotificationID); n != 0 {
		t.Errorf("notification row survived a rolled-back order tx: %d rows found for %s", n, res.NotificationID)
	}
	if n := countRiverJobRows(t, pool, res.NotificationID); n != 0 {
		t.Errorf("river_job row survived a rolled-back order tx: %d rows found for %s", n, res.NotificationID)
	}
}

// TestNotify_EnqueueCommitsWithTheOrderTransaction is the positive mirror:
// when the order transaction commits, BOTH the notification row and its
// delivery job are durable — the outbox pattern's other half. A caller that
// only wrote one of the two (say, the notification but not the job, from a
// bug in Enqueue) would leave a notification nobody ever delivers; this test
// would catch that.
func TestNotify_EnqueueCommitsWithTheOrderTransaction(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	accountID := insertNotifyAccount(t, pool)
	riverClient := riverInserterFor(t, pool)
	enq := notify.NewEnqueuer(notify.NewRepo(), riverClient)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	res, err := enq.Enqueue(ctx, tx, testNotification(accountID))
	if err != nil {
		t.Fatalf("enqueue inside tx: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM river_job WHERE kind = 'notify_deliver' AND args->>'notification_id' = $1`, res.NotificationID.String())
		_, _ = pool.Exec(c, `DELETE FROM notification WHERE id = $1`, res.NotificationID)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id = $1`, accountID)
	})

	if n := countNotifyRows(t, pool, res.NotificationID); n != 1 {
		t.Errorf("notification rows after commit = %d, want 1", n)
	}
	if n := countRiverJobRows(t, pool, res.NotificationID); n != 1 {
		t.Errorf("river_job rows after commit = %d, want 1 — the notification and its delivery job must commit together", n)
	}
}
