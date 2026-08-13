// Package machine is the compile-time model of the P-14 order state machine and
// the P-15 deadline table. It is pure data and pure functions: no database, no
// HTTP. The store layer owns the SELECT ... FOR UPDATE and the single UPDATE of
// order.state; this package answers "is this pair legal, who may trigger it, and
// what deadline does the destination carry".
//
// One enum, fourteen states, five terminal (P-14). The transition table below
// is the authoritative 21-row table from the spec; a test asserts that exactly
// those ordered pairs are permitted and every other pair is rejected.
package machine

// State is a member of the contract's OrderState enum. The customer and
// restaurant display vocabularies are mappings elsewhere; this is the only order
// state that appears on the wire.
type State string

const (
	StateCreated           State = "CREATED"
	StateAuthorized        State = "AUTHORIZED"
	StateRestaurantPending State = "RESTAURANT_PENDING"
	StatePreparing         State = "PREPARING"
	StateReadyForPickup    State = "READY_FOR_PICKUP"
	StatePickedUp          State = "PICKED_UP"
	StateArrived           State = "ARRIVED"
	StateDelivered         State = "DELIVERED"
	StateCompleted         State = "COMPLETED"
	StateCancelled         State = "CANCELLED"
	StateRejected          State = "REJECTED"
	StateFailed            State = "FAILED"
	StateDisputed          State = "DISPUTED"
	StateResolved          State = "RESOLVED"
)

// AllStates is every order state, in enum order. Used by the exhaustive
// transition test.
var AllStates = []State{
	StateCreated, StateAuthorized, StateRestaurantPending, StatePreparing,
	StateReadyForPickup, StatePickedUp, StateArrived, StateDelivered,
	StateCompleted, StateCancelled, StateRejected, StateFailed,
	StateDisputed, StateResolved,
}

// terminal is the set of states that never transition again (I-14.6). DISPUTED
// is deliberately not here: it is non-terminal and carries a 48h deadline.
var terminal = map[State]bool{
	StateCompleted: true,
	StateCancelled: true,
	StateRejected:  true,
	StateFailed:    true,
	StateResolved:  true,
}

// IsTerminal reports whether a state is terminal (carries no deadline).
func IsTerminal(s State) bool { return terminal[s] }

// ActorKind is a member of the contract's OrderActorKind enum. It is who may
// trigger a transition; SYSTEM means the deadline runner or a webhook, never a
// client.
type ActorKind string

const (
	ActorCustomer   ActorKind = "CUSTOMER"
	ActorRestaurant ActorKind = "RESTAURANT"
	ActorRider      ActorKind = "RIDER"
	ActorSupport    ActorKind = "SUPPORT"
	ActorAdmin      ActorKind = "ADMIN"
	ActorSystem     ActorKind = "SYSTEM"
)

// Transition is one edge of the machine. Actors is the set of actor kinds
// permitted to trigger it; Action is the P-05 permission a non-system actor must
// hold (empty when only SYSTEM triggers it).
type Transition struct {
	From    State
	To      State
	Actors  []ActorKind
	Action  string // authz.Action string; "" ⇒ system-only edge
	MoneyFX string // documentation of the money effect (P-14 table)
}

