package machine

// Which orders count as the customer's one active order.
//
// A customer may hold one active order at a time (the customer spec's order
// history rules, docs/spec/02-customer.md, "Order history and active-order
// resume", rule 4). The owner narrowed that on 1 Oct 2026: "an order under
// review does not count as active", for "a new order while the only active one
// is under review after a problem report", because "review can take up to 48
// hours, and the customer still needs dinner" (decision log:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01;
// issue https://github.com/shaiknoorullah/hg-mono/issues/260).
//
// Under review is the DISPUTED state. Every problem report moves an order
// there: the customer or the restaurant reporting a problem after delivery, the
// restaurant reporting one while preparing, support opening an incident mid
// delivery, and a delivery or handover that overran its deadline. Its deadline
// is the 48-hour review clock the decision refers to. A refund request is not a
// review of the order: the order stays in its own state and carries on, so it
// keeps counting (whether a problem reported before delivery should open a
// review is still open with the owner:
// https://github.com/shaiknoorullah/hg-mono/issues/164).
//
// An order leaves review only for RESOLVED, which is finished, so an order that
// stopped counting never counts again (TestNoTransitionMakesAnOrderActiveAgain).

// UnderReview reports whether an order in state s is under review after a
// problem report.
func UnderReview(s State) bool { return s == StateDisputed }

// CountsAsActive reports whether an order in state s is the customer's one
// active order: not finished, and not under review.
func CountsAsActive(s State) bool { return !IsTerminal(s) && !UnderReview(s) }

// ActiveStates returns, in enum order, the states that CountsAsActive, as
// strings for a SQL `state::text = ANY($n)` filter, so the database queries
// and this rule cannot drift apart.
func ActiveStates() []string {
	var out []string
	for _, s := range AllStates {
		if CountsAsActive(s) {
			out = append(out, string(s))
		}
	}
	return out
}
