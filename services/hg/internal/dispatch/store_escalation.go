package dispatch

import (
	"context"
	"time"
)

// waveToEscalate is a dispatch whose current offer wave has lapsed and which is
// still searching for a rider.
type waveToEscalate struct {
	OrderID  string
	Wave     int
	RadiusM  int
	ElapsedS int // seconds since the dispatch row was created (D-15 max_total_seconds)
}

// FindWavesToEscalate returns dispatches still SEARCHING/OFFERED (no rider yet)
// whose wave deadline — plus the inter-wave gap — has passed, so the next wave is
// due (D-15). ExpireDueOffers should be run first so the lapsed offers are already
// EXPIRED and excluded from the next candidate set.
func (s *Store) FindWavesToEscalate(ctx context.Context, now time.Time, gap time.Duration) ([]waveToEscalate, error) {
	rows, err := s.db.Query(ctx, `
SELECT order_id::text, wave, radius_m,
       GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - created_at))::int)
  FROM dispatch
 WHERE state IN ('SEARCHING', 'OFFERED')
   AND rider_account_id IS NULL
   AND deadline_action = 'NEXT_WAVE'
   AND deadline_at IS NOT NULL
   AND deadline_at + ($2 * interval '1 second') <= $1
 ORDER BY deadline_at
 LIMIT 200`, now, gap.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []waveToEscalate
	for rows.Next() {
		var w waveToEscalate
		if err := rows.Scan(&w.OrderID, &w.Wave, &w.RadiusM, &w.ElapsedS); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// MarkNoRiderFound ends the search for an order that exhausted the wave/radius/time
// budget with no acceptance (D-15 hard stop). Idempotent and safe: it only touches a
// still-searching, unassigned dispatch, so it can never clobber an accept.
func (s *Store) MarkNoRiderFound(ctx context.Context, orderID string) error {
	_, err := s.db.Exec(ctx, `
UPDATE dispatch
   SET state = 'NO_RIDER_FOUND', state_since = now(),
       deadline_at = NULL, deadline_action = NULL
 WHERE order_id = $1
   AND state IN ('SEARCHING', 'OFFERED')
   AND rider_account_id IS NULL`, orderID)
	return err
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

// nextRadiusIndex returns the index of the next-wider radius in the ladder after
// the given one, or -1 when the ladder is exhausted.
func nextRadiusIndex(radiusM int) int {
	for i, r := range radiusLadderM {
		if r == radiusM {
			if i+1 < len(radiusLadderM) {
				return i + 1
			}
			return -1
		}
	}
	// Unknown radius (shouldn't happen): widen from the smallest rung.
	return 0
}
