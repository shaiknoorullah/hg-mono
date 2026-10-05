package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// ErrNotFound is returned by the repository when a row does not exist.
var ErrNotFound = errors.New("admin: not found")

// Repo is the admin module's data access. It takes the shared pgx pool; it never
// opens its own. Every mutation that changes state writes exactly one
// audit_event in the same transaction as the change (A-04), which the audit
// BEFORE INSERT trigger chains and seals — the handler supplies actor identity
// from the verified principal, never from a request body.
type Repo struct {
	pool *pgxpool.Pool

	// notify and inviter send the messages a decision or an invitation owes
	// someone, inside the same transaction (internal/notify). Nil sends
	// nothing, which only tests rely on.
	notify  notify.TxEnqueuer
	inviter notify.StaffInviter
}

// NewRepo builds the repository over the shared pool.
func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// WithNotifications wires the notification outbox and the staff inviter
// (auth.Module.StaffInviter). Call once at boot.
func (r *Repo) WithNotifications(enq notify.TxEnqueuer, inviter notify.StaffInviter) *Repo {
	r.notify = enq
	r.inviter = inviter
	return r
}

// --- Staff (A-01) ---

// staffRow is the staff projection joining account and staff_profile.
type staffRow struct {
	ID          string
	Email       string
	FullName    string
	Role        string
	Status      string
	MFAEnrolled bool
	LastLoginAt *time.Time
	CreatedAt   time.Time
}

