package invariants

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// ---------------------------------------------------------------------------
// Invariant 7 — one end-to-end smoke: quote -> order -> accept (capture) ->
// dispatch -> deliver -> DELIVERED.
//
// This exercises the real orders.Store, the real payments.Service (over the
// local-dev-only fake Stripe client, never a mock of orders/payments
// themselves), and the real restaurant.Repo — the same production code every
// other invariant test in this package calls, composed the same way
// cmd/hg/main.go wires it. The rider-side pickup/delivery calls use exactly
// the two transitions internal/dispatch's orderLifecycleAdapter issues
// (ConfirmPickup -> PICKED_UP, CompleteDelivery -> DELIVERED); this test does
// not re-drive dispatch's own rider-matching machinery (candidate search,
// wave escalation), which is covered in internal/dispatch's own suite — the
// property this smoke pins is that the ORDER reaches DELIVERED through the
// real state machine when every module does its real job in sequence.
// ---------------------------------------------------------------------------

func TestSmoke_QuoteToOrderToDelivered(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	ctx := context.Background()

	// 1. quote -> order. The gateway authorises and advances the order to
	//    RESTAURANT_PENDING, exactly as production's Stripe webhook would.
	orderID, total := quoteAndOrder(t, st, b, gw)
	assertOrderState(t, pool, orderID, "RESTAURANT_PENDING")

	// 2. accept (capture). T6: RESTAURANT_PENDING -> PREPARING, and the
	//    payment_intent moves REQUIRES_CAPTURE -> SUCCEEDED.
	repo := restaurant.NewRepo(pool)
	if _, err := repo.AcceptOrder(ctx, b.restaurantID, orderID, b.accountID, nil); err != nil {
		t.Fatalf("accept order: %v", err)
	}
	pa := restaurantPay{svc: pay}
	if err := pa.Capture(ctx, orderID, total); err != nil {
		t.Fatalf("capture: %v", err)
	}
	assertOrderState(t, pool, orderID, "PREPARING")
	if state := paymentIntentState(t, pool, orderID); state != "SUCCEEDED" {
		t.Fatalf("payment_intent state after capture = %s, want SUCCEEDED", state)
	}

	// 3. mark ready. T10: PREPARING -> READY_FOR_PICKUP.
	if _, err := repo.MarkOrderReady(ctx, b.restaurantID, orderID, b.accountID); err != nil {
		t.Fatalf("mark order ready: %v", err)
	}
	assertOrderState(t, pool, orderID, "READY_FOR_PICKUP")

	riderAccountID := insertNotifyAccount(t, pool) // any account row serves as the rider actor here
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id=$1`, riderAccountID) })

	// 4. dispatch: rider confirms pickup. T12: READY_FOR_PICKUP -> PICKED_UP,
	//    ActorRider — the exact call internal/dispatch's orderLifecycleAdapter
	//    makes from Service.Transition on a rider's pickup step.
	if err := st.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StatePickedUp, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider confirmed pickup",
	}); err != nil {
		t.Fatalf("dispatch pickup transition: %v", err)
	}
	assertOrderState(t, pool, orderID, "PICKED_UP")

	// 5. deliver. T15: PICKED_UP -> DELIVERED, ActorRider.
	if err := st.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider completed delivery",
	}); err != nil {
		t.Fatalf("dispatch delivery transition: %v", err)
	}
	assertOrderState(t, pool, orderID, "DELIVERED")

	// DELIVERED is non-terminal (it still carries the SETTLE deadline, P-15) —
	// confirm the deadline survived the trip, i.e. invariant 3 held throughout.
	var deadlineAt any
	if err := pool.QueryRow(ctx, `SELECT deadline_at FROM "order" WHERE id=$1`, orderID).Scan(&deadlineAt); err != nil {
		t.Fatalf("read deadline: %v", err)
	}
	if deadlineAt == nil {
		t.Error("DELIVERED order has NULL deadline_at — I-15.1 violated at the end of the smoke")
	}
}

func assertOrderState(t *testing.T, pool *pgxpool.Pool, orderID, want string) {
	t.Helper()
	var got string
	if err := pool.QueryRow(context.Background(), `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&got); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	if got != want {
		t.Fatalf("order state = %s, want %s", got, want)
	}
}
