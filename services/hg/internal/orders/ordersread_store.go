package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Domain types for the three new read operations ----

// OrderTracking is the customer-safe tracking projection (C-32, contract
// OrderTracking schema). rider_location is nil outside PICKED_UP/ARRIVED.
type OrderTracking struct {
	OrderID             string
	State               string
	DispatchState       *string
	ETAAt               *time.Time
	ETAWindowMinutes    *int
	RestaurantLocation  GeoPoint
	DestinationLocation *GeoPoint
	RiderLocation       *RiderLocation
	Rider               *RiderPublicProfile
	Timeline            []OrderTransitionRow
}

// GeoPoint is a lat/lng pair.
type GeoPoint struct {
	Latitude  float64
	Longitude float64
}

// RiderLocation is GeoPoint + timestamp and optional kinematic fields.
type RiderLocation struct {
	Latitude   float64
	Longitude  float64
	HeadingDeg *float64
	SpeedMPS   *float64
	AccuracyM  *float64
	RecordedAt time.Time
	// IsCoarse is true when the position is low-quality (accuracy worse than
	// ~100 m or unknown). The customer always receives the precise, un-rounded
	// position; is_coarse only reflects the underlying GPS fix quality. The
	// restaurant projection (realtime, ≈100 m rounding) is a separate path.
	IsCoarse bool
}

// coarseAccuracyThresholdM is the accuracy boundary (metres) above which a
// rider position is reported as coarse. It matches the ≈100 m language in the
// contract's RiderLocation.is_coarse description and the restaurant-projection
// rounding in the realtime package.
const coarseAccuracyThresholdM = 100.0

// RiderPublicProfile is the PII-free rider snapshot exposed to the customer.
// There is no phone, email, last_name or earnings here — by construction (C-32).
type RiderPublicProfile struct {
	FirstName   string
	LastInitial string
	PhotoURL    *string
	VehicleType string
	RatingAvg   *float64
}

// OrderTransitionRow is one row from order_transition.
type OrderTransitionRow struct {
	FromState *string
	ToState   string
	ActorKind string
	Reason    *string
	At        time.Time
}

// ErrReceiptNotReady is returned when the order has no receipt_snapshot yet.
var ErrReceiptNotReady = errors.New("receipt not ready")

