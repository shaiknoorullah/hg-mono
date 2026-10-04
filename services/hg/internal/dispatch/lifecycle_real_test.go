package dispatch

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// recordingEmitter stands in for cmd/hg/main.go's realtime emitter: the orders
// transition function calls it inside the transition's transaction for every
// state change, which is where the existing order.state_changed event is
// written. Recording the calls proves the arrival step goes through that one
// path rather than a new event of its own (event shapes are issue #247).
type recordingEmitter struct {
	mu     sync.Mutex
	states []string
}

func (e *recordingEmitter) EmitOrderTransition(_ context.Context, _ pgx.Tx, _ string, newState string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.states = append(e.states, newState)
	return nil
}

func (e *recordingEmitter) emitted() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.states)
}

// realOrderLifecycle is the production-shaped adapter: it forwards the dispatch
// bridge onto the real orders.Store.Transition, exactly as cmd/hg/main.go's
// orderLifecycleAdapter does. Keeping a copy here lets the dispatch integration
// suite prove the seam against the REAL sibling (not just a fake), which is the
// only place P-14 (dispatch never writes order.state itself) is actually
// exercised end to end.
type realOrderLifecycle struct {
	store *orders.Store
}

func (a *realOrderLifecycle) ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StatePickedUp,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider confirmed pickup",
	})
}

func (a *realOrderLifecycle) MarkArrived(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateArrived,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider arrived at the drop-off",
	})
}

func (a *realOrderLifecycle) CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateDelivered,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider completed delivery",
	})
}

