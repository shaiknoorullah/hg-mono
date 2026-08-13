package machine

import "time"

// DeadlineSpec is the P-15 deadline rule for a non-terminal state: the named
// action the runner fires, the offset from the anchoring timestamp, and the
// escalation cap. A terminal state has no DeadlineSpec — its deadline_at and
// deadline_action are NULL, enforced by the order_deadline_required CHECK.
type DeadlineSpec struct {
	// Action is the deadline_action string persisted on the order and fired by
	// the runner. It is idempotency-keyed by (order_id, state, escalation_no).
	Action string
	// Offset is added to the anchor time to compute deadline_at on entry.
	Offset time.Duration
	// EscalationCap is the number of re-arms permitted before the terminal
	// action fires; 0 means the first firing is terminal (no re-arm).
	EscalationCap int
	// ReArm is the interval added on each escalation when the action re-arms
	// rather than transitions. Zero when the action always transitions.
	ReArm time.Duration
}

// Deadline action names (P-15). These are the deadline_action column values.
const (
	ActionExpirePayment     = "EXPIRE_PAYMENT"
	ActionOfferRestaurant   = "OFFER_RESTAURANT"
	ActionRestaurantTimeout = "RESTAURANT_TIMEOUT"
	ActionPrepOverdue       = "PREP_OVERDUE"
	ActionPickupOverdue     = "PICKUP_OVERDUE"
	ActionDeliveryOverdue   = "DELIVERY_OVERDUE"
	ActionHandoverOverdue   = "HANDOVER_OVERDUE"
	ActionSettle            = "SETTLE"
	ActionDisputeSLABreach  = "DISPUTE_SLA_BREACH"
)

// deadlines is the P-15 order deadline table. The launch offsets are from
// docs/spec (and the orders doc.go summary): CREATED 15m, AUTHORIZED 60s,
// RESTAURANT_PENDING 180s, PREPARING prep_eta+10m (computed by the caller from
// the anchor; the base offset here is the +10m tail applied on top of the prep
// window), READY_FOR_PICKUP 15m, PICKED_UP 75m (never auto-delivers), ARRIVED
// 15m, DELIVERED 2m (settle, backoff), DISPUTED 48h.
//
// PREPARING is special: its deadline_at is accepted_at + prep_eta_minutes +
// 10m, so its base offset cannot be a constant. The caller supplies the prep
// window; PrepDeadlineOffset composes it.
var deadlines = map[State]DeadlineSpec{
	StateCreated:           {Action: ActionExpirePayment, Offset: 15 * time.Minute, EscalationCap: 0},
	StateAuthorized:        {Action: ActionOfferRestaurant, Offset: 60 * time.Second, EscalationCap: 3, ReArm: 60 * time.Second},
	StateRestaurantPending: {Action: ActionRestaurantTimeout, Offset: 180 * time.Second, EscalationCap: 0},
	StatePreparing:         {Action: ActionPrepOverdue, Offset: 10 * time.Minute, EscalationCap: 3, ReArm: 10 * time.Minute},
	StateReadyForPickup:    {Action: ActionPickupOverdue, Offset: 15 * time.Minute, EscalationCap: 3, ReArm: 10 * time.Minute},
	StatePickedUp:          {Action: ActionDeliveryOverdue, Offset: 75 * time.Minute, EscalationCap: 3, ReArm: 15 * time.Minute},
	StateArrived:           {Action: ActionHandoverOverdue, Offset: 15 * time.Minute, EscalationCap: 2, ReArm: 10 * time.Minute},
	StateDelivered:         {Action: ActionSettle, Offset: 2 * time.Minute, EscalationCap: 8, ReArm: 2 * time.Minute},
	StateDisputed:          {Action: ActionDisputeSLABreach, Offset: 48 * time.Hour, EscalationCap: 3, ReArm: 24 * time.Hour},
}

// DeadlineFor returns the deadline spec for a non-terminal state. ok is false
// for a terminal state, which must be committed with NULL deadline columns.
func DeadlineFor(s State) (DeadlineSpec, bool) {
	d, ok := deadlines[s]
	return d, ok
}

// PrepWindow composes the PREPARING deadline offset from the restaurant's prep
// ETA: prep_eta_minutes + the +10m tail from the table. accepted_at + this is
// deadline_at (P-15).
func PrepWindow(prepEtaMinutes int) time.Duration {
	if prepEtaMinutes < 0 {
		prepEtaMinutes = 0
	}
	return time.Duration(prepEtaMinutes)*time.Minute + deadlines[StatePreparing].Offset
}

// ComputeDeadline returns the deadline_at for a state entered at anchor, and the
// deadline_action, or ok=false for a terminal state (NULL deadline).
//
// prepEtaMinutes is used only for PREPARING; it is ignored for every other
// state. A caller entering PREPARING passes the accepted restaurant's prep ETA.
func ComputeDeadline(s State, anchor time.Time, prepEtaMinutes int) (deadlineAt time.Time, action string, ok bool) {
	spec, has := deadlines[s]
	if !has {
		return time.Time{}, "", false
	}
	if s == StatePreparing {
		return anchor.Add(PrepWindow(prepEtaMinutes)), spec.Action, true
	}
	return anchor.Add(spec.Offset), spec.Action, true
}
