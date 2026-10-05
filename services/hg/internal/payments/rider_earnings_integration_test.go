package payments

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// Rider earnings against a real database (issue #306): the order's state
// machine drives the delivery, so the earnings are written by the same
// transaction the production bridge runs, and the deferred ledger triggers
// and the earning/ledger mirror trigger fire for real.

const (
	riderTestDeliveryFee = 799
	riderTestSubtotal    = 3000
)

// riderOrder is an order out for delivery: captured (the rider's share held
// in platform revenue, as BuildCaptureBatch leaves it), with one rider's
// accepted offer and assignment.
type riderOrder struct {
	OrderID      string
	RiderID      string
	AssignmentID string
	TotalCents   int64
}

func seedRider(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO account (email, status)
		VALUES ('rider-'||replace(uuid_generate_v7()::text, '-', '')||'@test.local', 'ACTIVE')
		RETURNING id::text`).Scan(&id); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	return id
}

// seedAssignment gives a rider an accepted offer and an assignment in the
// given state, with its proof of delivery recorded.
func seedAssignment(t *testing.T, pool *pgxpool.Pool, orderID, riderID, state string, offeredTipCents int64) string {
	t.Helper()
	ctx := context.Background()
	var offerID, id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO dispatch_offer (order_id, rider_account_id, wave, distance_m, earnings_cents,
		                            tip_estimate_cents, state, outcome, outcome_at, expires_at)
		VALUES ($1, $2, 1, 1200, $3, $4, 'ACCEPTED', 'ACCEPTED', now(), now())
		RETURNING id::text`,
		orderID, riderID, riderTestDeliveryFee+offeredTipCents, offeredTipCents).Scan(&offerID); err != nil {
		t.Fatalf("seed offer: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO assignment (order_id, rider_account_id, dispatch_offer_id, state,
		                        required_pod_method, pod_recorded, billable_distance_m, terminated_at)
		VALUES ($1, $2, $3, $4, 'PHOTO', true, 2400, CASE WHEN $5 THEN now() END)
		RETURNING id::text`, orderID, riderID, offerID, state,
		state == "DELIVERED" || state == "RETURNED" || state == "CANCELLED_BY_PLATFORM" || state == "REASSIGNED").Scan(&id); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

func seedRiderOrder(t *testing.T, pool *pgxpool.Pool, state machine.State, assignmentState string, tipCents, offeredTipCents int64) riderOrder {
	t.Helper()
	ctx := context.Background()
	o := riderOrder{RiderID: seedRider(t, pool), TotalCents: int64(riderTestSubtotal+riderTestDeliveryFee) + tipCents}

	var quoteID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO quote (account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
		                   pricing_config_id, tax_jurisdiction_code,
		                   subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents,
		                   tip_cents, total_cents, input_hash, state_hash, expires_at)
		SELECT $1, '66666666-6666-4666-8666-666666666666', $2, '22222222-2222-4222-8222-222222222222',
		       'DELIVERY', pc.id, 'CA-ON', $3, $4, 0, 0, $5, $6,
		       digest(uuid_generate_v7()::text, 'sha256'), digest(uuid_generate_v7()::text, 'sha256'),
		       now() + interval '10 minutes'
		  FROM pricing_config pc WHERE pc.version = 1
		RETURNING id::text`,
		fxAccountID, fxRestaurant, riderTestSubtotal, riderTestDeliveryFee, tipCents, o.TotalCents).Scan(&quoteID); err != nil {
		t.Fatalf("seed quote: %v", err)
	}
	_, action, _ := machine.ComputeDeadline(state, time.Now(), 20)
	if err := pool.QueryRow(ctx, `
		INSERT INTO "order" (code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
		                     state, deadline_at, deadline_action,
		                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                     restaurant_net_cents, rider_earnings_cents, accepted_at)
		VALUES ('HG-'||upper(substr(md5(uuid_generate_v7()::text), 1, 8)), $1, $2, $3,
		        '22222222-2222-4222-8222-222222222222', 'DELIVERY',
		        $4, now() + interval '1 hour', $5, $6, $7, $8, $9, $6, $10, now())
		RETURNING id::text`,
		quoteID, fxAccountID, fxRestaurant, string(state), action,
		riderTestSubtotal, riderTestDeliveryFee, tipCents, o.TotalCents, riderTestDeliveryFee+tipCents).Scan(&o.OrderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO payment_intent (order_id, stripe_payment_intent_id, state,
		                            amount_authorized_cents, amount_captured_cents, captured_at)
		VALUES ($1, $2, 'SUCCEEDED', $3, $3, now())`, o.OrderID, "pi_test_"+o.OrderID, o.TotalCents); err != nil {
		t.Fatalf("seed payment intent: %v", err)
	}
	capture := BuildCaptureBatch(OrderMoney{
		OrderID: o.OrderID, RestaurantID: fxRestaurant,
		SubtotalCents: riderTestSubtotal, DeliveryFeeCents: riderTestDeliveryFee, TipCents: tipCents,
		TotalCents: o.TotalCents, RestaurantNetCents: riderTestSubtotal, RiderEarningsCents: riderTestDeliveryFee + tipCents,
	}, "capture:"+o.OrderID, "system:test")
	if err := NewRepo(pool).PostBatch(ctx, capture); err != nil {
		t.Fatalf("seed capture batch: %v", err)
	}
	o.AssignmentID = seedAssignment(t, pool, o.OrderID, o.RiderID, assignmentState, offeredTipCents)
	return o
}

// earningLines returns the order's earning lines as "rider type" → gross
// cents (by rider, so a line to the wrong rider shows), failing on a line
// that is not linked to its ledger posting or is duplicated.
func earningLines(t *testing.T, pool *pgxpool.Pool, orderID string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT account_id::text, type::text, gross_cents, ledger_entry_id IS NOT NULL
		  FROM earning_entry WHERE order_id = $1`, orderID)
	if err != nil {
		t.Fatalf("read earning lines: %v", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var rider, typ string
		var gross int64
		var linked bool
		if err := rows.Scan(&rider, &typ, &gross, &linked); err != nil {
			t.Fatalf("scan earning line: %v", err)
		}
		key := rider + " " + typ
		if _, dup := out[key]; dup {
			t.Fatalf("two %s lines for order %s", key, orderID)
		}
		if !linked {
			t.Fatalf("%s line for order %s is not linked to a ledger posting", key, orderID)
		}
		out[key] = gross
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read earning lines: %v", err)
	}
	return out
}

