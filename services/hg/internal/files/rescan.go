package files

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

// errRescanReason is returned when a verdict change is asked for without a
// reason or without a named actor: the audit trail must say who and why.
var errRescanReason = errors.New("files: changing a virus scan verdict needs an actor and a reason")

// Rescan sends a file that already has a virus scan verdict back to the scan
// queue, for example after the signature database caught up with a new threat.
// It is the one way to reopen a verdict: the database refuses any other change
// to a recorded verdict (migration 00031_virus_scan, trigger
// stored_object_verdict_write_once), and this writes the audit row that names
// the actor and the reason in the same transaction.
//
// A file that was CLEAN stops being CLEAN here, so every APPROVED document on it
// goes back to review until the new scan passes it
// (https://github.com/shaiknoorullah/hg-mono/issues/218).
func (r *Repo) Rescan(ctx context.Context, actor Actor, storedObjectID, reason string) error {
	reason = strings.TrimSpace(reason)
	if actor.AccountID == "" || reason == "" {
		return errRescanReason
	}
	return inTx(ctx, r.pool, func(tx pgx.Tx) error {
		// hg.rescan_reason is transaction-local and cleared again below, so
		// only this statement may change a recorded verdict.
		if _, err := tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', $1, true)`, reason); err != nil {
			return err
		}
		const upd = `
UPDATE stored_object
   SET virus_scan_state    = 'PENDING',
       virus_scan_detail   = NULL,
       virus_scanned_at    = NULL,
       virus_scan_sha256   = NULL,
       virus_scan_version  = NULL,
       virus_scan_attempts = 0,
       virus_scan_next_at  = NULL
 WHERE id = $1 AND deleted_at IS NULL`
		tag, err := tx.Exec(ctx, upd, storedObjectID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if err := writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "stored_object.virus_rescan",
			subjectType: "STORED_OBJECT",
			subjectID:   &storedObjectID,
			outcome:     "SUCCESS",
			reasonCode:  "PENDING",
			reason:      reason,
		}); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', '', true)`)
		return err
	})
}

// markContentChanged records, inside tx, that the bytes at an object's key are
// not the bytes its verdict is about: content_version moves on from the
// version the caller checked, and the database (migration 00031_virus_scan,
// trigger stored_object_content_changed) sends the verdict back to PENDING,
// which sends every APPROVED document on the file back to review. The scan
// worker then reads the key again: the confirmed bytes, if they are back, can
// pass again; anything else ends ERROR. If the version already moved on,
// someone else recorded the change first and there is nothing to do.
func markContentChanged(ctx context.Context, tx pgx.Tx, actor Actor, id string, version int64, reason string) error {
	tag, err := tx.Exec(ctx, `
UPDATE stored_object SET content_version = content_version + 1
 WHERE id = $1 AND content_version = $2 AND deleted_at IS NULL`, id, version)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return writeAudit(ctx, tx, auditEntry{
		actor:       actor,
		action:      "stored_object.content_changed",
		subjectType: "STORED_OBJECT",
		subjectID:   &id,
		outcome:     "FAILED",
		reasonCode:  "CONTENT_CHANGED",
		reason:      reason,
	})
}