// TestLifecycleBridgeDrivesRealOrderStore is the load-bearing regression for
// SEAM B: it wires the dispatch Service to a REAL orders.Store (the same
// adapter shape as main.go) and drives an assignment ASSIGNED -> ... ->
// DELIVERED. It asserts the order's own state machine advances
// READY_FOR_PICKUP -> PICKED_UP -> ARRIVED -> DELIVERED as a side effect,
// proving:
//   - the main.go wiring compiles and runs against the real sibling signatures,
//   - the bridge fires ConfirmPickup at PICKED_UP, MarkArrived at
//     ARRIVED_AT_DROPOFF (the rider's "I'm here", issue #250) and
//     CompleteDelivery at DELIVERED, in that order,
//   - ARRIVED is entered with its 15-minute handover-overdue deadline armed, so
//     the order is never left waiting with no clock (docs/spec/01-platform.md,
//     "P-15 — Deadlines and timeout actions"),
//   - P-14 holds: dispatch never wrote order.state; only orders.Store did, and
//     it left exactly one order_transition row per legal move, each emitted
//     through the existing state-change event.
func TestLifecycleBridgeDrivesRealOrderStore(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	emitter := &recordingEmitter{}
	ordersStore := orders.NewStore(pool, emitter)
	lc := &realOrderLifecycle{store: ordersStore}
	svc := NewService(store, lc)
	ctx := context.Background()

	orderID, offers := seedFixture(t, pool, 1)
	o := offers[0]

	// The real bridge writes order_transition rows (FK to "order" is NO ACTION),
	// which would block seedFixture's own DELETE FROM "order" cleanup. t.Cleanup
	// runs LIFO, so registering this here means it fires BEFORE seedFixture's.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_transition WHERE order_id=$1`, orderID)
	})

	// Sanity: the seeded order starts in READY_FOR_PICKUP.
	var st string
	mustQuery(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &st, orderID)
	if st != "READY_FOR_PICKUP" {
		t.Fatalf("seeded order state = %q, want READY_FOR_PICKUP", st)
	}

	assignmentID, err := store.AcceptOffer(ctx, o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	override := "test override"
	// Walk to PICKED_UP. The bridge must advance the real order to PICKED_UP.
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "PICKED_UP"} {
		if _, err := svc.Transition(ctx, o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			PickupCode:     pickupCodeFor(step),
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}

	mustQuery(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &st, orderID)
	if st != "PICKED_UP" {
		t.Fatalf("after dispatch PICKED_UP, real order state = %q, want PICKED_UP (bridge did not fire ConfirmPickup)", st)
	}
	// The order carries a PICKED_UP deadline (order_deadline_required CHECK), and
	// exactly one T12 transition row exists with the rider as actor.
	var picked int
	mustQuery(t, pool, `
SELECT count(*) FROM order_transition
 WHERE order_id=$1 AND to_state='PICKED_UP' AND actor_kind='RIDER' AND actor_account_id=$2`,
		&picked, orderID, o.riderAccountID)
	if picked != 1 {
		t.Errorf("expected exactly 1 rider PICKED_UP order_transition, got %d", picked)
	}

	// POD gate: mark pod_recorded so the dispatch DELIVERED transition is legal.
	var requiredPod string
	mustQuery(t, pool, `SELECT required_pod_method FROM assignment WHERE id=$1`, &requiredPod, assignmentID)
	if requiredPod != "" {
		mustExec(t, pool, `UPDATE assignment SET pod_recorded=true WHERE id=$1`, assignmentID)
	}

	step := func(to string) {
		t.Helper()
		if _, err := svc.Transition(ctx, o.riderAccountID, assignmentID, TransitionInput{
			ToState:        to,
			PickupCode:     pickupCodeFor(to),
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", to, err)
		}
	}

	// Leaving the restaurant is not an arrival: the order stays PICKED_UP.
	step("EN_ROUTE_TO_DROPOFF")
	mustQuery(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &st, orderID)
	if st != "PICKED_UP" {
		t.Fatalf("after dispatch EN_ROUTE_TO_DROPOFF, real order state = %q, want PICKED_UP", st)
	}

	// The rider taps "I'm here": the order takes the picked-up to arrived step,
	// with the handover-overdue deadline armed 15 minutes out.
	beforeArrive := time.Now().UTC()
	step("ARRIVED_AT_DROPOFF")
	var deadlineAction *string
	var deadlineAt *time.Time
	if err := pool.QueryRow(ctx, `SELECT state::text, deadline_action, deadline_at FROM "order" WHERE id=$1`, orderID).
		Scan(&st, &deadlineAction, &deadlineAt); err != nil {
		t.Fatalf("read order after arrival: %v", err)
	}
	if st != "ARRIVED" {
		t.Fatalf("after dispatch ARRIVED_AT_DROPOFF, real order state = %q, want ARRIVED (bridge did not fire MarkArrived)", st)
	}
	if deadlineAction == nil || *deadlineAction != machine.ActionHandoverOverdue {
		t.Errorf("ARRIVED deadline_action = %v, want %s", deadlineAction, machine.ActionHandoverOverdue)
	}
	if deadlineAt == nil {
		t.Fatal("ARRIVED deadline_at is NULL; a non-terminal order must carry a deadline")
	}
	if got := deadlineAt.Sub(beforeArrive); got < 14*time.Minute || got > 16*time.Minute {
		t.Errorf("ARRIVED deadline_at is %s after arrival, want about 15m", got)
	}
	var arrived int
	mustQuery(t, pool, `
SELECT count(*) FROM order_transition
 WHERE order_id=$1 AND from_state='PICKED_UP' AND to_state='ARRIVED'
   AND actor_kind='RIDER' AND actor_account_id=$2`,
		&arrived, orderID, o.riderAccountID)
	if arrived != 1 {
		t.Errorf("expected exactly 1 rider PICKED_UP->ARRIVED order_transition, got %d", arrived)
	}

	// Handover: ARRIVED -> DELIVERED (the arrived-then-delivered edge, not the
	// direct picked-up-to-delivered one).
	step("DELIVERED")
	mustQuery(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &st, orderID)
	if st != "DELIVERED" {
		t.Fatalf("after dispatch DELIVERED, real order state = %q, want DELIVERED (bridge did not fire CompleteDelivery)", st)
	}
	var delivered int
	mustQuery(t, pool, `
SELECT count(*) FROM order_transition
 WHERE order_id=$1 AND from_state='ARRIVED' AND to_state='DELIVERED'
   AND actor_kind='RIDER' AND actor_account_id=$2`,
		&delivered, orderID, o.riderAccountID)
	if delivered != 1 {
		t.Errorf("expected exactly 1 rider ARRIVED->DELIVERED order_transition, got %d", delivered)
	}

	// Every move went out on the existing state-change event, in order.
	if got, want := emitter.emitted(), []string{"PICKED_UP", "ARRIVED", "DELIVERED"}; !slices.Equal(got, want) {
		t.Errorf("state-change events = %v, want %v", got, want)
	}
}

// TestLifecycleBridgeRefusesArrivalBeforePickup pins that the arrival step is
// only the documented picked-up to arrived edge: an order that was never
// picked up cannot be pushed to ARRIVED, and the refusal leaves the order, its
// deadline and its transition log untouched. Dispatch may move an order
// forward only through the transitions in docs/spec/01-platform.md,
// "P-14 — Order lifecycle states and transitions".
func TestLifecycleBridgeRefusesArrivalBeforePickup(t *testing.T) {
	pool := openPool(t)
	emitter := &recordingEmitter{}
	lc := &realOrderLifecycle{store: orders.NewStore(pool, emitter)}
	ctx := context.Background()

	orderID, offers := seedFixture(t, pool, 1)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_transition WHERE order_id=$1`, orderID)
	})

	err := lc.MarkArrived(ctx, orderID, offers[0].riderAccountID)
	var illegal *orders.IllegalTransitionError
	if !errors.As(err, &illegal) {
		t.Fatalf("MarkArrived on a READY_FOR_PICKUP order: err = %v, want an illegal-transition refusal", err)
	}
	if illegal.From != machine.StateReadyForPickup || illegal.To != machine.StateArrived {
		t.Errorf("refusal = %s -> %s, want READY_FOR_PICKUP -> ARRIVED", illegal.From, illegal.To)
	}

	var st string
	var deadlineAction *string
	if err := pool.QueryRow(ctx, `SELECT state::text, deadline_action FROM "order" WHERE id=$1`, orderID).
		Scan(&st, &deadlineAction); err != nil {
		t.Fatalf("read order after refusal: %v", err)
	}
	if st != "READY_FOR_PICKUP" {
		t.Errorf("order state after refused arrival = %q, want READY_FOR_PICKUP", st)
	}
	if deadlineAction == nil || *deadlineAction != machine.ActionPickupOverdue {
		t.Errorf("deadline_action after refused arrival = %v, want %s (unchanged)", deadlineAction, machine.ActionPickupOverdue)
	}
	var rows int
	mustQuery(t, pool, `SELECT count(*) FROM order_transition WHERE order_id=$1 AND to_state='ARRIVED'`, &rows, orderID)
	if rows != 0 {
		t.Errorf("refused arrival wrote %d ARRIVED order_transition rows, want 0", rows)
	}
	if got := emitter.emitted(); len(got) != 0 {
		t.Errorf("refused arrival emitted state-change events %v, want none", got)
	}
}

// TestLifecycleBridgeSkippedOnIdempotentRepeat asserts that re-POSTing the same
// assignment transition (an idempotent no-op) does NOT fire the OrderLifecycle
// bridge a second time. Re-firing would attempt an already-applied order
// transition — which the orders machine rejects as illegal — and would log a
// spurious bridge failure on an ordinary flaky-network retry. The store now
// reports transitioned=false for the no-op and the service skips the bridge.
func TestLifecycleBridgeSkippedOnIdempotentRepeat(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	lc := &fakeLifecycle{}
	svc := NewService(store, lc)
	ctx := context.Background()

	_, offers := seedFixture(t, pool, 1)
	o := offers[0]

	assignmentID, err := store.AcceptOffer(ctx, o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	override := "test override"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "PICKED_UP"} {
		if _, err := svc.Transition(ctx, o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			PickupCode:     pickupCodeFor(step),
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}
	if got := len(lc.pickups()); got != 1 {
		t.Fatalf("expected 1 ConfirmPickup after first PICKED_UP, got %d", got)
	}

	// Re-POST PICKED_UP: idempotent no-op, must NOT fire the bridge again.
	asn, err := svc.Transition(ctx, o.riderAccountID, assignmentID, TransitionInput{
		ToState:    "PICKED_UP",
		PickupCode: pickupCodeFor("PICKED_UP"),
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("idempotent repeat PICKED_UP must succeed: %v", err)
	}
	if asn.State != "PICKED_UP" {
		t.Errorf("assignment state = %q, want PICKED_UP", asn.State)
	}
	if got := len(lc.pickups()); got != 1 {
		t.Errorf("idempotent repeat re-fired the bridge: ConfirmPickup calls = %d, want 1", got)
	}
}
