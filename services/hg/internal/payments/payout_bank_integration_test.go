package payments

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Partners' money reaches their bank (issue #301). Connected accounts are on
// Stripe's manual payout schedule, so after the run's transfer the run must
// ask for the bank payout itself; the payout is PAID only when Stripe says
// that bank payout is paid. Against a real, migrated Postgres, with the fake
// Stripe of payout_run_integration_test.go.

// TestPayoutRun_MoneyReachesTheBank is the issue's "done when": a weekly run
// ends with a bank payout on each partner's account for exactly the payout,
// and the payout PAID once Stripe reports it paid. The platform's ledger does
// not move for the bank payout and stays at zero throughout.
func TestPayoutRun_MoneyReachesTheBank(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)
	svc := NewService(NewRepo(db), nil, config.Stripe{}, nil)
	rider := addPartner(t, db, PayeeRider, true)
	restaurant := addPartner(t, db, PayeeRestaurant, true)
	earn(t, db, rider, 1200, toronto(2026, 8, 11, 12, 0))
	earn(t, db, restaurant, 4500, toronto(2026, 8, 12, 13, 0))
	period := toronto(2026, 8, 17, 0, 0)

	runAt(t, runner, toronto(2026, 8, 17, 10, 0))
	run := lastRun(t, db, period)
	assertOutcomes(t, db, run, rider, OutcomePaid, OutcomeBankPayout)
	assertOutcomes(t, db, run, restaurant, OutcomePaid, OutcomeBankPayout)
	// Transferred, not paid: the money is in their Stripe balance, on its way
	// to the bank.
	assertPayouts(t, db, rider, want{end: period, cents: 1200, state: "TRANSFERRED"})
	assertPayouts(t, db, restaurant, want{end: period, cents: 4500, state: "TRANSFERRED"})
	for _, p := range []struct {
		who   PayeeRef
		cents int64
	}{{rider, 1200}, {restaurant, 4500}} {
		id := owedOrLastPayoutID(t, db, p.who)
		bank := stripe.bankPayouts(p.who.ID)
		if len(bank) != 1 {
			t.Fatalf("%s: %d bank payouts, want 1", p.who.Type, len(bank))
		}
		b := bank[0]
		if b.AmountCents != p.cents || b.Currency != "cad" || b.PayoutID != id || b.Attempt != 1 ||
			b.IdempotencyKey != "pb:"+id+":1" || b.StripeAccountID != "acct_"+p.who.ID {
			t.Fatalf("%s: bank payout %+v, want %d cad on acct_%s keyed pb:%s:1", p.who.Type, b, p.cents, p.who.ID, id)
		}
		if n := stripe.madeFor(p.who.ID); n != 1 {
			t.Fatalf("%s: %d transfers, want 1", p.who.Type, n)
		}
	}
	assertLedgerAtZero(t, db)

	// An event from another partner's account about this bank payout moves
	// nothing.
	riderBank := stripePayoutID(t, db, rider)
	deliverBankPayout(t, db, svc, "acct_"+restaurant.ID, "payout.paid", riderBank, 1200, "paid", owedOrLastPayoutID(t, db, rider), 1)
	assertPayouts(t, db, rider, want{end: period, cents: 1200, state: "TRANSFERRED"})

	// Stripe reports both paid: now, and only now, the payouts are PAID.
	for _, p := range []PayeeRef{rider, restaurant} {
		var cents int64 = 1200
		if p == restaurant {
			cents = 4500
		}
		id := owedOrLastPayoutID(t, db, p)
		deliverBankPayout(t, db, svc, "acct_"+p.ID, "payout.paid", stripePayoutID(t, db, p), cents, "paid", id, 1)
		deliverBankPayout(t, db, svc, "acct_"+p.ID, "payout.paid", stripePayoutID(t, db, p), cents, "paid", id, 1)
	}
	assertPayouts(t, db, rider, want{end: period, cents: 1200, state: "PAID"})
	assertPayouts(t, db, restaurant, want{end: period, cents: 4500, state: "PAID"})

	// The next Monday has nothing left to send.
	runAt(t, runner, toronto(2026, 8, 24, 10, 0))
	if n := stripe.made(); n != 2 {
		t.Fatalf("Stripe made %d transfers in all, want 2", n)
	}
	if n := len(stripe.bankPayouts(rider.ID)) + len(stripe.bankPayouts(restaurant.ID)); n != 2 {
		t.Fatalf("Stripe made %d bank payouts in all, want 2", n)
	}
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_BankPayoutRetriesNeverPayTwice: a bank payout whose answer was
// lost, one Stripe refused, and one the bank returned are each asked for again
// by the next run, and none ever leads to a second transfer or to two bank
// payouts on their way for one payout. The last two are the issue's "a failed
// bank payout is visible and retried".
func TestPayoutRun_BankPayoutRetriesNeverPayTwice(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)
	svc := NewService(NewRepo(db), nil, config.Stripe{}, nil)
	ctx := context.Background()
	slow := addPartner(t, db, PayeeRider, true)    // the bank payout call times out after Stripe made it
	refused := addPartner(t, db, PayeeRider, true) // Stripe refuses the bank payout
	earn(t, db, slow, 900, toronto(2026, 8, 11, 12, 0))
	earn(t, db, refused, 700, toronto(2026, 8, 11, 12, 0))
	week1, week2 := toronto(2026, 8, 17, 0, 0), toronto(2026, 8, 24, 0, 0)

	stripe.failNextBankPayout(slow.ID, "timeout")
	stripe.failNextBankPayout(refused.ID, "refuse")
	runAt(t, runner, toronto(2026, 8, 17, 10, 0))
	run1 := lastRun(t, db, week1)
	assertOutcomes(t, db, run1, slow, OutcomePaid, OutcomeBankPayoutFailed)
	assertOutcomes(t, db, run1, refused, OutcomePaid, OutcomeBankPayoutFailed)
	var state string
	queryRow(t, db, `SELECT state::text FROM payout_run WHERE id = '`+run1+`'`, &state)
	if state != RunFailed {
		t.Fatalf("a run whose bank payouts failed is %s, want FAILED: the failure must be visible", state)
	}
	assertPayouts(t, db, slow, want{end: week1, cents: 900, state: "TRANSFERRED"})
	assertPayouts(t, db, refused, want{end: week1, cents: 700, state: "TRANSFERRED"})

	// A week later Stripe has forgotten the keys: only finding the lost bank
	// payout by its metadata stops a second one. The refused one is asked for
	// again, with the same attempt, since Stripe made nothing.
	stripe.forgetKeys()
	runAt(t, runner, toronto(2026, 8, 24, 10, 0))
	run2 := lastRun(t, db, week2)
	assertOutcomes(t, db, run2, slow, OutcomeBankPayout, OutcomeNothingDue)
	assertOutcomes(t, db, run2, refused, OutcomeBankPayout, OutcomeNothingDue)
	if n := len(stripe.bankPayouts(slow.ID)); n != 1 {
		t.Fatalf("Stripe made %d bank payouts for the payout whose answer was lost, want 1", n)
	}
	if b := stripe.bankPayouts(refused.ID); len(b) != 1 || b[0].Attempt != 1 {
		t.Fatalf("bank payouts after a refusal: %+v, want one, attempt 1", b)
	}

	// The bank returns the slow rider's payout. The money is back in their
	// Stripe balance: the payout is TRANSFERRED again, with no bank payout on
	// its way, and a person is told.
	payout := owedOrLastPayoutID(t, db, slow)
	first := stripePayoutID(t, db, slow)
	deliverBankPayout(t, db, svc, "acct_"+slow.ID, "payout.failed", first, 900, "failed", payout, 1)
	assertPayouts(t, db, slow, want{end: week1, cents: 900, state: "TRANSFERRED"})
	if id := stripePayoutID(t, db, slow); id != "" {
		t.Fatalf("payout still names bank payout %q after it failed, want none", id)
	}
	var open int
	queryRow(t, db, `SELECT count(*) FROM reconciliation_exception
		WHERE kind = 'payout_failed' AND stripe_object_id = '`+first+`' AND resolved_at IS NULL`, &open)
	if open != 1 {
		t.Fatalf("%d open payout_failed exceptions for the returned bank payout, want 1", open)
	}
	// Stripe's earlier "paid" for it, arriving late, changes nothing: a failed
	// bank payout never comes back.
	deliverBankPayout(t, db, svc, "acct_"+slow.ID, "payout.paid", first, 900, "paid", payout, 1)
	assertPayouts(t, db, slow, want{end: week1, cents: 900, state: "TRANSFERRED"})

	// A second bank payout for this payout cannot even be recorded while one
	// is on its way: only after the first failed.
	if _, err := db.Exec(ctx, `INSERT INTO payout_bank_attempt (payout_id, attempt, amount_cents) VALUES ($1, 9, 900)`, payout); err != nil {
		t.Fatalf("a new attempt after the first failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO payout_bank_attempt (payout_id, attempt, amount_cents) VALUES ($1, 10, 900)`, payout); err == nil {
		t.Fatal("two bank payouts on their way for one payout were recorded; want the unique index to refuse")
	}
	mustExec(t, db, `UPDATE payout_bank_attempt SET state = 'FAILED', stripe_payout_id = 'po_never' WHERE payout_id = $1 AND attempt = 9`, payout)

	// The next run asks again, as a new attempt with a new key, and makes no
	// transfer.
	runAt(t, runner, toronto(2026, 8, 31, 10, 0))
	bank := stripe.bankPayouts(slow.ID)
	if len(bank) != 2 || bank[1].Attempt != 10 || bank[1].IdempotencyKey != "pb:"+payout+":10" || bank[1].AmountCents != 900 {
		t.Fatalf("bank payouts after the bank returned one: %+v, want a second, attempt 10, for 900", bank)
	}
	deliverBankPayout(t, db, svc, "acct_"+slow.ID, "payout.paid", stripePayoutID(t, db, slow), 900, "paid", payout, 10)
	assertPayouts(t, db, slow, want{end: week1, cents: 900, state: "PAID"})

	// Every partner was transferred to exactly once.
	for _, p := range []PayeeRef{slow, refused} {
		if n := stripe.madeFor(p.ID); n != 1 {
			t.Fatalf("Stripe made %d transfers to %s, want 1", n, p.ID)
		}
	}
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_TwoWorkersAskForOneBankPayout: two workers claiming the same
// transferred payout at once (two replicas past the lease) ask Stripe once.
func TestPayoutRun_TwoWorkersAskForOneBankPayout(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)
	ctx := context.Background()
	rider := addPartner(t, db, PayeeRider, true)
	earn(t, db, rider, 1500, toronto(2026, 8, 11, 12, 0))
	stripe.failNextBankPayout(rider.ID, "refuse")
	runAt(t, runner, toronto(2026, 8, 17, 10, 0))
	payout := owedOrLastPayoutID(t, db, rider)

	first, err := runner.repo.claimBankPayout(ctx, payout, "replica-1")
	if err != nil || !first.Claimed {
		t.Fatalf("first claim: %+v, %v", first, err)
	}
	second, err := runner.repo.claimBankPayout(ctx, payout, "replica-2")
	if err != nil || second.Claimed {
		t.Fatalf("second claim while the first is calling Stripe: %+v, %v; want not claimed", second, err)
	}
	assertLedgerAtZero(t, db)
}

