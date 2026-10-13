package payments

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// The partner hears about their payout, in the transaction that moves it
// (issue #248; docs/spec/01-platform.md, "P-24 — Notification router: which
// event, which role, which channel", rows payout.paid, payout.failed and
// payouts_enabled=false): held when Stripe has payouts off, failed when a bank
// payout is refused or returned, and sent when the bank payout is paid. Each
// message is written once, however often the run or Stripe's event repeats,
// and only to the people who answer for the money: a restaurant's owners and
// managers, never its other staff.
func TestPayoutNotices_HeldFailedSent(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	outbox := notify.NewEnqueuer(notify.NewRepo(), fakeRiver{})
	runner := newTestRunner(db, stripe, 30)
	runner.repo.WithOutbox(outbox)
	svc := NewService(runner.repo, nil, config.Stripe{}, nil).WithOutbox(outbox)

	rider, riderAcct := addRiderPartner(t, db)
	held := addPartner(t, db, PayeeRestaurant, false) // Stripe still needs the bank account
	owner, manager, staff := addRestaurantPerson(t, db, held, "RESTAURANT_OWNER"),
		addRestaurantPerson(t, db, held, "RESTAURANT_MANAGER"), addRestaurantPerson(t, db, held, "RESTAURANT_STAFF")
	earn(t, db, rider, 1500, toronto(2026, 8, 11, 12, 0))
	earn(t, db, held, 4500, toronto(2026, 8, 12, 13, 0))

	// Week 1: the restaurant's payout is held; Stripe refuses the rider's bank
	// payout, which the next run asks for again.
	stripe.failNextBankPayout(rider.ID, "refuse")
	runAt(t, runner, toronto(2026, 8, 17, 10, 0))
	for _, who := range []string{owner, manager} {
		assertNotices(t, db, who, "PAYOUT_HELD")
	}
	assertNotices(t, db, staff)
	assertNotices(t, db, riderAcct, "PAYOUT_FAILED:RETRYING")

	// Week 2: still held, still one notice; the rider's bank payout goes.
	runAt(t, runner, toronto(2026, 8, 24, 10, 0))
	assertNotices(t, db, owner, "PAYOUT_HELD")
	assertNotices(t, db, riderAcct, "PAYOUT_FAILED:RETRYING")

	// The bank returns it: one more notice, however often Stripe says so.
	payout, first := owedOrLastPayoutID(t, db, rider), stripePayoutID(t, db, rider)
	deliverBankPayout(t, db, svc, "acct_"+rider.ID, "payout.failed", first, 1500, "failed", payout, 1)
	deliverBankPayout(t, db, svc, "acct_"+rider.ID, "payout.failed", first, 1500, "failed", payout, 1)
	assertNotices(t, db, riderAcct, "PAYOUT_FAILED:RETRYING", "PAYOUT_FAILED:BANK_RETURNED")

	// Week 3 asks the bank again; Stripe reports it paid, twice.
	runAt(t, runner, toronto(2026, 8, 31, 10, 0))
	second := stripePayoutID(t, db, rider)
	deliverBankPayout(t, db, svc, "acct_"+rider.ID, "payout.paid", second, 1500, "paid", payout, 2)
	deliverBankPayout(t, db, svc, "acct_"+rider.ID, "payout.paid", second, 1500, "paid", payout, 2)
	assertPayouts(t, db, rider, want{end: toronto(2026, 8, 17, 0, 0), cents: 1500, state: "PAID"})
	assertNotices(t, db, riderAcct, "PAYOUT_FAILED:RETRYING", "PAYOUT_FAILED:BANK_RETURNED", "PAYOUT_SENT")
	assertLedgerAtZero(t, db)
}

// addRiderPartner is a rider with an account, a profile and a Connect account
// with payouts on.
func addRiderPartner(t *testing.T, db *pgxpool.Pool) (PayeeRef, string) {
	t.Helper()
	var id string
	queryRow(t, db, `INSERT INTO account (email, status) VALUES ('rider-' || gen_random_uuid()::text || '@test.local', 'ACTIVE')
		RETURNING id::text`, &id)
	mustExec(t, db, `INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state)
		VALUES ($1, 'Omar', 'K', '1990-01-01', 'ACTIVE')`, id)
	mustExec(t, db, `INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
		VALUES ('RIDER', $1, $2, true, true)`, id, "acct_"+id)
	return PayeeRef{Type: PayeeRider, ID: id}, id
}

// addRestaurantPerson is an account holding role on the restaurant.
func addRestaurantPerson(t *testing.T, db *pgxpool.Pool, r PayeeRef, role string) string {
	t.Helper()
	var id string
	queryRow(t, db, `INSERT INTO account (email, status) VALUES ('staff-' || gen_random_uuid()::text || '@test.local', 'ACTIVE')
		RETURNING id::text`, &id)
	mustExec(t, db, `INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, $2, 'RESTAURANT', $3)`,
		id, role, r.ID)
	return id
}

// assertNotices checks an account's payout notifications, oldest first, as
// KIND or KIND:PROBLEM.
func assertNotices(t *testing.T, db *pgxpool.Pool, accountID string, want ...string) {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT kind || COALESCE(':' || (data->>'problem'), '') FROM notification
		 WHERE account_id = $1 AND kind LIKE 'PAYOUT_%' ORDER BY created_at, id`, accountID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		got = append(got, k)
	}
	if rows.Err() != nil {
		t.Fatal(rows.Err())
	}
	if len(got) != len(want) {
		t.Fatalf("notices for %s = %v, want %v", accountID, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("notices for %s = %v, want %v", accountID, got, want)
		}
	}
}
