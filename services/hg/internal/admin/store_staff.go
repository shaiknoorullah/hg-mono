package admin

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// ErrEmailInUse is returned when an email already belongs to a live account.
var ErrEmailInUse = errors.New("admin: email in use")

// CreateStaff invites a staff account (A-01): it creates the account with no
// password, a staff_profile in INVITED, and a global role grant, mints the
// invitation (a single-use token and the email that carries it, through the
// auth module's StaffInviter), then audits it — all in one transaction.
func (r *Repo) CreateStaff(ctx context.Context, actor auditActor, in staffUserInput) (staffRow, error) {
	var out staffRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// A DEACTIVATED account's email reactivates that row (A-01 R1); here we
		// only guard the create path and reject a live duplicate.
		var existing string
		err := tx.QueryRow(ctx, `SELECT id FROM account WHERE lower(email::text)=lower($1) AND deleted_at IS NULL`, in.Email).Scan(&existing)
		if err == nil {
			return ErrEmailInUse
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		const insAcct = `
INSERT INTO account (email, status) VALUES ($1, 'ACTIVE')
RETURNING id, created_at`
		if err := tx.QueryRow(ctx, insAcct, in.Email).Scan(&out.ID, &out.CreatedAt); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrEmailInUse
			}
			return err
		}
		out.Email = in.Email
		out.FullName = in.FullName
		out.Role = in.Role
		out.Status = "INVITED"

		const insProfile = `
INSERT INTO staff_profile (account_id, full_name, status, created_by)
VALUES ($1, $2, 'INVITED', $3)`
		var createdBy any
		if actor.staffID != "" {
			createdBy = actor.staffID
		}
		if _, err := tx.Exec(ctx, insProfile, out.ID, in.FullName, createdBy); err != nil {
			return err
		}

		const insRole = `
INSERT INTO account_role (account_id, role, scope_type, granted_by)
VALUES ($1, $2, 'GLOBAL', $3)`
		if _, err := tx.Exec(ctx, insRole, out.ID, in.Role, createdBy); err != nil {
			return err
		}

		if r.inviter != nil {
			id, err := uuid.Parse(out.ID)
			if err != nil {
				return err
			}
			// The invitation names no one and quotes nothing the inviter
			// typed; the address is read from the account just created, and
			// the inviter is held to a daily limit (auth.Service.InviteStaff).
			inv := notify.StaffInvitation{AccountID: id, PlatformRole: in.Role}
			if by, err := uuid.Parse(actor.staffID); err == nil {
				inv.InvitedBy = by
			}
			if err := r.inviter.InviteStaff(ctx, tx, inv); err != nil {
				return err
			}
		}

		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "staff.create",
			subjectType: "STAFF_USER",
			subjectID:   &out.ID,
			outcome:     "SUCCESS",
			after:       map[string]any{"email": in.Email, "role": in.Role, "status": "INVITED"},
		})
	})
	return out, err
}
