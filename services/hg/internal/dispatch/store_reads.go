package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/riderview"
)

// CurrentOffer returns the rider's single outstanding PENDING offer, or nil.
// The projection is pre-accept: the drop-off's city and the area around its
// point (riderview.AreaOf), never the delivery address's own point, street,
// unit or instructions, and no phone alias. Every rider in a wave can read it,
// and most never accept.
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
	d.Dropoff = OfferDropoff{Area: dropoffArea, Point: riderview.AreaOf(dropLat, dropLng)}
	d.Earnings = buildEarnings(earningsCents, tipCents)
	return &d, nil
}

// LoadAssignment builds the post-accept Assignment projection for a rider's
// assignment. What it shows of the drop-off follows riderview's stages, and
// each field is a stored column passed through whole or left out, never a
// value parsed and trimmed:
//
//   - accepted: the address line and city, and the exact point;
//   - carrying the food: also the unit, the buzzer, the special instructions
//     and the item notes, verbatim;
//   - over: the city and the area around the point (riderview.AreaOf).
//
// The address's second line is never read.
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

	// The customer's phone alias stays nil: a stable proxy alias is out of
	// scope for V1, and the raw number is never exposed.
	stage := riderview.StageOf(a.State, terminal)
	a.Dropoff = AssignmentDropoff{
		CustomerDisplayName:  customerDisplayName(ctx, s, a.OrderID),
		DeliveryInstructions: instructions, // a closed enum, not free text
	}
	switch stage {
	case riderview.Accepted, riderview.Carrying:
		a.Dropoff.Address = addressLine(dropLine1, dropCity)
		if dropLat != nil && dropLng != nil {
			a.Dropoff.Latitude, a.Dropoff.Longitude = *dropLat, *dropLng
		}
		if stage == riderview.Carrying {
			a.Dropoff.Unit, a.Dropoff.Buzzer, a.Dropoff.SpecialInstructions = unit, buzzer, special
		}
	default: // riderview.Finished
		if dropCity != nil {
			a.Dropoff.Address = *dropCity
		}
		if dropLat != nil && dropLng != nil {
			area := riderview.AreaOf(*dropLat, *dropLng)
			a.Dropoff.Latitude, a.Dropoff.Longitude = area.Lat(), area.Lng()
		}
	}

	a.Items = loadItems(ctx, s, a.OrderID, stage == riderview.Carrying)
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
	// The customer's first name and last initial only, from their customer
	// profile ("Ayesha R."), so the rider greets the right person at the door
	// and never learns the full surname (contracts/openapi.yaml,
	// customer_display_name; https://github.com/shaiknoorullah/hg-mono/issues/420).
	// No profile, or no first name: a neutral placeholder.
	var name string
	err := s.db.QueryRow(ctx, `
SELECT COALESCE(
         (SELECT NULLIF(btrim(cp.first_name), '')
                 || COALESCE(' ' || upper(left(NULLIF(btrim(cp.last_name), ''), 1)) || '.', '')
            FROM customer_profile cp
            JOIN "order" o ON o.account_id = cp.account_id
           WHERE o.id = $1),
         'Customer')`, orderID).Scan(&name)
	if err != nil {
		return "Customer"
	}
	return name
}

// loadItems reads the order's lines with no prices. A line's note is the
// customer's free text, so it is read only when withNotes is set (the rider is
// carrying the food); otherwise it is never selected.
func loadItems(ctx context.Context, s *Store, orderID string, withNotes bool) []AssignmentItem {
	rows, err := s.db.Query(ctx, `
SELECT ol.line_no, ol.name_snapshot, ol.quantity, ol.variant_name,
       CASE WHEN $2 THEN ol.special_request END
FROM order_line ol WHERE ol.order_id = $1 ORDER BY ol.line_no`, orderID, withNotes)
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
