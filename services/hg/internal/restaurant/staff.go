package restaurant

// staff.go — restaurant-scoped staff management (contract:
// listRestaurantStaff / createRestaurantStaffUser). This is the
// restaurant-scoped counterpart to admin's platform-role-only /v1/admin/staff:
// an owner or manager invites RESTAURANT_STAFF accounts for their own
// restaurant, never a platform role and never another restaurant's roster.
//
// Reuses account / account_role (P-01: one account per human, roles as
// grants) but writes to its own restaurant_staff_profile table (migration
// 00026) rather than admin's staff_profile — that table backs the
// platform-role-only listStaff, whose query joins staff_profile
// unconditionally; sharing it here would leak restaurant staff into the
// platform roster with a null Role and fail listStaff's own schema. The scope
// is scope_type='RESTAURANT', scope_id=the caller's restaurant, and role is
// pinned to RESTAURANT_STAFF (an owner or manager cannot self-serve a new
// RESTAURANT_MANAGER grant this way).

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrStaffEmailInUse is returned when an email already belongs to a live account.
var ErrStaffEmailInUse = errors.New("restaurant: email in use")

// StaffRow is the restaurant-scoped staff projection (contract RestaurantStaffUser).
type StaffRow struct {
	ID          string
	Email       string
	FullName    string
	Role        string
	Status      string
	LastLoginAt *time.Time
	CreatedAt   time.Time
}

// StaffInput is the contract's RestaurantStaffUserInput.
type StaffInput struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
}

// ListStaff returns every account holding RESTAURANT_MANAGER or
// RESTAURANT_STAFF scoped to restaurantID, keyset-paginated by created_at, id.
func (r *Repo) ListStaff(ctx context.Context, restaurantID string, limit int, cursorCreatedAt *time.Time, cursorID *string) ([]StaffRow, error) {
	const q = `
SELECT a.id, a.email, sp.full_name, ar.role::text, sp.status::text, sp.last_login_at, a.created_at
  FROM account_role ar
  JOIN account a ON a.id = ar.account_id
  JOIN restaurant_staff_profile sp ON sp.account_id = a.id
 WHERE ar.scope_type = 'RESTAURANT'
   AND ar.scope_id = $1::uuid
   AND ar.role IN ('RESTAURANT_MANAGER','RESTAURANT_STAFF')
   AND ar.revoked_at IS NULL
   AND a.deleted_at IS NULL
   AND (a.created_at, a.id) > (COALESCE($2, 'epoch'::timestamptz), COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid))
 ORDER BY a.created_at ASC, a.id ASC
 LIMIT $4`
	var cid any
	if cursorID != nil {
		cid = *cursorID
	}
	rows, err := r.db.Query(ctx, q, restaurantID, cursorCreatedAt, cid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StaffRow
	for rows.Next() {
		var s StaffRow
		if err := rows.Scan(&s.ID, &s.Email, &s.FullName, &s.Role, &s.Status, &s.LastLoginAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CreateStaff invites a RESTAURANT_STAFF account scoped to restaurantID. Same
// shape as admin's platform CreateStaff: no password, account created ACTIVE
// with an INVITED restaurant_staff_profile, one account_role grant, and one audit_event
// — all in one transaction.
func (r *Repo) CreateStaff(ctx context.Context, actorAccountID string, actorRoles []string, restaurantID string, in StaffInput) (StaffRow, error) {
	var out StaffRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var existing string
		err := tx.QueryRow(ctx, `SELECT id FROM account WHERE lower(email::text)=lower($1) AND deleted_at IS NULL`, in.Email).Scan(&existing)
		if err == nil {
			return ErrStaffEmailInUse
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		// A new account starts ACTIVE by default; the API may not name an account's
		// status (migration 00045).
		const insAcct = `INSERT INTO account (email) VALUES ($1) RETURNING id, created_at`
		if err := tx.QueryRow(ctx, insAcct, in.Email).Scan(&out.ID, &out.CreatedAt); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrStaffEmailInUse
			}
			return err
		}
		out.Email = in.Email
		out.FullName = in.FullName
		out.Role = "RESTAURANT_STAFF"
		out.Status = "INVITED"

		var createdBy any
		if actorAccountID != "" {
			createdBy = actorAccountID
		}
		const insProfile = `INSERT INTO restaurant_staff_profile (account_id, full_name, status, created_by) VALUES ($1, $2, 'INVITED', $3)`
		if _, err := tx.Exec(ctx, insProfile, out.ID, in.FullName, createdBy); err != nil {
			return err
		}

		const insRole = `INSERT INTO account_role (account_id, role, scope_type, scope_id, granted_by) VALUES ($1, 'RESTAURANT_STAFF', 'RESTAURANT', $2, $3)`
		if _, err := tx.Exec(ctx, insRole, out.ID, restaurantID, createdBy); err != nil {
			return err
		}

		after, _ := json.Marshal(map[string]any{
			"email": in.Email, "role": "RESTAURANT_STAFF", "status": "INVITED", "restaurant_id": restaurantID,
		})
		rolesJSON, _ := json.Marshal(actorRoles)
		var rjAny any
		if len(actorRoles) > 0 {
			rjAny = string(rolesJSON)
		}
		const insAudit = `
INSERT INTO audit_event
  (actor_kind, actor_account_id, actor_roles, action, subject_type, subject_id,
   outcome, after,
   day, seq, prev_hash, hash)
VALUES
  ('ACCOUNT', $1, $2, 'restaurant.staff.create', 'ACCOUNT', $3,
   'SUCCESS', $4,
   current_date, 0, '\x00'::bytea, '\x00'::bytea)`
		if _, err := tx.Exec(ctx, insAudit, actorAccountID, rjAny, out.ID, string(after)); err != nil {
			return err
		}
		return nil
	})
	return out, err
}

// inTx runs fn inside a transaction, committing on nil error and rolling back
// otherwise. Mirrors admin.Repo.inTx.
func (r *Repo) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
