package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// ErrDocNotScanned is returned when an approval is attempted on a document
// whose file has not been virus-scanned clean: the scan is still pending, found
// a virus, could not read the whole file, or the bytes are no longer the ones
// it read. Migration 00031_virus_scan makes the database refuse it too. Spec:
// docs/spec/01-platform.md#p-28--presigned-upload-and-download.
var ErrDocNotScanned = errors.New("admin: document file not virus-scanned clean")

// ReviewDocument approves or rejects a single KYC document (A-14). Each document
// is reviewed independently; rejecting one does not re-queue the approved ones.
// The decision is attributed to the authenticated admin — no admin_id is read
// from the body. Approving a document marked SUSPECTED_FORGERY is refused unless
// the actor is a super admin who is clearing the hold, and approving one whose
// file has not passed its virus scan is refused outright
// (https://github.com/shaiknoorullah/hg-mono/issues/218).
func (r *Repo) ReviewDocument(ctx context.Context, actor auditActor, id, subjectType, decision string, reasonCode, reviewNote *string, isSuperAdmin bool) (kycDocRow, error) {
	var out kycDocRow
	// Approval looks at the file's bytes first, when it can: the scan verdict
	// is about particular bytes, and the bytes in the store are what an
	// approved document serves. The read happens before the transaction so
	// that up to 15 MiB of I/O never runs under row locks; the transaction
	// then checks that the file is still at the version whose bytes were read.
	checked, checkedVersion := false, int64(0)
	if decision == "APPROVE" && r.fileCheck != nil {
		var objectID, state string
		err := r.pool.QueryRow(ctx, `
SELECT stored_object_id::text, state::text FROM kyc_document
 WHERE id=$1 AND subject_type=$2::kyc_subject_type AND deleted_at IS NULL`, id, subjectType).Scan(&objectID, &state)
		if errors.Is(err, pgx.ErrNoRows) {
			return out, ErrNotFound
		}
		if err != nil {
			return out, err
		}
		if !docDecided(state) {
			v, clean, err := r.fileCheck(ctx, objectID, actor.staffID, actor.requestID)
			if err != nil {
				return out, err
			}
			if !clean {
				return out, ErrDocNotScanned
			}
			checked, checkedVersion = true, v
		}
	}

	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// Approval locks the file's row FOR UPDATE before the document's, the
		// order a verdict change takes them in (the file, then its documents),
		// so the two never deadlock. The lock is held until commit: a verdict
		// change that comes later waits for this approval and then revokes it
		// (trigger stored_object_scan_regressed); one that got here first holds
		// the row, so this waits for it and then reads the new verdict.
		var fileID string
		var passed bool
		var version int64
		if decision == "APPROVE" {
			const selFile = `
SELECT so.id::text, virus_scan_passed(so), so.content_version
  FROM stored_object so
 WHERE so.id = (SELECT stored_object_id FROM kyc_document
                 WHERE id=$1 AND subject_type=$2::kyc_subject_type AND deleted_at IS NULL)
 FOR UPDATE`
			if err := tx.QueryRow(ctx, selFile, id, subjectType).Scan(&fileID, &passed, &version); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return ErrNotFound
				}
				return err
			}
		}
		const sel = `
SELECT kd.id, kd.state::text, kd.rejection_reason_code::text, kd.stored_object_id::text
  FROM kyc_document kd
 WHERE kd.id=$1 AND kd.subject_type=$2::kyc_subject_type AND kd.deleted_at IS NULL
 FOR UPDATE`
		var cur kycDocRow
		var docFile string
		if err := tx.QueryRow(ctx, sel, id, subjectType).Scan(&cur.ID, &cur.State, &cur.RejectionReasonCode, &docFile); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if docDecided(cur.State) {
			return ErrDocDecided
		}
		var verifiedBy any
		if actor.staffID != "" {
			verifiedBy = actor.staffID
		}
		after := map[string]any{}
		switch decision {
		case "APPROVE":
			// A prior SUSPECTED_FORGERY finding blocks approval unless a super
			// admin is clearing it.
			if cur.RejectionReasonCode != nil && *cur.RejectionReasonCode == "SUSPECTED_FORGERY" && !isSuperAdmin {
				return ErrForgeryHold
			}
			// Only a file the virus scanner read in full and passed may be
			// approved, while it is still the file whose bytes were read:
			// the same file the lock was taken on, at the version checked.
			// Anything else, NULL included, is refused.
			if docFile != fileID || !passed || (checked && version != checkedVersion) {
				return ErrDocNotScanned
			}
			const upd = `
UPDATE kyc_document
   SET state='APPROVED', reviewed_by=$2, reviewed_at=now(),
       rejection_reason_code=NULL, review_note=$3,
       deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`
			if _, err := tx.Exec(ctx, upd, id, verifiedBy, reviewNote); err != nil {
				return notScannedErr(err)
			}
			// The audit row names the exact contents that were approved.
			after["stored_object_id"] = fileID
			after["stored_object_version"] = version
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
		after["state"] = out.State
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "kyc_document." + decisionVerbDoc(decision),
			subjectType: "KYC_DOCUMENT",
			subjectID:   &id,
			outcome:     "SUCCESS",
			reasonCode:  reasonCode,
			reason:      reviewNote,
			before:      map[string]any{"state": cur.State},
			after:       after,
		})
	})
	return out, err
}

// docDecided reports whether a document is in a terminal review state.
func docDecided(state string) bool {
	switch state {
	case "APPROVED", "REJECTED", "SUPERSEDED", "EXPIRED":
		return true
	}
	return false
}

// notScannedErr maps the database's own refusal of an unscanned approval
// (trigger kyc_document_virus_scan_clean, migration 00031_virus_scan) to
// ErrDocNotScanned. The checks above make it unreachable from this path; if
// they ever drift from the trigger, the answer is still a 409, not a 500.
func notScannedErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.ConstraintName == "kyc_document_virus_scan_clean" {
		return ErrDocNotScanned
	}
	return err
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
