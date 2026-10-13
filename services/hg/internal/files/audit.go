package files

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// Actor is the verified caller behind a download issuance. It comes from the
// authenticated principal, never from a request body.
type Actor struct {
	AccountID string
	Roles     []string
	RequestID string
	SessionID string
	IP        string
	UserAgent string
}

// auditEntry is one audit_event to append; the trigger computes day, seq and the
// chain hashes.
type auditEntry struct {
	actor       Actor
	action      string
	subjectType string
	subjectID   *string
	outcome     string
	reasonCode  string // optional, machine-readable
	reason      string // optional, human-readable: why it was done
}

// writeAudit appends exactly one audit_event inside the caller's transaction
// (P-35 / P-28): a KYC download-url issuance is audited in the same transaction
// it is authorised in, so an unaudited issuance is not a state the system can
// reach.
func writeAudit(ctx context.Context, tx pgx.Tx, e auditEntry) error {
	actorKind := "ACCOUNT"
	var actorID any
	if e.actor.AccountID == "" {
		actorKind = "SYSTEM"
	} else {
		actorID = e.actor.AccountID
	}
	var reqID, sessID, ip, ua, reasonCode, reason any
	if e.reasonCode != "" {
		reasonCode = e.reasonCode
	}
	if e.reason != "" {
		reason = e.reason
	}
	if e.actor.RequestID != "" {
		reqID = e.actor.RequestID
	}
	if e.actor.SessionID != "" {
		sessID = e.actor.SessionID
	}
	if e.actor.IP != "" {
		ip = e.actor.IP
	}
	if e.actor.UserAgent != "" {
		ua = e.actor.UserAgent
	}
	const q = `
INSERT INTO audit_event
  (actor_kind, actor_account_id, action, subject_type, subject_id, outcome,
   request_id, session_id, ip, user_agent, reason_code, reason, day, seq, prev_hash, hash)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
   current_date, 0, '\x00'::bytea, '\x00'::bytea)`
	_, err := tx.Exec(ctx, q, actorKind, actorID, e.action, e.subjectType, e.subjectID, e.outcome,
		reqID, sessID, ip, ua, reasonCode, reason)
	return err
}
