package payments

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// The weekly payout run against a real, migrated Postgres (issue #251). Each
// test gets a database of its own, because a run for every partner pays
// whatever the database holds. The server is HG_TEST_POSTGRES_DSN's, or a
// throwaway container; with neither the tests skip.

// TestPayoutRun_TwoMondays is the issue's "done when": the job run as of two
// consecutive Mondays gives one payout per partner per week, each payout is
// exactly the entries it stamped, and the ledger stays at zero. It also
// covers a held payout released on the next Monday.
func TestPayoutRun_TwoMondays(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)

	riderA := addPartner(t, db, PayeeRider, true)
	restaurantB := addPartner(t, db, PayeeRestaurant, true)
	riderC := addPartner(t, db, PayeeRider, false) // Stripe has payouts turned off

	// Week of 10 August.
	earn(t, db, riderA, 1200, toronto(2026, 8, 11, 12, 0)) // $12.00: there is no minimum
	earn(t, db, riderA, 899, toronto(2026, 8, 15, 20, 0))
	earn(t, db, restaurantB, 4500, toronto(2026, 8, 12, 13, 0))
	earn(t, db, riderC, 700, toronto(2026, 8, 13, 18, 0))
	runAt(t, runner, toronto(2026, 8, 17, 10, 0))

	assertPayouts(t, db, riderA, want{end: toronto(2026, 8, 17, 0, 0), cents: 2099, state: "PAID"})
	assertPayouts(t, db, restaurantB, want{end: toronto(2026, 8, 17, 0, 0), cents: 4500, state: "PAID"})
	assertPayouts(t, db, riderC, want{end: toronto(2026, 8, 17, 0, 0), cents: 700, state: "HELD"})

	// Week of 17 August. Rider C fixes their Stripe account midweek; the held
	// payout goes out with the next Monday run, not before.
	earn(t, db, riderA, 500, toronto(2026, 8, 18, 12, 0))
	earn(t, db, restaurantB, 3000, toronto(2026, 8, 20, 19, 0))
	earn(t, db, riderC, 300, toronto(2026, 8, 21, 12, 0))
	mustExec(t, db, `UPDATE connect_account SET payouts_enabled = true WHERE owner_id = $1`, riderC.ID)
	runAt(t, runner, toronto(2026, 8, 24, 10, 0))
	runAt(t, runner, toronto(2026, 8, 24, 11, 0)) // nothing left to do

	assertPayouts(t, db, riderA,
		want{end: toronto(2026, 8, 17, 0, 0), cents: 2099, state: "PAID"},
		want{end: toronto(2026, 8, 24, 0, 0), cents: 500, state: "PAID"})
	assertPayouts(t, db, restaurantB,
		want{end: toronto(2026, 8, 17, 0, 0), cents: 4500, state: "PAID"},
		want{end: toronto(2026, 8, 24, 0, 0), cents: 3000, state: "PAID"})
	assertPayouts(t, db, riderC,
		want{end: toronto(2026, 8, 17, 0, 0), cents: 700, state: "PAID"},
		want{end: toronto(2026, 8, 24, 0, 0), cents: 300, state: "PAID"})
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 8, 24, 0, 0)), riderC, OutcomeReleased, OutcomePaid)

	if n := stripe.made(); n != 6 {
		t.Fatalf("Stripe made %d transfers, want 6: one per payout", n)
	}
	// The two scheduled runs finished; the next Monday's is already queued.
	var finished, queued int
	queryRow(t, db, `SELECT count(*) FILTER (WHERE state = 'SUCCEEDED'), count(*) FILTER (WHERE state = 'QUEUED')
	                   FROM payout_run WHERE kind = 'SCHEDULED'`, &finished, &queued)
	if finished != 2 || queued != 1 {
		t.Fatalf("scheduled runs: %d succeeded and %d queued, want 2 and 1", finished, queued)
	}
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_NeverPaysTwice: running a period again, two replicas at once,
// two runs at once past the lease, and a retried transfer that had already
// reached Stripe all leave one payout per partner per period and one transfer
// per payout.
func TestPayoutRun_NeverPaysTwice(t *testing.T) {
	db := payoutTestDB(t)
	replica2 := secondPool(t, db)
	stripe := newStripeTransfers()
	r1 := newTestRunner(db, stripe, 30)
	r2 := newTestRunner(replica2, stripe, 30)
	monday := toronto(2026, 8, 17, 10, 0)
	period := toronto(2026, 8, 17, 0, 0)
	admin := addAdmin(t, db)
	ctx := context.Background()

	var riders []PayeeRef
	for i := 0; i < 3; i++ {
		p := addPartner(t, db, PayeeRider, true)
		earn(t, db, p, int64(1000+i), toronto(2026, 8, 12, 12, 0))
		riders = append(riders, p)
	}

	// Two replicas tick at the same moment: the lease lets one pay.
	r1.now, r2.now = fixed(monday), fixed(monday)
	var wg sync.WaitGroup
	for _, r := range []*PayoutRunner{r1, r2} {
		wg.Add(1)
		go func(r *PayoutRunner) {
			defer wg.Done()
			if _, err := r.RunDue(ctx); err != nil {
				t.Errorf("RunDue: %v", err)
			}
		}(r)
	}
	wg.Wait()
	for i, p := range riders {
		assertPayouts(t, db, p, want{end: period, cents: int64(1000 + i), state: "PAID"})
	}
	if n := stripe.made(); n != 3 {
		t.Fatalf("two replicas made %d transfers, want 3", n)
	}

	// An admin runs the same period again: everyone is already paid.
	run, replayed, err := r1.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000001"})
	if err != nil || replayed {
		t.Fatalf("request: replayed=%v err=%v", replayed, err)
	}
	if again, replayed, err := r1.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000001"}); err != nil || !replayed || again.ID != run.ID {
		t.Fatalf("a retried request must return the first run: replayed=%v err=%v", replayed, err)
	}
	other := addPartner(t, db, PayeeRestaurant, true)
	if _, _, err := r1.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000001", Payee: &other}); !errors.Is(err, ErrIdempotencyReuse) {
		t.Fatalf("the same key with another body: err=%v, want ErrIdempotencyReuse", err)
	}
	future := monday.Add(time.Hour)
	if _, _, err := r1.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000002", AsOf: &future}); !errors.Is(err, ErrAsOfInFuture) {
		t.Fatalf("as_of in the future: err=%v, want ErrAsOfInFuture", err)
	}
	if _, err := r1.RunDue(ctx); err != nil {
		t.Fatal(err)
	}
	rerun, err := r1.repo.GetPayoutRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rerun.State != RunSucceeded || rerun.Partners != 0 || rerun.Paid != 0 {
		t.Fatalf("re-running a paid period: %s with %d partners and %d paid, want SUCCEEDED with 0 and 0",
			rerun.State, rerun.Partners, rerun.Paid)
	}
	if n := stripe.made(); n != 3 {
		t.Fatalf("a re-run made %d transfers in all, want still 3", n)
	}

	// Past the lease: two runs for the same period execute at once, for an
	// entry that committed after the first run (dated before its cutoff).
	late := addPartner(t, db, PayeeRider, true)
	earn(t, db, late, 800, toronto(2026, 8, 14, 12, 0))
	runA, _, err := r1.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000003"})
	if err != nil {
		t.Fatal(err)
	}
	runB, _, err := r2.Request(ctx, PayoutRunRequest{Actor: adminActor{AccountID: admin}, IdempotencyKey: "rerun-0000000000004"})
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range []struct {
		r   *PayoutRunner
		run PayoutRunRow
	}{{r1, runA}, {r2, runB}} {
		wg.Add(1)
		go func(r *PayoutRunner, run PayoutRunRow) {
			defer wg.Done()
			if err := r.execute(ctx, run); err != nil {
				t.Errorf("execute: %v", err)
			}
		}(x.r, x.run)
	}
	wg.Wait()
	assertPayouts(t, db, late, want{end: period, cents: 800, state: "PAID"})
	paid, already := 0, 0
	for _, o := range runOutcomes(t, db, late, runA.ID, runB.ID) {
		switch o {
		case OutcomePaid:
			paid++
		case OutcomeAlreadyPaid:
			already++
		}
	}
	if paid != 1 || already != 1 {
		t.Fatalf("two concurrent runs wrote %d PAID and %d ALREADY_PAID lines for one partner, want 1 and 1", paid, already)
	}
	if n := stripe.made(); n != 4 {
		t.Fatalf("two concurrent runs made %d transfers in all, want 4", n)
	}

	// A transfer that reached Stripe but timed out on the way back. A week
	// later Stripe has forgotten the idempotency key, so only finding the
	// transfer by its group stops a second one.
	slow := addPartner(t, db, PayeeRider, true)
	earn(t, db, slow, 650, toronto(2026, 8, 19, 12, 0))
	stripe.timeoutAfterCreate(slow.ID)
	runAt(t, r1, toronto(2026, 8, 24, 10, 0))
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 8, 24, 0, 0)), slow, OutcomeTransferFailed)
	assertPayouts(t, db, slow, want{end: toronto(2026, 8, 24, 0, 0), cents: 650, state: "READY"})
	stripe.forgetKeys()
	runAt(t, r1, toronto(2026, 8, 31, 10, 0))
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 8, 31, 0, 0)), slow, OutcomeReleased, OutcomeNothingDue)
	assertPayouts(t, db, slow, want{end: toronto(2026, 8, 24, 0, 0), cents: 650, state: "PAID"})
	if n := stripe.madeFor(slow.ID); n != 1 {
		t.Fatalf("Stripe made %d transfers for the retried payout, want 1", n)
	}
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_CutoffBoundary: an earning made one microsecond before Monday
// 00:00 Toronto is in that Monday's payout; one made at 00:00 exactly is in
// the next week's, and the run waits for 09:00.
func TestPayoutRun_CutoffBoundary(t *testing.T) {
	db := payoutTestDB(t)
	runner := newTestRunner(db, newStripeTransfers(), 30)
	cutoff := toronto(2026, 8, 17, 0, 0)
	rider := addPartner(t, db, PayeeRider, true)
	earn(t, db, rider, 100, cutoff.Add(-time.Microsecond))
	earn(t, db, rider, 20, cutoff)
	earn(t, db, rider, 3, toronto(2026, 8, 17, 8, 0))

	runAt(t, runner, toronto(2026, 8, 17, 8, 59)) // not due before 09:00
	assertPayouts(t, db, rider)

	runAt(t, runner, toronto(2026, 8, 17, 9, 0))
	assertPayouts(t, db, rider, want{end: cutoff, cents: 100, state: "PAID"})

	runAt(t, runner, toronto(2026, 8, 24, 9, 0))
	assertPayouts(t, db, rider,
		want{end: cutoff, cents: 100, state: "PAID"},
		want{end: toronto(2026, 8, 24, 0, 0), cents: 23, state: "PAID"})
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_NegativeBalance: a balance below zero is carried and netted
// against later earnings; a restaurant below zero for more than the limit
// takes no new orders until it recovers; a rider is never blocked.
func TestPayoutRun_NegativeBalance(t *testing.T) {
	db := payoutTestDB(t)
	runner := newTestRunner(db, newStripeTransfers(), 30)
	restaurant := addPartner(t, db, PayeeRestaurant, true)
	rider := addPartner(t, db, PayeeRider, true)

	earn(t, db, restaurant, 1000, toronto(2026, 8, 3, 12, 0))
	earn(t, db, restaurant, -1500, toronto(2026, 8, 5, 12, 0)) // a refund charged back
	earn(t, db, rider, 400, toronto(2026, 8, 4, 12, 0))
	earn(t, db, rider, -900, toronto(2026, 8, 6, 12, 0))

	runAt(t, runner, toronto(2026, 8, 10, 10, 0))
	assertPayouts(t, db, restaurant)
	assertPayouts(t, db, rider)
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 8, 10, 0, 0)), restaurant, OutcomeCarriedNegative)
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 8, 10, 0, 0)), rider, OutcomeCarriedNegative)
	assertBlocked(t, db, restaurant, false)

	// 33 days below zero: the restaurant is blocked, the rider is not.
	runAt(t, runner, toronto(2026, 9, 7, 10, 0))
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 9, 7, 0, 0)), restaurant, OutcomeCarriedNegative, OutcomeOrdersBlocked)
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 9, 7, 0, 0)), rider, OutcomeCarriedNegative)
	assertBlocked(t, db, restaurant, true)

	// New earnings: the payout is netted and the block lifts.
	earn(t, db, restaurant, 2000, toronto(2026, 9, 8, 12, 0))
	earn(t, db, rider, 1000, toronto(2026, 9, 8, 12, 0))
	runAt(t, runner, toronto(2026, 9, 14, 10, 0))
	assertPayouts(t, db, restaurant, want{end: toronto(2026, 9, 14, 0, 0), cents: 1500, state: "PAID"})
	assertPayouts(t, db, rider, want{end: toronto(2026, 9, 14, 0, 0), cents: 500, state: "PAID"})
	assertOutcomes(t, db, lastRun(t, db, toronto(2026, 9, 14, 0, 0)), restaurant, OutcomePaid, OutcomeOrdersUnblocked)
	assertBlocked(t, db, restaurant, false)
	assertLedgerAtZero(t, db)
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

