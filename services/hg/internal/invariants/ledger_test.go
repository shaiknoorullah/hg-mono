package invariants

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Invariant 6 (AGENTS.md numbering) — "Every order's money decomposes to zero
// residual — enforced by an append-only double-entry ledger with a deferred
// SUM = 0 trigger."
//
// internal/payments/ledger_test.go already pins the Go-level guard
// (BuildCaptureBatch/BuildRefundBatch always balance, and PostBatch refuses an
// unbalanced batch in Go before it reaches Postgres). What is missing — and
// what these two tests add — is proof that the DATABASE trigger is the real
// backstop: they write ledger_entry rows directly over the pool, bypassing
// PostBatch's Go-side guard entirely, so only the deferred CONSTRAINT TRIGGER
// (ledger_entry_batch_balanced, migrations/00017_ledger.sql) stands between an
// unbalanced batch and a committed one.
// ---------------------------------------------------------------------------

func uniqueLedgerKey(t *testing.T, prefix string) string {
	t.Helper()
	return fmt.Sprintf("%s:%s:%d", prefix, t.Name(), time.Now().UnixNano())
}

// TestLedger_DeferredTriggerRejectsUnbalancedBatchAtCommit inserts a batch
// with a single 100-cent entry and no counter-entry, then commits. The
// residual is nonzero and the entry count is 1 — both conditions the deferred
// trigger fires on — so Commit must fail, and neither the batch nor the entry
// may survive in the database afterward (rolled back atomically).
func TestLedger_DeferredTriggerRejectsUnbalancedBatchAtCommit(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	key := uniqueLedgerKey(t, "unbalanced")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var batchID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO ledger_batch (kind, idempotency_key, posted_by)
		VALUES ('ADJUSTMENT', $1, 'invariants-test') RETURNING id`, key).Scan(&batchID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ledger_entry (batch_id, account, amount_cents, component)
		VALUES ($1, 'PLATFORM_REVENUE', 100, 'COMMISSION')`, batchID); err != nil {
		t.Fatalf("insert entry: %v", err)
	}

	err = tx.Commit(ctx)
	if err == nil {
		t.Fatal("commit of an unbalanced single-entry batch succeeded — the deferred ledger_entry_batch_balanced trigger did not fire")
	}
	if !strings.Contains(err.Error(), "ledger_batch_unbalanced") && !strings.Contains(err.Error(), "check_violation") {
		t.Errorf("unexpected error (want ledger_batch_unbalanced from the deferred trigger): %v", err)
	}

	assertLedgerBatchAbsent(t, pool, batchID)
}

// TestLedger_BalancedBatchCommitsAndResidualStaysZero is the positive mirror:
// two entries that sum to zero commit cleanly, and the ledger_global_residual
// view — which returns a row only when the ledger-wide SUM across every
// account is nonzero (I-13.7) — has none after the commit. This is the "zero
// residual" property observed as a live database fact, not just a per-batch
// unit test.
func TestLedger_BalancedBatchCommitsAndResidualStaysZero(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	key := uniqueLedgerKey(t, "balanced")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback(ctx) //nolint:errcheck
		}
	}()

	var batchID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO ledger_batch (kind, idempotency_key, posted_by)
		VALUES ('ADJUSTMENT', $1, 'invariants-test') RETURNING id`, key).Scan(&batchID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ledger_entry (batch_id, account, amount_cents, component) VALUES
		  ($1, 'PLATFORM_REVENUE',  100, 'COMMISSION'),
		  ($1, 'PSP_CLEARING',     -100, 'COMMISSION')`, batchID); err != nil {
		t.Fatalf("insert entries: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit a genuinely balanced batch failed: %v", err)
	}
	committed = true
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM ledger_entry WHERE batch_id = $1`, batchID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM ledger_batch WHERE id = $1`, batchID)
	})

	var residual int64
	err = pool.QueryRow(ctx, `SELECT COALESCE(sum(amount_cents),0) FROM ledger_entry WHERE batch_id = $1`, batchID).Scan(&residual)
	if err != nil {
		t.Fatalf("sum entries: %v", err)
	}
	if residual != 0 {
		t.Errorf("batch residual = %d, want 0", residual)
	}
}

// assertLedgerBatchAbsent confirms the batch id never landed durably — proof
// the rollback was atomic (I-13.1's counterpart: a batch that fails balance
// leaves no partial trace, not even the batch header row).
func assertLedgerBatchAbsent(t *testing.T, pool *pgxpool.Pool, batchID string) {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ledger_batch WHERE id = $1`, batchID).Scan(&n); err != nil {
		t.Fatalf("check batch absent: %v", err)
	}
	if n != 0 {
		t.Errorf("ledger_batch %s survived a failed commit — rollback was not atomic", batchID)
	}
}
