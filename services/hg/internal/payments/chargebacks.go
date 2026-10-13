package payments

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Chargebacks are disputes a customer raised with their bank, which Stripe
// reports by webhook and applyDisputeEvent keeps current
// (docs/spec/01-platform.md, "P-18 — Refunds, cancellations and
// compensation": a chargeback row with its evidence deadline, ops notified).
// Staff read them and keep the evidence they gather as notes (#172).
// Submitting that evidence to Stripe is #319.

// ChargebackDTO is the contract Chargeback schema.
type ChargebackDTO struct {
	ID                  string                  `json:"id"`
	OrderID             string                  `json:"order_id"`
	OrderCode           string                  `json:"order_code"`
	StripeDisputeID     string                  `json:"stripe_dispute_id"`
	AmountCents         int64                   `json:"amount_cents"`
	Currency            string                  `json:"currency"`
	Reason              *string                 `json:"reason"`
	Status              string                  `json:"status"`
	Outcome             *string                 `json:"outcome"`
	EvidenceDueAt       *string                 `json:"evidence_due_at"`
	DeadlineAt          *string                 `json:"deadline_at"`
	EvidenceSubmittedAt *string                 `json:"evidence_submitted_at"`
	OpenedAt            string                  `json:"opened_at"`
	UpdatedAt           string                  `json:"updated_at"`
	EvidenceNotes       []ChargebackEvidenceDTO `json:"evidence_notes"`
}

// ChargebackEvidenceDTO is the contract ChargebackEvidenceNote schema.
type ChargebackEvidenceDTO struct {
	ID              string `json:"id"`
	Body            string `json:"body"`
	AuthorAccountID string `json:"author_account_id"`
	CreatedAt       string `json:"created_at"`

	at time.Time
}

// ChargebackNoteInput is the contract ChargebackEvidenceNoteInput.
type ChargebackNoteInput struct {
	Body string `json:"body"`
}

// chargebackStatuses are Stripe's dispute statuses the contract names, as
// stored (lower case) and as sent (upper case).
var chargebackStatuses = map[string]string{
	"warning_needs_response": "WARNING_NEEDS_RESPONSE",
	"warning_under_review":   "WARNING_UNDER_REVIEW",
	"warning_closed":         "WARNING_CLOSED",
	"needs_response":         "NEEDS_RESPONSE",
	"under_review":           "UNDER_REVIEW",
	"won":                    "WON",
	"lost":                   "LOST",
	"prevented":              "PREVENTED",
	"charge_refunded":        "CHARGE_REFUNDED",
}

// chargebackStatus maps a stored status onto the contract's. A status Stripe
// adds later reads NEEDS_RESPONSE while the dispute is open, so a person looks
// at it rather than it passing unnoticed.
func chargebackStatus(stored string) string {
	if s, ok := chargebackStatuses[strings.ToLower(stored)]; ok {
		return s
	}
	return "NEEDS_RESPONSE"
}

// Reader is the read side of a pool or a transaction.
type Reader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const chargebackSelect = `
	SELECT c.id::text, c.order_id::text, o.code, c.stripe_dispute_id, c.amount_cents, o.currency::text,
	       c.reason, c.state, c.outcome, c.evidence_due_at, c.deadline_at, c.submitted_at,
	       c.created_at, c.updated_at
	  FROM chargeback c
	  JOIN "order" o ON o.id = c.order_id`

// chargebackRowAt is a chargeback with the exact sort key of the list.
type chargebackRowAt struct {
	dto      ChargebackDTO
	deadline *time.Time
	opened   time.Time
}

