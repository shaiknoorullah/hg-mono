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
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
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

// riderOrder is an order out for delivery: captured (its rider share parked
// in platform revenue, as BuildCaptureBatch leaves it), with the rider's
// accepted offer and assignment.
type riderOrder struct {
	OrderID      string
	RiderID      string
	AssignmentID string
}

func seedRiderOrder(t *testing.T, pool *pgxpool.Pool, state machine.State, assignmentState string, tipCents, offeredTipCents int64) riderOrder {
	t.Helper()
	ctx := context.Background()
	var o riderOrder
	total := int64(riderTestSubtotal+riderTestDeliveryFee) + tipCents

	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('rider-'||replace(uuid_generate_v7()::text, '-', '')||'@test.local', 'ACTIVE')
		RETURNING id::text`).Scan(&o.RiderID); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
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
		fxAccountID, fxRestaurant, riderTestSubtotal, riderTestDeliveryFee, tipCents, total).Scan(&quoteID); err != nil {
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
		riderTestSubtotal, riderTestDeliveryFee, tipCents, total, riderTestDeliveryFee+tipCents).Scan(&o.OrderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO payment_intent (order_id, stripe_payment_intent_id, state,
		                            amount_authorized_cents, amount_captured_cents, captured_at)
		VALUES ($1, $2, 'SUCCEEDED', $3, $3, now())`, o.OrderID, "pi_test_"+o.OrderID, total); err != nil {
		t.Fatalf("seed payment intent: %v", err)
	}
	capture := BuildCaptureBatch(OrderMoney{
		OrderID: o.OrderID, RestaurantID: fxRestaurant,
		SubtotalCents: riderTestSubtotal, DeliveryFeeCents: riderTestDeliveryFee, TipCents: tipCents,
		TotalCents: total, RestaurantNetCents: riderTestSubtotal, RiderEarningsCents: riderTestDeliveryFee + tipCents,
	}, "capture:"+o.OrderID, "system:test")
	if err := NewRepo(pool).PostBatch(ctx, capture); err != nil {
		t.Fatalf("seed capture batch: %v", err)
	}
	var offerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO dispatch_offer (order_id, rider_account_id, wave, distance_m, earnings_cents,
		                            tip_estimate_cents, state, outcome, outcome_at, expires_at)
		VALUES ($1, $2, 1, 1200, $3, $4, 'ACCEPTED', 'ACCEPTED', now(), now())
		RETURNING id::text`,
		o.OrderID, o.RiderID, riderTestDeliveryFee+offeredTipCents, offeredTipCents).Scan(&offerID); err != nil {
		t.Fatalf("seed offer: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO assignment (order_id, rider_account_id, dispatch_offer_id, state,
		                        required_pod_method, pod_recorded, billable_distance_m)
		VALUES ($1, $2, $3, $4, 'PHOTO', true, 2400)
		RETURNING id::text`, o.OrderID, o.RiderID, offerID, assignmentState).Scan(&o.AssignmentID); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return o
}