// table is the authoritative P-14 transition table (T1..T21). Where the spec
// lists two rows with the same (from,to) but different triggers/actors (T15/T16,
// T17/T19/T21), they are merged into one edge whose Actors is the union — the
// legality of the pair is what this package answers, and the runner distinguishes
// the trigger by the deadline action or the calling handler.
var table = []Transition{
	{From: StateCreated, To: StateAuthorized, Actors: []ActorKind{ActorSystem}, MoneyFX: "funds held"},                                                                       // T1
	{From: StateCreated, To: StateFailed, Actors: []ActorKind{ActorSystem}, MoneyFX: "none"},                                                                                 // T2
	{From: StateCreated, To: StateCancelled, Actors: []ActorKind{ActorCustomer, ActorSystem}, Action: ActionCancel, MoneyFX: "PI cancelled"},                                 // T3
	{From: StateAuthorized, To: StateRestaurantPending, Actors: []ActorKind{ActorSystem}, MoneyFX: "none"},                                                                   // T4
	{From: StateAuthorized, To: StateCancelled, Actors: []ActorKind{ActorSystem, ActorCustomer}, Action: ActionCancel, MoneyFX: "auth voided"},                               // T5/T9-early
	{From: StateRestaurantPending, To: StatePreparing, Actors: []ActorKind{ActorRestaurant}, Action: ActionAccept, MoneyFX: "capture"},                                       // T6
	{From: StateRestaurantPending, To: StateRejected, Actors: []ActorKind{ActorRestaurant}, Action: ActionReject, MoneyFX: "auth voided"},                                    // T7
	{From: StateRestaurantPending, To: StateCancelled, Actors: []ActorKind{ActorSystem, ActorCustomer}, Action: ActionCancel, MoneyFX: "auth voided"},                        // T8/T9
	{From: StatePreparing, To: StateReadyForPickup, Actors: []ActorKind{ActorRestaurant}, Action: ActionMarkReady, MoneyFX: "none"},                                          // T10
	{From: StatePreparing, To: StateCancelled, Actors: []ActorKind{ActorSupport, ActorAdmin, ActorSystem}, Action: ActionCancelSupport, MoneyFX: "refund per policy"},        // T11
	{From: StateReadyForPickup, To: StatePickedUp, Actors: []ActorKind{ActorRider}, Action: ActionConfirmPickup, MoneyFX: "none"},                                            // T12
	{From: StateReadyForPickup, To: StateCancelled, Actors: []ActorKind{ActorSystem}, MoneyFX: "refund customer, pay restaurant"},                                            // T13
	{From: StatePickedUp, To: StateArrived, Actors: []ActorKind{ActorRider, ActorSystem}, Action: ActionAdvanceDelivery, MoneyFX: "none"},                                    // T14
	{From: StatePickedUp, To: StateDelivered, Actors: []ActorKind{ActorRider}, Action: ActionCompleteDelivery, MoneyFX: "none"},                                              // T15
	{From: StateArrived, To: StateDelivered, Actors: []ActorKind{ActorRider}, Action: ActionCompleteDelivery, MoneyFX: "none"},                                               // T16
	{From: StatePickedUp, To: StateDisputed, Actors: []ActorKind{ActorSupport, ActorAdmin}, Action: ActionOpenDispute, MoneyFX: "none yet"},                                  // T17
	{From: StateArrived, To: StateDisputed, Actors: []ActorKind{ActorSupport, ActorAdmin}, Action: ActionOpenDispute, MoneyFX: "none yet"},                                   // T17
	{From: StateDelivered, To: StateCompleted, Actors: []ActorKind{ActorSystem}, MoneyFX: "settle"},                                                                          // T18
	{From: StateDelivered, To: StateDisputed, Actors: []ActorKind{ActorCustomer, ActorRestaurant, ActorSupport, ActorAdmin}, Action: ActionOpenDispute, MoneyFX: "none yet"}, // T19
	{From: StateCompleted, To: StateDisputed, Actors: []ActorKind{ActorCustomer, ActorRestaurant, ActorSupport, ActorAdmin}, Action: ActionOpenDispute, MoneyFX: "none yet"}, // T19
	{From: StateDisputed, To: StateResolved, Actors: []ActorKind{ActorSupport, ActorAdmin, ActorSystem}, Action: ActionResolveDispute, MoneyFX: "refund + adjustment batch"}, // T20
	{From: StatePreparing, To: StateDisputed, Actors: []ActorKind{ActorRestaurant}, Action: ActionOpenDispute, MoneyFX: "none yet"},                                          // T21
	{From: StateReadyForPickup, To: StateDisputed, Actors: []ActorKind{ActorRestaurant}, Action: ActionOpenDispute, MoneyFX: "none yet"},                                     // T21
}

// P-05 action strings owned by this module. They are the authz.Action values a
// non-system actor must hold to trigger the corresponding edge. The auth
// sibling's role→action matrix maps roles to these.
const (
	ActionCancel           = "order.cancel"
	ActionCancelSupport    = "order.cancel_support"
	ActionAccept           = "order.accept"
	ActionReject           = "order.reject"
	ActionMarkReady        = "order.mark_ready"
	ActionConfirmPickup    = "dispatch.confirm_pickup"
	ActionAdvanceDelivery  = "dispatch.advance"
	ActionCompleteDelivery = "dispatch.complete"
	ActionOpenDispute      = "order.open_dispute"
	ActionResolveDispute   = "dispute.resolve"
)

// index maps (from,to) to the transition for O(1) legality checks. Where two
// rows share a (from,to) their Actors are unioned into one index entry.
var index = func() map[[2]State]Transition {
	m := make(map[[2]State]Transition, len(table))
	for _, t := range table {
		key := [2]State{t.From, t.To}
		if existing, ok := m[key]; ok {
			existing.Actors = unionActors(existing.Actors, t.Actors)
			m[key] = existing
			continue
		}
		m[key] = t
	}
	return m
}()

func unionActors(a, b []ActorKind) []ActorKind {
	seen := map[ActorKind]bool{}
	out := make([]ActorKind, 0, len(a)+len(b))
	for _, x := range append(append([]ActorKind{}, a...), b...) {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// Lookup returns the transition for (from,to) and whether it exists.
func Lookup(from, to State) (Transition, bool) {
	t, ok := index[[2]State{from, to}]
	return t, ok
}

// AllowedFrom returns the destination states reachable from a state, in enum
// order, for the illegal_transition error's "allowed" list.
func AllowedFrom(from State) []State {
	var out []State
	for _, s := range AllStates {
		if _, ok := index[[2]State{from, s}]; ok {
			out = append(out, s)
		}
	}
	return out
}

// ActorPermitted reports whether an actor kind may trigger the (from,to) edge.
func (t Transition) ActorPermitted(a ActorKind) bool {
	for _, x := range t.Actors {
		if x == a {
			return true
		}
	}
	return false
}
