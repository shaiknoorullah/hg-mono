package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// waveToEscalate is a dispatch whose current offer wave has lapsed and which is
// still searching for a rider.
type waveToEscalate struct {
	OrderID  string
	Wave     int
	RadiusM  int
	ElapsedS int // seconds since the dispatch row was created (D-15 max_total_seconds)
	// LastWaveEmpty is set when the lapsed wave found nobody within RadiusM,
	// so the next wave searches one rung wider (escalateOne).
	LastWaveEmpty bool
}

// ClaimWavesToEscalate claims the dispatches still SEARCHING/OFFERED (no rider
// yet) whose wave deadline — plus the inter-wave gap — has passed, so the next
// wave is due (D-15). ExpireDueOffers should be run first so the lapsed offers
// are already EXPIRED and excluded from the next candidate set.
//
// Every replica runs the dispatch runner, so the claim takes the dispatch
// row's lease, as the runner mechanics do for every deadline
// (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions"): FOR
// UPDATE SKIP LOCKED, then lease_until/lease_owner for escalationLease. A
// search another replica holds is skipped until its lease lapses; the wave's
// writer releases it (CreateWave), and so does MarkNoRiderFound. Two replicas
// therefore never run the same search's next wave or end it twice
// (https://github.com/shaiknoorullah/hg-mono/issues/294).
func (s *Store) ClaimWavesToEscalate(ctx context.Context, now time.Time, gap time.Duration, owner string) ([]waveToEscalate, error) {
	rows, err := s.db.Query(ctx, `
WITH due AS (
  SELECT order_id FROM dispatch
   WHERE state IN ('SEARCHING', 'OFFERED')
     AND rider_account_id IS NULL
     AND deadline_action = 'NEXT_WAVE'
     AND deadline_at IS NOT NULL
     AND deadline_at + ($2 * interval '1 second') <= $1
     AND (lease_until IS NULL OR lease_until <= $1)
   ORDER BY deadline_at
   LIMIT 200
   FOR UPDATE SKIP LOCKED)
UPDATE dispatch d
   SET lease_until = $1::timestamptz + ($3 * interval '1 second'), lease_owner = $4
  FROM due
 WHERE d.order_id = due.order_id
RETURNING d.order_id::text, d.wave, d.radius_m,
       GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - d.created_at))::int),
       COALESCE((SELECT w.offers_sent = 0 FROM dispatch_wave w
                  WHERE w.order_id = d.order_id AND w.wave_no = d.wave), false)`,
		now, gap.Seconds(), escalationLease.Seconds(), owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []waveToEscalate
	for rows.Next() {
		var w waveToEscalate
		if err := rows.Scan(&w.OrderID, &w.Wave, &w.RadiusM, &w.ElapsedS, &w.LastWaveEmpty); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// MarkNoRiderFound ends the search for an order that exhausted the wave/radius/time
// budget with no acceptance (D-15 hard stop). Idempotent and safe: it only touches a
// still-searching, unassigned dispatch, so it can never clobber an accept.
//
// It ends the dispatch only. The order stays READY_FOR_PICKUP: dispatch may
// never cancel an order, and NO_RIDER_FOUND hands the order to its own
// READY_FOR_PICKUP deadline instead, which escalates and, at its cap, cancels
// with a full refund (docs/spec/01-platform.md: the dispatch sub-machine in
// "P-14 — Order lifecycle states and transitions", and the order deadline
// table in "P-15 — Deadlines and timeout actions"). No money moves here: the payment was captured when the
// restaurant accepted, and the refund belongs to that cancellation
// (https://github.com/shaiknoorullah/hg-mono/issues/336).
//
// The customer, the restaurant and ops hear of it in the same transaction:
// dispatch.state_changed on the order's channel and admin.dispatch_failure on
// admin:ops (docs/spec/01-platform.md, "P-32 — Rider search and offer",
// acceptance criterion 3; events_no_rider.go). Only the call that
// moves the row writes them, so a second replica's call says nothing.
func (s *Store) MarkNoRiderFound(ctx context.Context, orderID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var from string
	var waves, radiusM int
	err = tx.QueryRow(ctx, `
WITH prev AS (
  SELECT order_id, state FROM dispatch
   WHERE order_id = $1
     AND state IN ('SEARCHING', 'OFFERED')
     AND rider_account_id IS NULL
   FOR UPDATE)
UPDATE dispatch d
   SET state = 'NO_RIDER_FOUND', state_since = now(),
       deadline_at = NULL, deadline_action = NULL,
       lease_until = NULL, lease_owner = NULL
  FROM prev
 WHERE d.order_id = prev.order_id
RETURNING prev.state::text, d.wave, d.radius_m`, orderID).Scan(&from, &waves, &radiusM)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // already ended, or a rider took it: nothing to say
	}
	if err != nil {
		return err
	}
	if err := emitNoRiderFound(ctx, tx, orderID, from, waves, radiusM, time.Now().UTC()); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SweepUnresponsiveRiders forces OFFLINE any online rider whose three most-recent
// resolved offers are all EXPIRED — no interaction at all (spec 04-rider §auto-
// offline). Explicit rejections or accepts break the streak. is_online is set false
// so the row still satisfies CHECK rider_online_agrees. Returns the count offlined.
func (s *Store) SweepUnresponsiveRiders(ctx context.Context) (int64, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
WITH ranked AS (
  SELECT rider_account_id, outcome,
         row_number() OVER (PARTITION BY rider_account_id ORDER BY outcome_at DESC) AS rn
    FROM dispatch_offer
   WHERE outcome IS NOT NULL
), unresponsive AS (
  SELECT rider_account_id
    FROM ranked
   WHERE rn <= 3
   GROUP BY rider_account_id
  HAVING count(*) = 3
     AND count(*) FILTER (WHERE outcome = 'EXPIRED') = 3
)
UPDATE rider_profile rp
   SET availability_state = 'OFFLINE', is_online = false, availability_changed_at = now()
  FROM unresponsive u
 WHERE rp.account_id = u.rider_account_id
   AND rp.availability_state IN ('ONLINE_IDLE', 'ONLINE_STALE')
RETURNING rp.account_id::text`)
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
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind)
VALUES ($1, 'ONLINE_IDLE', 'OFFLINE', 'UNRESPONSIVE', 'SYSTEM')`, id); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int64(len(ids)), nil
}