// ListStaff returns staff accounts (accounts holding a staff role, joined to
// staff_profile) keyset-paginated by created_at, id. A-01: admins read; only a
// super admin mutates.
func (r *Repo) ListStaff(ctx context.Context, limit int, cursorCreatedAt *time.Time, cursorID *string) ([]staffRow, error) {
	const q = `
SELECT a.id, a.email, sp.full_name,
       (SELECT ar.role FROM account_role ar
         WHERE ar.account_id = a.id AND ar.revoked_at IS NULL
           AND ar.role IN ('SUPPORT_AGENT','ADMIN','SUPER_ADMIN')
         ORDER BY CASE ar.role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END
         LIMIT 1) AS role,
       sp.status, sp.mfa_enrolled, sp.last_login_at, sp.created_at
  FROM staff_profile sp
  JOIN account a ON a.id = sp.account_id
 WHERE sp.deleted_at IS NULL
   AND ($1::timestamptz IS NULL OR (sp.created_at, sp.account_id) < ($1, $2::uuid))
 ORDER BY sp.created_at DESC, sp.account_id DESC
 LIMIT $3`
	rows, err := r.pool.Query(ctx, q, cursorCreatedAt, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []staffRow
	for rows.Next() {
		var s staffRow
		var role *string
		if err := rows.Scan(&s.ID, &s.Email, &s.FullName, &role, &s.Status, &s.MFAEnrolled, &s.LastLoginAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		if role != nil {
			s.Role = *role
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// --- Halal issuing bodies (A-16) ---

type issuingBodyRow struct {
	ID                         string
	Name                       string
	Aliases                    []string
	Country                    *string
	Region                     *string
	Website                    *string
	AccreditationRef           *string
	RequiresIssuerConfirmation bool
	Status                     string
	Notes                      *string
}

// ListIssuingBodies returns the certifier registry keyset-paginated by name, id.
func (r *Repo) ListIssuingBodies(ctx context.Context, statuses []string, limit int, cursorName *string, cursorID *string) ([]issuingBodyRow, error) {
	const q = `
SELECT id, name, aliases, country, region, website, accreditation_ref,
       requires_issuer_confirmation, status, notes
  FROM halal_issuing_body
 WHERE deleted_at IS NULL
   AND (cardinality($1::text[]) = 0 OR status::text = ANY($1))
   AND ($2::text IS NULL OR (lower(name), id) > (lower($2), $3::uuid))
 ORDER BY lower(name) ASC, id ASC
 LIMIT $4`
	rows, err := r.pool.Query(ctx, q, statuses, cursorName, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []issuingBodyRow
	for rows.Next() {
		var b issuingBodyRow
		if err := rows.Scan(&b.ID, &b.Name, &b.Aliases, &b.Country, &b.Region, &b.Website,
			&b.AccreditationRef, &b.RequiresIssuerConfirmation, &b.Status, &b.Notes); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// GetIssuingBody loads a single body by id.
func (r *Repo) GetIssuingBody(ctx context.Context, id string) (issuingBodyRow, error) {
	const q = `
SELECT id, name, aliases, country, region, website, accreditation_ref,
       requires_issuer_confirmation, status, notes
  FROM halal_issuing_body WHERE id = $1 AND deleted_at IS NULL`
	var b issuingBodyRow
	err := r.pool.QueryRow(ctx, q, id).Scan(&b.ID, &b.Name, &b.Aliases, &b.Country, &b.Region,
		&b.Website, &b.AccreditationRef, &b.RequiresIssuerConfirmation, &b.Status, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		return b, ErrNotFound
	}
	return b, err
}

// ProposeIssuingBody inserts a PROPOSED body and audits it in one transaction
// (A-16). An admin may only propose; promotion to ACCEPTED is a super-admin act.
func (r *Repo) ProposeIssuingBody(ctx context.Context, actor auditActor, in issuingBodyRow, justification string) (issuingBodyRow, error) {
	var out issuingBodyRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		const ins = `
INSERT INTO halal_issuing_body (name, aliases, country, region, website, accreditation_ref, status, proposed_by)
VALUES ($1, $2, $3, $4, $5, $6, 'PROPOSED', $7)
RETURNING id, name, aliases, country, region, website, accreditation_ref, requires_issuer_confirmation, status, notes`
		var proposedBy any
		if actor.staffID != "" {
			proposedBy = actor.staffID
		}
		if err := tx.QueryRow(ctx, ins, in.Name, in.Aliases, in.Country, in.Region, in.Website,
			in.AccreditationRef, proposedBy).Scan(&out.ID, &out.Name, &out.Aliases, &out.Country,
			&out.Region, &out.Website, &out.AccreditationRef, &out.RequiresIssuerConfirmation,
			&out.Status, &out.Notes); err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "halal_issuing_body.propose",
			subjectType: "HALAL_ISSUING_BODY",
			subjectID:   &out.ID,
			outcome:     "SUCCESS",
			reason:      &justification,
			after:       map[string]any{"name": out.Name, "status": out.Status},
		})
	})
	return out, err
}

// SetIssuingBodyStatus changes a body's status (super-admin only, A-16) and
// audits the before/after in one transaction.
func (r *Repo) SetIssuingBodyStatus(ctx context.Context, actor auditActor, id, newStatus string, requiresConfirm *bool, justification string) (issuingBodyRow, error) {
	var out issuingBodyRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var before issuingBodyRow
		const sel = `SELECT id, status, requires_issuer_confirmation FROM halal_issuing_body WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`
		if err := tx.QueryRow(ctx, sel, id).Scan(&before.ID, &before.Status, &before.RequiresIssuerConfirmation); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		const upd = `
UPDATE halal_issuing_body
   SET status=$2,
       requires_issuer_confirmation = COALESCE($3, requires_issuer_confirmation),
       decided_by=$4, decided_at=now()
 WHERE id=$1
RETURNING id, name, aliases, country, region, website, accreditation_ref, requires_issuer_confirmation, status, notes`
		var decidedBy any
		if actor.staffID != "" {
			decidedBy = actor.staffID
		}
		if err := tx.QueryRow(ctx, upd, id, newStatus, requiresConfirm, decidedBy).Scan(&out.ID, &out.Name,
			&out.Aliases, &out.Country, &out.Region, &out.Website, &out.AccreditationRef,
			&out.RequiresIssuerConfirmation, &out.Status, &out.Notes); err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "halal_issuing_body.set_status",
			subjectType: "HALAL_ISSUING_BODY",
			subjectID:   &id,
			outcome:     "SUCCESS",
			reason:      &justification,
			before:      map[string]any{"status": before.Status},
			after:       map[string]any{"status": out.Status},
		})
	})
	return out, err
}

// --- transaction helper ---

// inTx runs fn in a transaction, committing on nil and rolling back otherwise.
func (r *Repo) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
