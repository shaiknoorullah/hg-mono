package payments

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Staff is the member of staff behind a refund or chargeback action, as the
// router authenticated them. It always comes from the verified principal,
// never from a request body. The service decides what they may do with it
// (docs/spec/05-admin.md, "A-02 — Role-based access control model": the route's
// action is checked first, and object-level rules are always applied after).
type Staff struct {
	AccountID string
	Roles     []string
	// MFA reports that the session was signed in with an authenticator code
	// (amr "pwd+totp"). Money actions need it ("A-02 — Role-based access
	// control model" R4 and "A-33 — Refund issuance and authority limits" R6:
	// MFA verified within 12 hours, which a staff session's 12-hour limit
	// guarantees once it was signed in with the code; docs/decisions/README.md,
	// "Staff session length").
	MFA bool
	// SessionID, RequestID, IP and UserAgent go on the audit event.
	SessionID string
	RequestID string
	IP        string
	UserAgent string
}

// StaffFrom builds the Staff for a request from its verified principal.
func StaffFrom(r *http.Request) Staff {
	p := httpx.PrincipalFrom(r.Context())
	roles := make([]string, 0, len(p.Roles))
	for _, role := range p.Roles {
		roles = append(roles, string(role))
	}
	return Staff{
		AccountID: p.AccountID,
		Roles:     roles,
		MFA:       slices.Contains(p.AMR, "pwd+totp"),
		SessionID: p.SessionID,
		RequestID: httpx.RequestIDFrom(r.Context()),
		IP:        httpx.ClientIP(r),
		UserAgent: r.Header.Get("User-Agent"),
	}
}

func (s Staff) has(role string) bool { return slices.Contains(s.Roles, role) }

// isStaff reports whether the caller holds a staff role. The routes are
// already gated by staff-only actions; this is the service's own check, so a
// mis-granted action can never let a customer decide a refund.
func (s Staff) isStaff() bool {
	return s.has("SUPPORT_AGENT") || s.has("ADMIN") || s.has("SUPER_ADMIN")
}

// requireStaff refuses a caller who is not staff.
func requireStaff(s Staff) error {
	if s.AccountID == "" || !s.isStaff() {
		return domainErr(string(httpx.CodeForbidden), 403, "Only staff may do this.")
	}
	return nil
}

// requireMoneyMFA refuses a money action from a session that was not signed in
// with an authenticator code.
func requireMoneyMFA(s Staff) error {
	if !s.MFA {
		return domainErr(string(codeMFARequired), 403,
			"Refunds need a session signed in with your authenticator code. Sign in again with it.")
	}
	return nil
}

// codeAlreadyDecided is the contract's ALREADY_DECIDED: the refund or
// chargeback is no longer waiting for this decision.
const codeAlreadyDecided = "ALREADY_DECIDED"

// authorityWindow is the rolling window a person's refund limit covers
// ("A-33 — Refund issuance and authority limits": max per rolling 24 hours).
const authorityWindow = 24 * time.Hour

// authorityUsed locks a person's refund authority for the rest of the
// transaction and returns what they approved in the 24 hours to now: the sum
// of the refunds they approved that were not declined or cancelled. The lock
// is what makes "total + amount ≤ cap" one decision (the same section, rule
// R3: the rolling cap is checked inside the authorising transaction): two refunds
// by the same person at once take turns, so they cannot both pass on the same
// total.
func authorityUsed(ctx context.Context, tx pgx.Tx, staffID string, now time.Time) (int64, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('refund_authority:' || $1, 0))`, staffID); err != nil {
		return 0, err
	}
	var used int64
	err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(amount_cents), 0)::bigint FROM refund
		 WHERE approved_by = $1
		   AND coalesce(approved_at, requested_at) >= $2
		   AND state NOT IN ('DECLINED', 'CANCELLED')`, staffID, now.Add(-authorityWindow)).Scan(&used)
	return used, err
}

// staffAudit is one audit event for a staff action on money.
type staffAudit struct {
	Action      string
	SubjectType string
	SubjectID   string
	ReasonCode  string
	Reason      string
	AmountCents *int64
	Before      map[string]any
	After       map[string]any
}

// writeStaffAudit appends the audit event for a staff action inside the
// action's own transaction, so the change and its record commit together or
// not at all (README "What the database refuses", row 5). The trigger computes
// the day, sequence and hash chain.
func writeStaffAudit(ctx context.Context, tx pgx.Tx, by Staff, a staffAudit) error {
	roles, err := json.Marshal(by.Roles)
	if err != nil {
		return err
	}
	var before, after any
	if a.Before != nil {
		b, err := json.Marshal(a.Before)
		if err != nil {
			return err
		}
		before = string(b)
	}
	if a.After != nil {
		b, err := json.Marshal(a.After)
		if err != nil {
			return err
		}
		after = string(b)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_event
		  (actor_kind, actor_account_id, actor_roles, action, subject_type, subject_id,
		   outcome, reason_code, reason, before, after, amount_cents,
		   request_id, session_id, ip, user_agent,
		   day, seq, prev_hash, hash)
		VALUES ('ACCOUNT', $1, $2, $3, $4, $5,
		        'SUCCESS', $6, $7, $8, $9, $10,
		        $11, $12, $13::inet, $14,
		        current_date, 0, '\x00'::bytea, '\x00'::bytea)`,
		by.AccountID, string(roles), a.Action, a.SubjectType, nullUUID(a.SubjectID),
		nullStr(a.ReasonCode), nullStr(a.Reason), before, after, a.AmountCents,
		nullStr(by.RequestID), nullUUID(by.SessionID), nullStr(by.IP), nullStr(by.UserAgent))
	if err != nil {
		return fmt.Errorf("audit %s: %w", a.Action, err)
	}
	return nil
}
