package catalog

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// staleHeartbeat is the R-22 heartbeat gate: a restaurant whose order screen has
// not checked in for 5 minutes computes to CLOSED_OFFLINE.
const staleHeartbeat = 5 * time.Minute

// availabilityRow is the restaurant-facing trading state read straight from the
// row (R-22). open_state is derived from these fields, never stored.
type availabilityRow struct {
	accountState      string
	isAcceptingOrders bool
	pauseUntil        *time.Time
	lastHeartbeatAt   *time.Time
	missedOrderCount  int32
	timezone          string
}

// getAvailability loads the trading state for a restaurant by id.
func (rp *Repo) getAvailability(ctx context.Context, restaurantID string) (availabilityRow, error) {
	const q = `
		SELECT account_state::text, is_accepting_orders, pause_until,
		       last_heartbeat_at, missed_order_count, timezone
		  FROM restaurant
		 WHERE id = $1::uuid AND deleted_at IS NULL`
	var a availabilityRow
	err := rp.db.QueryRow(ctx, q, restaurantID).Scan(
		&a.accountState, &a.isAcceptingOrders, &a.pauseUntil,
		&a.lastHeartbeatAt, &a.missedOrderCount, &a.timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return availabilityRow{}, errNotFound
	}
	return a, err
}

// setAcceptingOrders flips the master switch and reads the row back after the
// write (R-22): the response is the persisted row, so a no-op is impossible to
// mistake for a success. pause_until is ignored when accepting is false.
//
// The restaurant's tablets hear of it in the same transaction:
// restaurant.status_changed on restaurant:{id}, with the open state the change
// produces and the staff member who made it (contracts/websocket.md section
// 4.4; https://github.com/shaiknoorullah/hg-mono/issues/247).
func (rp *Repo) setAcceptingOrders(ctx context.Context, restaurantID string, accepting bool, pauseUntil *time.Time, changedBy string, now time.Time) (availabilityRow, error) {
	var pause *time.Time
	if accepting {
		pause = pauseUntil
	}
	tx, err := rp.db.Begin(ctx)
	if err != nil {
		return availabilityRow{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	const q = `
		UPDATE restaurant
		   SET is_accepting_orders = $2,
		       pause_until = $3
		 WHERE id = $1::uuid AND deleted_at IS NULL
		 RETURNING account_state::text, is_accepting_orders, pause_until,
		           last_heartbeat_at, missed_order_count, timezone`
	var a availabilityRow
	err = tx.QueryRow(ctx, q, restaurantID, accepting, pause).Scan(
		&a.accountState, &a.isAcceptingOrders, &a.pauseUntil,
		&a.lastHeartbeatAt, &a.missedOrderCount, &a.timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return availabilityRow{}, errNotFound
	}
	if err != nil {
		return availabilityRow{}, err
	}
	verdict := deriveOpenState(a, now, true, false)
	// The staff member who flipped the switch, by display name ("Hamza K.").
	by, err := realtime.StaffName(ctx, tx, changedBy)
	if err != nil {
		return availabilityRow{}, err
	}
	reason := verdict.reason
	if err := realtime.EmitRestaurant(ctx, tx, restaurantID, nil, realtime.RestaurantStatusChanged{
		RestaurantID: restaurantID, IsAcceptingOrders: a.isAcceptingOrders,
		OpenState: contract.RestaurantOpenState(verdict.state), Reason: &reason, ChangedBy: by,
	}); err != nil {
		return availabilityRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return availabilityRow{}, err
	}
	return a, nil
}

// recordHeartbeat stamps last_heartbeat_at = now() and returns the row so the
// current open state can be recomputed. It never mutates is_accepting_orders.
func (rp *Repo) recordHeartbeat(ctx context.Context, restaurantID string) (availabilityRow, time.Time, error) {
	const q = `
		UPDATE restaurant
		   SET last_heartbeat_at = now()
		 WHERE id = $1::uuid AND deleted_at IS NULL
		 RETURNING account_state::text, is_accepting_orders, pause_until,
		           last_heartbeat_at, missed_order_count, timezone`
	var a availabilityRow
	err := rp.db.QueryRow(ctx, q, restaurantID).Scan(
		&a.accountState, &a.isAcceptingOrders, &a.pauseUntil,
		&a.lastHeartbeatAt, &a.missedOrderCount, &a.timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return availabilityRow{}, time.Time{}, errNotFound
	}
	if err != nil {
		return availabilityRow{}, time.Time{}, err
	}
	received := time.Now().UTC()
	if a.lastHeartbeatAt != nil {
		received = *a.lastHeartbeatAt
	}
	return a, received, nil
}

// storedObjectRef is a bucket/key pair for presigning a certificate document.
type storedObjectRef struct {
	bucket    string
	objectKey string
}

// getCertificateObject resolves the stored object for a visible restaurant's
// active halal certificate document, so a short-lived presigned GET can be
// minted (C-12/P-28). errNotFound when the restaurant is invisible or has no
// viewable certificate document.
func (rp *Repo) getCertificateObject(ctx context.Context, restaurantID string) (storedObjectRef, error) {
	const q = `
		SELECT so.bucket, so.object_key
		  FROM restaurant r
		  JOIN halal_certificate c ON c.id = r.halal_certificate_id
		  JOIN kyc_document d ON d.id = c.document_id
		  JOIN stored_object so ON so.id = d.stored_object_id
		 WHERE r.id = $1::uuid AND ` + visiblePredicate
	var ref storedObjectRef
	err := rp.db.QueryRow(ctx, q, restaurantID).Scan(&ref.bucket, &ref.objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return storedObjectRef{}, errNotFound
	}
	return ref, err
}