func scanChargeback(row pgx.Row) (chargebackRowAt, error) {
	var (
		d                        ChargebackDTO
		state                    string
		outcome                  *string
		due, deadline, submitted *time.Time
		opened, updated          time.Time
	)
	err := row.Scan(&d.ID, &d.OrderID, &d.OrderCode, &d.StripeDisputeID, &d.AmountCents, &d.Currency,
		&d.Reason, &state, &outcome, &due, &deadline, &submitted, &opened, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return chargebackRowAt{}, ErrNotFound
	}
	if err != nil {
		return chargebackRowAt{}, err
	}
	d.Status = chargebackStatus(state)
	if outcome != nil {
		o := chargebackStatus(*outcome)
		d.Outcome = &o
	}
	d.EvidenceDueAt, d.DeadlineAt, d.EvidenceSubmittedAt = tsPtr(due), tsPtr(deadline), tsPtr(submitted)
	d.OpenedAt, d.UpdatedAt = tsFor(opened), tsFor(updated)
	d.EvidenceNotes = []ChargebackEvidenceDTO{}
	return chargebackRowAt{dto: d, deadline: deadline, opened: opened}, nil
}

// attachEvidenceNotes loads the notes of the given chargebacks, oldest first.
func attachEvidenceNotes(ctx context.Context, q Reader, cbs []ChargebackDTO) error {
	if len(cbs) == 0 {
		return nil
	}
	ids := make([]string, len(cbs))
	at := make(map[string]int, len(cbs))
	for i, c := range cbs {
		ids[i] = c.ID
		at[c.ID] = i
	}
	rows, err := q.Query(ctx, `
		SELECT chargeback_id::text, id::text, body, author_account_id::text, created_at
		  FROM chargeback_evidence_note
		 WHERE chargeback_id = ANY($1::uuid[])
		 ORDER BY created_at, id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cbID    string
			n       ChargebackEvidenceDTO
			created time.Time
		)
		if err := rows.Scan(&cbID, &n.ID, &n.Body, &n.AuthorAccountID, &created); err != nil {
			return err
		}
		n.CreatedAt, n.at = tsFor(created), created
		i := at[cbID]
		cbs[i].EvidenceNotes = append(cbs[i].EvidenceNotes, n)
	}
	return rows.Err()
}

// ChargebackFilter narrows listChargebacks.
type ChargebackFilter struct {
	Open    *bool
	OrderID string
	Limit   int
	Cursor  string
}

// ListChargebacks implements listChargebacks: open chargebacks first, the
// soonest evidence deadline first; closed ones after, newest first. Staff
// only.
func (s *Service) ListChargebacks(ctx context.Context, by Staff, f ChargebackFilter) ([]ChargebackDTO, *string, error) {
	if err := requireStaff(by); err != nil {
		return nil, nil, err
	}
	var (
		args  []any
		conds []string
	)
	add := func(cond string, v ...any) {
		args = append(args, v...)
		n := make([]any, len(v))
		for i := range v {
			n[i] = len(args) - len(v) + i + 1
		}
		conds = append(conds, fmt.Sprintf(cond, n...))
	}
	if f.Open != nil {
		if *f.Open {
			conds = append(conds, "c.outcome IS NULL")
		} else {
			conds = append(conds, "c.outcome IS NOT NULL")
		}
	}
	if f.OrderID != "" {
		add("c.order_id = $%d", f.OrderID)
	}
	if f.Cursor != "" {
		open, at, id, err := decodeChargebackCursor(f.Cursor)
		if err != nil {
			return nil, nil, domainErr("VALIDATION_FAILED", 422, "The cursor is not one this list gave out.")
		}
		if open {
			add("((c.outcome IS NULL AND (c.deadline_at, c.id) > ($%d, $%d)) OR c.outcome IS NOT NULL)", at, id)
		} else {
			add("(c.outcome IS NOT NULL AND c.id < $%d)", id)
		}
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}
	// Open chargebacks always carry their deadline (chargeback_deadline_required,
	// 00034); closed ones never do.
	rows, err := s.repo.pool.Query(ctx, chargebackSelect+where+fmt.Sprintf(`
		ORDER BY (c.outcome IS NOT NULL),
		         CASE WHEN c.outcome IS NULL THEN c.deadline_at END,
		         CASE WHEN c.outcome IS NULL THEN c.id END,
		         c.id DESC
		LIMIT %d`, limit+1), args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var found []chargebackRowAt
	for rows.Next() {
		c, err := scanChargeback(rows)
		if err != nil {
			return nil, nil, err
		}
		found = append(found, c)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var next *string
	if len(found) > limit {
		found = found[:limit]
		last := found[limit-1]
		c := encodeChargebackCursor(last.dto.Outcome == nil, last.deadline, last.dto.ID)
		next = &c
	}
	out := make([]ChargebackDTO, len(found))
	for i, c := range found {
		out[i] = c.dto
	}
	if err := attachEvidenceNotes(ctx, s.repo.pool, out); err != nil {
		return nil, nil, err
	}
	return out, next, nil
}

func encodeChargebackCursor(open bool, deadline *time.Time, id string) string {
	raw := "c|" + id
	if open && deadline != nil {
		raw = "o|" + deadline.UTC().Format(time.RFC3339Nano) + "|" + id
	}
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeChargebackCursor(c string) (open bool, at time.Time, id string, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return false, at, "", err
	}
	parts := strings.Split(string(raw), "|")
	switch {
	case len(parts) == 2 && parts[0] == "c" && len(parts[1]) == 36:
		return false, at, parts[1], nil
	case len(parts) == 3 && parts[0] == "o" && len(parts[2]) == 36:
		at, err = time.Parse(time.RFC3339Nano, parts[1])
		return true, at, parts[2], err
	}
	return false, at, "", errors.New("malformed cursor")
}

// GetChargeback implements getChargeback. Staff only.
func (s *Service) GetChargeback(ctx context.Context, by Staff, id string) (ChargebackDTO, error) {
	if err := requireStaff(by); err != nil {
		return ChargebackDTO{}, err
	}
	return getChargeback(ctx, s.repo.pool, id)
}

func getChargeback(ctx context.Context, q Reader, id string) (ChargebackDTO, error) {
	c, err := scanChargeback(q.QueryRow(ctx, chargebackSelect+` WHERE c.id = $1`, id))
	if errors.Is(err, ErrNotFound) {
		return ChargebackDTO{}, domainErr(httpxNotFound, 404, "No such chargeback.")
	}
	if err != nil {
		return ChargebackDTO{}, err
	}
	out := []ChargebackDTO{c.dto}
	if err := attachEvidenceNotes(ctx, q, out); err != nil {
		return ChargebackDTO{}, err
	}
	return out[0], nil
}

// AddChargebackEvidenceNote implements addChargebackEvidenceNote: a note of the
// evidence gathered for an open chargeback, appended with its audit event in
// one transaction. A chargeback Stripe has closed takes no more notes.
func (s *Service) AddChargebackEvidenceNote(ctx context.Context, by Staff, chargebackID string, in ChargebackNoteInput, idem *Idempotency) (Outcome, error) {
	if err := requireStaff(by); err != nil {
		return Outcome{}, err
	}
	if !validReason(in.Body, 10, 4000) {
		return Outcome{}, domainErr("VALIDATION_FAILED", 422, "body must be 10–4000 characters.")
	}
	return s.repo.once(ctx, idem, func(tx pgx.Tx) (Outcome, error) {
		var outcome *string
		err := tx.QueryRow(ctx, `SELECT outcome FROM chargeback WHERE id = $1 FOR UPDATE`, chargebackID).Scan(&outcome)
		if errors.Is(err, pgx.ErrNoRows) {
			return Outcome{}, domainErr(httpxNotFound, 404, "No such chargeback.")
		}
		if err != nil {
			return Outcome{}, err
		}
		if outcome != nil {
			return Outcome{}, domainErr(codeAlreadyDecided, 409, "Stripe has closed this chargeback ("+*outcome+"); it takes no more evidence.")
		}
		var noteID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO chargeback_evidence_note (chargeback_id, author_account_id, body)
			VALUES ($1, $2, $3) RETURNING id::text`, chargebackID, by.AccountID, in.Body).Scan(&noteID); err != nil {
			return Outcome{}, err
		}
		if err := writeStaffAudit(ctx, tx, by, staffAudit{
			Action: "chargeback.evidence_note", SubjectType: "chargeback", SubjectID: chargebackID,
			After: map[string]any{"note_id": noteID, "length": len(in.Body)},
		}); err != nil {
			return Outcome{}, err
		}
		d, err := getChargeback(ctx, tx, chargebackID)
		if err != nil {
			return Outcome{}, err
		}
		return Outcome{Status: http.StatusCreated, Data: d}, nil
	})
}

