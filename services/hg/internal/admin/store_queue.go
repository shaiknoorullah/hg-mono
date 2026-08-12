package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// restaurantAppRow is the restaurant application summary projection.
type restaurantAppRow struct {
	RestaurantID        string
	DisplayName         string
	City                *string
	Province            *string
	OnboardingState     string
	SubmissionCount     int
	AssignedAdminID     *string
	ReviewLockExpiresAt *time.Time
	SubmittedAt         time.Time
	SLADueAt            time.Time
}

// ListRestaurantApplications returns the onboarding review queue oldest-first by
// submitted_at (A-13, FIFO). Applications without a submitted_at are not yet in
// the queue and are excluded.
func (r *Repo) ListRestaurantApplications(ctx context.Context, states []string, limit int, cursorSubmitted *time.Time, cursorID *string) ([]restaurantAppRow, error) {
	const q = `
SELECT ra.restaurant_id, r.display_name, r.city, r.province::text, r.onboarding_state::text,
       ra.submission_count, ra.assigned_admin_id::text, ra.review_lock_expires_at,
       ra.submitted_at, ra.sla_due_at
  FROM restaurant_application ra
  JOIN restaurant r ON r.id = ra.restaurant_id
 WHERE ra.submitted_at IS NOT NULL AND ra.decided_at IS NULL
   AND (cardinality($1::text[]) = 0 OR r.onboarding_state::text = ANY($1))
   AND ($2::timestamptz IS NULL OR (ra.submitted_at, ra.restaurant_id) > ($2, $3::uuid))
 ORDER BY ra.submitted_at ASC, ra.restaurant_id ASC
 LIMIT $4`
	rows, err := r.pool.Query(ctx, q, states, cursorSubmitted, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []restaurantAppRow
	for rows.Next() {
		var a restaurantAppRow
		if err := rows.Scan(&a.RestaurantID, &a.DisplayName, &a.City, &a.Province, &a.OnboardingState,
			&a.SubmissionCount, &a.AssignedAdminID, &a.ReviewLockExpiresAt, &a.SubmittedAt, &a.SLADueAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// TakeNextRestaurantApplication atomically claims the oldest unassigned
// application with SELECT ... FOR UPDATE SKIP LOCKED (A-13), locking it to the
// admin for 60 minutes. Returns ErrNotFound when the queue is empty so the
// handler can render data:null.
func (r *Repo) TakeNextRestaurantApplication(ctx context.Context, actor auditActor) (restaurantAppRow, error) {
	var out restaurantAppRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		const sel = `
SELECT ra.restaurant_id
  FROM restaurant_application ra
 WHERE ra.submitted_at IS NOT NULL AND ra.decided_at IS NULL
   AND (ra.assigned_admin_id IS NULL OR ra.review_lock_expires_at < now())
 ORDER BY ra.submitted_at ASC
 FOR UPDATE OF ra SKIP LOCKED
 LIMIT 1`
		var id string
		if err := tx.QueryRow(ctx, sel).Scan(&id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		var assignedTo any
		if actor.staffID != "" {
			assignedTo = actor.staffID
		}
		const upd = `
UPDATE restaurant_application
   SET assigned_admin_id=$2, review_lock_expires_at = now() + interval '60 minutes'
 WHERE restaurant_id=$1`
		if _, err := tx.Exec(ctx, upd, id, assignedTo); err != nil {
			return err
		}
		var err error
		out, err = r.getRestaurantAppTx(ctx, tx, id)
		if err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "restaurant_application.claim",
			subjectType: "RESTAURANT",
			subjectID:   &id,
			outcome:     "SUCCESS",
		})
	})
	return out, err
}

func (r *Repo) getRestaurantAppTx(ctx context.Context, tx pgx.Tx, id string) (restaurantAppRow, error) {
	const q = `
SELECT ra.restaurant_id, r.display_name, r.city, r.province::text, r.onboarding_state::text,
       ra.submission_count, ra.assigned_admin_id::text, ra.review_lock_expires_at,
       ra.submitted_at, ra.sla_due_at
  FROM restaurant_application ra
  JOIN restaurant r ON r.id = ra.restaurant_id
 WHERE ra.restaurant_id = $1`
	var a restaurantAppRow
	err := tx.QueryRow(ctx, q, id).Scan(&a.RestaurantID, &a.DisplayName, &a.City, &a.Province,
		&a.OnboardingState, &a.SubmissionCount, &a.AssignedAdminID, &a.ReviewLockExpiresAt,
		&a.SubmittedAt, &a.SLADueAt)
	return a, err
}

// --- rider queue ---

type riderAppRow struct {
	AccountID           string
	DisplayName         string
	VehicleType         *string
	OnboardingState     string
	AttemptNumber       int
	AssignedAdminID     *string
	ReviewLockExpiresAt *time.Time
	SubmittedAt         time.Time
	SLADueAt            time.Time
}

// ListRiderApplications returns the rider onboarding queue oldest-first (A-23).
func (r *Repo) ListRiderApplications(ctx context.Context, states []string, limit int, cursorSubmitted *time.Time, cursorID *string) ([]riderAppRow, error) {
	const q = `
SELECT ra.account_id, (rp.first_name || ' ' || rp.last_name) AS display_name,
       rv.vehicle_type::text, rp.onboarding_state::text,
       ra.submission_count, ra.assigned_admin_id::text, ra.review_lock_expires_at,
       ra.submitted_at, ra.sla_due_at
  FROM rider_application ra
  JOIN rider_profile rp ON rp.account_id = ra.account_id
  LEFT JOIN rider_vehicle rv ON rv.account_id = ra.account_id
 WHERE ra.submitted_at IS NOT NULL AND ra.decided_at IS NULL
   AND (cardinality($1::text[]) = 0 OR rp.onboarding_state::text = ANY($1))
   AND ($2::timestamptz IS NULL OR (ra.submitted_at, ra.account_id) > ($2, $3::uuid))
 ORDER BY ra.submitted_at ASC, ra.account_id ASC
 LIMIT $4`
	rows, err := r.pool.Query(ctx, q, states, cursorSubmitted, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []riderAppRow
	for rows.Next() {
		var a riderAppRow
		if err := rows.Scan(&a.AccountID, &a.DisplayName, &a.VehicleType, &a.OnboardingState,
			&a.AttemptNumber, &a.AssignedAdminID, &a.ReviewLockExpiresAt, &a.SubmittedAt, &a.SLADueAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// TakeNextRiderApplication atomically claims the oldest unassigned rider
// application (A-23), SKIP LOCKED, 60-minute lock.
func (r *Repo) TakeNextRiderApplication(ctx context.Context, actor auditActor) (riderAppRow, error) {
	var out riderAppRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		const sel = `
SELECT ra.account_id
  FROM rider_application ra
 WHERE ra.submitted_at IS NOT NULL AND ra.decided_at IS NULL
   AND (ra.assigned_admin_id IS NULL OR ra.review_lock_expires_at < now())
 ORDER BY ra.submitted_at ASC
 FOR UPDATE OF ra SKIP LOCKED
 LIMIT 1`
		var id string
		if err := tx.QueryRow(ctx, sel).Scan(&id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		var assignedTo any
		if actor.staffID != "" {
			assignedTo = actor.staffID
		}
		if _, err := tx.Exec(ctx, `
UPDATE rider_application SET assigned_admin_id=$2, review_lock_expires_at = now() + interval '60 minutes'
 WHERE account_id=$1`, id, assignedTo); err != nil {
			return err
		}
		const q = `
SELECT ra.account_id, (rp.first_name || ' ' || rp.last_name), rv.vehicle_type::text,
       rp.onboarding_state::text, ra.submission_count, ra.assigned_admin_id::text,
       ra.review_lock_expires_at, ra.submitted_at, ra.sla_due_at
  FROM rider_application ra
  JOIN rider_profile rp ON rp.account_id = ra.account_id
  LEFT JOIN rider_vehicle rv ON rv.account_id = ra.account_id
 WHERE ra.account_id=$1`
		if err := tx.QueryRow(ctx, q, id).Scan(&out.AccountID, &out.DisplayName, &out.VehicleType,
			&out.OnboardingState, &out.AttemptNumber, &out.AssignedAdminID, &out.ReviewLockExpiresAt,
			&out.SubmittedAt, &out.SLADueAt); err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "rider_application.claim",
			subjectType: "RIDER",
			subjectID:   &id,
			outcome:     "SUCCESS",
		})
	})
	return out, err
}
