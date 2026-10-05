package payments

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Who may run a payout, and on what state a run decides to pay (issue #457).
// Against a real, migrated Postgres, like the rest of the payout run tests.

// TestPayoutRun_AdminIsCheckedInTheDatabase: a token that says ADMIN is not
// enough to queue a run. An access token lives 15 minutes and is not
// re-issued when a grant is revoked or an account suspended, so the request is
// decided on the database's state, in the transaction that queues the run.
// Only a live, platform-wide Admin or Super Admin grant passes
// (docs/spec/05-admin.md, "7.5 Money": payout.retry_batch).
func TestPayoutRun_AdminIsCheckedInTheDatabase(t *testing.T) {
	db := payoutTestDB(t)
	runner := newTestRunner(db, newStripeTransfers(), 30)
	runner.now = fixed(toronto(2026, 8, 19, 10, 0))
	restaurant := addPartner(t, db, PayeeRestaurant, true)
	req := func(key string) PayoutRunRequest {
		return PayoutRunRequest{Reason: "pay the restaurant after the incident", IdempotencyKey: key, Payee: &restaurant}
	}

	revoked := addAdmin(t, db)
	mustExec(t, db, `UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, revoked)
	suspended := addAdmin(t, db)
	mustExec(t, db, `UPDATE account SET status = 'SUSPENDED' WHERE id = $1`, suspended)
	suspendedStaff := addAdmin(t, db)
	mustExec(t, db, `INSERT INTO staff_profile (account_id, full_name, status) VALUES ($1, 'Former Admin', 'SUSPENDED')`, suspendedStaff)
	scopedOnly := addAdmin(t, db) // an owner at some other restaurant, nothing platform-wide
	mustExec(t, db, `UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, scopedOnly)
	mustExec(t, db, `INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`,
		scopedOnly, addPartner(t, db, PayeeRestaurant, true).ID)

	for name, id := range map[string]string{
		"an admin whose grant was revoked":               revoked,
		"a suspended account":                            suspended,
		"a suspended member of staff":                    suspendedStaff,
		"a restaurant owner with no platform-wide grant": scopedOnly,
	} {
		if _, _, err := runner.Request(asAdmin(context.Background(), id), req("stale-"+id)); !errors.Is(err, ErrNotPayoutAdmin) {
			t.Errorf("%s, holding a token that still says ADMIN: err=%v, want ErrNotPayoutAdmin", name, err)
		}
	}
	var queued int
	queryRow(t, db, `SELECT count(*) FROM payout_run WHERE kind = 'ADMIN'`, &queued)
	if queued != 0 {
		t.Fatalf("%d admin runs were queued on a stale token, want 0", queued)
	}

	superAdmin := addAdmin(t, db)
	mustExec(t, db, `UPDATE account_role SET role = 'SUPER_ADMIN' WHERE account_id = $1`, superAdmin)
	if _, _, err := runner.Request(asAdmin(context.Background(), superAdmin), req("live-super-admin-1")); err != nil {
		t.Fatalf("a super admin with a live grant: %v", err)
	}
	if _, _, err := runner.Request(asAdmin(context.Background(), addAdmin(t, db)), req("live-admin-00000001")); err != nil {
		t.Fatalf("an admin with a live grant: %v", err)
	}
}

// TestPayoutRun_QueuedRunIsCheckedWhenItStarts: a run waits in the queue for
// as long as it takes. If its admin loses the role, or comes to hold a role
// at the restaurant it pays, before it starts, it pays nothing and fails with
// the reason.
func TestPayoutRun_QueuedRunIsCheckedWhenItStarts(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)
	runner.now = fixed(toronto(2026, 8, 19, 10, 0))
	ctx := context.Background()

	for _, c := range []struct {
		name   string
		change func(admin string, restaurant PayeeRef)
	}{
		{"its admin's grant was revoked", func(admin string, _ PayeeRef) {
			mustExec(t, db, `UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, admin)
		}},
		{"its admin was suspended", func(admin string, _ PayeeRef) {
			mustExec(t, db, `UPDATE account SET status = 'SUSPENDED' WHERE id = $1`, admin)
		}},
		{"its admin joined the restaurant", func(admin string, restaurant PayeeRef) {
			mustExec(t, db, `INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_MANAGER', 'RESTAURANT', $2)`,
				admin, restaurant.ID)
		}},
	} {
		admin := addAdmin(t, db)
		restaurant := addPartner(t, db, PayeeRestaurant, true)
		earn(t, db, restaurant, 4500, toronto(2026, 8, 12, 13, 0))
		run, _, err := runner.Request(asAdmin(ctx, admin), PayoutRunRequest{
			Reason: "pay the restaurant after the incident", IdempotencyKey: "queued-" + admin, Payee: &restaurant})
		if err != nil {
			t.Fatalf("%s: request: %v", c.name, err)
		}
		c.change(admin, restaurant)
		if err := runner.execute(ctx, run); err != nil {
			t.Fatalf("%s: execute: %v", c.name, err)
		}
		got, err := runner.repo.GetPayoutRun(ctx, run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.State != RunFailed || got.Error == nil || got.Paid != 0 {
			t.Errorf("%s: run is %s (error %v, %d paid), want FAILED with the reason and nothing paid", c.name, got.State, got.Error, got.Paid)
		}
		assertPayouts(t, db, restaurant)
	}
	if n := stripe.made(); n != 0 {
		t.Fatalf("Stripe made %d transfers for refused runs, want 0", n)
	}
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_AdminRunForEveryoneLeavesOutTheAdmin: nobody runs their own
// payout, by naming themselves or by asking for everyone. An admin who is
// also a rider and owns a restaurant asks for a run for every partner before
// the Monday run: the other partners are paid, the admin's own payouts wait
// for the scheduled run.
func TestPayoutRun_AdminRunForEveryoneLeavesOutTheAdmin(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 30)
	ctx := context.Background()

	admin := addAdmin(t, db)
	adminAsRider := PayeeRef{Type: PayeeRider, ID: admin}
	mustExec(t, db, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted, requirements)
		VALUES ('RIDER', $1, $2, true, true, '{}'::jsonb)`, admin, "acct_"+admin)
	ownRestaurant := addPartner(t, db, PayeeRestaurant, true)
	mustExec(t, db, `INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`,
		admin, ownRestaurant.ID)
	other := addPartner(t, db, PayeeRider, true)
	for _, p := range []PayeeRef{adminAsRider, ownRestaurant, other} {
		earn(t, db, p, 1500, toronto(2026, 8, 12, 12, 0))
	}

	// Monday 08:00: the week has closed, the scheduled run is due at 09:00.
	runner.now = fixed(toronto(2026, 8, 17, 8, 0))
	run, _, err := runner.Request(asAdmin(ctx, admin), PayoutRunRequest{
		Reason: "pay everyone early for the long weekend", IdempotencyKey: "everyone-000000001"})
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.execute(ctx, run); err != nil {
		t.Fatal(err)
	}
	period := toronto(2026, 8, 17, 0, 0)
	assertPayouts(t, db, other, want{end: period, cents: 1500, state: "TRANSFERRED"})
	assertPayouts(t, db, adminAsRider)
	assertPayouts(t, db, ownRestaurant)
	if n := stripe.madeFor(admin) + stripe.madeFor(ownRestaurant.ID); n != 0 {
		t.Fatalf("the admin's run made %d transfers to the admin's own accounts, want 0", n)
	}

	// The scheduled run pays them as it pays everyone.
	runAt(t, runner, toronto(2026, 8, 17, 9, 0))
	assertPayouts(t, db, adminAsRider, want{end: period, cents: 1500, state: "TRANSFERRED"})
	assertPayouts(t, db, ownRestaurant, want{end: period, cents: 1500, state: "TRANSFERRED"})
	assertLedgerAtZero(t, db)
}

// TestPayoutRun_SuspensionMidRunStopsTheTransfer: a run decides to pay on the
// restaurant as it is when the payout is built and claimed, not as it was
// when the run first looked. Here the restaurant is suspended while the run
// is transferring its earlier payout: this week's payout is not built, and a
// payout claimed while it is suspended is not transferred. Both stay owed and
// are paid once it is reinstated; the ledger balances throughout.
func TestPayoutRun_SuspensionMidRunStopsTheTransfer(t *testing.T) {
	db := payoutTestDB(t)
	stripe := newStripeTransfers()
	runner := newTestRunner(db, stripe, 0)
	ctx := context.Background()
	restaurant := addPartner(t, db, PayeeRestaurant, true)
	week1, week2, week3 := toronto(2026, 8, 17, 0, 0), toronto(2026, 8, 24, 0, 0), toronto(2026, 8, 31, 0, 0)

	// Week 1's transfer is refused: its payout stays owed.
	earn(t, db, restaurant, 4000, toronto(2026, 8, 12, 13, 0))
	stripe.refuseNext(restaurant.ID)
	runAt(t, runner, toronto(2026, 8, 17, 10, 0))
	assertPayouts(t, db, restaurant, want{end: week1, cents: 4000, state: "READY"})

	// Week 2: the run transfers the owed payout, and the restaurant is
	// suspended the moment that transfer is made.
	earn(t, db, restaurant, 2500, toronto(2026, 8, 19, 13, 0))
	stripe.afterCreate = func(in CreateTransferInput) {
		if in.DestinationAcct == "acct_"+restaurant.ID {
			mustExec(t, db, `UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, restaurant.ID)
		}
	}
	runAt(t, runner, toronto(2026, 8, 24, 10, 0))
	stripe.afterCreate = nil
	assertOutcomes(t, db, lastRun(t, db, week2), restaurant, OutcomeReleased, OutcomePartnerSuspended)
	assertPayouts(t, db, restaurant, want{end: week1, cents: 4000, state: "TRANSFERRED"})
	if n := stripe.madeFor(restaurant.ID); n != 1 {
		t.Fatalf("Stripe made %d transfers to a restaurant suspended mid-run, want 1 (the one before it)", n)
	}
	// Nor is its transferred balance paid out to its bank while it is suspended.
	if n := len(stripe.bankPayouts(restaurant.ID)); n != 0 {
		t.Fatalf("Stripe made %d bank payouts for a restaurant suspended mid-run, want 0", n)
	}

	// Reinstated, week 3's transfer is refused; then suspended again before
	// the payout is claimed: the claim must not hand it to Stripe.
	mustExec(t, db, `UPDATE restaurant SET account_state = 'PENDING' WHERE id = $1`, restaurant.ID)
	earn(t, db, restaurant, 1000, toronto(2026, 8, 26, 13, 0))
	stripe.refuseNext(restaurant.ID)
	runAt(t, runner, toronto(2026, 8, 31, 10, 0))
	assertPayouts(t, db, restaurant,
		want{end: week1, cents: 4000, state: "TRANSFERRED"}, want{end: week3, cents: 3500, state: "READY"})
	mustExec(t, db, `UPDATE restaurant SET account_state = 'BANNED' WHERE id = $1`, restaurant.ID)
	owed := owedPayoutID(t, db, restaurant)
	claim, err := runner.repo.claimTransfer(ctx, owed, "test", toronto(2026, 9, 7, 9, 0), runActor{RunID: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if claim.Claimed || claim.Suspended != "BANNED" {
		t.Fatalf("claiming a banned restaurant's payout: claimed=%v suspended=%q, want not claimed, BANNED", claim.Claimed, claim.Suspended)
	}
	assertPayouts(t, db, restaurant,
		want{end: week1, cents: 4000, state: "TRANSFERRED"}, want{end: week3, cents: 3500, state: "READY"})

	// Reinstated again: the next run pays what was kept, once.
	mustExec(t, db, `UPDATE restaurant SET account_state = 'PENDING' WHERE id = $1`, restaurant.ID)
	runAt(t, runner, toronto(2026, 9, 7, 10, 0))
	assertPayouts(t, db, restaurant,
		want{end: week1, cents: 4000, state: "TRANSFERRED"}, want{end: week3, cents: 3500, state: "TRANSFERRED"})
	if n := stripe.madeFor(restaurant.ID); n != 2 {
		t.Fatalf("Stripe made %d transfers in all, want 2: one per payout", n)
	}
	if n := len(stripe.bankPayouts(restaurant.ID)); n != 2 {
		t.Fatalf("Stripe made %d bank payouts after reinstatement, want 2: one per payout", n)
	}
	assertLedgerAtZero(t, db)
}

// owedPayoutID is the partner's one payout not yet paid.
func owedPayoutID(t *testing.T, db *pgxpool.Pool, p PayeeRef) string {
	t.Helper()
	var id string
	if err := db.QueryRow(context.Background(), `
		SELECT po.id::text FROM payout po JOIN connect_account ca ON ca.id = po.connect_account_id
		 WHERE ca.owner_type = $1 AND ca.owner_id = $2 AND po.state IN ('READY', 'TRANSFERRING', 'HELD')`,
		p.Type, p.ID).Scan(&id); err != nil {
		t.Fatalf("owed payout for %s %s: %v", p.Type, p.ID, err)
	}
	return id
}
