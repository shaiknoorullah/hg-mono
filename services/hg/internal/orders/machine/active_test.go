package machine

import "testing"

// These pin which order states count as the customer's one active order, after
// the owner's decision that an order under review after a problem report does
// not count (decision log, 1 Oct 2026:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01;
// issue https://github.com/shaiknoorullah/hg-mono/issues/260).

func TestUnderReviewIsOnlyDisputed(t *testing.T) {
	for _, s := range AllStates {
		if got, want := UnderReview(s), s == StateDisputed; got != want {
			t.Errorf("UnderReview(%s) = %v, want %v", s, got, want)
		}
	}
}

func TestCountsAsActive(t *testing.T) {
	want := map[State]bool{
		StateCreated: true, StateAuthorized: true, StateRestaurantPending: true,
		StatePreparing: true, StateReadyForPickup: true, StatePickedUp: true,
		StateArrived: true, StateDelivered: true,
		// Finished orders never count.
		StateCompleted: false, StateCancelled: false, StateRejected: false,
		StateFailed: false, StateResolved: false,
		// Not finished, but under review: does not count.
		StateDisputed: false,
	}
	for _, s := range AllStates {
		if got := CountsAsActive(s); got != want[s] {
			t.Errorf("CountsAsActive(%s) = %v, want %v", s, got, want[s])
		}
	}

	var fromList []State
	for _, s := range AllStates {
		if want[s] {
			fromList = append(fromList, s)
		}
	}
	got := ActiveStates()
	if len(got) != len(fromList) {
		t.Fatalf("ActiveStates() = %v, want %v", got, fromList)
	}
	for i := range got {
		if got[i] != string(fromList[i]) {
			t.Fatalf("ActiveStates() = %v, want %v", got, fromList)
		}
	}
}

// The one-active-order rule is checked when an order is placed. That is enough
// only if an order that has stopped counting never starts counting again, so no
// edge of the machine may lead from a state that does not count into one that
// does. Today review is left only for RESOLVED, which is finished. If an edge
// back into fulfilment is ever added (say DISPUTED to PREPARING), a customer who
// ordered again during the review would hold two active orders: this test fails
// first, and the rule needs a new decision.
func TestNoTransitionMakesAnOrderActiveAgain(t *testing.T) {
	for _, from := range AllStates {
		if CountsAsActive(from) {
			continue
		}
		for _, to := range AllowedFrom(from) {
			if CountsAsActive(to) {
				t.Errorf("%s -> %s takes an order that does not count as active back into one that does", from, to)
			}
		}
	}
	if got := AllowedFrom(StateDisputed); len(got) != 1 || got[0] != StateResolved {
		t.Errorf("an order leaves review only for RESOLVED; AllowedFrom(DISPUTED) = %v", got)
	}
}
