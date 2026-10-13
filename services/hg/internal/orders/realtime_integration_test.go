package orders

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// recordingNotifier is an orders.EventEmitter that records the transitions it
// was handed, inside the transition's transaction.
type recordingNotifier struct{ states []string }

func (n *recordingNotifier) EmitOrderTransition(_ context.Context, _ pgx.Tx, _ string, newState string) error {
	n.states = append(n.states, newState)
	return nil
}

// channelEvents reads a channel's events in seq order.
func channelEvents(t *testing.T, pool *pgxpool.Pool, channel string) []realtime.StoredEvent {
	t.Helper()
	events, _, err := realtime.NewStore(pool, "test").Replay(context.Background(), channel, 0)
	if err != nil {
		t.Fatalf("replay %s: %v", channel, err)
	}
	return events
}

// validateEvent checks a stored event against the schema
// GET /v1/realtime/schema serves for its type, for every role that receives it.
func validateEvent(t *testing.T, e realtime.StoredEvent) {
	t.Helper()
	realtimetest.Validate(t, e)
}

// TestIntegrationTransitionWritesRealtimeEvent verifies that creating and
// moving an order writes the contract's events on the order's channel in the
// same transaction (contracts/websocket.md sections 4.2 and 6.1), and that
// each validates against the schema the server publishes.
func TestIntegrationTransitionWritesRealtimeEvent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	notifier := &recordingNotifier{}
	st := NewStore(pool, notifier)
	orderID, channel, accountID := buildCreatedOrder(t, pool, st)

	// Creation: order.created, then the first order.state_changed (from null).
	created := channelEvents(t, pool, channel)
	if len(created) != 2 || created[0].Type != "order.created" || created[1].Type != "order.state_changed" {
		t.Fatalf("creation wrote %v, want order.created then order.state_changed", eventTypes(created))
	}

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
		t.Fatalf("transition: %v", err)
	}

	events := channelEvents(t, pool, channel)
	if got := eventTypes(events); !slices.Equal(got, []string{"order.created", "order.state_changed", "order.state_changed", "order.cancelled"}) {
		t.Fatalf("channel events = %v", got)
	}
	for i, e := range events {
		if e.Seq != int64(i+1) {
			t.Errorf("event %d has seq %d; the channel's seq must be gapless", i, e.Seq)
		}
		validateEvent(t, e)
	}

	var changed struct {
		From      *string `json:"from"`
		To        string  `json:"to"`
		Reason    *string `json:"reason"`
		ActorKind string  `json:"actor_kind"`
	}
	if err := json.Unmarshal(events[2].Payload, &changed); err != nil {
		t.Fatal(err)
	}
	if changed.From == nil || *changed.From != "CREATED" || changed.To != "CANCELLED" ||
		changed.Reason == nil || *changed.Reason != "CUSTOMER_CANCELLED" || changed.ActorKind != "CUSTOMER" {
		t.Errorf("order.state_changed = %+v, want CREATED -> CANCELLED by CUSTOMER, reason CUSTOMER_CANCELLED", changed)
	}

	// The notifier still runs inside the transition (creation is not a
	// notification).
	if !slices.Equal(notifier.states, []string{"CANCELLED"}) {
		t.Errorf("notifier saw %v, want [CANCELLED]", notifier.states)
	}

	// Every event has its outbox row (the transactional outbox invariant).
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

func eventTypes(events []realtime.StoredEvent) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Type
	}
	return out
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

	st := NewStore(pool)
	orderID, channel, accountID := buildCreatedOrder(t, pool, st)

	before := orderState(t, pool, orderID)
	eventsBefore := countRealtimeEvents(t, pool, channel)

	// A poison effect that always fails. It runs AFTER the transition has
	// written its outbox rows inside the tx, so the rollback must unwind them.
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
	// And crucially: no realtime_event may have leaked. Had the events been
	// written outside the caller's tx, there would be a ghost event here.
	if n := countRealtimeEvents(t, pool, channel); n != eventsBefore {
		t.Errorf("%d realtime_event row(s) leaked after a rolled-back transition; the outbox write is not atomic with the state change", n-eventsBefore)
	}
}

// TestIntegrationIllegalTransitionEmitsNoEvent verifies a rejected transition
// (one the state machine refuses) writes no realtime_event: the events are
// written only after the state UPDATE succeeds, so an illegal pair never
// produces an outbox event.
func TestIntegrationIllegalTransitionEmitsNoEvent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	st := NewStore(pool)
	orderID, channel, _ := buildCreatedOrder(t, pool, st)
	eventsBefore := countRealtimeEvents(t, pool, channel)

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
	if n := countRealtimeEvents(t, pool, channel); n != eventsBefore {
		t.Errorf("%d realtime_event row(s) written for an illegal transition; want 0", n-eventsBefore)
	}
}

// TestIntegrationStoreWithoutNotifierStillEmits pins the reason the realtime
// events are written by Transition itself rather than through the injected
// notifier: a Store built with no notifier — as internal/admin builds one —
// still moves the order AND still tells the customer, the restaurant and the
// rider (https://github.com/shaiknoorullah/hg-mono/issues/247).
func TestIntegrationStoreWithoutNotifierStillEmits(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	st := NewStore(pool) // no notifier: s.emitter is nil
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
		t.Fatalf("transition without a notifier: %v", err)
	}
	if s := orderState(t, pool, orderID); s != string(machine.StateCancelled) {
		t.Errorf("order state = %q, want CANCELLED", s)
	}
	if got := eventTypes(channelEvents(t, pool, channel)); !slices.Contains(got, "order.cancelled") {
		t.Errorf("a store without a notifier emitted %v; it must still emit order.cancelled", got)
	}
}
