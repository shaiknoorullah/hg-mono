package payments

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strconv"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// With the local fake payment client the capture posts its own CAPTURE batch,
// as the succeeded event it cannot send would (#676): one balanced batch,
// however often the capture is asked for. A capture the fake refuses posts
// nothing and leaves the authorisation held. Skips without
// HG_TEST_POSTGRES_DSN (see testPool).
func TestLocalCaptureLedger(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(NewRepo(pool), NewFakeStripe(), config.Stripe{}, quiet).WithLocalCaptureLedger()
	run := strconv.FormatInt(time.Now().UnixNano(), 36)

	captured := seedOrderWithIntent(t, pool, "pi_fake_local_"+run, "PREPARING", "REQUIRES_CAPTURE")
	for i := 0; i < 2; i++ {
		row, err := svc.Capture(ctx, captured, 3919)
		if err != nil {
			t.Fatalf("capture %d: %v", i+1, err)
		}
		if row.State != string(StateSucceeded) || row.AmountCapturedCents != 3919 {
			t.Fatalf("capture %d: %s, %d captured", i+1, row.State, row.AmountCapturedCents)
		}
	}
	var batches int
	var sum int64
	if err := pool.QueryRow(ctx, `
		SELECT count(DISTINCT b.id), COALESCE(sum(e.amount_cents), 0)::bigint
		  FROM ledger_batch b JOIN ledger_entry e ON e.batch_id = b.id
		 WHERE b.order_id = $1 AND b.kind = 'CAPTURE'`, captured).Scan(&batches, &sum); err != nil {
		t.Fatal(err)
	}
	if batches != 1 || sum != 0 {
		t.Fatalf("CAPTURE batches %d summing to %d; want one, summing to 0", batches, sum)
	}

	refused := seedOrderWithIntent(t, pool, fakeCapFailPrefix+run, "PREPARING", "REQUIRES_CAPTURE")
	if _, err := svc.Capture(ctx, refused, 3919); !errors.Is(err, ErrFakeCaptureFailed) {
		t.Fatalf("capture-fails intent: %v, want the fake's refusal", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_batch WHERE order_id = $1`, refused).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if got := intentState(t, pool, fakeCapFailPrefix+run); n != 0 || got != string(StateRequiresCapture) {
		t.Fatalf("refused capture: %d batches, payment %s; want none and still authorised", n, got)
	}
}
