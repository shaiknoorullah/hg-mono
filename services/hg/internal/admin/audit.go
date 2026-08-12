package admin

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// auditActor is the verified identity behind a state change. It always comes
// from the authenticated principal (P-35 / A-04): the old system read admin_id
// out of the request body, which is exactly the attribution hole this closes.
type auditActor struct {
	// staffID is the acting account's id; empty for SYSTEM actors.
	staffID string
	// roles are the actor's role grants at the time of the action.
	roles []string
	// requestID correlates the audit row with the access log and X-Request-ID.
	requestID string
	// sessionID is the acting session, when known.
	sessionID string
	// ip is the actor's source address, when known.
	ip string
	// userAgent is the actor's user agent, when known.
	userAgent string
}

// auditEntry is one row to append. The trigger computes day, seq, prev_hash and
// hash; the caller supplies none of them.
type auditEntry struct {
	actor       auditActor
	action      string
	subjectType string
	subjectID   *string
	outcome     string // SUCCESS | DENIED | FAILED
	reasonCode  *string
	reason      *string
	before      map[string]any
	after       map[string]any
	amountCents *int64
}

// writeAudit inserts exactly one audit_event inside the caller's transaction. If
// this insert fails the whole business transaction rolls back (A-04 R1): the
// change and its record are atomic, not best effort.
func writeAudit(ctx context.Context, tx pgx.Tx, e auditEntry) error {
	actorKind := "ACCOUNT"
	var actorID any
	if e.actor.staffID == "" {
		actorKind = "SYSTEM"
	} else {
		actorID = e.actor.staffID
	}

	var rolesJSON, beforeJSON, afterJSON any
	if len(e.actor.roles) > 0 {
		b, err := json.Marshal(e.actor.roles)
		if err != nil {
			return err
		}
		rolesJSON = string(b)
	}
	if e.before != nil {
		b, err := json.Marshal(e.before)
		if err != nil {
			return err
		}
		beforeJSON = string(b)
	}
	if e.after != nil {
		b, err := json.Marshal(e.after)
		if err != nil {
			return err
		}
		afterJSON = string(b)
	}

	var reqID, sessID, ip, ua any
	if e.actor.requestID != "" {
		reqID = e.actor.requestID
	}
	if e.actor.sessionID != "" {
		sessID = e.actor.sessionID
	}
	if e.actor.ip != "" {
		ip = e.actor.ip
	}
	if e.actor.userAgent != "" {
		ua = e.actor.userAgent
	}

	const q = `
INSERT INTO audit_event
  (actor_kind, actor_account_id, actor_roles, action, subject_type, subject_id,
   outcome, reason_code, reason, before, after, amount_cents,
   request_id, session_id, ip, user_agent,
   day, seq, prev_hash, hash)
VALUES
  ($1, $2, $3, $4, $5, $6,
   $7, $8, $9, $10, $11, $12,
   $13, $14, $15, $16,
   -- placeholders overwritten by the BEFORE INSERT trigger; NOT NULL columns
   -- need a value at parse time, and the trigger recomputes day/seq/hashes.
   current_date, 0, '\x00'::bytea, '\x00'::bytea)`
	_, err := tx.Exec(ctx, q,
		actorKind, actorID, rolesJSON, e.action, e.subjectType, e.subjectID,
		e.outcome, e.reasonCode, e.reason, beforeJSON, afterJSON, e.amountCents,
		reqID, sessID, ip, ua)
	return err
}
