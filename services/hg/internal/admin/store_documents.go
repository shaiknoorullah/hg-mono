package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// kycDocRow is the kyc_document projection.
type kycDocRow struct {
	ID                  string
	SubjectType         string
	SubjectID           string
	DocType             string
	State               string
	Issuer              *string
	CertificateNumber   *string
	IssuedOn            *time.Time
	ValidUntil          *time.Time
	Version             int
	RejectionReasonCode *string
	ReviewNote          *string
	ReviewedAt          *time.Time
	CreatedAt           time.Time
}

// GetDocument loads one KYC document for the given subject family. subjectType
// scopes the review endpoint so a rider-document route cannot review a
// restaurant document.
func (r *Repo) GetDocument(ctx context.Context, id, subjectType string) (kycDocRow, error) {
	const q = `
SELECT id, subject_type::text, subject_id,
       COALESCE(restaurant_doc_type::text, rider_doc_type::text) AS doc_type,
       state::text, issuer, certificate_number, issued_on, valid_until, version,
       rejection_reason_code::text, review_note, reviewed_at, created_at
  FROM kyc_document
 WHERE id = $1 AND subject_type = $2::kyc_subject_type AND deleted_at IS NULL`
	var d kycDocRow
	err := r.pool.QueryRow(ctx, q, id, subjectType).Scan(&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType,
		&d.State, &d.Issuer, &d.CertificateNumber, &d.IssuedOn, &d.ValidUntil, &d.Version,
		&d.RejectionReasonCode, &d.ReviewNote, &d.ReviewedAt, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// ErrForgeryHold is returned when an approval is blocked by a SUSPECTED_FORGERY
// finding that a super admin has not cleared (A-14 / R-08).
var ErrForgeryHold = errors.New("admin: suspected forgery hold")

// ErrDocDecided is returned when a document is already in a terminal state.
var ErrDocDecided = errors.New("admin: document already decided")

// ReviewDocument approves or rejects a single KYC document (A-14). Each document
// is reviewed independently; rejecting one does not re-queue the approved ones.
// The decision is attributed to the authenticated admin — no admin_id is read
// from the body. Approving a document marked SUSPECTED_FORGERY is refused unless
// the actor is a super admin who is clearing the hold.
func (r *Repo) ReviewDocument(ctx context.Context, actor auditActor, id, subjectType, decision string, reasonCode, reviewNote *string, isSuperAdmin bool) (kycDocRow, error) {
	var out kycDocRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		const sel = `
SELECT id, state::text, rejection_reason_code::text
  FROM kyc_document
 WHERE id=$1 AND subject_type=$2::kyc_subject_type AND deleted_at IS NULL
 FOR UPDATE`
		var cur kycDocRow
		if err := tx.QueryRow(ctx, sel, id, subjectType).Scan(&cur.ID, &cur.State, &cur.RejectionReasonCode); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if cur.State == "APPROVED" || cur.State == "REJECTED" || cur.State == "SUPERSEDED" || cur.State == "EXPIRED" {
			return ErrDocDecided
		}
		var verifiedBy any
		if actor.staffID != "" {
			verifiedBy = actor.staffID
		}
		switch decision {
		case "APPROVE":
			// A prior SUSPECTED_FORGERY finding blocks approval unless a super
			// admin is clearing it.
			if cur.RejectionReasonCode != nil && *cur.RejectionReasonCode == "SUSPECTED_FORGERY" && !isSuperAdmin {
				return ErrForgeryHold
			}
			const upd = `
UPDATE kyc_document
   SET state='APPROVED', reviewed_by=$2, reviewed_at=now(),
       rejection_reason_code=NULL, review_note=$3,
       deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`
			if _, err := tx.Exec(ctx, upd, id, verifiedBy, reviewNote); err != nil {
				return err
			}
		case "REJECT":
			const upd = `
UPDATE kyc_document
   SET state='REJECTED', reviewed_by=$2, reviewed_at=now(),
       rejection_reason_code=$3::document_rejection_reason_code, review_note=$4,
       deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`
			if _, err := tx.Exec(ctx, upd, id, verifiedBy, reasonCode, reviewNote); err != nil {
				return err
			}
		default:
			return errBadDate
		}

		var err error
		out, err = r.getDocumentTx(ctx, tx, id, subjectType)
		if err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "kyc_document." + decisionVerbDoc(decision),
			subjectType: "KYC_DOCUMENT",
			subjectID:   &id,
			outcome:     "SUCCESS",
			reasonCode:  reasonCode,
			reason:      reviewNote,
			before:      map[string]any{"state": cur.State},
			after:       map[string]any{"state": out.State},
		})
	})
	return out, err
}

func (r *Repo) getDocumentTx(ctx context.Context, tx pgx.Tx, id, subjectType string) (kycDocRow, error) {
	const q = `
SELECT id, subject_type::text, subject_id,
       COALESCE(restaurant_doc_type::text, rider_doc_type::text) AS doc_type,
       state::text, issuer, certificate_number, issued_on, valid_until, version,
       rejection_reason_code::text, review_note, reviewed_at, created_at
  FROM kyc_document WHERE id=$1 AND subject_type=$2::kyc_subject_type`
	var d kycDocRow
	err := tx.QueryRow(ctx, q, id, subjectType).Scan(&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType,
		&d.State, &d.Issuer, &d.CertificateNumber, &d.IssuedOn, &d.ValidUntil, &d.Version,
		&d.RejectionReasonCode, &d.ReviewNote, &d.ReviewedAt, &d.CreatedAt)
	return d, err
}

func decisionVerbDoc(decision string) string {
	if decision == "APPROVE" {
		return "approve"
	}
	return "reject"
}
