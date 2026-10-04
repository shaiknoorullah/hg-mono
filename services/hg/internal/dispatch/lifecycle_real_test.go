package dispatch

import (
	"context"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

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
// READY_FOR_PICKUP -> PICKED_UP -> DELIVERED as a side effect, proving:
//   - the main.go wiring compiles and runs against the real sibling signatures,
//   - the bridge fires ConfirmPickup at PICKED_UP and CompleteDelivery at
//     DELIVERED in the right order,
//   - P-14 holds: dispatch never wrote order.state; only orders.Store did, and
//     it left exactly one order_transition row per legal move.
func TestLifecycleBridgeDrivesRealOrderStore(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ordersStore := orders.NewStore(pool)
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

	for _, step := range []string{"EN_ROUTE_TO_DROPOFF", "ARRIVED_AT_DROPOFF", "DELIVERED"} {
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
	if st != "DELIVERED" {
		t.Fatalf("after dispatch DELIVERED, real order state = %q, want DELIVERED (bridge did not fire CompleteDelivery)", st)
	}
	var delivered int
	mustQuery(t, pool, `
SELECT count(*) FROM order_transition
 WHERE order_id=$1 AND to_state='DELIVERED' AND actor_kind='RIDER' AND actor_account_id=$2`,
		&delivered, orderID, o.riderAccountID)
	if delivered != 1 {
		t.Errorf("expected exactly 1 rider DELIVERED order_transition, got %d", delivered)
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
