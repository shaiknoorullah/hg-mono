package orders

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// testRealtimeEmitter is an in-test implementation of orders.EventEmitter that
// calls realtime.EmitInTx directly — the same logic the cmd/hg/main.go adapter
// uses. It lets the integration test own the realtime outbox without importing
// package main.
type testRealtimeEmitter struct{}

func (e *testRealtimeEmitter) EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	payload, err := json.Marshal(struct {
		State string `json:"state"`
	}{State: newState})
	if err != nil {
		return err
	}
	oid := orderID
	_, _, err = realtime.EmitInTx(ctx, tx,
		"order:"+orderID,
		"order.state_changed",
		1,
		nil,
		json.RawMessage(payload),
		&oid,
		nil,
	)
	return err
}

// TestIntegrationTransitionWritesRealtimeEvent verifies that a state transition
// writes a realtime_event row for the order's channel in the same transaction,
// satisfying the transactional outbox contract (§6.1 / Seam C).
func TestIntegrationTransitionWritesRealtimeEvent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	// Wire a store with the realtime emitter so Transition emits outbox events.
	st := NewStore(pool, &testRealtimeEmitter{})
	b := seedBasics(t, pool)

	// Build an order in CREATED state.
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	q, err := st.CreateQuote(ctx, QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID,
		DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("create quote: %v", err)
	}
	var fresh *Quote
	prepared, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	channel := "order:" + prepared.OrderID

	// Clean up realtime rows this test writes (the account/order rows are
	// handled by seedBasics's Cleanup; realtime rows reference order_id so they
	// must go first).
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM outbox_message WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_event WHERE channel = $1`, channel)
		_, _ = pool.Exec(bg, `DELETE FROM channel_cursor WHERE channel = $1`, channel)
	})

	// Perform a transition: CREATED → CANCELLED. This is a customer cancel
	// before restaurant acceptance and requires no money effect.
	// cancel_reason must be a valid order_cancellation_reason_code enum value;
	// customer_cancel_reason carries the customer's reported reason code.
	cancelReason := "CUSTOMER_CANCELLED"
	customerReason := "CHANGED_MIND"
	err = st.Transition(ctx, TransitionRequest{
		OrderID:              prepared.OrderID,
		To:                   machine.StateCancelled,
		Actor:                machine.ActorCustomer,
		ActorAccountID:       b.accountID,
		Reason:               "customer cancelled",
		CancelReason:         &cancelReason,
		CustomerCancelReason: &customerReason,
	})
	if err != nil {
		t.Fatalf("transition: %v", err)
	}

	// Assert: a realtime_event row for the order's channel exists.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM realtime_event WHERE channel = $1 AND type = 'order.state_changed'`,
		channel).Scan(&count); err != nil {
		t.Fatalf("count realtime_event: %v", err)
	}
	if count == 0 {
		t.Fatalf("expected a realtime_event row for channel %s after Transition; got 0", channel)
	}

	// Assert: the event's payload carries the new state.
	var rawPayload json.RawMessage
	if err := pool.QueryRow(ctx,
		`SELECT payload FROM realtime_event WHERE channel = $1 AND type = 'order.state_changed' LIMIT 1`,
		channel).Scan(&rawPayload); err != nil {
		t.Fatalf("read payload: %v", err)
	}
	var got struct {
		State string `json:"state"`
	}
	if err := json.Unmarshal(rawPayload, &got); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if got.State != string(machine.StateCancelled) {
		t.Errorf("payload.state = %q, want %q", got.State, machine.StateCancelled)
	}

	// Assert: there is exactly one corresponding outbox_message row
	// (the transactional outbox invariant from §6.1).
	var missing int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM realtime_event_without_outbox WHERE channel = $1`,
		channel).Scan(&missing); err != nil {
		t.Fatalf("outbox invariant query: %v", err)
	}
	if missing != 0 {
		t.Errorf("%d realtime event(s) have no outbox row — the transactional outbox invariant is violated", missing)
	}
}
