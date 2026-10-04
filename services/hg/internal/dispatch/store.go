package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// Store is this module's data access. It owns only the tables the dispatch spec
// owns (dispatch, dispatch_wave, dispatch_offer, assignment, assignment_transition)
// plus the reads it needs across rider_profile / rider_position / order.
//
// Redis is deliberately absent from every correctness-critical path: acceptance
// is a conditional UPDATE in Postgres and nothing else, so accept still succeeds
// with Redis entirely down (D-16 acceptance criterion 4).
type Store struct {
	db *pgxpool.Pool
}

// NewStore builds a Store over the shared pool.
func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

// ---------------------------------------------------------------------------
// Candidate search — PostGIS ST_DWithin on the single rider_position.location
// column, with the radius ladder (D-13 step 1). No Redis GEO anywhere.
// ---------------------------------------------------------------------------

// Candidate is one row of the candidate query.
type Candidate struct {
	RiderAccountID  string
	PickupDistanceM float64
}

// FindCandidates runs the single-query PostGIS candidate search for one order at
// one radius. It returns riders who are ONLINE_IDLE, approved, active, have a
// fresh location fix within the radius, payouts enabled, and who have neither an
// open pending offer nor a prior REJECTED/EXPIRED offer for this order.
//
// FOR UPDATE SKIP LOCKED locks the rider_position rows so two concurrent
// dispatch runs cannot both hand the same rider an offer.
func (s *Store) FindCandidates(ctx context.Context, orderID string, pickupLng, pickupLat float64, radiusM, limit int) ([]Candidate, error) {
	const q = `
SELECT rp.account_id,
       ST_Distance(rpos.location,
                   ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS pickup_distance_m
FROM rider_profile rp
JOIN rider_position rpos ON rpos.account_id = rp.account_id
JOIN connect_account ca
  ON ca.owner_type = 'RIDER' AND ca.owner_id = rp.account_id AND ca.payouts_enabled
WHERE rp.onboarding_state   = 'ACTIVE'
  AND rp.account_status      = 'ACTIVE'
  AND rp.availability_state   = 'ONLINE_IDLE'
  AND rp.deleted_at IS NULL
  AND rpos.received_at > now() - make_interval(secs => $4)
  AND ST_DWithin(rpos.location,
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                 $5)
  AND NOT EXISTS (
        SELECT 1 FROM dispatch_offer o
         WHERE o.rider_account_id = rp.account_id
           AND o.order_id = $1
           AND o.state IN ('REJECTED', 'EXPIRED', 'ACCEPTED', 'WITHDRAWN'))
  AND NOT EXISTS (
        SELECT 1 FROM dispatch_offer o
         WHERE o.rider_account_id = rp.account_id
           AND o.state = 'PENDING')
ORDER BY pickup_distance_m ASC
LIMIT $6
FOR UPDATE OF rpos SKIP LOCKED`

	rows, err := s.db.Query(ctx, q, orderID, pickupLng, pickupLat, locationFreshness.Seconds(), radiusM, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Candidate
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.RiderAccountID, &c.PickupDistanceM); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Order pickup location + earnings basis (read model for dispatch).
// ---------------------------------------------------------------------------

// OrderDispatchInfo is what dispatch needs about an order to build offers.
type OrderDispatchInfo struct {
	OrderID          string
	Code             string
	State            string
	RestaurantName   string
	PickupLat        float64
	PickupLng        float64
	DeliveryFeeCents int64
	TipCents         int64
}

// LoadOrderDispatchInfo reads the order's pickup location and money basis.
func (s *Store) LoadOrderDispatchInfo(ctx context.Context, orderID string) (*OrderDispatchInfo, error) {
	const q = `
SELECT o.id, o.code, o.state::text, r.display_name,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       o.delivery_fee_cents, o.tip_cents
FROM "order" o
JOIN restaurant r ON r.id = o.restaurant_id
WHERE o.id = $1 AND r.location IS NOT NULL`
	var info OrderDispatchInfo
	err := s.db.QueryRow(ctx, q, orderID).Scan(
		&info.OrderID, &info.Code, &info.State, &info.RestaurantName,
		&info.PickupLat, &info.PickupLng, &info.DeliveryFeeCents, &info.TipCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("order or restaurant location not found")
	}
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// ---------------------------------------------------------------------------
// Offer creation (a wave) and expiry.
// ---------------------------------------------------------------------------

// InsertedOffer identifies a persisted offer.
type InsertedOffer struct {
	OfferID        string
	RiderAccountID string
}

// CreateWave persists a dispatch_wave row and one dispatch_offer per candidate,
// all in one transaction. The partial unique index dispatch_offer_one_pending
// guarantees a rider cannot hold two pending offers; the unique
// dispatch_offer_unique guarantees a rider is offered a given order at most once.
func (s *Store) CreateWave(ctx context.Context, o *OrderDispatchInfo, waveNo, radiusM int, cands []Candidate, offers []offerRow, expiresAt time.Time) ([]InsertedOffer, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// The state before this wave, for dispatch.state_changed (events.go).
	prevState, err := dispatchStateFor(ctx, tx, o.OrderID)
	if err != nil {
		return nil, err
	}

	// The dispatch row is the single source of truth for a live delivery and the
	// load-bearing arbiter of the race-free accept (AcceptOffer locks and guards
	// on it). A wave cannot exist without it, so upsert it here in SEARCHING —
	// idempotently, inside the same transaction as the wave — otherwise an order
	// dispatched only by the backstop sweep (which never creates a dispatch row
	// otherwise) can never be accepted, and the sweep re-fires wave 1 every tick.
	//
	// ON CONFLICT bumps wave/radius on a re-run while the order is still being
	// searched, but never disturbs a row that has already been ASSIGNED (or is
	// otherwise past SEARCHING/OFFERED/PENDING): the WHERE guard leaves it intact.
	if _, err := tx.Exec(ctx, `
INSERT INTO dispatch (order_id, state, state_since, wave, radius_m, deadline_at, deadline_action)
VALUES ($1, 'SEARCHING', now(), $2, $3, $4, 'NEXT_WAVE')
ON CONFLICT (order_id) DO UPDATE
   SET wave = EXCLUDED.wave, radius_m = EXCLUDED.radius_m,
       state_since = now(), deadline_at = EXCLUDED.deadline_at, deadline_action = 'NEXT_WAVE'
 WHERE dispatch.state IN ('PENDING', 'SEARCHING', 'OFFERED')
   AND dispatch.rider_account_id IS NULL`,
		o.OrderID, waveNo, radiusM, expiresAt); err != nil {
		return nil, err
	}

	var waveID string
	err = tx.QueryRow(ctx, `
INSERT INTO dispatch_wave (order_id, wave_no, radius_m, candidates, offers_sent, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id`,
		o.OrderID, waveNo, radiusM, len(cands), len(offers), expiresAt).Scan(&waveID)
	if err != nil {
		return nil, err
	}

	var inserted []InsertedOffer
	for _, r := range offers {
		var offerID string
		err := tx.QueryRow(ctx, `
INSERT INTO dispatch_offer (
  order_id, dispatch_wave_id, rider_account_id, wave, distance_m, est_duration_s,
  earnings_cents, tip_estimate_cents, surge_multiplier_bps, score, rank_in_wave,
  state, offered_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 10000, $9, $10, 'PENDING', now(), $11)
RETURNING id`,
			o.OrderID, waveID, r.RiderAccountID, waveNo, r.DistanceM, r.EstDurationS,
			r.EarningsCents, r.TipCents, r.Score, r.RankInWave, expiresAt).Scan(&offerID)
		if err != nil {
			return nil, err
		}
		inserted = append(inserted, InsertedOffer{OfferID: offerID, RiderAccountID: r.RiderAccountID})
	}

	// The realtime events, in this transaction (events.go): the search state
	// on the order's channel, and each offer on its rider's channel.
	newState, err := dispatchStateFor(ctx, tx, o.OrderID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if err := emitDispatchState(ctx, tx, o.OrderID, prevState, newState, now); err != nil {
		return nil, err
	}
	if err := emitOffers(ctx, tx, inserted, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return inserted, nil
}

// offerRow is the per-candidate data for an offer insert.
type offerRow struct {
	RiderAccountID string
	DistanceM      int
	EstDurationS   *int
	EarningsCents  int64
	TipCents       int64
	Score          int
	RankInWave     int
}

// ExpireDueOffers transitions every PENDING offer whose expires_at has passed to
// EXPIRED, server-authoritatively (D-15). Returns the number expired. Idempotent.
//
// Each expired offer's rider is sent dispatch.offer_withdrawn ("expired") in the
// same transaction (events.go).
func (s *Store) ExpireDueOffers(ctx context.Context, now time.Time) (int64, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `
UPDATE dispatch_offer
   SET state = 'EXPIRED', outcome = 'EXPIRED', outcome_at = now()
 WHERE state = 'PENDING' AND expires_at <= $1
RETURNING id::text, order_id::text, rider_account_id::text`, now)
	if err != nil {
		return 0, err
	}
	expired, err := scanWithdrawn(rows)
	if err != nil {
		return 0, err
	}
	if err := emitWithdrawn(ctx, tx, expired, realtime.DispatchWithdrawnExpired); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int64(len(expired)), nil
}

// ---------------------------------------------------------------------------
// Race-free accept (D-16 / P-32). The conditional UPDATE on "order" is the sole
// arbiter of simultaneous accepts.
// ---------------------------------------------------------------------------

// acceptResult carries the current offer row state so the caller can pick the
// right 409 code when the accept loses the race.
type acceptOfferState struct {
	State     string
	OrderID   string
	ExpiresAt time.Time
}

// AcceptOffer runs the whole single-winner accept transaction. On success it
// returns the new assignment id. On any lost race it returns a *serviceError
// with the distinct 409 code the contract requires and rolls back cleanly.
func (s *Store) AcceptOffer(ctx context.Context, riderAccountID, offerID string, now time.Time) (string, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Step 0: read the offer for this rider. Missing ⇒ 404. We deliberately do NOT
	// lock the offer row here: the load-bearing arbiter is the order's dispatch row
	// (Step 2, guarded on rider_account_id IS NULL), and concurrent accepts for the
	// same order must take that order-level lock in a consistent order to stay
	// deadlock-free. Locking the per-rider offer row first would let the winner hold
	// the dispatch row while it withdraws the losers' offer rows (Step 5), each of
	// which a loser already holds while it waits on the dispatch row — a lock cycle.
	var st acceptOfferState
	err = tx.QueryRow(ctx, `
SELECT state::text, order_id, expires_at
FROM dispatch_offer
WHERE id = $1 AND rider_account_id = $2`, offerID, riderAccountID).Scan(&st.State, &st.OrderID, &st.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errOfferNotFound
	}
	if err != nil {
		return "", err
	}

	// Step 0a: serialise same-order accepts on the order's dispatch row BEFORE
	// touching any offer row. Every accept for this order now queues on this single
	// row lock, so lock acquisition is globally ordered (dispatch row, then offer
	// rows) and the Step 5 withdraw can never deadlock against a waiting loser.
	var prevDispatch string
	if err := tx.QueryRow(ctx, `SELECT state::text FROM dispatch WHERE order_id = $1 FOR UPDATE`, st.OrderID).Scan(&prevDispatch); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	// Decide the failure code from the current offer row state before touching
	// anything else. An expired-but-still-PENDING offer is OFFER_EXPIRED.
	switch st.State {
	case "PENDING":
		if !st.ExpiresAt.After(now) {
			return "", newError(409, CodeOfferExpired, "This offer has expired.", nil)
		}
	case "ACCEPTED":
		return "", newError(409, CodeOfferAlreadyTaken, "This order was taken by another rider.", nil)
	case "WITHDRAWN":
		return "", newError(409, CodeOfferWithdrawn, "This offer was withdrawn.", nil)
	case "EXPIRED":
		return "", newError(409, CodeOfferExpired, "This offer has expired.", nil)
	case "REJECTED":
		return "", newError(409, CodeOfferExpired, "This offer is no longer active.", nil)
	}

	// Step 1: claim the offer. Guarded again on state + expiry inside SQL so a
	// concurrent sweeper cannot slip an expiry between the read and the write.
	var claimedOrder, wave string
	var waveNo int
	var earningsCents, tipCents int64
	var offerDistanceM int
	var dispatchOfferID string
	err = tx.QueryRow(ctx, `
UPDATE dispatch_offer
   SET state = 'ACCEPTED', outcome = 'ACCEPTED', outcome_at = now(), seen_at = COALESCE(seen_at, now())
 WHERE id = $1 AND rider_account_id = $2 AND state = 'PENDING' AND expires_at > $3
RETURNING order_id, wave::text, wave, earnings_cents, tip_estimate_cents, distance_m, id`,
		offerID, riderAccountID, now).Scan(&claimedOrder, &wave, &waveNo, &earningsCents, &tipCents, &offerDistanceM, &dispatchOfferID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the race in the tiny window since the read. It expired.
		return "", newError(409, CodeOfferExpired, "This offer has expired.", nil)
	}
	if err != nil {
		return "", err
	}

	// Step 2 — THE arbiter. Exactly one transaction sees the order awaiting a
	// rider and unassigned; every other accept gets 0 rows ⇒ OFFER_ALREADY_TAKEN.
	//
	// The order lifecycle owner (orders module) drives order.state; dispatch may
	// only advance it through the three permitted transitions and never here.
	// Assignment is tracked on the dispatch row's rider_account_id, which is the
	// race column: NULL ⇒ unclaimed. We guard on the dispatch row rather than on
	// order.state so we never write order.state (P-14 forbids it outside the
	// orders transition function).
	var dispatchState string
	err = tx.QueryRow(ctx, `
UPDATE dispatch
   SET rider_account_id = $2, assigned_at = now(),
       state = 'ASSIGNED', state_since = now(),
       deadline_at = now() + interval '20 minutes',
       deadline_action = 'RIDER_NOT_ARRIVING'
 WHERE order_id = $1
   AND rider_account_id IS NULL
   AND state IN ('SEARCHING', 'OFFERED', 'PENDING')
RETURNING state::text`, claimedOrder, riderAccountID).Scan(&dispatchState)
	if errors.Is(err, pgx.ErrNoRows) {
		// The order is either already assigned to someone, or no longer searching
		// (cancelled). Distinguish for the right code.
		var ds string
		derr := tx.QueryRow(ctx, `SELECT state::text FROM dispatch WHERE order_id = $1`, claimedOrder).Scan(&ds)
		if errors.Is(derr, pgx.ErrNoRows) {
			return "", newError(409, CodeOrderCancelled, "This order is no longer available.", nil)
		}
		if derr != nil {
			return "", derr
		}
		switch ds {
		case "NO_RIDER_FOUND", "COMPLETED":
			return "", newError(409, CodeOrderCancelled, "This order is no longer available.", nil)
		default:
			return "", newError(409, CodeOfferAlreadyTaken, "This order was taken by another rider.", nil)
		}
	}
	if err != nil {
		return "", err
	}

	// Step 3: availability ONLINE_IDLE → ON_DELIVERY, same transaction (D-16).
	var newAvail string
	err = tx.QueryRow(ctx, `
UPDATE rider_profile
   SET availability_state = 'ON_DELIVERY', availability_changed_at = now()
 WHERE account_id = $1 AND availability_state = 'ONLINE_IDLE'
RETURNING availability_state::text`, riderAccountID).Scan(&newAvail)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", newError(409, CodeRiderNotAvailable, "You are not available to take an order.", nil)
	}
	if err != nil {
		return "", err
	}

	// Availability audit event.
	if _, err := tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, 'ONLINE_IDLE', 'ON_DELIVERY', 'OFFER_ACCEPTED', 'RIDER')`, riderAccountID); err != nil {
		return "", err
	}

	// Step 4: create the assignment. Required POD method derives from the order's
	// delivery instructions (D-21): a met-handover instruction ⇒ OTP, otherwise
	// PHOTO. LEAVE_AT_DOOR / DO_NOT_RING_BELL are unattended ⇒ PHOTO.
	var podMethod string
	if err := tx.QueryRow(ctx, `
SELECT CASE
         WHEN 'MEET_AT_DOOR' = ANY(o.delivery_instructions)
           OR 'MEET_IN_LOBBY' = ANY(o.delivery_instructions)
         THEN 'OTP'
         ELSE 'PHOTO'
       END
FROM "order" o WHERE o.id = $1`, claimedOrder).Scan(&podMethod); err != nil {
		return "", err
	}

	var assignmentID string
	err = tx.QueryRow(ctx, `
INSERT INTO assignment (
  order_id, rider_account_id, dispatch_offer_id, state, state_since,
  required_pod_method, billable_distance_m, assigned_at)
VALUES ($1, $2, $3, 'ASSIGNED', now(), $4, $5, now())
RETURNING id`, claimedOrder, riderAccountID, dispatchOfferID, podMethod, offerDistanceM).Scan(&assignmentID)
	if err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO assignment_transition (assignment_id, from_state, to_state, actor_kind, actor_account_id, reason)
VALUES ($1, NULL, 'ASSIGNED', 'RIDER', $2, 'ACCEPTED')`, assignmentID, riderAccountID); err != nil {
		return "", err
	}

	// Step 5: withdraw every other still-PENDING offer for this order (D-15).
	rows, err := tx.Query(ctx, `
UPDATE dispatch_offer
   SET state = 'WITHDRAWN', outcome = 'WITHDRAWN', outcome_at = now()
 WHERE order_id = $1 AND state = 'PENDING' AND id <> $2
RETURNING id::text, order_id::text, rider_account_id::text`, claimedOrder, dispatchOfferID)
	if err != nil {
		return "", err
	}
	taken, err := scanWithdrawn(rows)
	if err != nil {
		return "", err
	}

	// Step 6: the realtime events, in this transaction (events.go).
	if err := emitAssigned(ctx, tx, claimedOrder); err != nil {
		return "", err
	}
	if err := emitDispatchState(ctx, tx, claimedOrder, prevDispatch, dispatchState, now); err != nil {
		return "", err
	}
	if err := emitWithdrawn(ctx, tx, taken, realtime.DispatchWithdrawnTaken); err != nil {
		return "", err
	}
	if err := emitAvailability(ctx, tx, riderAccountID); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return assignmentID, nil
}

// ---------------------------------------------------------------------------
// Offer reject (D-17).
// ---------------------------------------------------------------------------

// RejectOffer moves a PENDING offer to REJECTED with a reason code. Rejecting an
// already-expired offer returns OFFER_EXPIRED (treated as a harmless no-op by the
// UI). It never changes availability.
func (s *Store) RejectOffer(ctx context.Context, riderAccountID, offerID, reasonCode string, note *string, now time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var state string
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
SELECT state::text, expires_at FROM dispatch_offer
WHERE id = $1 AND rider_account_id = $2 FOR UPDATE`, offerID, riderAccountID).Scan(&state, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return errOfferNotFound
	}
	if err != nil {
		return err
	}
	if state != "PENDING" || !expiresAt.After(now) {
		return newError(409, CodeOfferExpired, "This offer is no longer active.", nil)
	}

	if _, err := tx.Exec(ctx, `
UPDATE dispatch_offer
   SET state = 'REJECTED', outcome = 'REJECTED', outcome_at = now(),
       reject_reason_code = $3, seen_at = COALESCE(seen_at, now())
 WHERE id = $1 AND rider_account_id = $2 AND state = 'PENDING'`,
		offerID, riderAccountID, reasonCode); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