// GetOrderTracking returns the customer-safe tracking projection for an order
// owned by accountID (P-07: IDOR → 404).
func (s *Store) GetOrderTracking(ctx context.Context, accountID, orderID string) (*OrderTracking, error) {
	// Load core order fields + restaurant location in one parameterised query.
	// ownership enforced via order_visibility view (same as loadOrderView).
	var ot OrderTracking
	var restLat, restLng float64
	var destLat, destLng *float64
	var dispatchState *string

	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.state::text,
		       ST_Y(r.location::geometry) AS rest_lat,
		       ST_X(r.location::geometry) AS rest_lng,
		       d.state::text
		  FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		  JOIN restaurant r ON r.id = o.restaurant_id
		  LEFT JOIN dispatch d ON d.order_id = o.id
		 WHERE o.id = $2`, accountID, orderID).Scan(
		&ot.OrderID, &ot.State,
		&restLat, &restLng,
		&dispatchState)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get order tracking: %w", err)
	}

	ot.RestaurantLocation = GeoPoint{Latitude: restLat, Longitude: restLng}
	ot.DispatchState = dispatchState

	// Delivery address location (destination) — may be null for PICKUP orders.
	err = s.pool.QueryRow(ctx, `
		SELECT ST_Y(a.location::geometry), ST_X(a.location::geometry)
		  FROM "order" o
		  JOIN address a ON a.id = o.delivery_address_id
		 WHERE o.id = $1 AND o.delivery_address_id IS NOT NULL`, orderID).Scan(&destLat, &destLng)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("get destination location: %w", err)
	}
	if destLat != nil && destLng != nil {
		ot.DestinationLocation = &GeoPoint{Latitude: *destLat, Longitude: *destLng}
	}

	// Rider location and profile: only visible in PICKED_UP / ARRIVED (C-32).
	if ot.State == "PICKED_UP" || ot.State == "ARRIVED" {
		rp, rl, err := s.loadRiderForOrder(ctx, orderID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("load rider: %w", err)
		}
		ot.Rider = rp
		ot.RiderLocation = rl
	}

	// Timeline.
	rows, err := s.pool.Query(ctx, `
		SELECT from_state::text, to_state::text, actor_kind::text, reason, at
		  FROM order_transition
		 WHERE order_id = $1
		 ORDER BY at ASC`, orderID)
	if err != nil {
		return nil, fmt.Errorf("load timeline: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tr OrderTransitionRow
		if err := rows.Scan(&tr.FromState, &tr.ToState, &tr.ActorKind, &tr.Reason, &tr.At); err != nil {
			return nil, err
		}
		ot.Timeline = append(ot.Timeline, tr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &ot, nil
}

// loadRiderForOrder fetches the assigned rider profile + current position for
// an order. Returns (nil, nil, pgx.ErrNoRows) when no rider is assigned.
func (s *Store) loadRiderForOrder(ctx context.Context, orderID string) (*RiderPublicProfile, *RiderLocation, error) {
	var rp RiderPublicProfile
	var rl RiderLocation
	var riderAccountID string
	var lat, lng float64
	var headingDeg, speedMPS, accuracyM *float64

	err := s.pool.QueryRow(ctx, `
		SELECT rp.account_id,
		       rp.first_name,
		       left(rp.last_name, 1),
		       NULL::text,
		       rv.vehicle_type::text,
		       rp.rating_avg,
		       ST_Y(pos.location::geometry),
		       ST_X(pos.location::geometry),
		       pos.heading_deg,
		       pos.speed_mps,
		       pos.accuracy_m,
		       pos.recorded_at
		  FROM dispatch d
		  JOIN rider_profile rp ON rp.account_id = d.rider_account_id
		  JOIN rider_vehicle rv ON rv.account_id = d.rider_account_id AND rv.is_active AND rv.deleted_at IS NULL
		  LEFT JOIN rider_position pos ON pos.account_id = d.rider_account_id
		 WHERE d.order_id = $1 AND d.rider_account_id IS NOT NULL`, orderID).Scan(
		&riderAccountID,
		&rp.FirstName,
		&rp.LastInitial,
		&rp.PhotoURL,
		&rp.VehicleType,
		&rp.RatingAvg,
		&lat, &lng,
		&headingDeg, &speedMPS, &accuracyM,
		&rl.RecordedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, pgx.ErrNoRows
	}
	if err != nil {
		return nil, nil, err
	}

	rl.Latitude = lat
	rl.Longitude = lng
	rl.HeadingDeg = headingDeg
	rl.SpeedMPS = speedMPS
	rl.AccuracyM = accuracyM
	// A position with unknown or worse-than-~100 m accuracy is coarse.
	rl.IsCoarse = accuracyM == nil || *accuracyM > coarseAccuracyThresholdM

	return &rp, &rl, nil
}

// GetOrderReceipt returns the frozen receipt snapshot for a COMPLETED order
// owned by accountID (P-07). Returns ErrReceiptNotReady when the order exists
// but is not yet COMPLETED (i.e., receipt_snapshot is NULL).
func (s *Store) GetOrderReceipt(ctx context.Context, accountID, orderID string) (json.RawMessage, error) {
	var snapshot *json.RawMessage
	err := s.pool.QueryRow(ctx, `
		SELECT o.receipt_snapshot
		  FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		 WHERE o.id = $2`, accountID, orderID).Scan(&snapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get order receipt: %w", err)
	}
	if snapshot == nil {
		return nil, ErrReceiptNotReady
	}
	return *snapshot, nil
}

// GetRiderPublicProfile returns the PII-free rider profile for an order the
// customer owns. Returns ErrOrderNotFound when the order doesn't exist or
// belongs to a different account (IDOR → 404). Returns ErrOrderNotFound when
// the order is not yet in PICKED_UP or ARRIVED state (C-32: rider identity
// hidden before pickup).
func (s *Store) GetRiderPublicProfile(ctx context.Context, accountID, orderID string) (*RiderPublicProfile, error) {
	// Ownership check + state check in one query (IDOR: any failure → 404).
	var orderState string
	err := s.pool.QueryRow(ctx, `
		SELECT o.state::text
		  FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		 WHERE o.id = $2`, accountID, orderID).Scan(&orderState)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("check order ownership: %w", err)
	}

	// Rider identity is only visible in PICKED_UP or ARRIVED (C-32).
	if orderState != "PICKED_UP" && orderState != "ARRIVED" {
		return nil, ErrOrderNotFound
	}

	// Load rider — joins through dispatch → requires an assigned rider.
	rp, _, err := s.loadRiderForOrder(ctx, orderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load rider public profile: %w", err)
	}
	return rp, nil
}
