package orders

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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

// buildCreatedOrder seeds a domain fixture and returns an order in CREATED state
// plus its realtime channel. It registers cleanup of the realtime rows for that
// channel (the account/order rows are cleaned by seedBasics).
func buildCreatedOrder(t *testing.T, pool *pgxpool.Pool, st *Store) (orderID, channel string, accountID string) {
	t.Helper()
	ctx := context.Background()
	b := seedBasics(t, pool)

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
	ch := "order:" + prepared.OrderID
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM outbox_message WHERE channel = $1`, ch)
		_, _ = pool.Exec(bg, `DELETE FROM realtime_event WHERE channel = $1`, ch)
		_, _ = pool.Exec(bg, `DELETE FROM channel_cursor WHERE channel = $1`, ch)
	})
	return prepared.OrderID, ch, b.accountID
}

func countRealtimeEvents(t *testing.T, pool *pgxpool.Pool, channel string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM realtime_event WHERE channel = $1`, channel).Scan(&n); err != nil {
		t.Fatalf("count realtime_event: %v", err)
	}
	return n
}

func orderState(t *testing.T, pool *pgxpool.Pool, orderID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM "order" WHERE id = $1`, orderID).Scan(&s); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	return s
}

// TestIntegrationTransitionRollsBackEventOnEffectFailure is the negative half of
// the transactional-outbox contract: because the emitter writes the outbox event
// inside the SAME transaction as the state change, a failing effect must roll the
// whole thing back — the state must NOT advance AND no realtime_event may persist.
// Without atomicity this test would find a leaked event with no committed state
// change (a ghost update the customer would see for a transition that never
// happened).
func TestIntegrationTransitionRollsBackEventOnEffectFailure(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	st := NewStore(pool, &testRealtimeEmitter{})
	orderID, channel, accountID := buildCreatedOrder(t, pool, st)

	before := orderState(t, pool, orderID)

	// A poison effect that always fails. It runs AFTER the emitter has already
	// written the outbox row inside the tx, so the rollback must unwind that write.
	boom := errors.New("boom: effect failed")
	cancelReason := "CUSTOMER_CANCELLED"
	customerReason := "CHANGED_MIND"
	err := st.Transition(ctx, TransitionRequest{
		OrderID:              orderID,
		To:                   machine.StateCancelled,
		Actor:                machine.ActorCustomer,
		ActorAccountID:       accountID,
		Reason:               "customer cancelled",
		CancelReason:         &cancelReason,
		CustomerCancelReason: &customerReason,
	}, func(pgx.Tx) error { return boom })

	if !errors.Is(err, boom) {
		t.Fatalf("Transition error = %v, want the poison effect error", err)
	}

	// The state must be unchanged: the whole tx rolled back.
	if after := orderState(t, pool, orderID); after != before {
		t.Errorf("order state advanced to %q despite failed effect; want %q (tx must roll back)", after, before)
	}
	// And crucially: no realtime_event may have leaked. If the emitter wrote
	// outside the caller's tx, this would be non-zero — a ghost event.
	if n := countRealtimeEvents(t, pool, channel); n != 0 {
		t.Errorf("%d realtime_event row(s) leaked after a rolled-back transition; the outbox write is not atomic with the state change", n)
	}
}

// TestIntegrationIllegalTransitionEmitsNoEvent verifies a rejected transition
// (one the state machine refuses) writes no realtime_event: the emitter is
// reached only after the state UPDATE succeeds, so an illegal pair never
// produces an outbox event.
func TestIntegrationIllegalTransitionEmitsNoEvent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	st := NewStore(pool, &testRealtimeEmitter{})
	orderID, channel, _ := buildCreatedOrder(t, pool, st)

	// CREATED -> DELIVERED is not a legal pair; the machine rejects it before any
	// state write or emit.
	err := st.Transition(ctx, TransitionRequest{
		OrderID: orderID,
		To:      machine.StateDelivered,
		Actor:   machine.ActorSystem,
		Reason:  "illegal jump",
	})
	var illegal *IllegalTransitionError
	if !errors.As(err, &illegal) {
		t.Fatalf("Transition error = %v, want IllegalTransitionError", err)
	}
	if n := countRealtimeEvents(t, pool, channel); n != 0 {
		t.Errorf("%d realtime_event row(s) written for an illegal transition; want 0", n)
	}
}

// TestIntegrationNilEmitterTransitionsWithoutEvent is the nil-dependency safety
// contract: a Store built with no emitter (the realtime sibling not wired — e.g.
// a boot without B8, or a unit context) must still transition orders normally
// and simply emit nothing. This proves Transition never assumes the emitter is
// present.
func TestIntegrationNilEmitterTransitionsWithoutEvent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	// No emitter passed: s.emitter is nil.
	st := NewStore(pool)
	orderID, channel, accountID := buildCreatedOrder(t, pool, st)

	cancelReason := "CUSTOMER_CANCELLED"
	customerReason := "CHANGED_MIND"
	err := st.Transition(ctx, TransitionRequest{
		OrderID:              orderID,
		To:                   machine.StateCancelled,
		Actor:                machine.ActorCustomer,
		ActorAccountID:       accountID,
		Reason:               "customer cancelled",
		CancelReason:         &cancelReason,
		CustomerCancelReason: &customerReason,
	})
	if err != nil {
		t.Fatalf("transition with nil emitter: %v", err)
	}
	// The state change still committed.
	if s := orderState(t, pool, orderID); s != string(machine.StateCancelled) {
		t.Errorf("order state = %q after nil-emitter transition; want CANCELLED", s)
	}
	// But no realtime event was emitted.
	if n := countRealtimeEvents(t, pool, channel); n != 0 {
		t.Errorf("%d realtime_event row(s) written with a nil emitter; want 0 (boot-without-sibling must be silent)", n)
	}
}
