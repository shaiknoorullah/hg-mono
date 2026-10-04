package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/riderview"
)

// CurrentOffer returns the rider's single outstanding PENDING offer, or nil.
// The projection is pre-accept: the drop-off's area name and a point rounded to
// about a kilometre (riderview.ApproximateArea), never the delivery address's
// own coordinates, street or unit, and no phone alias. Every rider in a wave
// can read it, and most never accept.
func (s *Store) CurrentOffer(ctx context.Context, riderAccountID string, now time.Time) (*DispatchOffer, error) {
	const q = `
SELECT o.id, o.order_id, o.state::text, o.wave, o.expires_at,
       o.distance_m, o.est_duration_s,
       o.earnings_cents, o.tip_estimate_cents,
       r.display_name,
       COALESCE(r.line1, '') || CASE WHEN r.city IS NOT NULL THEN ', ' || r.city ELSE '' END,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       COALESCE(a.city, '') AS dropoff_area,
       ST_Y(a.location::geometry), ST_X(a.location::geometry),
       (SELECT count(*)::int FROM order_line ol WHERE ol.order_id = ord.id)
FROM dispatch_offer o
JOIN "order" ord ON ord.id = o.order_id
JOIN restaurant r ON r.id = ord.restaurant_id
LEFT JOIN address a ON a.id = ord.delivery_address_id
WHERE o.rider_account_id = $1 AND o.state = 'PENDING' AND o.expires_at > $2
ORDER BY o.offered_at DESC
LIMIT 1`

	var d DispatchOffer
	var expiresAt time.Time
	var distanceM, estDuration *int32
	var earningsCents, tipCents int64
	var dropoffArea string
	var dropLat, dropLng float64
	err := s.db.QueryRow(ctx, q, riderAccountID, now).Scan(
		&d.OfferID, &d.OrderID, &d.State, &d.Wave, &expiresAt,
		&distanceM, &estDuration, &earningsCents, &tipCents,
		&d.Pickup.RestaurantName, &d.Pickup.AddressShort,
		&d.Pickup.Latitude, &d.Pickup.Longitude,
		&dropoffArea, &dropLat, &dropLng, &d.ItemsCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.ExpiresAt = tsMillis(expiresAt)
	d.ServerTime = tsMillis(now)
	d.DistanceM = distanceM
	d.EstDuration = estDuration
	d.Dropoff.Area = dropoffArea
	d.Dropoff.Latitude, d.Dropoff.Longitude = riderview.ApproximateArea(dropLat, dropLng)
	d.Earnings = buildEarnings(earningsCents, tipCents)
	return &d, nil
}

// LoadAssignment builds the full post-accept Assignment projection for a rider's
// assignment. Progressive disclosure (the rider spec's assignment view): the
// full address, the exact drop-off point, unit, buzzer, special instructions
// and phone aliases are present only while the assignment is non-terminal.
// Once it is over, the rider's history keeps the street without its number
// (riderview.StreetLevel) and the area's point (riderview.ApproximateArea),
// never the customer's home (contracts/websocket.md section 5, "Per-role
// projection rules").
func (s *Store) LoadAssignment(ctx context.Context, riderAccountID, assignmentID string) (*Assignment, error) {
	const q = `
SELECT asn.id, asn.order_id, ord.code, asn.state::text,
       asn.required_pod_method, asn.pod_recorded, asn.handover_method::text,
       asn.tracking_health::text, asn.billable_distance_m, asn.pickup_wait_seconds,
       asn.assigned_at, asn.arrived_pickup_at, asn.picked_up_at,
       asn.arrived_dropoff_at, asn.delivered_at, asn.terminated_at,
       r.display_name,
       COALESCE(r.line1, '')
         || CASE WHEN r.line2 IS NOT NULL THEN ', ' || r.line2 ELSE '' END
         || CASE WHEN r.city IS NOT NULL THEN ', ' || r.city ELSE '' END,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       r.public_phone_e164, ord.state::text,
       COALESCE(a.line1, ''), a.city,
       a.unit, a.buzzer,
       ST_Y(a.location::geometry), ST_X(a.location::geometry),
       ord.delivery_instructions, ord.special_instructions,
       ord.delivery_fee_cents, ord.tip_cents
FROM assignment asn
JOIN "order" ord ON ord.id = asn.order_id
JOIN restaurant r ON r.id = ord.restaurant_id
LEFT JOIN address a ON a.id = ord.delivery_address_id
WHERE asn.id = $1 AND asn.rider_account_id = $2`

	var a Assignment
	var handover, dropCity *string
	var dropLine1 string
	var restaurantAddr string
	var trackingHealth, podMethod string
	var billable, pickupWait *int32
	var pickupPhone *string
	var orderState string
	var unit, buzzer *string
	var dropLat, dropLng *float64
	var instructions []string
	var special *string
	var deliveryFeeCents, tipCents int64
	var assignedAt time.Time
	var arrivedPickup, pickedUp, arrivedDrop, delivered, terminated *time.Time

	err := s.db.QueryRow(ctx, q, assignmentID, riderAccountID).Scan(
		&a.ID, &a.OrderID, &a.OrderCode, &a.State,
		&podMethod, &a.PodRecorded, &handover,
		&trackingHealth, &billable, &pickupWait,
		&assignedAt, &arrivedPickup, &pickedUp, &arrivedDrop, &delivered, &terminated,
		&a.Pickup.RestaurantName, &restaurantAddr, &a.Pickup.Latitude, &a.Pickup.Longitude,
		&pickupPhone, &orderState,
		&dropLine1, &dropCity, &unit, &buzzer, &dropLat, &dropLng,
		&instructions, &special, &deliveryFeeCents, &tipCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errAssignmentNotFound
	}
	if err != nil {
		return nil, err
	}

	terminal := terminated != nil
	a.RequiredPodMethod = podMethod
	a.HandoverMethod = handover
	a.TrackingHealth = trackingHealth
	a.PaymentStatus = "PREPAID"
	a.BillableDistanceM = billable
	a.PickupWaitSeconds = pickupWait
	a.AssignedAt = tsMillis(assignedAt)
	a.ArrivedPickupAt = tsPtr(arrivedPickup)
	a.PickedUpAt = tsPtr(pickedUp)
	a.ArrivedDropoffAt = tsPtr(arrivedDrop)
	a.DeliveredAt = tsPtr(delivered)

	a.Pickup.Address = restaurantAddr
	a.Pickup.OrderState = orderState
	// After terminal, the restaurant proxy line is deactivated within 30 minutes.
	if !terminal {
		a.Pickup.PhoneAlias = pickupPhone
	}

	a.Dropoff.CustomerDisplayName = customerDisplayName(ctx, s, a.OrderID)
	a.Dropoff.DeliveryInstructions = instructions
	if terminal {
		// The assignment is over: street level and the area's point only; no
		// civic number, exact point, unit, buzzer, phone or notes.
		a.Dropoff.Address = addressLine(riderview.StreetLevel(dropLine1), dropCity)
		if dropLat != nil && dropLng != nil {
			a.Dropoff.Latitude, a.Dropoff.Longitude = riderview.ApproximateArea(*dropLat, *dropLng)
		}
	} else {
		a.Dropoff.Address = addressLine(dropLine1, dropCity)
		if dropLat != nil && dropLng != nil {
			a.Dropoff.Latitude, a.Dropoff.Longitude = *dropLat, *dropLng
		}
		a.Dropoff.Unit = unit
		a.Dropoff.Buzzer = buzzer
		a.Dropoff.SpecialInstructions = special
		// A stable proxy alias is deliberately out of scope for V1; the raw
		// customer number is never exposed. Left nil until the proxy service lands.
	}

	a.Items = loadItems(ctx, s, a.OrderID)
	e := buildEarnings(deliveryFeeCents, tipCents)
	a.Earnings = &e
	return &a, nil
}

// FindUndispatchedReadyOrders returns order IDs in READY_FOR_PICKUP state that
// have no dispatch row yet. This is the sweep query for the DispatchRunner
// backstop (D-13): orders that arrive in READY_FOR_PICKUP but were never offered
// to riders because the restaurant-side dispatch trigger (OFFER_RESTAURANT) has
// not been wired yet.
//
// SKIP LOCKED is not used here because we want every replica to see the same
// list — two replicas calling RunWave for the same order queue on the dispatch
// row the first wave creates, and the second finds the wave already run
// (CreateWave, errWaveNotOpen) and writes nothing.
func (s *Store) FindUndispatchedReadyOrders(ctx context.Context) ([]string, error) {
	rows, err := s.db.Query(ctx, `
SELECT o.id
FROM "order" o
WHERE o.state = 'READY_FOR_PICKUP'
  AND NOT EXISTS (
        SELECT 1 FROM dispatch d WHERE d.order_id = o.id)
ORDER BY o.ready_at ASC NULLS FIRST
LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// LoadAssignmentByOrder returns the live assignment id for an order, if any.
func (s *Store) LoadAssignmentByOrder(ctx context.Context, orderID string) (string, string, error) {
	var id, rider string
	err := s.db.QueryRow(ctx, `
SELECT id, rider_account_id FROM assignment
WHERE order_id = $1 AND terminated_at IS NULL`, orderID).Scan(&id, &rider)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return id, rider, err
}

// addressLine joins an address line and its city the way the rider's views
// print them: "88 Harbour St, Toronto".
func addressLine(line string, city *string) string {
	if city == nil {
		return line
	}
	return line + ", " + *city
}

func customerDisplayName(ctx context.Context, s *Store, orderID string) string {
	// First name + last initial only. Derived from the rider_profile of the
	// customer account if present; otherwise a neutral placeholder. The customer
	// profile lives in another module, so we read only the account's public label.
	var name string
	err := s.db.QueryRow(ctx, `
SELECT COALESCE(
         (SELECT rp.first_name || ' ' || left(rp.last_name, 1) || '.'
            FROM rider_profile rp
            JOIN "order" o ON o.account_id = rp.account_id
           WHERE o.id = $1),
         'Customer')`, orderID).Scan(&name)
	if err != nil {
		return "Customer"
	}
	return name
}

func loadItems(ctx context.Context, s *Store, orderID string) []AssignmentItem {
	rows, err := s.db.Query(ctx, `
SELECT ol.line_no, ol.name_snapshot, ol.quantity, ol.variant_name, ol.special_request
FROM order_line ol WHERE ol.order_id = $1 ORDER BY ol.line_no`, orderID)
	if err != nil {
		return []AssignmentItem{}
	}
	defer rows.Close()

	type lineKey struct {
		no   int
		item AssignmentItem
	}
	var lines []lineKey
	var nos []int
	for rows.Next() {
		var no int
		var it AssignmentItem
		var variant, note *string
		if err := rows.Scan(&no, &it.Name, &it.Quantity, &variant, &note); err != nil {
			return []AssignmentItem{}
		}
		it.VariantName = variant
		it.Note = note
		it.AddonNames = []string{}
		it.AllergenTags = []string{}
		lines = append(lines, lineKey{no: no, item: it})
		nos = append(nos, no)
	}
	if rows.Err() != nil {
		return []AssignmentItem{}
	}

	// Add-ons per line.
	for i := range lines {
		arows, err := s.db.Query(ctx, `
SELECT addon_name FROM order_line_addon WHERE order_id = $1 AND line_no = $2 ORDER BY addon_name`,
			orderID, lines[i].no)
		if err != nil {
			continue
		}
		for arows.Next() {
			var an string
			if err := arows.Scan(&an); err == nil {
				lines[i].item.AddonNames = append(lines[i].item.AddonNames, an)
			}
		}
		arows.Close()
	}

	out := make([]AssignmentItem, 0, len(lines))
	for _, l := range lines {
		out = append(out, l.item)
	}
	return out
}
