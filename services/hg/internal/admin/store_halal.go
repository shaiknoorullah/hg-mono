package admin

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// certRow is the halal_certificate projection.
type certRow struct {
	ID                  string
	RestaurantID        string
	DocumentID          *string
	CertificateNumber   *string
	IssuingBodyID       *string
	CertifiedLegalName  *string
	CertifiedAddress    *string
	Scope               *string
	IssuedOn            *time.Time
	ExpiresOn           *time.Time
	Status              string
	ChecklistVersion    int
	RejectionReasonCode *string
	RejectionReasonText *string
	VerifiedBy          *string
	VerifiedAt          *time.Time
}

// checkRow is one halal_certificate_check.
type checkRow struct {
	CheckKey       string
	Result         string
	ComputedResult string
	Overridable    bool
	Note           *string
	CheckedAt      *time.Time
}

// GetCertificate loads a certificate and its checks.
func (r *Repo) GetCertificate(ctx context.Context, id string) (certRow, []checkRow, error) {
	c, err := r.getCertificate(ctx, r.pool, id)
	if err != nil {
		return c, nil, err
	}
	checks, err := r.getChecks(ctx, r.pool, id)
	return c, checks, err
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (r *Repo) getCertificate(ctx context.Context, q querier, id string) (certRow, error) {
	const sql = `
SELECT id, restaurant_id, document_id::text, certificate_number, issuing_body_id::text,
       certified_legal_name, certified_address, scope::text, issued_on, expires_on,
       status::text, checklist_version, rejection_reason_code::text, rejection_reason_text,
       verified_by::text, verified_at
  FROM halal_certificate WHERE id = $1 AND deleted_at IS NULL`
	var c certRow
	err := q.QueryRow(ctx, sql, id).Scan(&c.ID, &c.RestaurantID, &c.DocumentID, &c.CertificateNumber,
		&c.IssuingBodyID, &c.CertifiedLegalName, &c.CertifiedAddress, &c.Scope, &c.IssuedOn, &c.ExpiresOn,
		&c.Status, &c.ChecklistVersion, &c.RejectionReasonCode, &c.RejectionReasonText, &c.VerifiedBy, &c.VerifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (r *Repo) getChecks(ctx context.Context, q querier, certID string) ([]checkRow, error) {
	const sql = `
SELECT check_key::text, result::text, computed_result::text, overridable, note, checked_at
  FROM halal_certificate_check WHERE halal_certificate_id = $1`
	rows, err := q.Query(ctx, sql, certID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byKey := map[string]checkRow{}
	for rows.Next() {
		var c checkRow
		if err := rows.Scan(&c.CheckKey, &c.Result, &c.ComputedResult, &c.Overridable, &c.Note, &c.CheckedAt); err != nil {
			return nil, err
		}
		byKey[c.CheckKey] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Return the seven checks in canonical H1..H7 order, materialising any that
	// have not yet been recorded as NOT_ASSESSED so the panel always shows all
	// seven — the closed checklist is a fixed shape, not a sparse set.
	out := make([]checkRow, 0, len(AllCheckKeys))
	for _, k := range AllCheckKeys {
		if c, ok := byKey[k]; ok {
			out = append(out, c)
			continue
		}
		out = append(out, checkRow{CheckKey: k, Result: ResultNotAssessed, ComputedResult: ResultNotAssessed, Overridable: !NonOverridable(k)})
	}
	return out, nil
}

// certFactsFor builds the server's computable facts for a certificate under a
// transaction: issuer acceptance now, duplicate existence now, and dates.
func (r *Repo) certFactsFor(ctx context.Context, tx pgx.Tx, c certRow, minRemainingDays int, at time.Time) (certFacts, error) {
	f := certFacts{
		issuedOn:         c.IssuedOn,
		expiresOn:        c.ExpiresOn,
		minRemainingDays: minRemainingDays,
		now:              at,
	}
	if c.Scope != nil {
		f.scope = *c.Scope
	}
	if c.IssuingBodyID != nil {
		var status string
		err := tx.QueryRow(ctx, `SELECT status::text FROM halal_issuing_body WHERE id=$1 AND deleted_at IS NULL`, *c.IssuingBodyID).Scan(&status)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return f, err
		}
		f.issuerAccepted = status == "ACCEPTED"
	}
	if c.CertificateNumber != nil && c.IssuingBodyID != nil {
		var n int
		// H7: any *other* APPROVED certificate with the same (body, number).
		err := tx.QueryRow(ctx, `
SELECT count(*) FROM halal_certificate
 WHERE issuing_body_id=$1 AND certificate_number=$2 AND status='APPROVED' AND id <> $3 AND deleted_at IS NULL`,
			*c.IssuingBodyID, *c.CertificateNumber, c.ID).Scan(&n)
		if err != nil {
			return f, err
		}
		f.duplicateExists = n > 0
	}
	return f, nil
}

// Transcribe records the structured certificate fields and recomputes the
// auto-evaluable checks (A-15). Nothing is inferred or OCR'd; the issuing body
// is chosen from the accepted registry (free text is refused at the handler).
// The computed results of H2, H5, H6, H7 are upserted; a human's recorded
// result for those is not touched here — RecordChecks enforces overridability.
func (r *Repo) Transcribe(ctx context.Context, actor auditActor, id string, in halalTranscriptionInput, minRemainingDays int, at time.Time) (certRow, []checkRow, error) {
	var outCert certRow
	var outChecks []checkRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		before, err := r.getCertificate(ctx, tx, id)
		if err != nil {
			return err
		}
		if before.Status == "APPROVED" || before.Status == "REVOKED" {
			return fmt.Errorf("%w: certificate is %s and its fields are immutable", errImmutable, before.Status)
		}
		// The issuing body must exist.
		var bodyExists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM halal_issuing_body WHERE id=$1 AND deleted_at IS NULL`, in.IssuingBodyID).Scan(&bodyExists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: issuing_body_id", errUnknownIssuer)
			}
			return err
		}
		issued, err := time.Parse("2006-01-02", in.IssuedOn)
		if err != nil {
			return fmt.Errorf("%w: issued_on", errBadDate)
		}
		expires, err := time.Parse("2006-01-02", in.ExpiresOn)
		if err != nil {
			return fmt.Errorf("%w: expires_on", errBadDate)
		}
		const upd = `
UPDATE halal_certificate
   SET certificate_number=$2, issuing_body_id=$3, certified_legal_name=$4,
       certified_address=$5, scope=$6, issued_on=$7, expires_on=$8,
       checklist_version=$9
 WHERE id=$1
RETURNING id, restaurant_id, document_id::text, certificate_number, issuing_body_id::text,
          certified_legal_name, certified_address, scope::text, issued_on, expires_on,
          status::text, checklist_version, rejection_reason_code::text, rejection_reason_text,
          verified_by::text, verified_at`
		if err := tx.QueryRow(ctx, upd, id, in.CertificateNumber, in.IssuingBodyID,
			in.CertifiedLegalName, in.CertifiedAddress, in.Scope, issued, expires, HalalChecklistVersion).Scan(
			&outCert.ID, &outCert.RestaurantID, &outCert.DocumentID, &outCert.CertificateNumber,
			&outCert.IssuingBodyID, &outCert.CertifiedLegalName, &outCert.CertifiedAddress, &outCert.Scope,
			&outCert.IssuedOn, &outCert.ExpiresOn, &outCert.Status, &outCert.ChecklistVersion,
			&outCert.RejectionReasonCode, &outCert.RejectionReasonText, &outCert.VerifiedBy, &outCert.VerifiedAt); err != nil {
			return err
		}
		// Recompute the server's own evaluation and persist computed_result for
		// every check, seeding the non-overridable H5/H7 result to the computed
		// value so a subsequent approval sees the truth.
		facts, err := r.certFactsFor(ctx, tx, outCert, minRemainingDays, at)
		if err != nil {
			return err
		}
		if err := r.upsertComputed(ctx, tx, id, computedResults(facts), actor.staffID); err != nil {
			return err
		}
		outChecks, err = r.getChecks(ctx, tx, id)
		if err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "halal_certificate.transcribe",
			subjectType: "HALAL_CERTIFICATE",
			subjectID:   &id,
			outcome:     "SUCCESS",
			before:      map[string]any{"certificate_number": before.CertificateNumber, "scope": before.Scope},
			after:       map[string]any{"certificate_number": in.CertificateNumber, "scope": in.Scope},
		})
	})
	return outCert, outChecks, err
}

// upsertComputed writes computed_result for all seven checks and seeds result
// from the server's own computation for every check the server can evaluate
// (H2, H5, H6, H7). H1/H3/H4 have no computation (computed_result NOT_ASSESSED)
// and are left for a human to record.
//
// For the two non-overridable checks (H5, H7) the recorded result is forced to
// equal the computation on every write, keeping the DB invariant
// halal_check_non_overridable_matches_computation true. For the overridable
// server-computed checks (H2, H6) the computed value is adopted as the default
// result, but a human-recorded result is never clobbered: on conflict the
// result is only pulled forward from the computation while it is still
// NOT_ASSESSED.
func (r *Repo) upsertComputed(ctx context.Context, tx pgx.Tx, certID string, computed map[string]string, staffID string) error {
	for _, k := range AllCheckKeys {
		cr := computed[k]
		overridable := !NonOverridable(k)

		// H1/H3/H4: nothing to compute — only ensure the row exists at
		// NOT_ASSESSED without disturbing any human-recorded result.
		if cr == ResultNotAssessed {
			const q = `
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable)
VALUES ($1, $2, 'NOT_ASSESSED', 'NOT_ASSESSED', $3)
ON CONFLICT (halal_certificate_id, check_key)
DO UPDATE SET computed_result = EXCLUDED.computed_result`
			if _, err := tx.Exec(ctx, q, certID, k, overridable); err != nil {
				return err
			}
			continue
		}

		var checkedBy any
		if staffID != "" {
			checkedBy = staffID
		}
		checkedAt := time.Now().UTC()

		if !overridable {
			// Non-overridable: recorded result always equals the computation.
			const q = `
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
VALUES ($1, $2, $3, $3, false, $4, $5)
ON CONFLICT (halal_certificate_id, check_key)
DO UPDATE SET result = EXCLUDED.computed_result, computed_result = EXCLUDED.computed_result,
              checked_by = EXCLUDED.checked_by, checked_at = EXCLUDED.checked_at`
			if _, err := tx.Exec(ctx, q, certID, k, cr, checkedBy, checkedAt); err != nil {
				return err
			}
			continue
		}

		// Overridable server-computed (H2, H6): seed the result from the
		// computation, but keep a human override — only adopt the computed
		// value while the recorded result is still NOT_ASSESSED.
		const q = `
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
VALUES ($1, $2, $3, $3, true, $4, $5)
ON CONFLICT (halal_certificate_id, check_key)
DO UPDATE SET computed_result = EXCLUDED.computed_result,
              result = CASE WHEN halal_certificate_check.result = 'NOT_ASSESSED'
                            THEN EXCLUDED.computed_result
                            ELSE halal_certificate_check.result END,
              checked_by = CASE WHEN halal_certificate_check.result = 'NOT_ASSESSED'
                            THEN EXCLUDED.checked_by
                            ELSE halal_certificate_check.checked_by END,
              checked_at = CASE WHEN halal_certificate_check.result = 'NOT_ASSESSED'
                            THEN EXCLUDED.checked_at
                            ELSE halal_certificate_check.checked_at END`
		if _, err := tx.Exec(ctx, q, certID, k, cr, checkedBy, checkedAt); err != nil {
			return err
		}
	}
	return nil
}

// errOverride is returned when a human tries to set a non-overridable check
// against the server's computation.
type checkOverrideError struct {
	CheckKey string
	Computed string
}

func (e checkOverrideError) Error() string {
	return fmt.Sprintf("check %s is not overridable (computed %s)", e.CheckKey, e.Computed)
}

var (
	errImmutable      = errors.New("certificate is immutable")
	errUnknownIssuer  = errors.New("unknown issuing body")
	errBadDate        = errors.New("invalid date")
	errNotTranscribed = errors.New("certificate is not transcribed")
)

// RecordChecks records the human-judgement results for the checklist (A-15). H5
// and H7 may never be set against the server computation: an attempt returns a
// checkOverrideError which the handler renders as 409 CHECK_NOT_OVERRIDABLE with
// details.computed. Any override of a system suggestion requires a >=20 char note
// (enforced at the handler by the schema minLength).
func (r *Repo) RecordChecks(ctx context.Context, actor auditActor, id string, in halalChecksInput, minRemainingDays int, at time.Time) (certRow, []checkRow, error) {
	var outCert certRow
	var outChecks []checkRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		cert, err := r.getCertificate(ctx, tx, id)
		if err != nil {
			return err
		}
		if cert.Status == "APPROVED" || cert.Status == "REVOKED" {
			return fmt.Errorf("%w: certificate is %s", errImmutable, cert.Status)
		}
		if cert.IssuingBodyID == nil || cert.CertificateNumber == nil {
			return errNotTranscribed
		}
		facts, err := r.certFactsFor(ctx, tx, cert, minRemainingDays, at)
		if err != nil {
			return err
		}
		computed := computedResults(facts)
		for _, in := range in.Checks {
			if NonOverridable(in.CheckKey) && in.Result != computed[in.CheckKey] {
				return checkOverrideError{CheckKey: in.CheckKey, Computed: computed[in.CheckKey]}
			}
			var note any
			if in.Note != nil {
				note = *in.Note
			}
			var checkedBy any
			if actor.staffID != "" {
				checkedBy = actor.staffID
			}
			const q = `
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable, note, checked_by, checked_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (halal_certificate_id, check_key)
DO UPDATE SET result = EXCLUDED.result, computed_result = EXCLUDED.computed_result,
              note = EXCLUDED.note, checked_by = EXCLUDED.checked_by, checked_at = now()`
			overridable := !NonOverridable(in.CheckKey)
			if _, err := tx.Exec(ctx, q, id, in.CheckKey, in.Result, computed[in.CheckKey], overridable, note, checkedBy); err != nil {
				return err
			}
		}
		outCert = cert
		outChecks, err = r.getChecks(ctx, tx, id)
		if err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "halal_certificate.check",
			subjectType: "HALAL_CERTIFICATE",
			subjectID:   &id,
			outcome:     "SUCCESS",
		})
	})
	return outCert, outChecks, err
}

// decisionError names a decision that cannot proceed because the checklist is
// not complete or a check has failed.
type decisionError struct {
	Code      httpxCode
	CheckKeys []string
}

func (e decisionError) Error() string { return string(e.Code) }

type httpxCode string

const (
	decChecklistIncomplete httpxCode = "CHECKLIST_INCOMPLETE"
	decCheckFailed         httpxCode = "CHECK_FAILED"
)

// Decide approves, rejects or revokes a certificate (A-15). Approval requires
// all seven checks present and PASS; the server re-verifies rather than trusting
// the recorded rows, then the DB constraint trigger halal_assert_approval_complete
// independently refuses to commit an APPROVED row with fewer than seven PASS.
// REVOKE is super-admin only, enforced at the handler.
func (r *Repo) Decide(ctx context.Context, actor auditActor, id, decision string, reasonCode, reasonText *string, minRemainingDays int, at time.Time) (certRow, []checkRow, error) {
	var outCert certRow
	var outChecks []checkRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		cert, err := r.getCertificate(ctx, tx, id)
		if err != nil {
			return err
		}
		switch decision {
		case "APPROVE":
			if cert.Status != "PENDING" {
				return ErrAlreadyDecided
			}
			// Hold the issuing body FOR SHARE until this approval commits. A
			// status change locks the body FOR UPDATE and then re-derives every
			// restaurant holding its certificates, so the approval either commits
			// first and is re-derived by it, or waits and reads the new status
			// below. Without the lock an approval that read ACCEPTED could commit
			// a badge after a withdrawal had passed its restaurant. The body is
			// locked before the certificate write reaches the restaurant row, the
			// order the status change takes them in.
			// Issue: https://github.com/shaiknoorullah/hg-mono/issues/346
			if cert.IssuingBodyID != nil {
				if _, err := tx.Exec(ctx, `SELECT 1 FROM halal_issuing_body WHERE id = $1 FOR SHARE`, *cert.IssuingBodyID); err != nil {
					return fmt.Errorf("lock issuing body: %w", err)
				}
			}
			// Recompute the non-overridable checks fresh so a stale recorded PASS
			// can never carry an approval.
			facts, err := r.certFactsFor(ctx, tx, cert, minRemainingDays, at)
			if err != nil {
				return err
			}
			if err := r.upsertComputed(ctx, tx, id, computedResults(facts), actor.staffID); err != nil {
				return err
			}
			checks, err := r.getChecks(ctx, tx, id)
			if err != nil {
				return err
			}
			var notAssessed, failed []string
			for _, c := range checks {
				switch c.Result {
				case ResultPass:
				case ResultFail:
					failed = append(failed, c.CheckKey)
				default:
					notAssessed = append(notAssessed, c.CheckKey)
				}
			}
			if len(failed) > 0 {
				return decisionError{Code: decCheckFailed, CheckKeys: failed}
			}
			if len(notAssessed) > 0 {
				return decisionError{Code: decChecklistIncomplete, CheckKeys: notAssessed}
			}
			const upd = `
UPDATE halal_certificate SET status='APPROVED', verified_by=$2, verified_at=now(),
       rejection_reason_code=NULL, rejection_reason_text=NULL WHERE id=$1`
			var verifiedBy any
			if actor.staffID != "" {
				verifiedBy = actor.staffID
			}
			if _, err := tx.Exec(ctx, upd, id, verifiedBy); err != nil {
				return err
			}
		case "REJECT":
			if cert.Status != "PENDING" {
				return ErrAlreadyDecided
			}
			if reasonCode == nil {
				return fmt.Errorf("%w: reason_code is required to reject", errBadDate)
			}
			const upd = `
UPDATE halal_certificate SET status='REJECTED', verified_by=$2, verified_at=now(),
       rejection_reason_code=$3, rejection_reason_text=$4 WHERE id=$1`
			var verifiedBy any
			if actor.staffID != "" {
				verifiedBy = actor.staffID
			}
			if _, err := tx.Exec(ctx, upd, id, verifiedBy, *reasonCode, reasonText); err != nil {
				return err
			}
		case "REVOKE":
			if cert.Status != "APPROVED" {
				return fmt.Errorf("%w: only an approved certificate can be revoked", ErrAlreadyDecided)
			}
			const upd = `
UPDATE halal_certificate SET status='REVOKED', revoked_by=$2, revoked_at=now(),
       revocation_reason_code=$3 WHERE id=$1`
			var revokedBy any
			if actor.staffID != "" {
				revokedBy = actor.staffID
			}
			var rc any
			if reasonCode != nil {
				rc = *reasonCode
			}
			if _, err := tx.Exec(ctx, upd, id, revokedBy, rc); err != nil {
				return err
			}
		default:
			return fmt.Errorf("%w: decision", errBadDate)
		}

		outCert, err = r.getCertificate(ctx, tx, id)
		if err != nil {
			return err
		}
		outChecks, err = r.getChecks(ctx, tx, id)
		if err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "halal_certificate." + decisionVerb(decision),
			subjectType: "HALAL_CERTIFICATE",
			subjectID:   &id,
			outcome:     "SUCCESS",
			reasonCode:  reasonCode,
			reason:      reasonText,
			before:      map[string]any{"status": cert.Status},
			after:       map[string]any{"status": outCert.Status},
		})
	})
	return outCert, outChecks, err
}

// ErrAlreadyDecided is returned when a decision is attempted on a decided cert.
var ErrAlreadyDecided = errors.New("already decided")

// decisionVerb lowercases a decision verb for the audit action suffix.
func decisionVerb(decision string) string {
	switch decision {
	case "APPROVE":
		return "approve"
	case "REJECT":
		return "reject"
	case "REVOKE":
		return "revoke"
	default:
		return "decide"
	}
}
