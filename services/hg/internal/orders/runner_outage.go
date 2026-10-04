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

// Outage handling for the deadline runner — docs/spec/01-platform.md, "P-15 —
// Deadlines and timeout actions", "Outages".
//
// Without it, every deadline that fell while no runner was running (a
// failover, a restore, a reboot, a crash) fires at once on restart as if the
// restaurant or the rider had missed it. With it:
//
//   - every tick writes a heartbeat row;
//   - a runner that finds the newest heartbeat of any runner more than
//     OutageThreshold old records the gap as a deadline_outage window and
//     alerts ops;
//   - a due row whose deadline_at lies inside a window takes the outage path:
//     an order not yet accepted is cancelled as a platform error (its
//     authorisation is voided, and nothing counts against the restaurant); an
//     accepted, paid order fires once without using up an escalation and
//     re-arms from now;
//   - every outage action is tagged with its outage in deadline_audit.
//
// Every non-terminal order still carries a deadline afterwards: the cancel goes
// through the one transition function, and the re-arm writes a new
// deadline_at. The order_deadline_required CHECK refuses anything else.

// OutageThreshold is how old the newest heartbeat may be before the gap counts
// as an outage. A crash-restart of one replica, or a rolling deploy, stays well
// under it; deadlines missed in such a short gap fire normally.
const OutageThreshold = 2 * time.Minute

// Outcomes written to deadline_audit by the outage path. The schema requires
// outage_id on exactly the rows whose outcome starts with OUTAGE_.
const (
	outcomeOutageVoided  = "OUTAGE_VOIDED"
	outcomeOutageReArmed = "OUTAGE_RE_ARMED"
)

// outageCancelReason is the order_cancellation_reason_code an outage void
// writes. It is the platform's fault, not the restaurant's, so nothing derived
// from RESTAURANT_TIMEOUT (the acceptance rate) counts it.
const outageCancelReason = "PLATFORM_ERROR"

// OpsAlert is one admin.alert event on the admin:ops channel
// (contracts/websocket.md, "Admin — channel admin:ops").
type OpsAlert struct {
	Severity    string
	Kind        string
	SubjectType string
	SubjectID   string
	Message     string
	At          time.Time
}

// OpsAlerter writes an ops alert inside the caller's transaction, so the alert
// exists if and only if the outage record it describes committed. The concrete
// implementation lives in cmd/hg/main.go and writes the realtime outbox; this
// package declares only the interface so it never imports realtime.
type OpsAlerter interface {
	AlertOps(ctx context.Context, tx pgx.Tx, a OpsAlert) error
}

// WithHold makes Run wait, without a heartbeat or a sweep, until ops inserts a
// deadline_runner_release row (HG_DEADLINE_RUNNER_HOLD). A failover starts the
// runner held, runs its catch-up, then releases it; the gap is then handled by
// the outage path, so nobody edits deadline_at by hand.
func (r *DeadlineRunner) WithHold(hold bool) *DeadlineRunner {
	r.hold = hold
	return r
}

// WithOpsAlerter attaches the admin:ops alerter.
func (r *DeadlineRunner) WithOpsAlerter(a OpsAlerter) *DeadlineRunner {
	r.alerter = a
	return r
}

// waitForRelease blocks until a release row newer than the moment the hold
// began exists. It returns false if ctx ends first.
func (r *DeadlineRunner) waitForRelease(ctx context.Context) bool {
	var since time.Time
	held := false
	t := time.NewTicker(r.tick)
	defer t.Stop()
	for {
		if !held {
			// The hold is measured on the database clock, the same clock the
			// release row is stamped with.
			if err := r.store.pool.QueryRow(ctx, `SELECT now()`).Scan(&since); err == nil {
				held = true
				r.log.Warn("deadline runner held: no deadline fires until it is released",
					slog.String("owner", r.owner),
					slog.String("release", "INSERT INTO deadline_runner_release (released_by, reason) VALUES ('<who>', '<why>')"))
			}
		} else {
			var released bool
			err := r.store.pool.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM deadline_runner_release WHERE released_at >= $1)`, since).Scan(&released)
			if err == nil && released {
				r.log.Info("deadline runner released", slog.String("owner", r.owner))
				return true
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-t.C:
		}
	}
}

// beat writes this runner's heartbeat. Before it does, it looks at the newest
// heartbeat of any runner: if that is older than outageAfter, the gap between
// it and now is recorded as an outage first, in the same transaction. One
// replica restarting while another keeps beating is therefore not an outage.
func (r *DeadlineRunner) beat(ctx context.Context) error {
	return r.store.inTx(ctx, func(tx pgx.Tx) error {
		var last *time.Time
		var now time.Time
		if err := tx.QueryRow(ctx, `SELECT max(beat_at), now() FROM deadline_runner_heartbeat`).
			Scan(&last, &now); err != nil {
			return fmt.Errorf("read heartbeat: %w", err)
		}
		if last != nil && now.Sub(*last) > r.outageAfter {
			if err := r.recordOutage(ctx, tx, *last, now); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO deadline_runner_heartbeat (owner, beat_at) VALUES ($1, now())
			ON CONFLICT (owner) DO UPDATE SET beat_at = EXCLUDED.beat_at`, r.owner)
		if err != nil {
			return fmt.Errorf("write heartbeat: %w", err)
		}
		return nil
	})
}

