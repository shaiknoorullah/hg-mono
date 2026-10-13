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

// PickupEscalation is one lapse of a ready order's pickup deadline: the order
// has been READY_FOR_PICKUP for 15 minutes (the first lapse) or for another
// 10 since the last one, and no rider has collected it.
type PickupEscalation struct {
	OrderID string
	// Lapse counts the lapses of this order's pickup deadline, from 1.
	Lapse int
	// CapReached is set from the lapse that reaches the escalation cap (the
	// third, 45 minutes after the order was ready). At the cap an order no
	// rider holds is cancelled with a full refund instead (UncollectedCanceller);
	// one a rider holds keeps escalating, for ops to decide.
	CapReached bool
	// NextDeadlineAt is when the deadline lapses again if still nobody comes.
	NextDeadlineAt time.Time
}

// PickupEscalator carries out a pickup escalation inside the deadline runner's
// transaction, so its effects commit with the audit row and the re-armed
// deadline, once per lapse. The spec's action for a lapsed READY_FOR_PICKUP is
// to escalate dispatch, alert ops and re-arm 10 minutes later
// (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions", order
// deadlines); the customer is told too, as for the other overdue orders
// (https://github.com/shaiknoorullah/hg-mono/issues/293).
//
// The orders module owns none of those effects: the dispatch search, the
// admin:ops channel and the notification outbox belong to their own modules,
// so cmd/hg composes them behind this one seam, the same way it composes the
// realtime emitter.
type PickupEscalator interface {
	EscalatePickup(ctx context.Context, tx pgx.Tx, e PickupEscalation) error
}

// UncollectedCanceller ends a ready order nobody collected, at the pickup
// escalation cap: the order is cancelled (T13, NO_RIDER_FOUND), the customer
// is refunded in full, the restaurant is paid in full and the platform absorbs
// the cost (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions",
// the READY_FOR_PICKUP row and acceptance criterion 5;
// https://github.com/shaiknoorullah/hg-mono/issues/336).
//
// CancelUncollectedTx runs in the deadline runner's transaction, before the
// order moves to CANCELLED: it closes the search for a rider and posts the
// refund, so the refund, the cancellation and the events that announce both
// commit together. It reports false, having changed nothing, when a rider
// holds the order; the escalation then carries on. Like PickupEscalator, the
// effects belong to the dispatch and payments modules, so cmd/hg composes them.
type UncollectedCanceller interface {
	CancelUncollectedTx(ctx context.Context, tx pgx.Tx, orderID string) (bool, error)
}

// WithUncollectedCanceller attaches the cap's cancellation. With none attached
// the cap keeps escalating, as before: an order is never cancelled without its
// refund.
func (r *DeadlineRunner) WithUncollectedCanceller(c UncollectedCanceller) *DeadlineRunner {
	r.uncollected = c
	return r
}

// WithPickupEscalator attaches the effects of a lapsed pickup deadline. With
// none attached, a lapse is still audited and re-armed, never left to fail.
func (r *DeadlineRunner) WithPickupEscalator(e PickupEscalator) *DeadlineRunner {
	r.pickup = e
	return r
}

// escalatePickup handles PICKUP_OVERDUE: a ready order nobody has collected.
// In one transaction it re-checks the order under its row lock, records the
// deadline_audit row, runs the escalation's effects and re-arms the deadline
// 10 minutes on. The re-check is what makes a lapse escalate exactly once: the
// order must still be READY_FOR_PICKUP, with the escalation count the claim
// saw, and a deadline that has passed. A rider who picked the order up in the
// meantime, or a second run of the same claim, finds nothing to do.
//
// At the cap, an order no rider holds is cancelled with a full refund
// (UncollectedCanceller), recorded as TRANSITIONED. One a rider holds, or any
// order when no canceller is attached, is recorded as CAP_REACHED and keeps
// escalating every 10 minutes: the order is never abandoned, and ops are told
// on every lapse until someone acts.
func (r *DeadlineRunner) escalatePickup(ctx context.Context, c claimedOrder) error {
	spec, _ := machine.DeadlineFor(machine.StateReadyForPickup)
	return r.store.inTx(ctx, func(tx pgx.Tx) error {
		var now time.Time
		err := tx.QueryRow(ctx, `
			SELECT now() FROM "order"
			 WHERE id = $1 AND state = 'READY_FOR_PICKUP'
			   AND deadline_escalations = $2 AND deadline_at <= now()
			 FOR UPDATE`, c.id, c.escalations).Scan(&now)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("lock ready order: %w", err)
		}

		e := PickupEscalation{
			OrderID:        c.id,
			Lapse:          c.escalations + 1,
			CapReached:     c.escalations+1 >= spec.EscalationCap,
			NextDeadlineAt: now.Add(spec.ReArm),
		}
		if e.CapReached && r.uncollected != nil {
			cancelled, err := r.cancelUncollected(ctx, tx, c)
			if err != nil || cancelled {
				return err
			}
		}
		outcome := "RE_ARMED"
		if e.CapReached {
			outcome = "CAP_REACHED"
		}
		if err := r.recordAudit(ctx, tx, c, machine.ActionPickupOverdue, outcome); err != nil {
			return err
		}
		if r.pickup != nil {
			if err := r.pickup.EscalatePickup(ctx, tx, e); err != nil {
				return fmt.Errorf("escalate pickup: %w", err)
			}
		} else {
			r.log.Warn("pickup deadline lapsed with no escalator wired; re-armed only",
				slog.String("order_id", c.id), slog.Int("lapse", e.Lapse))
		}
		// deadline_action is written too: an order marked ready before #293 was
		// fixed carries RIDER_NO_SHOW, and from here on it carries the action
		// the deadline table names.
		_, err = tx.Exec(ctx, `
			UPDATE "order"
			   SET deadline_at = $2, deadline_action = $3,
			       deadline_escalations = LEAST(deadline_escalations + 1, 32),
			       lease_until = NULL, lease_owner = NULL
			 WHERE id = $1`, c.id, e.NextDeadlineAt, machine.ActionPickupOverdue)
		return err
	})
}

// cancelUncollected is the cap's action for an order no rider holds: the
// refund and the closed search first, then the one transition function moves
// the order to CANCELLED, so order.cancelled carries the refund. It reports
// false when a rider holds the order.
func (r *DeadlineRunner) cancelUncollected(ctx context.Context, tx pgx.Tx, c claimedOrder) (bool, error) {
	ok, err := r.uncollected.CancelUncollectedTx(ctx, tx, c.id)
	if err != nil {
		return false, fmt.Errorf("cancel uncollected order: %w", err)
	}
	if !ok {
		return false, nil
	}
	if err := r.recordAudit(ctx, tx, c, machine.ActionPickupOverdue, "TRANSITIONED"); err != nil {
		return false, err
	}
	reason := noRiderFound
	return true, r.store.transitionTx(ctx, tx, TransitionRequest{
		OrderID: c.id, To: machine.StateCancelled, Actor: machine.ActorSystem,
		Reason: "no rider collected the order by the pickup escalation cap", CancelReason: &reason,
	})
}

// noRiderFound is the order's cancel reason and the refund's reason code.
const noRiderFound = "NO_RIDER_FOUND"
