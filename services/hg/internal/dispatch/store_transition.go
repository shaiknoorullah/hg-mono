package dispatch

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
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
	// PickupCode is the code the kitchen read out, for PICKED_UP only
	// (contract PickupTransitionInput). It is compared and never echoed.
	PickupCode *string
}

// Transition advances an assignment one forward step. It validates the machine,
// the geofence precondition (unless overridden), and the POD gate for DELIVERED,
// then persists the timestamp, the transition row, and — for terminal states —
// restores the rider's availability in the same transaction (D-10 restoration is
// server-owned). Repeating the current state is a no-op returning the assignment.
// The returned bool reports whether a real forward transition was persisted;
// it is false for the idempotent no-op (repeating the current state) so the
// caller can skip firing the OrderLifecycle bridge on a duplicate request.
//
// pickup moves the order for a PICKED_UP step in this same transaction
// (pickup.go); a refusal rolls the step back. A nil pickup (no OrderLifecycle
// wired) leaves the order alone.
func (s *Store) Transition(ctx context.Context, riderAccountID, assignmentID string, in TransitionInput, now time.Time, pickup pickupStep) (*Assignment, bool, error) {
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

	// PICKED_UP needs the pickup code, and nothing stands in for it: no
	// override_reason, no geofence (handover_codes.go). The order row is locked
	// after the assignment, the lock order every code check uses. A refusal
	// commits first, so a counted wrong code and a lock alert survive it.
	//
	// The code is asked for only when the pickup could otherwise go ahead: the
	// order is waiting at the counter and this rider holds its delivery. Any
	// other order is refused by the order move below (pickup.go) without
	// touching the code, so a pickup that is not allowed never counts a try.
	codeDue, err := pickupCodeDue(ctx, tx, in.ToState, orderID, riderAccountID)
	if err != nil {
		return nil, false, err
	}
	if codeDue {
		refusal, err := codeGate(ctx, tx, orderID, handover.Pickup, in.PickupCode)
		if err != nil {
			return nil, false, err
		}
		if refusal != nil {
			if err := tx.Commit(ctx); err != nil {
				return nil, false, err
			}
			return nil, false, refusal
		}
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

	// PICKED_UP moves the order in this transaction, after the assignment row:
	// the lock order every pickup path uses. The orders module checks that this
	// rider holds the order's delivery and that the kitchen marked it ready; an
	// order still PREPARING is refused until the kitchen's pickup code is
	// checked (https://github.com/shaiknoorullah/hg-mono/issues/413). A refusal
	// rolls the step back (pickup.go).
	if in.ToState == "PICKED_UP" && pickup != nil {
		if err := pickup(ctx, tx, orderID); err != nil {
			return nil, false, pickupRefusal(err, cur)
		}
	}

	// Terminal ⇒ restore availability in the same transaction (D-10). The rider
	// returns to ONLINE_IDLE, or OFFLINE if they asked to end the shift.
	if terminalAssignment(in.ToState) {
		if err := restoreAvailabilityTx(ctx, tx, riderAccountID); err != nil {
			return nil, false, err
		}
		// Advance the dispatch row to COMPLETED on DELIVERED so the rider is no
		// longer counted as holding a live dispatch. Any other end takes the
		// row off the rider (release.go); dispatch never cancels an order.
		if in.ToState != "DELIVERED" {
			if err := releaseRiderTx(ctx, tx, orderID, riderAccountID, strings.ToLower(in.ToState)); err != nil {
				return nil, false, err
			}
		}
		if in.ToState == "DELIVERED" {
			prevDispatch, err := dispatchStateFor(ctx, tx, orderID)
			if err != nil {
				return nil, false, err
			}
			if _, err := tx.Exec(ctx, `
UPDATE dispatch SET state = 'COMPLETED', state_since = now(),
                    deadline_at = NULL, deadline_action = NULL
 WHERE order_id = $1 AND rider_account_id = $2`, orderID, riderAccountID); err != nil {
				return nil, false, err
			}
			if err := emitDispatchState(ctx, tx, orderID, prevDispatch, "COMPLETED", now); err != nil {
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

// pickupCodeDue reports whether a step must pass the pickup code: a PICKED_UP
// of an order that is READY_FOR_PICKUP and whose live dispatch this rider
// holds. It locks the order row, after the assignment row.
func pickupCodeDue(ctx context.Context, tx pgx.Tx, toState, orderID, riderAccountID string) (bool, error) {
	if toState != "PICKED_UP" {
		return false, nil
	}
	var due bool
	err := tx.QueryRow(ctx, `
SELECT o.state = 'READY_FOR_PICKUP'
       AND EXISTS (SELECT 1 FROM dispatch d
                    WHERE d.order_id = o.id AND d.rider_account_id = $2
                      AND d.state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING'))
  FROM "order" o
 WHERE o.id = $1
   FOR UPDATE OF o`, orderID, riderAccountID).Scan(&due)
	return due, err
}

// restoreAvailabilityTx returns a rider from ON_DELIVERY to ONLINE_IDLE (or
// OFFLINE if go_offline_after_delivery), inside the caller's transaction.
func restoreAvailabilityTx(ctx context.Context, tx pgx.Tx, riderAccountID string) error {
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
	if _, err = tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, $2, $3, 'ASSIGNMENT_TERMINAL', 'SYSTEM')`, riderAccountID, from, to); err != nil {
		return err
	}
	return emitAvailability(ctx, tx, riderAccountID)
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

// podMethodAccepted reports whether a submitted proof method satisfies the
// assignment's required one. A met handover (OTP) accepts only the customer's
// delivery code: a photo or a statement never replaces it, before or after the
// code locks. Where a photo is required, a photo with a statement is accepted
// too (round-2 decisions, "Leave at door"; contracts/openapi.yaml,
// submitProofOfDelivery).
func podMethodAccepted(required, method string) bool {
	if required == "PHOTO" {
		return method == "PHOTO" || method == "PHOTO_WITH_ATTESTATION"
	}
	return method == required
}

// RecordPod records proof of delivery, which DELIVERED then requires in its own
// transaction (docs/spec/04-rider.md, "D-21 — Proof of delivery"). The method
// must satisfy the assignment's required_pod_method (podMethodAccepted). A met
// handover is proved only by the customer's delivery code, compared in constant
// time against the code stored on the order, with five wrong codes per order
// before it locks and the order goes to support (handover_codes.go;
// https://github.com/shaiknoorullah/hg-mono/issues/259).
// A photo must be a READY object with purpose POD.
//
// Only the order's current rider proves the handover: the assignment row is
// locked, and one that has ended (the order was moved to another rider, or
// cancelled) is refused before anything is compared. The wrong-code count
// lives on the order, so an old assignment id must never reach it: that rider
// could otherwise test guesses, or spend the next rider's five tries and lock
// the code.
func (s *Store) RecordPod(ctx context.Context, riderAccountID, assignmentID string, in PodInput) (*Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var requiredPod, orderID, state string
	var podObjectID *string
	var podRecorded, ended bool
	err = tx.QueryRow(ctx, `
SELECT COALESCE(required_pod_method::text, ''), order_id, pod_object_id, pod_recorded,
       state::text, terminated_at IS NOT NULL
FROM assignment WHERE id = $1 AND rider_account_id = $2 FOR UPDATE`,
		assignmentID, riderAccountID).Scan(&requiredPod, &orderID, &podObjectID, &podRecorded, &state, &ended)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errAssignmentNotFound
	}
	if err != nil {
		return nil, err
	}
	if ended {
		return nil, newError(409, CodeInvalidTransition, "This assignment has ended.",
			map[string]any{"current_state": state})
	}

	if requiredPod == "" {
		return nil, newError(422, CodePodRequired, "This delivery does not require proof of delivery.", nil)
	}
	if !podMethodAccepted(requiredPod, in.Method) {
		msg := "Wrong proof-of-delivery method."
		if requiredPod == "OTP" {
			msg = "This delivery needs a code from the customer, not a photo."
		}
		return nil, newError(422, CodePodMethodMismatch, msg,
			map[string]any{"required_pod_method": requiredPod})
	}

	switch in.Method {
	case "OTP":
		// The customer reads the code out at the door, so it is typed there:
		// at ARRIVED_AT_DROPOFF, the step a met handover's DELIVERED follows
		// (proof of delivery gates ARRIVED_AT_DROPOFF → DELIVERED:
		// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/04-rider.md#d-21--proof-of-delivery)
		// and the one support's override waits on. Anywhere else nothing is
		// compared or counted, so a rider cannot spend the five tries, or lock
		// the code, before reaching the customer (before pickup there is not
		// even a code to compare).
		if state != "ARRIVED_AT_DROPOFF" {
			return nil, newError(409, CodeInvalidTransition,
				"Enter the customer's code at the drop-off.",
				map[string]any{"current_state": state})
		}
		// A repeat after the code was accepted is a no-op: the code is not
		// compared again and nothing is counted.
		if podRecorded {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return s.LoadAssignment(ctx, riderAccountID, assignmentID)
		}
		refusal, err := codeGate(ctx, tx, orderID, handover.Delivery, in.OtpCode)
		if err != nil {
			return nil, err
		}
		if refusal != nil {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return nil, refusal
		}
	case "PHOTO", "PHOTO_WITH_ATTESTATION":
		if in.PhotoObjectID == nil {
			return nil, newError(422, CodePodRequired, "A proof photo is required.", nil)
		}
		// The object must be READY, purpose POD, uploaded by this rider for
		// this delivery's order: never another account's photo. Every other
		// object gets the same answer, so it says nothing about whether the
		// object exists (https://github.com/shaiknoorullah/hg-mono/issues/359).
		var ok bool
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM stored_object so
   WHERE so.id = $1 AND so.state = 'READY' AND so.purpose = 'POD' AND so.deleted_at IS NULL
     AND so.uploaded_by = $2
     AND so.order_id = (SELECT order_id FROM assignment WHERE id = $3))`,
			*in.PhotoObjectID, riderAccountID, assignmentID).Scan(&ok); err != nil {
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

// ---------------------------------------------------------------------------
// Reconciliation sweep (D-10). Backstop, not the mechanism.
// ---------------------------------------------------------------------------

// ReconcileAvailability returns every rider stuck in ON_DELIVERY with no live
// assignment (one is live until its terminated_at is set) to ONLINE_IDLE, or
// OFFLINE if they asked to go offline after the delivery. Each one is an anomaly, since an
// assignment's terminal step restores its rider in the same transaction
// (restoreAvailabilityTx), so each is written to rider_availability_event with
// reason RECONCILED and sent rider.availability_changed (events.go), in the
// transaction that moves it. It returns the riders it
// restored. Idempotent: a restored rider no longer matches, so a second run
// restores nobody. AvailabilitySweeper runs it every 60 s
// (availability_sweeper.go, https://github.com/shaiknoorullah/hg-mono/issues/255).
func (s *Store) ReconcileAvailability(ctx context.Context) ([]string, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
UPDATE rider_profile rp
   SET availability_state = (CASE WHEN rp.go_offline_after_delivery THEN 'OFFLINE' ELSE 'ONLINE_IDLE' END)::rider_availability_state,
       is_online = NOT rp.go_offline_after_delivery,
       availability_changed_at = now()
 WHERE rp.availability_state = 'ON_DELIVERY'
   AND NOT EXISTS (
         SELECT 1 FROM assignment a
          WHERE a.rider_account_id = rp.account_id
            AND a.terminated_at IS NULL)
RETURNING rp.account_id::text, rp.availability_state::text`)
	if err != nil {
		return nil, err
	}
	var ids, states []string
	for rows.Next() {
		var id, to string
		if err := rows.Scan(&id, &to); err != nil {
			rows.Close()
			return nil, err
		}
		ids, states = append(ids, id), append(states, to)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, id := range ids {
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, 'ON_DELIVERY', $2, 'RECONCILED', 'SYSTEM')`, id, states[i]); err != nil {
			return nil, err
		}
		// The rider app hears of the restore like any other availability
		// change, in this transaction
		// (https://github.com/shaiknoorullah/hg-mono/issues/379).
		if err := emitAvailability(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return ids, nil
}

// SweepStaleOnline moves ONLINE_IDLE riders whose location fix is older than the
// staleness window to ONLINE_STALE (D-10: not dispatchable, still "online").
// Each rider moved is sent rider.availability_changed in the same transaction
// (events.go).
func (s *Store) SweepStaleOnline(ctx context.Context, staleAfter time.Duration, now time.Time) (int64, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `
UPDATE rider_profile rp
   SET availability_state = 'ONLINE_STALE', availability_changed_at = now()
 WHERE rp.availability_state = 'ONLINE_IDLE'
   AND NOT EXISTS (
         SELECT 1 FROM rider_position pos
          WHERE pos.account_id = rp.account_id
            AND pos.received_at > $1)
RETURNING rp.account_id::text`, now.Add(-staleAfter))
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := emitAvailability(ctx, tx, id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int64(len(ids)), nil
}
