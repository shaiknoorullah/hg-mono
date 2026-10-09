package orders

import (
	"context"
	"errors"
	"testing"
	"time"
)

// The developer clock only ever brings a deadline earlier, only for the
// state and action named, and the runner then fires the real action.
func TestIntegrationBringDeadlineForwardFiresTheRealAction(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	cart, _ := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	q, _ := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	var fresh *Quote
	prepared, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	if _, err := BringDeadlineForward(ctx, pool, prepared.OrderID, "CREATED", "EXPIRE_PAYMENT", -time.Second); err == nil {
		t.Fatal("a deadline was pushed into the past")
	}
	if _, err := BringDeadlineForward(ctx, pool, prepared.OrderID, "PREPARING", "PREP_OVERDUE", 0); !errors.Is(err, ErrDeadlineNotMoved) {
		t.Fatalf("wrong state: got %v, want ErrDeadlineNotMoved", err)
	}
	var before time.Time
	if err := pool.QueryRow(ctx, `SELECT deadline_at FROM "order" WHERE id = $1`, prepared.OrderID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	// Asking for a later instant than the current deadline changes nothing.
	got, err := BringDeadlineForward(ctx, pool, prepared.OrderID, "CREATED", "EXPIRE_PAYMENT", time.Hour)
	if err != nil || !got.Equal(before) {
		t.Fatalf("later instant: got %v %v, want the unchanged %v", got, err, before)
	}

	got, err = BringDeadlineForward(ctx, pool, prepared.OrderID, "CREATED", "EXPIRE_PAYMENT", 0)
	if err != nil {
		t.Fatalf("bring forward: %v", err)
	}
	if !got.Before(before) {
		t.Fatalf("deadline %v is not earlier than %v", got, before)
	}

	runner := NewDeadlineRunner(st, nil, testLogger(), "test-worker")
	if n, err := runner.Sweep(ctx); err != nil || n == 0 {
		t.Fatalf("sweep: %d %v", n, err)
	}
	view, err := st.GetOrderForCustomer(ctx, b.accountID, prepared.OrderID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if view.State != "CANCELLED" {
		t.Fatalf("state = %s, want CANCELLED once the brought-forward deadline fired", view.State)
	}
	if _, err := BringDeadlineForward(ctx, pool, prepared.OrderID, "CREATED", "EXPIRE_PAYMENT", 0); !errors.Is(err, ErrDeadlineNotMoved) {
		t.Fatalf("terminal order: got %v, want ErrDeadlineNotMoved", err)
	}
}