// MoneyEventDTO is the contract MoneyEvent schema.
type MoneyEventDTO struct {
	Kind           string  `json:"kind"`
	At             string  `json:"at"`
	AmountCents    *int64  `json:"amount_cents"`
	Currency       string  `json:"currency"`
	ActorKind      string  `json:"actor_kind"`
	ActorAccountID *string `json:"actor_account_id"`
	RefundID       *string `json:"refund_id"`
	ChargebackID   *string `json:"chargeback_id"`
	Reason         *string `json:"reason"`

	at time.Time
}

// MoneyHistory is an order's payment, refund and chargeback history for the
// admin order view (getOrderAdmin).
type MoneyHistory struct {
	Timeline    []MoneyEventDTO
	Chargebacks []ChargebackDTO
}

// auditMoneyEvents maps the audit actions of refund and chargeback steps onto
// the timeline. A refund's request and a chargeback's opening come from their
// rows, which every refund and chargeback has whatever wrote it; an evidence
// note comes from its own row.
var auditMoneyEvents = map[string]string{
	"refund.escalate":            "REFUND_ESCALATED",
	"refund.approve":             "REFUND_APPROVED",
	"refund.decline":             "REFUND_DECLINED",
	"payment.refund_submitted":   "REFUND_SUBMITTED",
	"payment.refund_succeeded":   "REFUND_SUCCEEDED",
	"payment.refund_failed":      "REFUND_FAILED",
	"payment.refund_set_aside":   "REFUND_SET_ASIDE",
	"payment.chargeback_updated": "CHARGEBACK_UPDATED",
	"payment.chargeback_closed":  "CHARGEBACK_CLOSED",
}

