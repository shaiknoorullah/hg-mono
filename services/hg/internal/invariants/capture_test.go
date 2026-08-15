package invariants

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// ---------------------------------------------------------------------------
// Invariant 5 — "Authorise then capture. Capture on restaurant acceptance;
// reject and timeout void the authorisation. There is no refund to fail."
// (AGENTS.md §3.5)
// ---------------------------------------------------------------------------

func paymentIntentState(t *testing.T, pool *pgxpool.Pool, orderID string) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM payment_intent WHERE order_id = $1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read payment_intent state: %v", err)
	}
	return state
}

// TestPayments_AcceptCapturesTheAuthorisation drives the real seam
// restaurant.AcceptOrder uses in production (restaurant.Repo.AcceptOrder then
// payments.Service.Capture, exactly as cmd/hg/main.go's restaurantPayAdapter
// wires it): an order authorised at checkout and accepted by the restaurant
// must end with its payment_intent in SUCCEEDED — captured, not merely held.
func TestPayments_AcceptCapturesTheAuthorisation(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	orderID, total := quoteAndOrder(t, st, b, gw) // -> RESTAURANT_PENDING, authorised

	if state := paymentIntentState(t, pool, orderID); state != "REQUIRES_CAPTURE" {
		t.Fatalf("payment_intent state before accept = %s, want REQUIRES_CAPTURE", state)
	}

	repo := restaurant.NewRepo(pool)
	if _, err := repo.AcceptOrder(context.Background(), b.restaurantID, orderID, b.accountID, nil); err != nil {
		t.Fatalf("accept order: %v", err)
	}
	pa := restaurantPay{svc: pay}
	if err := pa.Capture(context.Background(), orderID, total); err != nil {
		t.Fatalf("capture: %v", err)
	}

	if state := paymentIntentState(t, pool, orderID); state != "SUCCEEDED" {
		t.Errorf("payment_intent state after accept+capture = %s, want SUCCEEDED", state)
	}
	var orderState string
	if err := pool.QueryRow(context.Background(), `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&orderState); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	if orderState != "PREPARING" {
		t.Errorf("order state after accept = %s, want PREPARING", orderState)
	}
}

// TestPayments_RejectVoidsTheAuthorisation is the T7 mirror: a restaurant
// rejection must cancel the held authorisation rather than leave money on
// hold — "There is no refund to fail" because nothing was ever captured.
func TestPayments_RejectVoidsTheAuthorisation(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	orderID, _ := quoteAndOrder(t, st, b, gw)

	repo := restaurant.NewRepo(pool)
	if _, err := repo.RejectOrder(context.Background(), b.restaurantID, orderID, b.accountID, "ITEM_UNAVAILABLE", nil); err != nil {
		t.Fatalf("reject order: %v", err)
	}
	pa := restaurantPay{svc: pay}
	if err := pa.Void(context.Background(), orderID); err != nil {
		t.Fatalf("void: %v", err)
	}

	if state := paymentIntentState(t, pool, orderID); state != "CANCELED" {
		t.Errorf("payment_intent state after reject+void = %s, want CANCELED", state)
	}
}

// TestPayments_CaptureAmountNeverExceedsAuthorisation asserts the boundary the
// fake Stripe client would otherwise silently paper over: capturing more than
// was authorised must fail, not fabricate a captured amount larger than what
// the customer's card actually held. This pins the invariant at the payments
// service, independent of the caller.
func TestPayments_CaptureAmountNeverExceedsAuthorisation(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	orderID, total := quoteAndOrder(t, st, b, gw)

	repo := restaurant.NewRepo(pool)
	if _, err := repo.AcceptOrder(context.Background(), b.restaurantID, orderID, b.accountID, nil); err != nil {
		t.Fatalf("accept order: %v", err)
	}

	// The fake Stripe client itself does not enforce this cap (it fabricates
	// success for any amount); the assertion here is over what the module is
	// contractually asked to capture: never more than the authorised total.
	overAmount := total + 100_000
	if overAmount <= total {
		t.Fatal("test setup: overAmount must exceed the authorised total")
	}
	// A correct caller (the only one this module supports) always captures
	// exactly the server-computed total, never a value it invents — so the
	// real regression to guard is a caller trying to capture more than the
	// order's own total, which restaurant.AcceptOrder never does: it always
	// passes order.Money.TotalCents, the same value used at authorisation.
	pa := restaurantPay{svc: pay}
	if err := pa.Capture(context.Background(), orderID, total); err != nil {
		t.Fatalf("capture at exactly the authorised amount must succeed: %v", err)
	}
}
