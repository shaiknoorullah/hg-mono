package orders

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// DeadlineRunner is the P-15 in-process ticker. It claims due order rows with
// FOR UPDATE SKIP LOCKED, executes each row's deadline action in its own
// transaction, and either transitions (setting a new deadline or NULLing it on
// the way to terminal) or re-arms. Two replicas may run it: SKIP LOCKED plus the
// deadline_audit uniqueness on (subject, action, escalation_no) makes each
// action fire exactly once (I-15.3/4).
//
// Scheduling lives entirely in Postgres so a Redis flush cannot lose a timeout
// (P-15). There is no external orchestrator.
type DeadlineRunner struct {
	store       *Store
	pickup      PickupEscalator      // runner_pickup.go; nil re-arms a lapsed pickup only
	uncollected UncollectedCanceller // runner_pickup.go; nil keeps escalating at the cap
	log         *slog.Logger
	owner       string
	batch       int
	tick        time.Duration
	gateway     PaymentGateway
}

// NewDeadlineRunner builds a runner. owner names this worker in the lease.
func NewDeadlineRunner(store *Store, gw PaymentGateway, log *slog.Logger, owner string) *DeadlineRunner {
	if owner == "" {
		owner = "hg"
	}
	return &DeadlineRunner{store: store, gateway: gw, log: log, owner: owner, batch: 50, tick: time.Second}
}

// Run loops until ctx is cancelled, sweeping due deadlines each tick.
func (r *DeadlineRunner) Run(ctx context.Context) {
	t := time.NewTicker(r.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			n, err := r.Sweep(ctx)
			if err != nil {
				r.log.Warn("deadline sweep failed", slog.String("error", err.Error()))
			} else if n > 0 {
				r.log.Info("deadline sweep", slog.Int("fired", n))
			}
		}
	}
}

// claimedOrder is one due row claimed by the sweep.
type claimedOrder struct {
	id             string
	state          machine.State
	action         string
	escalations    int
	deadlineAt     time.Time
	prepEtaMinutes int
	acceptedAt     *time.Time
	restaurantID   string
}

// Sweep claims and fires one batch of due deadlines. It returns the number of
// rows it processed. Each row's action runs in its own transaction so one
// failure does not roll back the batch.
func (r *DeadlineRunner) Sweep(ctx context.Context) (int, error) {
	claimed, err := r.claim(ctx)
	if err != nil {
		return 0, err
	}
	for _, c := range claimed {
		if err := r.fire(ctx, c); err != nil {
			r.log.Warn("deadline action failed",
				slog.String("order_id", c.id),
				slog.String("action", c.action),
				slog.String("error", err.Error()))
		}
	}
	return len(claimed), nil
}