func toronto(y int, m time.Month, d, h, min int) time.Time {
	return time.Date(y, m, d, h, min, 0, 0, payoutZone)
}

func fixed(t time.Time) func() time.Time { return func() time.Time { return t } }

func newTestRunner(db *pgxpool.Pool, s *stripeTransfers, blockDays int) *PayoutRunner {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewPayoutRunner(NewRepo(db), s.client(), PayoutPolicy{RestaurantNegativeBlockDays: blockDays}, "test", log)
}

// runAt ticks the runner as if the clock read at.
func runAt(t *testing.T, r *PayoutRunner, at time.Time) {
	t.Helper()
	r.now = fixed(at)
	ran, err := r.RunDue(context.Background())
	if err != nil || !ran {
		t.Fatalf("RunDue at %s: ran=%v err=%v", at, ran, err)
	}
}

func mustExec(t *testing.T, db *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := db.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func queryRow(t *testing.T, db *pgxpool.Pool, sql string, dest ...any) {
	t.Helper()
	if err := db.QueryRow(context.Background(), sql).Scan(dest...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// addPartner makes a restaurant or a rider with a Stripe Connect account.
func addPartner(t *testing.T, db *pgxpool.Pool, kind string, payoutsEnabled bool) PayeeRef {
	t.Helper()
	p := PayeeRef{Type: kind, ID: uuid.NewString()}
	if kind == PayeeRestaurant {
		mustExec(t, db, `INSERT INTO restaurant (id, slug, legal_name, display_name) VALUES ($1, $2, 'Test Co', 'Test Kitchen')`, p.ID, "test-"+p.ID)
	}
	reqs := `{}`
	if !payoutsEnabled {
		reqs = `{"currently_due": ["external_account"]}`
	}
	mustExec(t, db, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted, requirements)
		VALUES ($1, $2, $3, $4, true, $5::jsonb)`, p.Type, p.ID, "acct_"+p.ID, payoutsEnabled, reqs)
	return p
}

func addAdmin(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `
		INSERT INTO account (email, status) VALUES ('admin-' || gen_random_uuid()::text || '@test.local', 'ACTIVE')
		RETURNING id::text`).Scan(&id); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	return id
}

// earn posts a balanced batch moving cents into (or, negative, out of) a
// partner's payable account, dated at.
func earn(t *testing.T, db *pgxpool.Pool, p PayeeRef, cents int64, at time.Time) {
	t.Helper()
	ctx := context.Background()
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		var batch string
		kind, counter, component := "SETTLE", "PSP_CLEARING", "SUBTOTAL"
		if cents < 0 {
			kind, counter, component = "REFUND", "REFUNDS", "REFUND"
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO ledger_batch (kind, idempotency_key, posted_by, posted_at)
			VALUES ($1, $2, 'test', $3) RETURNING id::text`, kind, uuid.NewString(), at).Scan(&batch); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO ledger_entry (batch_id, account, counterparty_type, counterparty_id, amount_cents, component, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $8),
			       ($1, $7, NULL, NULL, -$5::bigint, $6, $8)`,
			batch, string(payableAccount(p.Type)), p.Type, p.ID, cents, component, counter, at)
		return err
	})
	if err != nil {
		t.Fatalf("earn %d for %s: %v", cents, p.ID, err)
	}
}

type want struct {
	end   time.Time
	cents int64
	state string
}

// assertPayouts checks a partner's payouts, oldest period first, and that
// each payout is exactly the sum of the ledger entries stamped with it.
func assertPayouts(t *testing.T, db *pgxpool.Pool, p PayeeRef, wants ...want) {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT po.period_end, po.amount_cents, po.state::text,
		       (SELECT COALESCE(sum(le.amount_cents), 0)::bigint FROM ledger_entry le WHERE le.payout_id = po.id)
		  FROM payout po JOIN connect_account ca ON ca.id = po.connect_account_id
		 WHERE ca.owner_type = $1 AND ca.owner_id = $2
		 ORDER BY po.period_end`, p.Type, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got []want
	for rows.Next() {
		var w want
		var stamped int64
		if err := rows.Scan(&w.end, &w.cents, &w.state, &stamped); err != nil {
			t.Fatal(err)
		}
		if stamped != w.cents {
			t.Errorf("payout for period ending %s is %d cents but its entries sum to %d", w.end, w.cents, stamped)
		}
		got = append(got, w)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(wants) {
		t.Fatalf("%s %s has %d payouts %v, want %v", p.Type, p.ID, len(got), got, wants)
	}
	for i := range wants {
		if !got[i].end.Equal(wants[i].end) || got[i].cents != wants[i].cents || got[i].state != wants[i].state {
			t.Fatalf("%s %s payout %d = %+v, want %+v", p.Type, p.ID, i, got[i], wants[i])
		}
	}
}

// lastRun is the run for a period that finished last.
func lastRun(t *testing.T, db *pgxpool.Pool, periodEnd time.Time) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `
		SELECT id::text FROM payout_run WHERE period_end = $1 AND finished_at IS NOT NULL
		 ORDER BY finished_at DESC, id DESC LIMIT 1`, periodEnd).Scan(&id); err != nil {
		t.Fatalf("no finished run for the period ending %s: %v", periodEnd, err)
	}
	return id
}

// assertOutcomes checks the outcomes a run wrote for a partner, in order.
func assertOutcomes(t *testing.T, db *pgxpool.Pool, runID string, p PayeeRef, outcomes ...PayoutRunOutcome) {
	t.Helper()
	if got := runOutcomes(t, db, p, runID); fmt.Sprint(got) != fmt.Sprint(outcomes) {
		t.Fatalf("run %s, %s %s: outcomes %v, want %v", runID, p.Type, p.ID, got, outcomes)
	}
}

// runOutcomes lists the outcomes the given runs wrote for a partner.
func runOutcomes(t *testing.T, db *pgxpool.Pool, p PayeeRef, runIDs ...string) []PayoutRunOutcome {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT outcome::text FROM payout_run_line
		 WHERE run_id::text = ANY($1) AND payee_id = $2 ORDER BY id`, runIDs, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []PayoutRunOutcome
	for rows.Next() {
		var o string
		if err := rows.Scan(&o); err != nil {
			t.Fatal(err)
		}
		got = append(got, PayoutRunOutcome(o))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return got
}

func assertBlocked(t *testing.T, db *pgxpool.Pool, restaurant PayeeRef, blocked bool) {
	t.Helper()
	var open bool
	if err := db.QueryRow(context.Background(), `
		SELECT EXISTS (SELECT 1 FROM restaurant_collection WHERE restaurant_id = $1 AND closed_at IS NULL)`,
		restaurant.ID).Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open != blocked {
		t.Fatalf("restaurant %s blocked = %v, want %v", restaurant.ID, open, blocked)
	}
}

// assertLedgerAtZero runs the ledger's own invariant check (every batch, every
// order and the whole ledger sum to zero) and checks no payout claims more or
// less than its entries.
func assertLedgerAtZero(t *testing.T, db *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(ctx, `SELECT assert_ledger_invariants()`); err != nil {
		t.Fatalf("ledger invariants: %v", err)
	}
	var total, mismatched int64
	queryRow(t, db, `SELECT COALESCE(sum(amount_cents), 0)::bigint FROM ledger_entry`, &total)
	queryRow(t, db, `
		SELECT count(*) FROM payout po
		 WHERE po.amount_cents <> (SELECT COALESCE(sum(amount_cents), 0) FROM ledger_entry WHERE payout_id = po.id)`,
		&mismatched)
	if total != 0 || mismatched != 0 {
		t.Fatalf("ledger sums to %d (want 0); %d payout(s) disagree with their entries", total, mismatched)
	}
}

// stripeTransfers stands in for Stripe's transfer API: one transfer per
// idempotency key while Stripe remembers the key, and a lookup by group.
type stripeTransfers struct {
	mu        sync.Mutex
	byKey     map[string]*StripeTransfer
	byGroup   map[string]*StripeTransfer
	transfers []CreateTransferInput
	forget    bool
	timeoutTo map[string]bool // destination accounts whose next transfer times out after Stripe made it
}

func newStripeTransfers() *stripeTransfers {
	return &stripeTransfers{byKey: map[string]*StripeTransfer{}, byGroup: map[string]*StripeTransfer{}, timeoutTo: map[string]bool{}}
}

func (s *stripeTransfers) client() *mockStripe {
	return &mockStripe{TransferFn: s.create, FindTransferFn: s.find}
}

func (s *stripeTransfers) create(in CreateTransferInput) (*StripeTransfer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if tr, ok := s.byKey[in.IdempotencyKey]; ok && !s.forget {
		return tr, nil
	}
	tr := &StripeTransfer{ID: fmt.Sprintf("tr_%d", len(s.transfers)+1)}
	s.byKey[in.IdempotencyKey], s.byGroup[in.TransferGroup] = tr, tr
	s.transfers = append(s.transfers, in)
	if s.timeoutTo[in.DestinationAcct] {
		delete(s.timeoutTo, in.DestinationAcct)
		return nil, errors.New("stripe create transfer: context deadline exceeded")
	}
	return tr, nil
}

func (s *stripeTransfers) find(group string) (*StripeTransfer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.byGroup[group], nil
}

func (s *stripeTransfers) timeoutAfterCreate(ownerID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.timeoutTo["acct_"+ownerID] = true
}

// forgetKeys is Stripe more than 24 hours later: it no longer knows the keys.
func (s *stripeTransfers) forgetKeys() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.forget = true
}

func (s *stripeTransfers) made() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.transfers)
}

func (s *stripeTransfers) madeFor(ownerID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, in := range s.transfers {
		if in.DestinationAcct == "acct_"+ownerID {
			n++
		}
	}
	return n
}

// secondPool is another replica's connection pool on the same database.
func secondPool(t *testing.T, db *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	p, err := pgxpool.NewWithConfig(context.Background(), db.Config().Copy())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

// payoutTestDB migrates a new, empty database for one test and returns a pool
// on it: on HG_TEST_POSTGRES_DSN's server, or in a throwaway container.
func payoutTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	server := os.Getenv("HG_TEST_POSTGRES_DSN")
	if server == "" {
		if _, err := os.Stat("/var/run/docker.sock"); err != nil && os.Getenv("DOCKER_HOST") == "" {
			t.Skip("no Docker and no HG_TEST_POSTGRES_DSN: skipping the payout run tests")
		}
		ctr, err := tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
			tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
			testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(2*time.Minute)))
		if err != nil {
			t.Skipf("postgres container did not start: %v", err)
		}
		t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })
		if server, err = ctr.ConnectionString(ctx, "sslmode=disable"); err != nil {
			t.Fatal(err)
		}
	}

	admin, err := pgx.Connect(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	name := fmt.Sprintf("hg_payouts_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), server)
		if err == nil {
			_, _ = c.Exec(context.Background(), `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
			_ = c.Close(context.Background())
		}
	})

	u, err := url.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dsn := u.String()
	dir, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	goose := exec.Command("go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3", "-dir", dir, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
