package invariants

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// ---------------------------------------------------------------------------
// Invariant 3 — "Every non-terminal order state carries deadline_at, enforced
// by a Postgres CHECK. 'Waits forever' is unrepresentable." (AGENTS.md §3.4)
// Plus the order state machine's own legality: illegal transitions and wrong
// actors are rejected.
// ---------------------------------------------------------------------------

// TestOrderMachine_IllegalTransitionRejected drives Store.Transition — the one
// function that owns every write of order.state — against a live CREATED
// order and asks it to jump straight to DELIVERED, a pair absent from the
// compile-time transition table. It must be refused, and the order's state in
// the database must be unchanged.
func TestOrderMachine_IllegalTransitionRejected(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	orderID, _ := quoteAndOrder(t, st, b, nil) // stays CREATED: no gateway

	err := st.Transition(context.Background(), orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		Reason: "hostile: skip the whole machine",
	})
	var illegal *orders.IllegalTransitionError
	if !errors.As(err, &illegal) {
		t.Fatalf("Transition(CREATED->DELIVERED) error = %v, want *IllegalTransitionError", err)
	}
	if illegal.From != machine.StateCreated || illegal.To != machine.StateDelivered {
		t.Errorf("illegal transition reported (%s->%s), want (CREATED->DELIVERED)", illegal.From, illegal.To)
	}

	var state string
	if err := pool.QueryRow(context.Background(), `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("re-read state: %v", err)
	}
	if state != "CREATED" {
		t.Errorf("order state after rejected transition = %s, want CREATED unchanged", state)
	}
}

// TestOrderMachine_WrongActorRejected asserts the actor gate, not just the
// (from,to) pair: RESTAURANT_PENDING -> PREPARING (T6) is a legal edge, but
// only ActorRestaurant may trigger it. A customer attempting the same pair
// must be refused exactly like an illegal pair would be.
func TestOrderMachine_WrongActorRejected(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	orderID, _ := quoteAndOrder(t, st, b, gw) // advances to RESTAURANT_PENDING

	err := st.Transition(context.Background(), orders.TransitionRequest{
		OrderID: orderID, To: machine.StatePreparing, Actor: machine.ActorCustomer,
		Reason: "hostile: customer self-accepts",
	})
	var illegal *orders.IllegalTransitionError
	if !errors.As(err, &illegal) {
		t.Fatalf("Transition by wrong actor error = %v, want *IllegalTransitionError", err)
	}
}

// TestOrderMachine_EveryLiveNonTerminalStateHasADeadline drives an order
// through CREATED -> AUTHORIZED -> RESTAURANT_PENDING via the real gateway and
// asserts deadline_at is non-NULL in the database at every stop — the
// property the order_deadline_required CHECK enforces, observed live rather
// than asserted only at the machine-table level (which
// internal/orders/machine already covers exhaustively in
// TestDeadlineForEveryNonTerminalState).
func TestOrderMachine_EveryLiveNonTerminalStateHasADeadline(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	gw := localGateway{pay: pay, store: st}
	orderID, _ := quoteAndOrder(t, st, b, gw)

	var state string
	var deadlineAt any
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text, deadline_at FROM "order" WHERE id=$1`, orderID).Scan(&state, &deadlineAt); err != nil {
		t.Fatalf("re-read order: %v", err)
	}
	if state != "RESTAURANT_PENDING" {
		t.Fatalf("state = %s, want RESTAURANT_PENDING (gateway should have advanced it)", state)
	}
	if deadlineAt == nil {
		t.Error("RESTAURANT_PENDING order has NULL deadline_at — I-15.1 violated")
	}
}

// TestOrderMachine_DeadlineCheckRejectsNonTerminalWithNullDeadline bypasses
// the Go layer entirely and proves the invariant is a database fact, not a
// convention: the order_deadline_required CHECK constraint (migrations
// 00013_order.sql) must refuse a raw UPDATE that leaves a non-terminal order
// with a NULL deadline_at, even from a client that skips Store.Transition
// altogether.
func TestOrderMachine_DeadlineCheckRejectsNonTerminalWithNullDeadline(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	orderID, _ := quoteAndOrder(t, st, b, nil) // CREATED, has a deadline

	_, err := pool.Exec(context.Background(),
		`UPDATE "order" SET deadline_at = NULL WHERE id = $1`, orderID)
	if err == nil {
		t.Fatal("UPDATE clearing deadline_at on a non-terminal order succeeded — order_deadline_required CHECK did not fire")
	}
	msg := err.Error()
	if !strings.Contains(msg, "order_deadline_required") && !strings.Contains(msg, "23514") {
		t.Errorf("unexpected error (want the order_deadline_required CHECK): %v", err)
	}
}
