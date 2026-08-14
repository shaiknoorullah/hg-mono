package dispatch

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RiderGateState is what the availability check needs to decide can-go-online.
type RiderGateState struct {
	OnboardingState     string
	AccountStatus       string
	AvailabilityState   string
	AvailabilityChanged *time.Time
	GoOfflineAfterDel   bool
	PayoutsEnabled      bool
	HasFreshFix         bool
	Exists              bool
}

// LoadRiderGate reads the rider's onboarding/account/availability state plus
// whether a payout account is ready and a fresh location fix exists.
func (s *Store) LoadRiderGate(ctx context.Context, riderAccountID string, freshBefore time.Duration, now time.Time) (RiderGateState, error) {
	const q = `
SELECT rp.onboarding_state::text, rp.account_status::text,
       rp.availability_state::text, rp.availability_changed_at,
       rp.go_offline_after_delivery,
       COALESCE((SELECT ca.payouts_enabled FROM connect_account ca
                  WHERE ca.owner_type = 'RIDER' AND ca.owner_id = rp.account_id), false),
       EXISTS (SELECT 1 FROM rider_position pos
                WHERE pos.account_id = rp.account_id
                  AND pos.received_at > $2)
FROM rider_profile rp
WHERE rp.account_id = $1 AND rp.deleted_at IS NULL`
	var g RiderGateState
	err := s.db.QueryRow(ctx, q, riderAccountID, now.Add(-freshBefore)).Scan(
		&g.OnboardingState, &g.AccountStatus, &g.AvailabilityState,
		&g.AvailabilityChanged, &g.GoOfflineAfterDel, &g.PayoutsEnabled, &g.HasFreshFix)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, nil
	}
	if err != nil {
		return g, err
	}
	g.Exists = true
	return g, nil
}

// SetAvailability performs the availability transition and (when going online)
// writes the fresh position, all in one transaction. It returns the resulting
// state and the timestamp it changed at. Callers must have already gated
// eligibility for going online; this method enforces only the invariants that
// are cheap and correctness-critical (no going OFFLINE while ON_DELIVERY).
func (s *Store) SetAvailability(ctx context.Context, riderAccountID string, online bool, lat, lng, accuracy *float64, goOfflineAfter *bool, now time.Time) (string, time.Time, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", time.Time{}, err
	}
	defer tx.Rollback(ctx)

	var cur string
	err = tx.QueryRow(ctx, `
SELECT availability_state::text FROM rider_profile
WHERE account_id = $1 AND deleted_at IS NULL FOR UPDATE`, riderAccountID).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, errors.New("rider not found")
	}
	if err != nil {
		return "", time.Time{}, err
	}

	target := "OFFLINE"
	if online {
		// Preserve ON_DELIVERY: going "online" while on a delivery is a no-op for
		// the state (the rider is already effectively online).
		if cur == "ON_DELIVERY" {
			target = "ON_DELIVERY"
		} else {
			target = "ONLINE_IDLE"
		}
	} else {
		if cur == "ON_DELIVERY" {
			// Cannot go offline mid-delivery; the rider must set the flag instead.
			return "", time.Time{}, newError(409, CodeActiveDeliveryInProgres,
				"You cannot go offline while a delivery is in progress.",
				map[string]any{"suggestion": "SET_GO_OFFLINE_AFTER_DELIVERY"})
		}
		target = "OFFLINE"
	}

	// Persist the fresh fix when going online with coordinates.
	if online && lat != nil && lng != nil {
		var accVal any
		if accuracy != nil {
			accVal = *accuracy
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, now())
ON CONFLICT (account_id) DO UPDATE
   SET location = EXCLUDED.location, accuracy_m = EXCLUDED.accuracy_m,
       recorded_at = EXCLUDED.recorded_at, received_at = now()`,
			riderAccountID, *lng, *lat, accVal, now); err != nil {
			return "", time.Time{}, err
		}
	}

	// is_online must agree with the target state (CHECK rider_online_agrees):
	// only OFFLINE is not-online; ONLINE_IDLE and ON_DELIVERY are online. Omitting
	// it left the boolean stale on every state change → the UPDATE violated the
	// CHECK and every go-online/go-offline write 500'd.
	onlineTarget := target != "OFFLINE"
	var changedAt time.Time
	if goOfflineAfter != nil {
		err = tx.QueryRow(ctx, `
UPDATE rider_profile
   SET availability_state = $2, is_online = $4, availability_changed_at = now(),
       go_offline_after_delivery = $3
 WHERE account_id = $1
RETURNING availability_changed_at`, riderAccountID, target, *goOfflineAfter, onlineTarget).Scan(&changedAt)
	} else {
		err = tx.QueryRow(ctx, `
UPDATE rider_profile
   SET availability_state = $2, is_online = $3, availability_changed_at = now()
 WHERE account_id = $1
RETURNING availability_changed_at`, riderAccountID, target, onlineTarget).Scan(&changedAt)
	}
	if err != nil {
		return "", time.Time{}, err
	}

	if cur != target {
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_availability_event (account_id, from_state, to_state, reason, actor_kind, location)
VALUES ($1, $2, $3, 'RIDER_TOGGLE', 'RIDER',
        CASE WHEN $4::float8 IS NOT NULL AND $5::float8 IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography ELSE NULL END)`,
			riderAccountID, cur, target, lng, lat); err != nil {
			return "", time.Time{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", time.Time{}, err
	}
	return target, changedAt, nil
}

