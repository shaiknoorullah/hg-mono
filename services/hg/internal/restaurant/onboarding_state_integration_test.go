package restaurant_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// recomputeState runs RecomputeOnboarding in its own transaction (as the real
// callers do) and returns the restaurant's resulting onboarding + account state.
func recomputeState(t *testing.T, pool *pgxpool.Pool, rid string) (string, string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := restaurant.RecomputeOnboarding(ctx, tx, rid); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("recompute: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	var st, acct string
	if err := pool.QueryRow(ctx,
		`SELECT onboarding_state::text, account_state::text FROM restaurant WHERE id=$1`, rid,
	).Scan(&st, &acct); err != nil {
		t.Fatalf("read state: %v", err)
	}
	return st, acct
}

// TestRecomputeOnboarding_GoLive walks a restaurant through the automatic
// post-approval band (spec 03-restaurant R-11/R-17/R-06), satisfying one gate at
// a time and asserting the recompute advances exactly one step — and crucially,
// that it does NOT jump to ACTIVE while any gate is unmet.
func TestRecomputeOnboarding_GoLive(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // gives a restaurant with a LIVE menu item already
	ctx := context.Background()
	rid := f.restaurantID

	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM restaurant_hours WHERE restaurant_id=$1`, rid)
		_, _ = pool.Exec(c, `DELETE FROM connect_account WHERE owner_type='RESTAURANT' AND owner_id=$1`, rid)
		_, _ = pool.Exec(c, `DELETE FROM restaurant_onboarding_transition WHERE restaurant_id=$1`, rid)
	})

	// Baseline: admin has just approved the documents. location + province are set
	// during profile submission (early, before doc approval); the LIVE account_state
	// CHECK (restaurant_live_needs_location) requires them, so seed them here as the
	// real flow would already have.
	if _, err := pool.Exec(ctx, `
		UPDATE restaurant
		   SET onboarding_state='DOCUMENTS_APPROVED', account_state='PENDING',
		       province='ON',
		       location=ST_SetSRID(ST_MakePoint(-79.38, 43.65), 4326)::geography
		 WHERE id=$1`, rid); err != nil {
		t.Fatalf("seed DOCUMENTS_APPROVED: %v", err)
	}

	// 1. DOCUMENTS_APPROVED -> PAYOUT_PENDING (automatic; no payout account yet).
	if st, acct := recomputeState(t, pool, rid); st != "PAYOUT_PENDING" || acct != "PENDING" {
		t.Fatalf("docs approved: got %s/%s, want PAYOUT_PENDING/PENDING", st, acct)
	}

	// 2a. A payout account that is NOT yet ready must hold the state at PAYOUT_PENDING.
	if _, err := pool.Exec(ctx, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
		VALUES ('RESTAURANT', $1, 'acct_notready_'||substr(md5(random()::text),1,8), false, false)`, rid); err != nil {
		t.Fatalf("seed not-ready connect: %v", err)
	}
	if st, _ := recomputeState(t, pool, rid); st != "PAYOUT_PENDING" {
		t.Fatalf("payout NOT ready: got %s, want PAYOUT_PENDING (must not advance)", st)
	}

	// 2b. Payout account reaches READY -> MENU_PENDING. A LIVE item already exists, but
	// hours are not set, so it must stop at MENU_PENDING (must NOT jump to ACTIVE).
	if _, err := pool.Exec(ctx,
		`UPDATE connect_account SET payouts_enabled=true, details_submitted=true WHERE owner_type='RESTAURANT' AND owner_id=$1`, rid); err != nil {
		t.Fatalf("mark payout ready: %v", err)
	}
	if st, acct := recomputeState(t, pool, rid); st != "MENU_PENDING" || acct != "PENDING" {
		t.Fatalf("payout ready (no hours): got %s/%s, want MENU_PENDING/PENDING", st, acct)
	}

	// 3. Hours set (live item already present) -> ACTIVE, and account_state flips to LIVE.
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
		VALUES ($1, 1, '09:00', '21:00')`, rid); err != nil {
		t.Fatalf("seed hours: %v", err)
	}
	if st, acct := recomputeState(t, pool, rid); st != "ACTIVE" || acct != "LIVE" {
		t.Fatalf("menu+payout+hours: got %s/%s, want ACTIVE/LIVE", st, acct)
	}

	// 4. Idempotent: recomputing an already-ACTIVE restaurant is a no-op.
	if st, acct := recomputeState(t, pool, rid); st != "ACTIVE" || acct != "LIVE" {
		t.Fatalf("idempotent recompute drifted: %s/%s", st, acct)
	}
}