// orderLedger is the order's ledger, summed the ways the invariants read it.
type orderLedger struct {
	Residual, Rider, RiderTip, PlatformTipRows, Entries int64
}

func readOrderLedger(t *testing.T, pool *pgxpool.Pool, orderID, riderID string) orderLedger {
	t.Helper()
	var l orderLedger
	if err := pool.QueryRow(context.Background(), `
		SELECT coalesce(sum(amount_cents), 0),
		       coalesce(sum(amount_cents) FILTER (WHERE account = 'RIDER_PAYABLE' AND counterparty_id = $2), 0),
		       coalesce(sum(amount_cents) FILTER (WHERE account = 'RIDER_PAYABLE' AND component = 'TIP'), 0),
		       count(*) FILTER (WHERE account = 'PLATFORM_REVENUE' AND component = 'TIP'),
		       count(*)
		  FROM ledger_entry WHERE order_id = $1`, orderID, riderID).Scan(
		&l.Residual, &l.Rider, &l.RiderTip, &l.PlatformTipRows, &l.Entries); err != nil {
		t.Fatalf("read order ledger: %v", err)
	}
	return l
}

func newRiderEarningsService(pool *pgxpool.Pool) *Service {
	return NewService(NewRepo(pool), nil, config.Stripe{}, nil)
}

func deliverAs(orderID, riderID string) orders.TransitionRequest {
	return orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: riderID, Reason: "rider completed delivery",
	}
}

