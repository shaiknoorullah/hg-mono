package dispatch

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// A rider whose assignment ended without a delivery no longer holds the order:
// the dispatch row stops naming them in the transaction that ended it, and
// dispatch.unassigned on order:{id} tells the customer and the restaurant,
// and makes the gateway re-check the rider's subscription, which now fails,
// so the rider is unsubscribed with no_longer_authorized
// (contracts/websocket.md, "Re-validation";
// https://github.com/shaiknoorullah/hg-mono/issues/415). Before, the row kept
// naming the rider, who stayed subscribed to the order and showed to the
// customer as assigned.

// releaseRiderTx takes the order's dispatch row off riderAccountID. An order
// still waiting to be collected is searched for again from the nearest
// radius, as ResumeSearchTx does; the rider who just let it go is not offered
// it again (their offer is ACCEPTED, which the candidate query excludes). Any
// other order (picked up and returned, cancelled, finished) needs no rider, and
// the row ends in NO_RIDER_FOUND. A row that does not name the rider is left
// alone.
func releaseRiderTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID, reason string) error {
	var from, orderState string
	err := tx.QueryRow(ctx, `
SELECT d.state::text, o.state::text
  FROM dispatch d JOIN "order" o ON o.id = d.order_id
 WHERE d.order_id = $1 AND d.rider_account_id = $2
   FOR UPDATE OF d`, orderID, riderAccountID).Scan(&from, &orderState)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("lock dispatch: %w", err)
	}
	var to string
	var at time.Time
	if orderState == "PREPARING" || orderState == "READY_FOR_PICKUP" {
		to = "SEARCHING"
		err = tx.QueryRow(ctx, `
UPDATE dispatch
   SET state = 'SEARCHING', rider_account_id = NULL, pickup_eta_at = NULL, state_since = now(),
       radius_m = $2, deadline_at = now(), deadline_action = 'NEXT_WAVE',
       lease_until = NULL, lease_owner = NULL
 WHERE order_id = $1
RETURNING state_since`, orderID, radiusLadderM[0]).Scan(&at)
	} else {
		to = "NO_RIDER_FOUND"
		err = tx.QueryRow(ctx, `
UPDATE dispatch
   SET state = 'NO_RIDER_FOUND', rider_account_id = NULL, pickup_eta_at = NULL, state_since = now(),
       deadline_at = NULL, deadline_action = NULL, lease_until = NULL, lease_owner = NULL
 WHERE order_id = $1
RETURNING state_since`, orderID).Scan(&at)
	}
	if err != nil {
		return fmt.Errorf("release the rider: %w", err)
	}
	if err := realtime.EmitOrder(ctx, tx, orderID, realtime.DispatchUnassigned{OrderID: orderID, Reason: reason}); err != nil {
		return err
	}
	return emitDispatchState(ctx, tx, orderID, from, to, at)
}

// ReleaseCancelledOrderTx is the dispatch half of an order's cancellation, run
// in the transaction that cancels it. A live assignment ends
// CANCELLED_BY_PLATFORM, its rider is available again and the dispatch row
// stops naming them (releaseRiderTx); a search with no rider yet is closed and
// its waiting offers withdrawn. The orders module calls it through
// orders.OrderCancelled, wired in cmd/hg, so orders never imports dispatch.
func ReleaseCancelledOrderTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	var asnID, rider, state string
	err := tx.QueryRow(ctx, `
SELECT id::text, rider_account_id::text, state::text FROM assignment
 WHERE order_id = $1 AND terminated_at IS NULL
   FOR UPDATE`, orderID).Scan(&asnID, &rider, &state)
	switch {
	case err == nil:
		if _, err := tx.Exec(ctx, `
UPDATE assignment SET state = 'CANCELLED_BY_PLATFORM', state_since = now(), terminated_at = now()
 WHERE id = $1`, asnID); err != nil {
			return fmt.Errorf("end the assignment: %w", err)
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO assignment_transition (assignment_id, from_state, to_state, actor_kind, reason)
VALUES ($1, $2, 'CANCELLED_BY_PLATFORM', 'SYSTEM', 'order cancelled')`, asnID, state); err != nil {
			return fmt.Errorf("record the assignment's end: %w", err)
		}
		if err := restoreAvailabilityTx(ctx, tx, rider); err != nil {
			return err
		}
		if err := releaseRiderTx(ctx, tx, orderID, rider, "order_cancelled"); err != nil {
			return err
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("lock the live assignment: %w", err)
	}

	var from string
	var at time.Time
	err = tx.QueryRow(ctx, `
WITH prev AS (
  SELECT state FROM dispatch
   WHERE order_id = $1 AND rider_account_id IS NULL AND state NOT IN ('COMPLETED', 'NO_RIDER_FOUND')
     FOR UPDATE)
UPDATE dispatch d
   SET state = 'NO_RIDER_FOUND', state_since = now(), deadline_at = NULL, deadline_action = NULL,
       lease_until = NULL, lease_owner = NULL
  FROM prev
 WHERE d.order_id = $1
RETURNING prev.state::text, d.state_since`, orderID).Scan(&from, &at)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return fmt.Errorf("close the search: %w", err)
	default:
		if err := emitDispatchState(ctx, tx, orderID, from, "NO_RIDER_FOUND", at); err != nil {
			return err
		}
	}
	rows, err := tx.Query(ctx, `
UPDATE dispatch_offer
   SET state = 'WITHDRAWN', outcome = 'WITHDRAWN', outcome_at = now()
 WHERE order_id = $1 AND state = 'PENDING'
RETURNING id::text, order_id::text, rider_account_id::text`, orderID)
	if err != nil {
		return fmt.Errorf("withdraw offers: %w", err)
	}
	withdrawn, err := scanWithdrawn(rows)
	if err != nil {
		return err
	}
	return emitWithdrawn(ctx, tx, withdrawn, realtime.DispatchWithdrawnCancelled)
}
