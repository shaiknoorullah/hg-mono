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
// to a recorded verdict (migration 00028_virus_scan, trigger
// stored_object_verdict_write_once), and this writes the audit row that names
// the actor and the reason in the same transaction.
//
// A file that was CLEAN stops being CLEAN here, so every APPROVED document on it
// goes back to review until the new scan passes it
// (https://github.com/shaiknoorullah/hg-mono/issues/218).
func (r *Repo) Rescan(ctx context.Context, actor Actor, storedObjectID, reason string) error {
	if actor.AccountID == "" {
		return errRescanReason
	}
	return inTx(ctx, r.pool, func(tx pgx.Tx) error {
		return overrideVerdict(ctx, tx, actor, storedObjectID, "PENDING", "", "stored_object.virus_rescan", reason)
	})
}

// overrideVerdict changes a recorded verdict to state, inside tx. It sets the
// transaction-local hg.rescan_reason that the write-once trigger requires,
// writes the audit row, then clears the setting so later statements in the
// same transaction are guarded again.
func overrideVerdict(ctx context.Context, tx pgx.Tx, actor Actor, id, state, detail, action, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errRescanReason
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', $1, true)`, reason); err != nil {
		return err
	}
	const upd = `
UPDATE stored_object
   SET virus_scan_state    = $2,
       virus_scan_detail   = NULLIF($3, ''),
       virus_scanned_at    = CASE WHEN $2 = 'PENDING' THEN NULL ELSE now() END,
       virus_scan_attempts = 0,
       virus_scan_next_at  = NULL
 WHERE id = $1 AND deleted_at IS NULL`
	tag, err := tx.Exec(ctx, upd, id, state, detail)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := writeAudit(ctx, tx, auditEntry{
		actor:       actor,
		action:      action,
		subjectType: "STORED_OBJECT",
		subjectID:   &id,
		outcome:     "SUCCESS",
		reasonCode:  state,
		reason:      reason,
	}); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', '', true)`)
	return err
}