// GoOfflineAfterDelivery reads the current flag for the availability response.
func (s *Store) GoOfflineAfterDelivery(ctx context.Context, riderAccountID string) (bool, error) {
	var v bool
	err := s.db.QueryRow(ctx, `
SELECT go_offline_after_delivery FROM rider_profile WHERE account_id = $1`, riderAccountID).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return v, err
}

// ---------------------------------------------------------------------------
// Position ingest (D-11 / D-12).
// ---------------------------------------------------------------------------

// PositionPoint is one accepted-or-rejected fix from a batch.
type PositionPoint struct {
	Lat, Lng   float64
	AccuracyM  *float64
	HeadingDeg *float64
	SpeedMps   *float64
	BatteryPct *int32
	RecordedAt time.Time
	Assignment *string
}

// IngestPositions upserts the newest accepted point onto rider_position and
// appends every accepted point to rider_position_history. rejectedIdx maps a
// batch index to a rejection code; those points are not stored. It refuses to
// store any location while the rider is OFFLINE (D-11: no collection offline).
func (s *Store) IngestPositions(ctx context.Context, riderAccountID string, pts []PositionPoint, rejected map[int]string, accuracyThresholdM float64, now time.Time) (int, *time.Time, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(ctx)

	var avail string
	if err := tx.QueryRow(ctx, `
SELECT availability_state::text FROM rider_profile WHERE account_id = $1`, riderAccountID).Scan(&avail); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil, errors.New("rider not found")
		}
		return 0, nil, err
	}
	if avail == "OFFLINE" {
		// Silently accept nothing while offline; the client must not stream then.
		return 0, nil, tx.Commit(ctx)
	}

	accepted := 0
	var newest *PositionPoint
	for i := range pts {
		if _, bad := rejected[i]; bad {
			continue
		}
		p := pts[i]
		// Append to history (kept even for low-accuracy points).
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_position_history (account_id, order_id, assignment_id, location, accuracy_m, heading_deg, speed_mps, recorded_at, received_at)
VALUES ($1, NULL, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6, $7, $8, now())`,
			riderAccountID, p.Assignment, p.Lng, p.Lat, ptrF(p.AccuracyM), ptrF(p.HeadingDeg), ptrF(p.SpeedMps), p.RecordedAt); err != nil {
			return 0, nil, err
		}
		accepted++
		// The current position is the newest point whose accuracy is within the
		// dispatch threshold; low-accuracy points are excluded (D-11).
		if p.AccuracyM != nil && *p.AccuracyM > accuracyThresholdM {
			continue
		}
		if newest == nil || p.RecordedAt.After(newest.RecordedAt) {
			cp := p
			newest = &cp
		}
	}

	var current *time.Time
	if newest != nil {
		if _, err := tx.Exec(ctx, `
INSERT INTO rider_position (account_id, location, accuracy_m, heading_deg, speed_mps, battery_pct, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7, $8, now())
ON CONFLICT (account_id) DO UPDATE
   SET location = EXCLUDED.location, accuracy_m = EXCLUDED.accuracy_m,
       heading_deg = EXCLUDED.heading_deg, speed_mps = EXCLUDED.speed_mps,
       battery_pct = EXCLUDED.battery_pct, recorded_at = EXCLUDED.recorded_at,
       received_at = now()
 WHERE rider_position.recorded_at <= EXCLUDED.recorded_at`,
			riderAccountID, newest.Lng, newest.Lat, ptrF(newest.AccuracyM), ptrF(newest.HeadingDeg), ptrF(newest.SpeedMps), ptrI(newest.BatteryPct), newest.RecordedAt); err != nil {
			return 0, nil, err
		}
		// A location update returns ONLINE_STALE riders to ONLINE_IDLE (D-10).
		if _, err := tx.Exec(ctx, `
UPDATE rider_profile SET availability_state = 'ONLINE_IDLE', availability_changed_at = now()
 WHERE account_id = $1 AND availability_state = 'ONLINE_STALE'`, riderAccountID); err != nil {
			return 0, nil, err
		}
		t := newest.RecordedAt
		current = &t
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, nil, err
	}
	return accepted, current, nil
}

func ptrF(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func ptrI(p *int32) any {
	if p == nil {
		return nil
	}
	return *p
}
