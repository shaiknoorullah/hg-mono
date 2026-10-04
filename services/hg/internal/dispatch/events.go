package dispatch

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The realtime events dispatch produces (contracts/websocket.md section 4.5;
// https://github.com/shaiknoorullah/hg-mono/issues/247). Each is written in the
// transaction that makes the change, so it exists only if the change commits:
//
//   - a wave's offers: dispatch.offer to each offered rider on rider:{id}, and
//     dispatch.state_changed when the order starts searching;
//   - an accept: dispatch.assigned and dispatch.state_changed on order:{id},
//     dispatch.offer_withdrawn ("taken") to every other offered rider, and the
//     winner's rider.availability_changed;
//   - an offer timing out: dispatch.offer_withdrawn ("expired");
//   - the search's wave or time budget spent with no rider: dispatch.state_changed
//     to NO_RIDER_FOUND, and admin.dispatch_failure on admin:ops, once, by the
//     call that ends the search (MarkNoRiderFound);
//   - delivery: dispatch.state_changed to COMPLETED;
//   - a position report: rider.location to the customer and restaurant of each
//     order the rider is still carrying out (the realtime catalogue coarsens
//     it per role), at most every 5 seconds per order;
//   - availability changes: rider.availability_changed on rider:{id}.
//
// The dispatch row's state changes only at those points today: it is not moved
// through AT_RESTAURANT, CARRYING and AT_CUSTOMER as the assignment advances,
// so no dispatch.state_changed is sent for those (the order's own
// order.state_changed carries PICKED_UP and ARRIVED).

// emitDispatchState writes dispatch.state_changed when the state moved.
func emitDispatchState(ctx context.Context, tx pgx.Tx, orderID, from, to string, at time.Time) error {
	if from == to {
		return nil
	}
	return realtime.EmitOrder(ctx, tx, orderID, realtime.DispatchStateChanged{
		OrderID: orderID, From: contract.DispatchState(from), To: contract.DispatchState(to), At: realtime.At(at),
	})
}

// emitOffers writes dispatch.offer for each new offer, to its rider only. The
// payload is the rider's pre-accept view: the restaurant, the drop-off's
// approximate area and the money the rider earns — never the customer's
// address, the address's own coordinates, the phone or the order's prices.
// Every rider in a wave gets one, and most never accept, so the drop-off point
// is rounded to about a kilometre (realtime.ApproximateArea) before it is
// stored: the outbox row, the 7-day replay on rider:{id} and the wire all hold
// the area, never the customer's home (the owner's decision on the customer's
// address on a rider's offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
func emitOffers(ctx context.Context, tx pgx.Tx, offers []InsertedOffer, serverTime time.Time) error {
	for _, in := range offers {
		var (
			ev               realtime.DispatchOffer
			expires          time.Time
			est              *int
			dropLat, dropLng float64
		)
		err := tx.QueryRow(ctx, `
SELECT o.order_id::text, o.id::text, o.expires_at, o.distance_m, o.est_duration_s,
       o.earnings_cents, o.tip_estimate_cents,
       r.display_name,
       COALESCE(r.line1, '') || CASE WHEN r.city IS NOT NULL THEN ', ' || r.city ELSE '' END,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       COALESCE(a.city, ''), ST_Y(a.location::geometry), ST_X(a.location::geometry),
       (SELECT count(*)::int FROM order_line ol WHERE ol.order_id = ord.id)
FROM dispatch_offer o
JOIN "order" ord ON ord.id = o.order_id
JOIN restaurant r ON r.id = ord.restaurant_id
LEFT JOIN address a ON a.id = ord.delivery_address_id
WHERE o.id = $1`, in.OfferID).Scan(
			&ev.OrderID, &ev.OfferID, &expires, &ev.DistanceM, &est,
			&ev.EarningsCents, &ev.TipCentsEstimate,
			&ev.Pickup.RestaurantName, &ev.Pickup.AddressShort, &ev.Pickup.Lat, &ev.Pickup.Lng,
			&ev.Dropoff.Area, &dropLat, &dropLng, &ev.ItemsCount)
		if err != nil {
			return fmt.Errorf("load offer for events: %w", err)
		}
		ev.Dropoff.Lat, ev.Dropoff.Lng = realtime.ApproximateArea(dropLat, dropLng)
		ev.ExpiresAt = realtime.At(expires)
		ev.ServerTime = realtime.At(serverTime)
		// The wave stores its estimate; an offer without one gets the same
		// distance-based estimate the wave would have made.
		if est != nil {
			ev.EstDurationS = *est
		} else {
			ev.EstDurationS = etaSeconds(float64(ev.DistanceM))
		}
		if err := realtime.EmitRider(ctx, tx, in.RiderAccountID, ev); err != nil {
			return err
		}
	}
	return nil
}

// withdrawnOffer is an offer that left PENDING without the rider answering it.
type withdrawnOffer struct {
	offerID, orderID, riderAccountID string
}

// scanWithdrawn reads (id, order_id, rider_account_id) rows.
func scanWithdrawn(rows pgx.Rows) ([]withdrawnOffer, error) {
	defer rows.Close()
	var out []withdrawnOffer
	for rows.Next() {
		var w withdrawnOffer
		if err := rows.Scan(&w.offerID, &w.orderID, &w.riderAccountID); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// emitWithdrawn tells each rider their offer is gone, and why.
func emitWithdrawn(ctx context.Context, tx pgx.Tx, offers []withdrawnOffer, reason realtime.DispatchWithdrawnReason) error {
	for _, w := range offers {
		if err := realtime.EmitRider(ctx, tx, w.riderAccountID, realtime.DispatchOfferWithdrawn{
			OrderID: w.orderID, OfferID: w.offerID, Reason: reason,
		}); err != nil {
			return err
		}
	}
	return nil
}

// emitAssigned writes dispatch.assigned: the rider's public profile — first
// name, vehicle and rating, never earnings, phone or record — read the way the
// customer's REST order view reads it (internal/orders/order_read.go).
func emitAssigned(ctx context.Context, tx pgx.Tx, orderID string) error {
	var (
		rider   realtime.RiderPublic
		vehicle *string
		eta     *time.Time
	)
	err := tx.QueryRow(ctx, `
SELECT rp.first_name, rv.vehicle_type::text, rp.rating_avg::float8, d.pickup_eta_at
  FROM dispatch d
  JOIN rider_profile rp ON rp.account_id = d.rider_account_id
  LEFT JOIN rider_vehicle rv ON rv.account_id = d.rider_account_id AND rv.is_active AND rv.deleted_at IS NULL
 WHERE d.order_id = $1 AND d.rider_account_id IS NOT NULL`, orderID).Scan(
		&rider.FirstName, &vehicle, &rider.RatingAvg, &eta)
	if err != nil {
		return fmt.Errorf("load assigned rider for events: %w", err)
	}
	if vehicle != nil {
		vt := contract.VehicleType(*vehicle)
		rider.VehicleType = &vt
	}
	return realtime.EmitOrder(ctx, tx, orderID, realtime.DispatchAssigned{
		OrderID: orderID, Rider: rider, PickupEtaAt: realtime.AtPtr(eta),
	})
}

// emitAvailability writes rider.availability_changed with the rider's state as
// the transaction now sees it.
func emitAvailability(ctx context.Context, tx pgx.Tx, riderAccountID string) error {
	var (
		online bool
		state  string
		at     *time.Time
	)
	err := tx.QueryRow(ctx, `
SELECT is_online, availability_state::text, availability_changed_at
  FROM rider_profile WHERE account_id = $1`, riderAccountID).Scan(&online, &state, &at)
	if err != nil {
		return fmt.Errorf("load availability for events: %w", err)
	}
	when := time.Now().UTC()
	if at != nil {
		when = *at
	}
	return realtime.EmitRider(ctx, tx, riderAccountID, realtime.RiderAvailabilityChanged{
		AccountID: riderAccountID, IsOnline: online,
		AvailabilityState: contract.RiderAvailabilityState(state), At: realtime.At(when),
	})
}

// emitNoRiderFound tells the customer, the restaurant and ops that no rider
// accepted any wave. The order's deadline and timeout actions then run
// (docs/spec/01-platform.md, "Deadlines and timeout actions").
func emitNoRiderFound(ctx context.Context, tx pgx.Tx, orderID, from string, waves, radiusM int, at time.Time) error {
	if err := emitDispatchState(ctx, tx, orderID, from, "NO_RIDER_FOUND", at); err != nil {
		return err
	}
	var offered int
	if err := tx.QueryRow(ctx, `
SELECT count(DISTINCT rider_account_id)::int FROM dispatch_offer WHERE order_id = $1`, orderID).Scan(&offered); err != nil {
		return fmt.Errorf("count offered riders for events: %w", err)
	}
	oid := orderID
	return realtime.EmitAdmin(ctx, tx, &oid, realtime.AdminDispatchFailure{
		OrderID: orderID, Waves: waves, RidersOffered: offered, RadiusM: radiusM,
	})
}

// emitRiderLocation sends the rider's newest accepted fix to each order the
// rider is carrying out (contracts/websocket.md section 4.5), and to no other.
// That is an order whose dispatch names this rider, whose assignment this rider
// still holds on the way to the restaurant or the customer, and which is still
// being prepared or delivered. The dispatch row alone is not enough: it moves
// to COMPLETED only on delivery, so after an assignment that ends any other way
// (undeliverable, returned, cancelled by the platform, reassigned) or an order
// cancelled under a live assignment it still names the rider, and every fix
// the rider reports afterwards, on later jobs too, would reach that order's
// customer and restaurant. The lists are the states that qualify, so a state
// added later sends nothing until it is named here. The customer's copy stays
// coarse until the order is picked up (internal/realtime/catalogue.go).
func emitRiderLocation(ctx context.Context, tx pgx.Tx, riderAccountID string, p PositionPoint) error {
	rows, err := tx.Query(ctx, `
SELECT d.order_id::text, o.state IN ('PICKED_UP', 'ARRIVED')
  FROM dispatch d
  JOIN "order" o ON o.id = d.order_id
  JOIN assignment asn ON asn.order_id = d.order_id AND asn.rider_account_id = d.rider_account_id
 WHERE d.rider_account_id = $1
   AND d.state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER')
   AND asn.state IN ('ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP',
                     'PICKED_UP', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_AT_DROPOFF')
   AND o.state IN ('PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED')`, riderAccountID)
	if err != nil {
		return fmt.Errorf("load live orders for rider.location: %w", err)
	}
	type live struct {
		orderID  string
		pickedUp bool
	}
	var orders []live
	for rows.Next() {
		var l live
		if err := rows.Scan(&l.orderID, &l.pickedUp); err != nil {
			rows.Close()
			return err
		}
		orders = append(orders, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, l := range orders {
		if _, err := realtime.EmitRiderLocation(ctx, tx, realtime.RiderLocation{
			OrderID: l.orderID, Lat: p.Lat, Lng: p.Lng,
			HeadingDeg: p.HeadingDeg, SpeedMps: p.SpeedMps, AccuracyM: p.AccuracyM,
			RecordedAt: realtime.At(p.RecordedAt), PickedUp: l.pickedUp,
		}); err != nil {
			return err
		}
	}
	return nil
}

// dispatchStateFor reads an order's dispatch state in tx; "PENDING" when the
// order has no dispatch row yet (the column's default).
func dispatchStateFor(ctx context.Context, tx pgx.Tx, orderID string) (string, error) {
	var state string
	err := tx.QueryRow(ctx, `SELECT state::text FROM dispatch WHERE order_id = $1`, orderID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return "PENDING", nil
	}
	return state, err
}
