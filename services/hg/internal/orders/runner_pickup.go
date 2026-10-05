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
	// third, 45 minutes after the order was ready). The spec's action at the cap
	// cancels the order with a full refund; that is not automated yet
	// (https://github.com/shaiknoorullah/hg-mono/issues/336), so ops must act.
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
// From the cap on, the lapse is recorded as CAP_REACHED and keeps escalating
// every 10 minutes: the order is never abandoned, and ops are told on every
// lapse until someone acts (see PickupEscalation.CapReached).
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
