package machine

import (
	"testing"
	"time"
)

// TestExhaustiveTransitions asserts the permitted (from,to) pairs are exactly
// the set the P-14 table declares and every other ordered pair of the 14 states
// is rejected (I-14.7, acceptance 5). Merged rows (same from,to) count once.
func TestExhaustiveTransitions(t *testing.T) {
	permitted := map[[2]State]bool{
		{StateCreated, StateAuthorized}:           true,
		{StateCreated, StateFailed}:               true,
		{StateCreated, StateCancelled}:            true,
		{StateAuthorized, StateRestaurantPending}: true,
		{StateAuthorized, StateCancelled}:         true,
		{StateRestaurantPending, StatePreparing}:  true,
		{StateRestaurantPending, StateRejected}:   true,
		{StateRestaurantPending, StateCancelled}:  true,
		{StatePreparing, StateReadyForPickup}:     true,
		{StatePreparing, StateCancelled}:          true,
		{StateReadyForPickup, StatePickedUp}:      true,
		{StateReadyForPickup, StateCancelled}:     true,
		{StatePickedUp, StateArrived}:             true,
		{StatePickedUp, StateDelivered}:           true,
		{StateArrived, StateDelivered}:            true,
		{StatePickedUp, StateDisputed}:            true,
		{StateArrived, StateDisputed}:             true,
		{StateDelivered, StateCompleted}:          true,
		{StateDelivered, StateDisputed}:           true,
		{StateCompleted, StateDisputed}:           true,
		{StateDisputed, StateResolved}:            true,
		{StatePreparing, StateDisputed}:           true,
		{StateReadyForPickup, StateDisputed}:      true,
	}
	var count int
	for _, from := range AllStates {
		for _, to := range AllStates {
			_, ok := Lookup(from, to)
			want := permitted[[2]State{from, to}]
			if ok != want {
				t.Errorf("Lookup(%s, %s) = %v, want %v", from, to, ok, want)
			}
			if ok {
				count++
			}
		}
	}
	if count != len(permitted) {
		t.Errorf("permitted edge count = %d, want %d", count, len(permitted))
	}
}

func TestTerminalNeverTransitions(t *testing.T) {
	// I-14.6: terminal states carry no deadline and never re-enter the forward
	// flow. The one spec-sanctioned exception is COMPLETED → DISPUTED (T19): a
	// dispute may be raised within the window after completion. COMPLETED still
	// carries no deadline (it is deadline-terminal), so the exception does not
	// weaken the "waits forever is unrepresentable" property.
	for _, s := range AllStates {
		if !IsTerminal(s) {
			continue
		}
		for _, to := range AllStates {
			_, ok := Lookup(s, to)
			if s == StateCompleted && to == StateDisputed {
				if !ok {
					t.Errorf("COMPLETED → DISPUTED (T19) must be permitted")
				}
				continue
			}
			if ok {
				t.Errorf("terminal %s has an unexpected outgoing edge to %s", s, to)
			}
		}
	}
}

func TestActorPermitted(t *testing.T) {
	// Acceptance 2 shape: only the restaurant may accept a RESTAURANT_PENDING order.
	tr, ok := Lookup(StateRestaurantPending, StatePreparing)
	if !ok {
		t.Fatal("accept edge missing")
	}
	if !tr.ActorPermitted(ActorRestaurant) {
		t.Error("restaurant should be permitted to accept")
	}
	if tr.ActorPermitted(ActorCustomer) || tr.ActorPermitted(ActorRider) {
		t.Error("customer/rider must not accept")
	}
	if tr.Action != ActionAccept {
		t.Errorf("accept action = %q, want %q", tr.Action, ActionAccept)
	}
}

func TestAllowedFromForError(t *testing.T) {
	// Acceptance 1: RESTAURANT_PENDING → {PREPARING, REJECTED, CANCELLED}.
	got := AllowedFrom(StateRestaurantPending)
	want := []State{StatePreparing, StateCancelled, StateRejected}
	set := map[State]bool{}
	for _, s := range got {
		set[s] = true
	}
	for _, s := range want {
		if !set[s] {
			t.Errorf("AllowedFrom(RESTAURANT_PENDING) missing %s (got %v)", s, got)
		}
	}
	if len(got) != len(want) {
		t.Errorf("AllowedFrom count = %d, want %d: %v", len(got), len(want), got)
	}
}

func TestDeadlineForEveryNonTerminalState(t *testing.T) {
	// I-15.1: every non-terminal state has a deadline spec (so the CHECK can
	// always be satisfied). Every terminal state has none.
	for _, s := range AllStates {
		_, ok := DeadlineFor(s)
		if IsTerminal(s) && ok {
			t.Errorf("terminal %s must have no deadline spec", s)
		}
		if !IsTerminal(s) && !ok {
			t.Errorf("non-terminal %s must have a deadline spec", s)
		}
	}
}

func TestComputeDeadlineTerminalIsNull(t *testing.T) {
	_, _, ok := ComputeDeadline(StateCompleted, time.Time{}, 0)
	if ok {
		t.Error("terminal state must not produce a deadline")
	}
	_, action, ok := ComputeDeadline(StateCreated, time.Time{}, 0)
	if !ok || action != ActionExpirePayment {
		t.Errorf("CREATED deadline action = %q ok=%v, want EXPIRE_PAYMENT", action, ok)
	}
}
