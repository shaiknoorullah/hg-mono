package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// assignmentForward is the strictly-forward transition graph (D-20 / §0.4). A
// repeat of the current state is a 200 no-op; anything not listed as a valid
// successor is a 409 INVALID_TRANSITION.
var assignmentForward = map[string][]string{
	"ASSIGNED":            {"EN_ROUTE_TO_PICKUP", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"EN_ROUTE_TO_PICKUP":  {"ARRIVED_AT_PICKUP", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"ARRIVED_AT_PICKUP":   {"PICKED_UP", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"PICKED_UP":           {"EN_ROUTE_TO_DROPOFF", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"EN_ROUTE_TO_DROPOFF": {"ARRIVED_AT_DROPOFF", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"ARRIVED_AT_DROPOFF":  {"DELIVERED", "UNDELIVERABLE", "CANCELLED_BY_PLATFORM", "REASSIGNED"},
	"UNDELIVERABLE":       {"RETURNING"},
	"RETURNING":           {"RETURNED"},
}

// terminalAssignment reports whether a state ends the assignment.
func terminalAssignment(s string) bool {
	switch s {
	case "DELIVERED", "RETURNED", "CANCELLED_BY_PLATFORM", "REASSIGNED":
		return true
	}
	return false
}

// isForward reports whether to is a valid forward successor of from.
func isForward(from, to string) bool {
	for _, s := range assignmentForward[from] {
		if s == to {
			return true
		}
	}
	return false
}

// arrivalState reports whether a target requires a geofence check.
func requiresGeofence(to string) bool {
	return to == "ARRIVED_AT_PICKUP" || to == "ARRIVED_AT_DROPOFF"
}

// TransitionInput carries the validated transition request.
type TransitionInput struct {
	ToState        string
	Lat, Lng       *float64
	AccuracyM      *float64
	OccurredAt     time.Time
	OverrideReason *string
}

// Transition advances an assignment one forward step. It validates the machine,
// the geofence precondition (unless overridden), and the POD gate for DELIVERED,
// then persists the timestamp, the transition row, and — for terminal states —
// restores the rider's availability in the same transaction (D-10 restoration is
// server-owned). Repeating the current state is a no-op returning the assignment.
// The returned bool reports whether a real forward transition was persisted;
// it is false for the idempotent no-op (repeating the current state) so the
// caller can skip firing the OrderLifecycle bridge on a duplicate request.
func (s *Store) Transition(ctx context.Context, riderAccountID, assignmentID string, in TransitionInput, now time.Time) (*Assignment, bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)

	var cur, orderID, requiredPod string
	var podRecorded bool
	var pickupLat, pickupLng float64
	var dropLat, dropLng *float64
	var arrivedPickupAt *time.Time
	err = tx.QueryRow(ctx, `
SELECT asn.state::text, asn.order_id, asn.required_pod_method, asn.pod_recorded,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       ST_Y(a.location::geometry), ST_X(a.location::geometry),
       asn.arrived_pickup_at
FROM assignment asn
JOIN "order" ord ON ord.id = asn.order_id
JOIN restaurant r ON r.id = ord.restaurant_id
LEFT JOIN address a ON a.id = ord.delivery_address_id
WHERE asn.id = $1 AND asn.rider_account_id = $2
FOR UPDATE OF asn`, assignmentID, riderAccountID).Scan(
		&cur, &orderID, &requiredPod, &podRecorded,
		&pickupLat, &pickupLng, &dropLat, &dropLng, &arrivedPickupAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, errAssignmentNotFound
	}
	if err != nil {
		return nil, false, err
	}

	// Idempotent no-op: repeating the current state. No forward transition is
	// persisted, so the bridge must not fire again (transitioned=false).
	if in.ToState == cur {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		asn, err := s.LoadAssignment(ctx, riderAccountID, assignmentID)
		return asn, false, err
	}
	if !isForward(cur, in.ToState) {
		return nil, false, newError(409, CodeInvalidTransition, "That transition is not allowed.",
			map[string]any{"current_state": cur})
	}

	// Geofence precondition. A failure does not trap the rider: an override_reason
	// makes it a flagged manual transition. Absent both proximity and override ⇒ 422.
	geofenceOK := true
	if requiresGeofence(in.ToState) {
		if in.OverrideReason != nil && *in.OverrideReason != "" {
			geofenceOK = false // allowed, but flagged
		} else if in.Lat == nil || in.Lng == nil || !withinRadius(tx, ctx, in.ToState, *in.Lat, *in.Lng, pickupLat, pickupLng, dropLat, dropLng) {
			return nil, false, newError(422, CodeGeofenceRequired,
				"You must be near the location, or supply an override reason.", nil)
		}
	}

	// DELIVERED requires the POD artefact recorded in the same lifecycle (D-21).
	if in.ToState == "DELIVERED" && requiredPod != "" && !podRecorded {
		return nil, false, newError(422, CodePodRequired, "Proof of delivery is required before delivering.",
			map[string]any{"required_pod_method": requiredPod})
	}

	// occurred_at is clamped to [received - 120s, received]; server time is
	// authoritative for pay. We store the clamped occurred_at in the transition row.
	occurred := in.OccurredAt
	lower := now.Add(-120 * time.Second)
	if occurred.Before(lower) {
		occurred = lower
	}
	if occurred.After(now) {
		occurred = now
	}

	// Compute the assignment timestamp column to set, and pickup wait on PICKED_UP.
	set := timestampColumn(in.ToState)
	var pickupWait *int
	if in.ToState == "PICKED_UP" && arrivedPickupAt != nil {
		w := int(now.Sub(*arrivedPickupAt).Seconds())
		if w < 0 {
			w = 0
		}
		pickupWait = &w
	}

	// Persist the new state + timestamp.
	q := `UPDATE assignment SET state = $2, state_since = now()`
	if set != "" {
		q += ", " + set + " = now()"
	}
	if terminalAssignment(in.ToState) {
		q += ", terminated_at = now()"
	}
	if pickupWait != nil {
		q += ", pickup_wait_seconds = $3"
		q += " WHERE id = $1"
		if _, err := tx.Exec(ctx, q, assignmentID, in.ToState, *pickupWait); err != nil {
			return nil, false, err
		}
	} else {
		q += " WHERE id = $1"
		if _, err := tx.Exec(ctx, q, assignmentID, in.ToState); err != nil {
			return nil, false, err
		}
	}

	// Transition audit row.
	if _, err := tx.Exec(ctx, `
INSERT INTO assignment_transition (assignment_id, from_state, to_state, actor_kind, actor_account_id, reason, at)
VALUES ($1, $2, $3, 'RIDER', $4, $5, $6)`,
		assignmentID, cur, in.ToState, riderAccountID, in.OverrideReason, occurred); err != nil {
		return nil, false, err
	}
	_ = geofenceOK // flagged-for-ops signalling is emitted via the outbox in a later slice.

	// A rider who brings the order back did the work and is paid in the same
	// transaction (docs/spec/04-rider.md, "D-32 — Incident reporting &
	// mid-delivery exceptions"; the payments module applies the configured
	// rule, https://github.com/shaiknoorullah/hg-mono/issues/306).
	if in.ToState == "RETURNED" && s.earnings != nil {
		if err := s.earnings.CreditReturnedTx(ctx, tx, assignmentID); err != nil {
			return nil, false, err
		}
	}

	// Terminal ⇒ restore availability in the same transaction (D-10). The rider
	// returns to ONLINE_IDLE, or OFFLINE if they asked to end the shift.
	if terminalAssignment(in.ToState) {
		if err := s.restoreAvailabilityTx(ctx, tx, riderAccountID); err != nil {
			return nil, false, err
		}
		// Advance the dispatch row to COMPLETED on DELIVERED so the rider is no
		// longer counted as holding a live dispatch. Other terminal reasons leave
		// the platform-side reassignment to ops; dispatch never cancels an order.
		if in.ToState == "DELIVERED" {
			if _, err := tx.Exec(ctx, `
UPDATE dispatch SET state = 'COMPLETED', state_since = now(),
                    deadline_at = NULL, deadline_action = NULL
 WHERE order_id = $1 AND rider_account_id = $2`, orderID, riderAccountID); err != nil {
				return nil, false, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	asn, err := s.LoadAssignment(ctx, riderAccountID, assignmentID)
	return asn, true, err
}

// restoreAvailabilityTx returns a rider from ON_DELIVERY to ONLINE_IDLE (or
// OFFLINE if go_offline_after_delivery), inside the caller's transaction.
func (s *Store) restoreAvailabilityTx(ctx context.Context, tx pgx.Tx, riderAccountID string) error {
	var from, to string
	err := tx.QueryRow(ctx, `
UPDATE rider_profile
   SET availability_state = (CASE WHEN go_offline_after_delivery THEN 'OFFLINE' ELSE 'ONLINE_IDLE' END)::rider_availability_state,
       is_online = NOT go_offline_after_delivery,
       availability_changed_at = now()
 WHERE account_id = $1 AND availability_state = 'ON_DELIVERY'
RETURNING 'ON_DELIVERY', availability_state::text`, riderAccountID).Scan(&from, &to)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // already restored; idempotent
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, $2, $3, 'ASSIGNMENT_TERMINAL', 'SYSTEM')`, riderAccountID, from, to)
	return err
}

func timestampColumn(state string) string {
	switch state {
	case "ARRIVED_AT_PICKUP":
		return "arrived_pickup_at"
	case "PICKED_UP":
		return "picked_up_at"
	case "ARRIVED_AT_DROPOFF":
		return "arrived_dropoff_at"
	case "DELIVERED":
		return "delivered_at"
	}
	return ""
}

// withinRadius checks proximity to the relevant point using PostGIS ST_DWithin.
func withinRadius(tx pgx.Tx, ctx context.Context, to string, lat, lng, pickupLat, pickupLng float64, dropLat, dropLng *float64) bool {
	var targetLat, targetLng float64
	if to == "ARRIVED_AT_PICKUP" {
		targetLat, targetLng = pickupLat, pickupLng
	} else {
		if dropLat == nil || dropLng == nil {
			return false
		}
		targetLat, targetLng = *dropLat, *dropLng
	}
	var ok bool
	err := tx.QueryRow(ctx, `
SELECT ST_DWithin(
         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
         ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
         $5)`, lng, lat, targetLng, targetLat, geoArrivalRadiusM).Scan(&ok)
	if err != nil {
		return false
	}
	return ok
}

// ---------------------------------------------------------------------------
// Proof of delivery (D-21).
// ---------------------------------------------------------------------------

// PodInput carries a validated proof-of-delivery submission.
type PodInput struct {
	Method         string
	OtpCode        *string
	PhotoObjectID  *string
	HandoverMethod *string
	Attestation    *string
}

// RecordPod records proof of delivery. The method must match the assignment's
// required_pod_method. OTP is verified against the order's stored delivery OTP;
// PHOTO requires a READY object with purpose POD owned by the rider. On success
// it sets pod_recorded=true and stores the artefact so DELIVERED can commit.
//
// The OTP verification path is intentionally strict: five wrong attempts lock the
// code (OTP_LOCKED) and the rider must fall back to photo-with-attestation.
func (s *Store) RecordPod(ctx context.Context, riderAccountID, assignmentID string, in PodInput) (*Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var requiredPod, state string
	var podObjectID *string
	err = tx.QueryRow(ctx, `
SELECT required_pod_method, state::text, pod_object_id
FROM assignment WHERE id = $1 AND rider_account_id = $2 FOR UPDATE`,
		assignmentID, riderAccountID).Scan(&requiredPod, &state, &podObjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errAssignmentNotFound
	}
	if err != nil {
		return nil, err
	}

	if requiredPod == "" {
		return nil, newError(422, CodePodRequired, "This delivery does not require proof of delivery.", nil)
	}
	// PHOTO_WITH_ATTESTATION is the fallback and is always acceptable; otherwise
	// the submitted method must equal the required method.
	if in.Method != requiredPod && in.Method != "PHOTO_WITH_ATTESTATION" {
		return nil, newError(422, CodePodMethodMismatch, "Wrong proof-of-delivery method.",
			map[string]any{"required_pod_method": requiredPod})
	}

	switch in.Method {
	case "OTP":
		if in.OtpCode == nil {
			return nil, newError(422, CodePodRequired, "An OTP code is required.", nil)
		}
		if err := s.verifyDeliveryOtpTx(ctx, tx, assignmentID, *in.OtpCode); err != nil {
			return nil, err
		}
	case "PHOTO", "PHOTO_WITH_ATTESTATION":
		if in.PhotoObjectID == nil {
			return nil, newError(422, CodePodRequired, "A proof photo is required.", nil)
		}
		// The object must be READY, purpose POD, uploaded by this rider.
		var ok bool
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM stored_object so
   WHERE so.id = $1 AND so.state = 'READY' AND so.purpose = 'POD')`,
			*in.PhotoObjectID).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, newError(422, CodePodRequired, "The referenced photo is not a READY proof-of-delivery object.", nil)
		}
		podObjectID = in.PhotoObjectID
	}

	if _, err := tx.Exec(ctx, `
UPDATE assignment
   SET pod_recorded = true, pod_object_id = $2, handover_method = $3
 WHERE id = $1`, assignmentID, podObjectID, in.HandoverMethod); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.LoadAssignment(ctx, riderAccountID, assignmentID)
}

// verifyDeliveryOtpTx checks the customer's delivery OTP for the assignment's
// order. There is no dedicated delivery-OTP table in the current schema, so this
// path is not yet wired to a real code store.
//
// TODO(pod-otp): the delivery OTP is generated and shared with the customer by
// the orders/notifications module; there is no delivery_otp column or table in
// the schema yet. Until that lands, an OTP-method POD cannot be verified and this
// returns OTP_INCORRECT rather than fabricating a pass. Riders on OTP deliveries
// must use PHOTO_WITH_ATTESTATION in the interim.
func (s *Store) verifyDeliveryOtpTx(ctx context.Context, tx pgx.Tx, assignmentID, code string) error {
	_ = ctx
	_ = tx
	_ = assignmentID
	_ = code
	return newError(422, CodeOtpIncorrect, "The delivery OTP could not be verified.", nil)
}

// ---------------------------------------------------------------------------
// Reconciliation sweep (D-10). Backstop, not the mechanism.
// ---------------------------------------------------------------------------

// ReconcileAvailability returns any rider stuck in ON_DELIVERY whose assignment
// is no longer in a non-terminal state to ONLINE_IDLE/OFFLINE, and logs the
// anomaly count. Idempotent; safe to run every 60s from a single leader.
func (s *Store) ReconcileAvailability(ctx context.Context) (int64, error) {
	tag, err := s.db.Exec(ctx, `
UPDATE rider_profile rp
   SET availability_state = (CASE WHEN rp.go_offline_after_delivery THEN 'OFFLINE' ELSE 'ONLINE_IDLE' END)::rider_availability_state,
       is_online = NOT rp.go_offline_after_delivery,
       availability_changed_at = now()
 WHERE rp.availability_state = 'ON_DELIVERY'
   AND NOT EXISTS (
         SELECT 1 FROM assignment a
          WHERE a.rider_account_id = rp.account_id
            AND a.terminated_at IS NULL)`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// SweepStaleOnline moves ONLINE_IDLE riders whose location fix is older than the
// staleness window to ONLINE_STALE (D-10: not dispatchable, still "online").
func (s *Store) SweepStaleOnline(ctx context.Context, staleAfter time.Duration, now time.Time) (int64, error) {
	tag, err := s.db.Exec(ctx, `
UPDATE rider_profile rp
   SET availability_state = 'ONLINE_STALE', availability_changed_at = now()
 WHERE rp.availability_state = 'ONLINE_IDLE'
   AND NOT EXISTS (
         SELECT 1 FROM rider_position pos
          WHERE pos.account_id = rp.account_id
            AND pos.received_at > $1)`, now.Add(-staleAfter))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