// deliverBankPayout applies a payout.* event from a connected account through
// the webhook worker's own dispatch, as one transaction.
func deliverBankPayout(t *testing.T, db *pgxpool.Pool, svc *Service, account, typ, stripeID string, cents int64,
	status, payoutID string, attempt int) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id": "evt_" + uuid.NewString(), "type": typ, "created": time.Now().Unix(), "account": account, "livemode": false,
		"data": map[string]any{"object": map[string]any{
			"id": stripeID, "object": "payout", "amount": cents, "currency": "cad", "status": status,
			"failure_code": "account_closed",
			"metadata":     map[string]any{"payout_id": payoutID, "attempt": strconv.Itoa(attempt)},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		_, err := svc.applyEventSafely(ctx, tx, payload)
		return err
	}); err != nil {
		t.Fatalf("apply %s for %s: %v", typ, stripeID, err)
	}
}

// owedOrLastPayoutID is the partner's most recent payout.
func owedOrLastPayoutID(t *testing.T, db *pgxpool.Pool, p PayeeRef) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `
		SELECT po.id::text FROM payout po JOIN connect_account ca ON ca.id = po.connect_account_id
		 WHERE ca.owner_type = $1 AND ca.owner_id = $2 ORDER BY po.period_end DESC LIMIT 1`, p.Type, p.ID).Scan(&id); err != nil {
		t.Fatalf("payout for %s %s: %v", p.Type, p.ID, err)
	}
	return id
}

// stripePayoutID is the bank payout the partner's latest payout names, or "".
func stripePayoutID(t *testing.T, db *pgxpool.Pool, p PayeeRef) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `SELECT coalesce(stripe_payout_id, '') FROM payout WHERE id = $1`,
		owedOrLastPayoutID(t, db, p)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