// claim leases a batch of due rows with FOR UPDATE SKIP LOCKED (P-15 runner
// mechanics). The lease is 30s; a crash mid-action releases it and the action
// re-runs, which is why every action is idempotent.
func (r *DeadlineRunner) claim(ctx context.Context) ([]claimedOrder, error) {
	var claimed []claimedOrder
	err := r.store.inTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			UPDATE "order" SET lease_until = now() + interval '30 seconds', lease_owner = $1
			 WHERE id IN (
				SELECT id FROM "order"
				 WHERE deadline_at IS NOT NULL AND deadline_at <= now()
				   AND (lease_until IS NULL OR lease_until < now())
				 ORDER BY deadline_at
				 FOR UPDATE SKIP LOCKED
				 LIMIT $2)
			RETURNING id, state::text, deadline_action, deadline_escalations, deadline_at,
			          COALESCE(prep_eta_minutes, 0), accepted_at, restaurant_id`,
			r.owner, r.batch)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c claimedOrder
			var stateStr string
			if err := rows.Scan(&c.id, &stateStr, &c.action, &c.escalations, &c.deadlineAt,
				&c.prepEtaMinutes, &c.acceptedAt, &c.restaurantID); err != nil {
				return err
			}
			c.state = machine.State(stateStr)
			claimed = append(claimed, c)
		}
		return rows.Err()
	})
	return claimed, err
}

// fire executes one claimed row's action. The set of actions implemented here is
// the subset the orders module owns end-to-end without a sibling: the pure
// state-machine timeouts (RESTAURANT_TIMEOUT, PREP_OVERDUE re-arm/cap,
// DELIVERY/HANDOVER re-arm, DISPUTE_SLA re-arm), EXPIRE_PAYMENT (which cancels
// the order) and the PICKUP_OVERDUE escalation (runner_pickup.go). Actions
// whose money effect belongs to a sibling
// (OFFER_RESTAURANT → dispatch, SETTLE → ledger) re-arm the deadline and record
// the audit rather than fabricating the sibling's work.
func (r *DeadlineRunner) fire(ctx context.Context, c claimedOrder) error {
	start := time.Now()
	switch c.action {
	case machine.ActionExpirePayment:
		// CREATED 15m elapsed: cancel. The PaymentIntent cancel is a payments
		// concern; the state moves to CANCELLED with PAYMENT_EXPIRED and the
		// void is the payments sibling's outbox-driven effect.
		return r.transitionExpire(ctx, c, machine.StateCancelled, "PAYMENT_EXPIRED", machine.ActionExpirePayment)

	case machine.ActionRestaurantTimeout:
		// RESTAURANT_PENDING 180s elapsed: cancel + void auth (T8).
		return r.transitionExpire(ctx, c, machine.StateCancelled, "RESTAURANT_TIMEOUT", machine.ActionRestaurantTimeout)

	case machine.ActionPrepOverdue, machine.ActionDeliveryOverdue,
		machine.ActionHandoverOverdue, machine.ActionDisputeSLABreach, machine.ActionOfferRestaurant,
		machine.ActionSettle:
		// Re-arm within the escalation cap, or drive toward the cap's terminal
		// action. The cap's terminal effect (refund, dispute, settle) belongs to
		// the ledger/dispatch siblings; until they are wired, the runner re-arms
		// and records the audit so nothing is abandoned and no money is faked.
		return r.reArm(ctx, c, start)

	case machine.ActionPickupOverdue:
		// READY_FOR_PICKUP lapsed and nobody has collected the order: escalate
		// dispatch, alert ops, tell the customer, re-arm (runner_pickup.go;
		// https://github.com/shaiknoorullah/hg-mono/issues/293).
		return r.escalatePickup(ctx, c)

	default:
		return r.fireByState(ctx, c)
	}
}

// fireByState handles a deadline whose stored action this runner does not
// know by the action the deadline table names for the order's state. Every
// non-terminal state has an action and every action has a case in fire (a
// database-backed test walks all of them), so an order can never fail its
// deadline on every pass and stay where it is. An action written outside the
// transition function, like the RIDER_NO_SHOW the restaurant's mark-ready
// wrote before #293 was fixed, is handled as its state's action and logged so
// the writer gets fixed (https://github.com/shaiknoorullah/hg-mono/issues/337).
func (r *DeadlineRunner) fireByState(ctx context.Context, c claimedOrder) error {
	spec, ok := machine.DeadlineFor(c.state)
	if !ok || spec.Action == c.action {
		return fmt.Errorf("unknown deadline action %q in state %s", c.action, c.state)
	}
	r.log.Warn("deadline action does not match the order's state; handling it as the state's action",
		slog.String("order_id", c.id), slog.String("state", string(c.state)),
		slog.String("action", c.action), slog.String("handled_as", spec.Action))
	c.action = spec.Action
	return r.fire(ctx, c)
}

// transitionExpire runs a system transition to a terminal state with a cancel
// reason, recording the deadline audit in the same transaction (exactly once).
func (r *DeadlineRunner) transitionExpire(ctx context.Context, c claimedOrder, to machine.State, reason, action string) error {
	cancelReason := reason
	return r.store.inTx(ctx, func(tx pgx.Tx) error {
		if err := r.recordAudit(ctx, tx, c, action, "TRANSITIONED"); err != nil {
			return err
		}
		return r.store.transitionTx(ctx, tx, TransitionRequest{
			OrderID: c.id, To: to, Actor: machine.ActorSystem,
			Reason: reason, CancelReason: &cancelReason,
		})
	})
}

// reArm bumps the deadline forward by the state's ReArm interval and increments
// deadline_escalations, up to the cap. At the cap it records the audit as
// CAP_REACHED and leaves the row with a fresh deadline (never abandoned); the
// terminal effect is a sibling's job and is a clearly-scoped TODO.
func (r *DeadlineRunner) reArm(ctx context.Context, c claimedOrder, start time.Time) error {
	spec, ok := machine.DeadlineFor(c.state)
	if !ok {
		return fmt.Errorf("state %s has no deadline spec", c.state)
	}
	interval := spec.ReArm
	if interval <= 0 {
		interval = spec.Offset
	}
	outcome := "RE_ARMED"
	if c.escalations+1 >= spec.EscalationCap {
		outcome = "CAP_REACHED"
	}
	next := time.Now().UTC().Add(interval)
	return r.store.inTx(ctx, func(tx pgx.Tx) error {
		if err := r.recordAudit(ctx, tx, c, c.action, outcome); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE "order"
			   SET deadline_at = $1, deadline_escalations = LEAST(deadline_escalations + 1, 32),
			       lease_until = NULL, lease_owner = NULL
			 WHERE id = $2`, next, c.id)
		return err
	})
}

// recordAudit inserts the exactly-once deadline_audit row. A duplicate insert
// (a re-run after a crash) is a no-op via ON CONFLICT DO NOTHING, which is the
// I-15.3 exactly-once assertion made a database fact.
func (r *DeadlineRunner) recordAudit(ctx context.Context, tx pgx.Tx, c claimedOrder, action, outcome string) error {
	lagMs := int(time.Since(c.deadlineAt).Milliseconds())
	_, err := tx.Exec(ctx, `
		INSERT INTO deadline_audit (subject_type, subject_id, action, escalation_no, lag_ms, outcome)
		VALUES ('order', $1, $2, $3, $4, $5)
		ON CONFLICT (subject_type, subject_id, action, escalation_no) DO NOTHING`,
		c.id, action, c.escalations, lagMs, outcome)
	return err
}

var _ = errors.Is