// OrderMoneyHistory reads an order's money timeline and chargebacks: the
// payment's authorisation, capture or void; each refund's request and every
// later step with who took it and why; each chargeback, its updates and the
// evidence notes staff added (#172). Oldest first.
func OrderMoneyHistory(ctx context.Context, q Reader, orderID string) (MoneyHistory, error) {
	h := MoneyHistory{Timeline: []MoneyEventDTO{}, Chargebacks: []ChargebackDTO{}}
	var currency string
	if err := q.QueryRow(ctx, `SELECT currency::text FROM "order" WHERE id = $1`, orderID).Scan(&currency); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return h, ErrNotFound
		}
		return h, err
	}
	add := func(kind string, at time.Time, amount *int64, actorKind string, actor, refundID, cbID, reason *string) {
		h.Timeline = append(h.Timeline, MoneyEventDTO{
			Kind: kind, At: tsFor(at), AmountCents: amount, Currency: currency, ActorKind: actorKind,
			ActorAccountID: actor, RefundID: refundID, ChargebackID: cbID, Reason: reason, at: at,
		})
	}

	// The payment: authorised, captured, voided.
	rows, err := q.Query(ctx, `
		SELECT amount_authorized_cents, amount_captured_cents, authorized_at, captured_at, canceled_at
		  FROM payment_intent WHERE order_id = $1 ORDER BY created_at`, orderID)
	if err != nil {
		return h, err
	}
	for rows.Next() {
		var (
			authorised, captured  int64
			authAt, capAt, voidAt *time.Time
		)
		if err := rows.Scan(&authorised, &captured, &authAt, &capAt, &voidAt); err != nil {
			rows.Close()
			return h, err
		}
		if authAt != nil {
			add("PAYMENT_AUTHORISED", *authAt, int64Ptr(authorised), "SYSTEM", nil, nil, nil, nil)
		}
		if capAt != nil {
			add("PAYMENT_CAPTURED", *capAt, int64Ptr(captured), "SYSTEM", nil, nil, nil, nil)
		}
		if voidAt != nil {
			add("PAYMENT_VOIDED", *voidAt, int64Ptr(authorised), "SYSTEM", nil, nil, nil, nil)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return h, err
	}

	// Each refund's request.
	var subjects []string
	rows, err = q.Query(ctx, `
		SELECT id::text, amount_cents, requested_at, requested_by::text, note
		  FROM refund WHERE order_id = $1 ORDER BY requested_at, id`, orderID)
	if err != nil {
		return h, err
	}
	for rows.Next() {
		var (
			id, by string
			amount int64
			at     time.Time
			note   *string
		)
		if err := rows.Scan(&id, &amount, &at, &by, &note); err != nil {
			rows.Close()
			return h, err
		}
		add("REFUND_REQUESTED", at, int64Ptr(amount), "ACCOUNT", &by, &id, nil, note)
		subjects = append(subjects, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return h, err
	}

	// Each chargeback, opened, and its evidence notes.
	rows, err = q.Query(ctx, chargebackSelect+` WHERE c.order_id = $1 ORDER BY c.created_at, c.id`, orderID)
	if err != nil {
		return h, err
	}
	var opened []time.Time
	for rows.Next() {
		c, err := scanChargeback(rows)
		if err != nil {
			rows.Close()
			return h, err
		}
		h.Chargebacks = append(h.Chargebacks, c.dto)
		opened = append(opened, c.opened)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return h, err
	}
	if err := attachEvidenceNotes(ctx, q, h.Chargebacks); err != nil {
		return h, err
	}
	for i, c := range h.Chargebacks {
		id := c.ID
		add("CHARGEBACK_OPENED", opened[i], int64Ptr(c.AmountCents), "WEBHOOK", nil, nil, &id, c.Reason)
		for _, n := range c.EvidenceNotes {
			author := n.AuthorAccountID
			add("CHARGEBACK_EVIDENCE_NOTE", n.at, nil, "ACCOUNT", &author, nil, &id, nil)
		}
		subjects = append(subjects, id)
	}

	// Every later step, from the audit trail, with who took it and why.
	if len(subjects) > 0 {
		actions := make([]string, 0, len(auditMoneyEvents))
		for a := range auditMoneyEvents {
			actions = append(actions, a)
		}
		rows, err = q.Query(ctx, `
			SELECT action, at, subject_type, subject_id::text, actor_kind, actor_account_id::text,
			       amount_cents, coalesce(reason, reason_code)
			  FROM audit_event
			 WHERE subject_type IN ('refund', 'chargeback') AND subject_id = ANY($1::uuid[])
			   AND action = ANY($2::text[]) AND outcome = 'SUCCESS'
			 ORDER BY at, seq`, subjects, actions)
		if err != nil {
			return h, err
		}
		for rows.Next() {
			var (
				action, subjectType, subjectID, actorKind string
				at                                        time.Time
				actor, reason                             *string
				amount                                    *int64
			)
			if err := rows.Scan(&action, &at, &subjectType, &subjectID, &actorKind, &actor, &amount, &reason); err != nil {
				rows.Close()
				return h, err
			}
			id := subjectID
			if subjectType == "refund" {
				add(auditMoneyEvents[action], at, amount, actorKind, actor, &id, nil, reason)
			} else {
				add(auditMoneyEvents[action], at, amount, actorKind, actor, nil, &id, reason)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return h, err
		}
	}

	sort.SliceStable(h.Timeline, func(i, j int) bool { return h.Timeline[i].at.Before(h.Timeline[j].at) })
	return h, nil
}