// A delivered order writes one line per component, each mirroring its
// RIDER_PAYABLE posting, and the order's ledger still sums to zero. A
// duplicate DELIVERED transition, and a replay of the writer, write nothing.
func TestIntegration_RiderEarnings_DeliveredOrderPaysEachComponentOnce(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newRiderEarningsService(pool)
	st := orders.NewStore(pool).WithRiderEarnings(svc)
	o := seedRiderOrder(t, pool, machine.StatePickedUp, "DELIVERED", 200, 200)

	if err := st.Transition(ctx, deliverAs(o.OrderID, o.RiderID)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	lines := earningLines(t, pool, o.OrderID)
	if len(lines) != 2 || lines[o.RiderID+" DELIVERY"] != riderTestDeliveryFee || lines[o.RiderID+" TIP"] != 200 {
		t.Fatalf("earning lines = %v, want DELIVERY 799 and TIP 200 for the delivering rider", lines)
	}
	l := readOrderLedger(t, pool, o.OrderID, o.RiderID)
	if l.Residual != 0 {
		t.Fatalf("the order's ledger sums to %d, want 0", l.Residual)
	}
	if l.Rider != riderTestDeliveryFee+200 || l.RiderTip != 200 || l.PlatformTipRows != 0 {
		t.Fatalf("rider payable %d (want 999), rider tip %d (want 200), platform tip rows %d (want 0)",
			l.Rider, l.RiderTip, l.PlatformTipRows)
	}

	var illegal *orders.IllegalTransitionError
	if err := st.Transition(ctx, deliverAs(o.OrderID, o.RiderID)); !errors.As(err, &illegal) {
		t.Fatalf("a second delivery = %v, want an illegal transition", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := svc.CreditDeliveryTx(ctx, tx, o.OrderID, o.RiderID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("replay: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("replay commit: %v", err)
	}
	if again := earningLines(t, pool, o.OrderID); len(again) != 2 {
		t.Fatalf("after a replay the order has %d lines, want 2", len(again))
	}
	if again := readOrderLedger(t, pool, o.OrderID, o.RiderID); again != l {
		t.Fatalf("a replay changed the ledger: %+v, was %+v", again, l)
	}
}

// Only the rider whose assignment delivered the order is paid. A rider whose
// assignment was reassigned gets nothing, and cannot complete the order; an
// order that reaches DELIVERED without a completed assignment and its proof
// of delivery pays nobody.
func TestIntegration_RiderEarnings_OnlyTheRiderWhoDeliveredIsPaid(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	st := orders.NewStore(pool).WithRiderEarnings(newRiderEarningsService(pool))

	// Rider A was reassigned; rider B delivered.
	o := seedRiderOrder(t, pool, machine.StatePickedUp, "REASSIGNED", 300, 300)
	riderA, riderB := o.RiderID, seedRider(t, pool)
	seedAssignment(t, pool, o.OrderID, riderB, "DELIVERED", 300)

	if err := st.Transition(ctx, deliverAs(o.OrderID, riderA)); err == nil {
		t.Fatal("the reassigned rider completed the delivery; it must be refused")
	}
	if lines := earningLines(t, pool, o.OrderID); len(lines) != 0 {
		t.Fatalf("a refused delivery wrote lines: %v", lines)
	}
	if err := st.Transition(ctx, deliverAs(o.OrderID, riderB)); err != nil {
		t.Fatalf("deliver as the delivering rider: %v", err)
	}
	lines := earningLines(t, pool, o.OrderID)
	if len(lines) != 2 || lines[riderB+" DELIVERY"] != riderTestDeliveryFee || lines[riderB+" TIP"] != 300 {
		t.Fatalf("earning lines = %v, want DELIVERY 799 and TIP 300 for rider B only", lines)
	}
	if a := readOrderLedger(t, pool, o.OrderID, riderA); a.Rider != 0 || a.Residual != 0 {
		t.Fatalf("rider A's ledger for the order = %+v, want nothing and a zero sum", a)
	}

	// Delivered without the assignment completing (a seal scan, for one):
	// nobody is paid and the ledger is untouched.
	u := seedRiderOrder(t, pool, machine.StateArrived, "ARRIVED_AT_DROPOFF", 200, 200)
	before := readOrderLedger(t, pool, u.OrderID, u.RiderID)
	if err := st.Transition(ctx, deliverAs(u.OrderID, u.RiderID)); err != nil {
		t.Fatalf("deliver without a completed assignment: %v", err)
	}
	if lines := earningLines(t, pool, u.OrderID); len(lines) != 0 {
		t.Fatalf("an order delivered without a completed assignment wrote lines: %v", lines)
	}
	if after := readOrderLedger(t, pool, u.OrderID, u.RiderID); after != before {
		t.Fatalf("the ledger changed: %+v, was %+v", after, before)
	}
}

// A cancelled order pays the rider nothing, even with a rider assigned.
func TestIntegration_RiderEarnings_CancelledOrderWritesNothing(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	st := orders.NewStore(pool).WithRiderEarnings(newRiderEarningsService(pool))
	o := seedRiderOrder(t, pool, machine.StateReadyForPickup, "ARRIVED_AT_PICKUP", 200, 200)
	before := readOrderLedger(t, pool, o.OrderID, o.RiderID)

	reason := "SUPPORT_CANCELLED"
	if err := st.Transition(ctx, orders.TransitionRequest{
		OrderID: o.OrderID, To: machine.StateCancelled, Actor: machine.ActorSystem,
		CancelReason: &reason, Reason: "cancelled with a rider assigned",
	}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if lines := earningLines(t, pool, o.OrderID); len(lines) != 0 {
		t.Fatalf("a cancelled order wrote earning lines: %v", lines)
	}
	if after := readOrderLedger(t, pool, o.OrderID, o.RiderID); after != before || after.Rider != 0 {
		t.Fatalf("a cancelled order changed the ledger: %+v, was %+v", after, before)
	}
}

// A refund that charges the rider back reverses the earnings with a CLAWBACK
// line mirroring the reversing posting; the original lines are unchanged and
// the order's ledger sums to zero after the earning, the refund and the
// reversal.
func TestIntegration_RiderEarnings_RefundReversesTheEarnings(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := NewRepo(pool)
	o := seedRiderOrder(t, pool, machine.StatePickedUp, "DELIVERED", 200, 200)
	if err := orders.NewStore(pool).WithRiderEarnings(newRiderEarningsService(pool)).
		Transition(ctx, deliverAs(o.OrderID, o.RiderID)); err != nil {
		t.Fatalf("deliver: %v", err)
	}

	money, _, err := repo.GetOrderMoney(ctx, o.OrderID)
	if err != nil {
		t.Fatalf("order money: %v", err)
	}
	var intentID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM payment_intent WHERE order_id = $1`, o.OrderID).Scan(&intentID); err != nil {
		t.Fatalf("intent: %v", err)
	}
	split := ComputeLiabilitySplit("NEVER_DELIVERED", o.TotalCents, 0, money.RiderEarningsCents)
	batch := BuildRefundBatch(money, split, o.TotalCents, "refund:"+o.OrderID, "system:test")
	if _, err := repo.CreateRefund(ctx, CreateRefundParams{
		OrderID: o.OrderID, PaymentIntentID: intentID, Kind: RefundFull, Scope: ScopeFull,
		ReasonCode: "NEVER_DELIVERED", AmountCents: o.TotalCents, Split: split,
		State: RefundAuthorised, RequestedBy: fxAccountID, DeadlineAction: "submit_refund_to_stripe",
		Ledger: &batch,
	}); err != nil {
		t.Fatalf("refund: %v", err)
	}

	lines := earningLines(t, pool, o.OrderID)
	if len(lines) != 3 || lines[o.RiderID+" DELIVERY"] != riderTestDeliveryFee || lines[o.RiderID+" TIP"] != 200 ||
		lines[o.RiderID+" CLAWBACK"] != -(riderTestDeliveryFee+200) {
		t.Fatalf("earning lines = %v, want the original DELIVERY 799 and TIP 200 plus a CLAWBACK of -999", lines)
	}
	l := readOrderLedger(t, pool, o.OrderID, o.RiderID)
	if l.Residual != 0 || l.Rider != 0 {
		t.Fatalf("after the refund the order sums to %d and the rider is owed %d for it, want 0 and 0", l.Residual, l.Rider)
	}
	unpaid, err := repo.UnpaidBalanceCents(ctx, o.RiderID)
	if err != nil || unpaid != 0 {
		t.Fatalf("the rider's unpaid balance = %d, %v; want 0", unpaid, err)
	}
}

// The rider's endpoints show the amounts: the lines, the unpaid balance, and
// after the weekly run the paid payout with its lines.
func TestIntegration_RiderEarnings_EndpointsShowTheAmounts(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newRiderEarningsService(pool)
	o := seedRiderOrder(t, pool, machine.StateArrived, "DELIVERED", 350, 350)
	if err := orders.NewStore(pool).WithRiderEarnings(svc).Transition(ctx, deliverAs(o.OrderID, o.RiderID)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	h := NewHandler(svc, &config.Config{})
	asRider := httpx.WithPrincipalForTest(ctx, httpx.Principal{AccountID: o.RiderID, Roles: []httpx.Role{"RIDER"}})
	get := func(handle http.HandlerFunc, ctx context.Context, target string, into any) {
		t.Helper()
		rec := httptest.NewRecorder()
		handle(rec, httptest.NewRequest(http.MethodGet, target, nil).WithContext(ctx))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d: %s", target, rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &struct{ Data any }{Data: into}); err != nil {
			t.Fatalf("GET %s: decode: %v", target, err)
		}
	}
	byType := func(entries []EarningEntryDTO) map[string]EarningEntryDTO {
		m := map[string]EarningEntryDTO{}
		for _, e := range entries {
			m[e.Type] = e
		}
		return m
	}

	var entries []EarningEntryDTO
	get(h.ListRiderEarningEntries, asRider, "/v1/riders/me/earnings/entries", &entries)
	got := byType(entries)
	if len(entries) != 2 || got[EarningDelivery].GrossCents != riderTestDeliveryFee || got[EarningTip].GrossCents != 350 ||
		got[EarningTip].TipCents != 350 || got[EarningDelivery].OrderCode == nil {
		t.Fatalf("entries = %+v, want DELIVERY 799 and TIP 350 with the order code", entries)
	}
	var summary EarningsSummaryDTO
	get(h.GetRiderEarningsSummary, asRider, "/v1/riders/me/earnings/summary?period=WEEK", &summary)
	if summary.UnpaidBalanceCents != riderTestDeliveryFee+350 {
		t.Fatalf("unpaid balance = %d, want 1149", summary.UnpaidBalanceCents)
	}

	// The weekly run claims the rider's postings; their lines follow.
	if _, err := pool.Exec(ctx, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id,
		                             charges_enabled, payouts_enabled, details_submitted)
		VALUES ('RIDER', $1, $2, true, true, true)`, o.RiderID, "acct_test_"+o.RiderID); err != nil {
		t.Fatalf("seed connect account: %v", err)
	}
	repo := NewRepo(pool)
	now := time.Now()
	pp, err := repo.createPeriodPayout(ctx, PayeeRef{Type: "RIDER", ID: o.RiderID},
		PayoutPeriod{Start: now.Add(-7 * 24 * time.Hour), End: now.Add(time.Second)},
		0, now.Add(time.Hour), now.Add(time.Hour), runActor{})
	payoutID := pp.PayoutID
	if err != nil || payoutID == "" {
		t.Fatalf("run payout = %q, %v", payoutID, err)
	}
	claim, err := repo.claimTransfer(ctx, payoutID, "test", now.Add(time.Hour), runActor{})
	if err != nil || !claim.Claimed {
		t.Fatalf("claim transfer = %+v, %v", claim, err)
	}
	if err := repo.markTransferred(ctx, payoutID, "tr_test_"+payoutID, runActor{}, false, claim.AmountCents); err != nil {
		t.Fatalf("mark transferred: %v", err)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("payoutId", payoutID)
	var payout PayoutDetailDTO
	get(h.GetRiderPayout, context.WithValue(asRider, chi.RouteCtxKey, rctx), "/v1/riders/me/payouts/"+payoutID, &payout)
	paid := byType(payout.Entries)
	if payout.AmountCents != riderTestDeliveryFee+350 || payout.State != "PAID" || len(payout.Entries) != 2 ||
		paid[EarningDelivery].Status != "PAID" || paid[EarningTip].Status != "PAID" ||
		paid[EarningTip].PayoutID == nil || *paid[EarningTip].PayoutID != payoutID {
		t.Fatalf("payout = %+v, want 1149 PAID with both lines PAID and stamped", payout)
	}
	get(h.GetRiderEarningsSummary, asRider, "/v1/riders/me/earnings/summary?period=WEEK", &summary)
	if summary.UnpaidBalanceCents != 0 {
		t.Fatalf("unpaid balance after the payout = %d, want 0", summary.UnpaidBalanceCents)
	}
}