// earningLines returns the order's earning lines as type → gross cents,
// failing on a line that is not linked to its ledger posting.
func earningLines(t *testing.T, pool *pgxpool.Pool, orderID string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT type::text, gross_cents, ledger_entry_id IS NOT NULL FROM earning_entry WHERE order_id = $1`, orderID)
	if err != nil {
		t.Fatalf("read earning lines: %v", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var typ string
		var gross int64
		var linked bool
		if err := rows.Scan(&typ, &gross, &linked); err != nil {
			t.Fatalf("scan earning line: %v", err)
		}
		if _, dup := out[typ]; dup {
			t.Fatalf("two %s lines for order %s", typ, orderID)
		}
		if !linked {
			t.Fatalf("%s line for order %s is not linked to a ledger posting", typ, orderID)
		}
		out[typ] = gross
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

func readOrderLedger(t *testing.T, pool *pgxpool.Pool, o riderOrder) orderLedger {
	t.Helper()
	var l orderLedger
	if err := pool.QueryRow(context.Background(), `
		SELECT coalesce(sum(amount_cents), 0),
		       coalesce(sum(amount_cents) FILTER (WHERE account = 'RIDER_PAYABLE' AND counterparty_id = $2), 0),
		       coalesce(sum(amount_cents) FILTER (WHERE account = 'RIDER_PAYABLE' AND component = 'TIP'), 0),
		       count(*) FILTER (WHERE account = 'PLATFORM_REVENUE' AND component = 'TIP'),
		       count(*)
		  FROM ledger_entry WHERE order_id = $1`, o.OrderID, o.RiderID).Scan(
		&l.Residual, &l.Rider, &l.RiderTip, &l.PlatformTipRows, &l.Entries); err != nil {
		t.Fatalf("read order ledger: %v", err)
	}
	return l
}

func newRiderEarningsService(pool *pgxpool.Pool) *Service {
	return NewService(NewRepo(pool), nil, config.Stripe{}, nil)
}

func deliverAs(o riderOrder) orders.TransitionRequest {
	return orders.TransitionRequest{
		OrderID: o.OrderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: o.RiderID, Reason: "rider completed delivery",
	}
}

// A delivered order writes one line per component, each mirroring its
// RIDER_PAYABLE posting, and the order's ledger still sums to zero. A
// duplicate transition, and a re-run of the writer, write nothing new.
func TestIntegration_RiderEarnings_DeliveredOrderPaysEachComponentOnce(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newRiderEarningsService(pool)
	st := orders.NewStore(pool).WithRiderEarnings(svc)
	o := seedRiderOrder(t, pool, machine.StatePickedUp, "DELIVERED", 200, 200)

	if err := st.Transition(ctx, deliverAs(o)); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	lines := earningLines(t, pool, o.OrderID)
	if len(lines) != 2 || lines[EarningDelivery] != riderTestDeliveryFee || lines[EarningTip] != 200 {
		t.Fatalf("earning lines = %v, want DELIVERY 799 and TIP 200", lines)
	}
	l := readOrderLedger(t, pool, o)
	if l.Residual != 0 {
		t.Fatalf("the order's ledger sums to %d, want 0", l.Residual)
	}
	if l.Rider != riderTestDeliveryFee+200 || l.RiderTip != 200 || l.PlatformTipRows != 0 {
		t.Fatalf("rider payable %d (want 999), rider tip %d (want 200), platform tip rows %d (want 0)",
			l.Rider, l.RiderTip, l.PlatformTipRows)
	}

	var illegal *orders.IllegalTransitionError
	if err := st.Transition(ctx, deliverAs(o)); !errors.As(err, &illegal) {
		t.Fatalf("a second delivery = %v, want an illegal transition", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := svc.CreditDeliveryTx(ctx, tx, o.OrderID, o.RiderID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("re-run: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("re-run commit: %v", err)
	}
	if again := earningLines(t, pool, o.OrderID); len(again) != 2 {
		t.Fatalf("after a re-run the order has %d lines, want 2", len(again))
	}
	if again := readOrderLedger(t, pool, o); again != l {
		t.Fatalf("a re-run changed the ledger: %+v, was %+v", again, l)
	}
}

// The rider's endpoints show the amounts: the lines, the unpaid balance, and
// after the weekly run the paid payout with its lines.
func TestIntegration_RiderEarnings_EndpointsShowTheAmounts(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := newRiderEarningsService(pool)
	// A delivery confirmed by the handover scan leaves the assignment live.
	o := seedRiderOrder(t, pool, machine.StateArrived, "ARRIVED_AT_DROPOFF", 350, 350)
	if err := orders.NewStore(pool).WithRiderEarnings(svc).Transition(ctx, deliverAs(o)); err != nil {
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
	payoutID, _, err := repo.RunPayout(ctx, "RIDER", o.RiderID, time.Now().Add(-7*24*time.Hour), time.Now().Add(time.Second))
	if err != nil || payoutID == "" {
		t.Fatalf("run payout = %q, %v", payoutID, err)
	}
	if err := repo.MarkPayoutTransferred(ctx, payoutID, "tr_test_"+payoutID); err != nil {
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

// A cancelled order pays the rider nothing, even with a rider assigned.
func TestIntegration_RiderEarnings_CancelledOrderWritesNothing(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	st := orders.NewStore(pool).WithRiderEarnings(newRiderEarningsService(pool))
	o := seedRiderOrder(t, pool, machine.StateReadyForPickup, "ARRIVED_AT_PICKUP", 200, 200)
	before := readOrderLedger(t, pool, o)

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
	if after := readOrderLedger(t, pool, o); after != before || after.Rider != 0 {
		t.Fatalf("a cancelled order changed the ledger: %+v, was %+v", after, before)
	}
}

// An order the rider brings back to the restaurant pays the delivery fee and
// not the tip, in the transaction that records the return (the documented
// default; the owner's open question is #164).
func TestIntegration_RiderEarnings_ReturnedOrderPaysTheDeliveryFee(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	ds := dispatch.NewStore(pool).WithEarnings(newRiderEarningsService(pool))
	o := seedRiderOrder(t, pool, machine.StatePickedUp, "RETURNING", 300, 300)

	now := time.Now()
	if _, moved, err := ds.Transition(ctx, o.RiderID, o.AssignmentID,
		dispatch.TransitionInput{ToState: "RETURNED", OccurredAt: now}, now); err != nil || !moved {
		t.Fatalf("return = moved %v, %v", moved, err)
	}
	lines := earningLines(t, pool, o.OrderID)
	if len(lines) != 1 || lines[EarningDelivery] != riderTestDeliveryFee {
		t.Fatalf("earning lines = %v, want DELIVERY 799 only", lines)
	}
	if l := readOrderLedger(t, pool, o); l.Residual != 0 || l.Rider != riderTestDeliveryFee {
		t.Fatalf("ledger = %+v, want a zero sum and 799 to the rider", l)
	}
}