// recordOutage inserts the (gapStart, gapEnd] window and alerts ops. When two
// runners come back together, the window's no-overlap constraint lets only the
// first insert through; the other finds nothing to do.
func (r *DeadlineRunner) recordOutage(ctx context.Context, tx pgx.Tx, gapStart, gapEnd time.Time) error {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO deadline_outage (gap_start, gap_end, detected_by) VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
		RETURNING id::text`, gapStart, gapEnd, r.owner).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("record outage: %w", err)
	}

	var affected int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM "order" WHERE deadline_at > $1 AND deadline_at <= $2`,
		gapStart, gapEnd).Scan(&affected); err != nil {
		return fmt.Errorf("count outage deadlines: %w", err)
	}

	gap := gapEnd.Sub(gapStart).Round(time.Second)
	msg := fmt.Sprintf("No deadline runner ran for %s (last heartbeat %s). %d order deadline(s) fell in the gap "+
		"and are handled as outage actions: orders not yet accepted are cancelled as a platform error, "+
		"paid orders fire once without using an escalation and re-arm from now.",
		gap, gapStart.UTC().Format(time.RFC3339), affected)
	r.log.Error("deadline outage recorded",
		slog.String("outage_id", id), slog.Duration("gap", gap), slog.Int("affected_orders", affected))

	if r.alerter == nil {
		return nil
	}
	return r.alerter.AlertOps(ctx, tx, OpsAlert{
		Severity:    "CRITICAL",
		Kind:        "DEADLINE_OUTAGE",
		SubjectType: "deadline_outage",
		SubjectID:   id,
		Message:     msg,
		At:          gapEnd,
	})
}

// fireOutage is the outage path for one claimed row whose deadline fell inside
// a recorded outage.
func (r *DeadlineRunner) fireOutage(ctx context.Context, c claimedOrder) error {
	if awaitingAcceptance(c.state) {
		// Authorise then capture: an order the restaurant has not accepted has
		// not been captured, so cancelling it voids the authorisation and no
		// refund is involved (AGENTS.md, "Non-negotiable invariants").
		return r.transitionWithAudit(ctx, c, machine.StateCancelled, outageCancelReason,
			"deadline fell during a platform outage", c.action, outcomeOutageVoided)
	}
	return r.reArmAfterOutage(ctx, c)
}

// awaitingAcceptance reports whether an order is still before the restaurant's
// acceptance, the point at which payment is captured.
func awaitingAcceptance(s machine.State) bool {
	switch s {
	case machine.StateCreated, machine.StateAuthorized, machine.StateRestaurantPending:
		return true
	}
	return false
}

// reArmAfterOutage fires a paid order's action once and re-arms it from now,
// leaving deadline_escalations where it was: the outage, not the restaurant or
// the rider, used that time.
func (r *DeadlineRunner) reArmAfterOutage(ctx context.Context, c claimedOrder) error {
	spec, ok := machine.DeadlineFor(c.state)
	if !ok {
		return fmt.Errorf("state %s has no deadline spec", c.state)
	}
	interval := spec.ReArm
	if interval <= 0 {
		interval = spec.Offset
	}
	next := time.Now().UTC().Add(interval)
	return r.store.inTx(ctx, func(tx pgx.Tx) error {
		if err := r.recordAudit(ctx, tx, c, c.action, outcomeOutageReArmed); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE "order"
			   SET deadline_at = $1, lease_until = NULL, lease_owner = NULL
			 WHERE id = $2`, next, c.id)
		return err
	})
}
