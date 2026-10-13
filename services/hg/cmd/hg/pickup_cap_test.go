package main

import (
	"context"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestUncollectedOrderIsCancelledAndRefundedAtTheCap is acceptance criterion
// 5 of docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions": a
// ready order no rider collected reaches the third lapse of its pickup
// deadline, and the deadline runner, wired as in production, cancels it
// (NO_RIDER_FOUND), refunds the customer in full, leaves the restaurant's
// payable untouched and puts the cost on PLATFORM_ABSORBED, in one
// transaction with the search for a rider closed. Before
// https://github.com/shaiknoorullah/hg-mono/issues/336 it re-armed forever.
// A rider who holds the order stops the cancel: ops decide.
func TestUncollectedOrderIsCancelledAndRefundedAtTheCap(t *testing.T) {
	dsn := testseed.FreshDatabase(t, "hg_pickup_cap")
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	// HG-TEST01 from migrations/test/fixtures.sql: CAD 43.63 captured, with
	// its CAPTURE batch. Ready, two lapses already escalated, the third due.
	const orderID = "88888888-8888-4888-8888-888888888888"
	const riderID = "019ffe57-fbd0-7355-ade8-b03ea7943578"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%v\n%s", err, sql)
		}
	}
	exec(`UPDATE "order" SET state = 'READY_FOR_PICKUP', ready_at = now() - interval '45 minutes',
	                        deadline_action = 'PICKUP_OVERDUE', deadline_at = now() - interval '1 second',
	                        deadline_escalations = 2, cancel_reason = NULL, cancelled_at = NULL
	       WHERE id = $1`, orderID)
	exec(`DELETE FROM dispatch WHERE order_id = $1`, orderID)
	exec(`INSERT INTO dispatch (order_id, state, rider_account_id, deadline_at, deadline_action)
	      VALUES ($1, 'ASSIGNED', $2, now() + interval '10 minutes', 'RIDER_NOT_ARRIVING')`, orderID, riderID)

	runner := orders.NewDeadlineRunner(orders.NewStore(pool), nil, slog.Default(), "test-pickup-cap").
		WithPickupEscalator(&pickupEscalator{}).
		WithUncollectedCanceller(uncollectedCanceller{})

	var state, outcome string
	read := func() {
		t.Helper()
		if err := pool.QueryRow(ctx, `
			SELECT o.state::text,
			       coalesce((SELECT outcome FROM deadline_audit WHERE subject_id = o.id AND escalation_no = 2), '')
			  FROM "order" o WHERE o.id = $1`, orderID).Scan(&state, &outcome); err != nil {
			t.Fatal(err)
		}
	}

	// A rider holds it: not cancelled, still escalating, nothing refunded.
	if _, err := runner.Sweep(ctx); err != nil {
		t.Fatalf("sweep with a rider assigned: %v", err)
	}
	read()
	if state != "READY_FOR_PICKUP" || outcome != "CAP_REACHED" {
		t.Fatalf("with a rider assigned: state %s, audit %q; want READY_FOR_PICKUP, CAP_REACHED", state, outcome)
	}

	// No rider: searching, with an offer still waiting for an answer.
	exec(`DELETE FROM deadline_audit WHERE subject_id = $1 AND escalation_no = 2`, orderID)
	exec(`UPDATE "order" SET deadline_at = now() - interval '1 second', deadline_escalations = 2 WHERE id = $1`, orderID)
	exec(`UPDATE dispatch SET state = 'SEARCHING', rider_account_id = NULL, deadline_action = 'NEXT_WAVE'
	       WHERE order_id = $1`, orderID)
	exec(`INSERT INTO dispatch_offer (order_id, rider_account_id, wave, distance_m, earnings_cents, state, expires_at)
	      VALUES ($1, $2, 1, 900, 500, 'PENDING', now() + interval '30 seconds')`, orderID, riderID)
	payableBefore := sumAccount(t, pool, orderID, "RESTAURANT_PAYABLE")

	if _, err := runner.Sweep(ctx); err != nil {
		t.Fatalf("sweep at the cap: %v", err)
	}
	read()
	if state != "CANCELLED" || outcome != "TRANSITIONED" {
		t.Fatalf("at the cap: state %s, audit %q; want CANCELLED, TRANSITIONED", state, outcome)
	}

	var cancelReason, refundState, refundReason, requestedBy string
	var refunded, absorbed, restaurantCharged int64
	if err := pool.QueryRow(ctx, `
		SELECT o.cancel_reason::text, r.state::text, r.reason_code::text, r.requested_by::text,
		       r.amount_cents, r.platform_absorbed_cents, r.restaurant_chargeback_cents
		  FROM "order" o JOIN refund r ON r.order_id = o.id
		 WHERE o.id = $1`, orderID).Scan(&cancelReason, &refundState, &refundReason, &requestedBy,
		&refunded, &absorbed, &restaurantCharged); err != nil {
		t.Fatalf("read the cancel and its refund: %v", err)
	}
	if cancelReason != "NO_RIDER_FOUND" || refundState != "AUTHORISED" || refundReason != "NO_RIDER_FOUND" ||
		refunded != 4363 || absorbed != 4363 || restaurantCharged != 0 {
		t.Errorf("cancel %s, refund %s %s of %d (absorbed %d, restaurant charged %d); "+
			"want NO_RIDER_FOUND, an AUTHORISED NO_RIDER_FOUND refund of 4363 the platform absorbs",
			cancelReason, refundState, refundReason, refunded, absorbed, restaurantCharged)
	}
	if requestedBy != "00000000-0000-7000-8000-00000000a001" {
		t.Errorf("refund requested by %s, want the platform account", requestedBy)
	}
	if after := sumAccount(t, pool, orderID, "RESTAURANT_PAYABLE"); after != payableBefore {
		t.Errorf("restaurant payable %d after the cancel, want %d: the restaurant is paid in full", after, payableBefore)
	}
	if got := sumAccount(t, pool, orderID, "PLATFORM_ABSORBED"); got == 0 {
		t.Error("nothing on PLATFORM_ABSORBED; the platform absorbs the refund")
	}
	var residual int64
	if err := pool.QueryRow(ctx, `SELECT coalesce(sum(amount_cents), 0) FROM ledger_entry WHERE order_id = $1`,
		orderID).Scan(&residual); err != nil || residual != 0 {
		t.Errorf("order ledger sums to %d (err %v), want 0", residual, err)
	}

	var dispatchState, offerState string
	var deadline *string
	var withRefund bool
	if err := pool.QueryRow(ctx, `
		SELECT d.state::text, d.deadline_at::text,
		       (SELECT state::text FROM dispatch_offer WHERE order_id = d.order_id),
		       EXISTS (SELECT 1 FROM realtime_event
		                WHERE order_id = d.order_id AND type = 'order.cancelled' AND payload ? 'refund')
		  FROM dispatch d WHERE d.order_id = $1`, orderID).Scan(&dispatchState, &deadline, &offerState, &withRefund); err != nil {
		t.Fatal(err)
	}
	if dispatchState != "NO_RIDER_FOUND" || deadline != nil || offerState != "WITHDRAWN" {
		t.Errorf("dispatch %s (deadline %v), offer %s; want the search closed and the offer withdrawn",
			dispatchState, deadline, offerState)
	}
	if !withRefund {
		t.Error("no order.cancelled event carrying the refund")
	}
}

func sumAccount(t *testing.T, pool *pgxpool.Pool, orderID, account string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(context.Background(), `
		SELECT coalesce(sum(amount_cents), 0) FROM ledger_entry
		 WHERE order_id = $1 AND account = $2::ledger_account`, orderID, account).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	return sum
}
