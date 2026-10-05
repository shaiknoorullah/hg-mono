package payments

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// AdminRefundDTO is the contract AdminRefund schema: a refund as staff see it,
// with who asked and every decision, who took it and why (#172).
type AdminRefundDTO struct {
	ID                   string                  `json:"id"`
	OrderID              string                  `json:"order_id"`
	OrderCode            string                  `json:"order_code"`
	Kind                 string                  `json:"kind"`
	Scope                *string                 `json:"scope"`
	ReasonCode           string                  `json:"reason_code"`
	AmountCents          int64                   `json:"amount_cents"`
	TaxCents             int64                   `json:"tax_cents"`
	Currency             string                  `json:"currency"`
	State                string                  `json:"state"`
	LiabilitySplit       RefundLiabilitySplitDTO `json:"liability_split"`
	Note                 *string                 `json:"note"`
	RequestedAt          string                  `json:"requested_at"`
	RequestedBy          string                  `json:"requested_by"`
	RequesterKind        string                  `json:"requester_kind"`
	ApprovalRequiredRole *string                 `json:"approval_required_role"`
	EscalatedBy          *string                 `json:"escalated_by"`
	EscalatedAt          *string                 `json:"escalated_at"`
	ApprovedBy           *string                 `json:"approved_by"`
	ApprovedAt           *string                 `json:"approved_at"`
	DeclinedBy           *string                 `json:"declined_by"`
	DeclinedAt           *string                 `json:"declined_at"`
	DecisionReason       *string                 `json:"decision_reason"`
	SettledAt            *string                 `json:"settled_at"`
	FailureMessage       *string                 `json:"failure_message"`
}

// adminRefundSelect reads a refund with its order's code and customer, so the
// requester can be told apart: the order's own customer, or staff.
const adminRefundSelect = `
	SELECT r.id::text, r.order_id::text, o.code, r.kind::text, r.scope::text, r.reason_code::text,
	       r.amount_cents, r.tax_cents, pi.currency::text, r.state::text,
	       r.restaurant_chargeback_cents, r.rider_chargeback_cents, r.platform_absorbed_cents,
	       r.note, r.requested_at, r.requested_by::text, r.requested_by = o.account_id,
	       r.approval_required_role::text, r.escalated_by::text, r.escalated_at,
	       r.approved_by::text, r.approved_at, r.declined_by::text, r.declined_at,
	       r.decision_reason, r.settled_at, r.failure_message
	  FROM refund r
	  JOIN payment_intent pi ON pi.id = r.payment_intent_id
	  JOIN "order" o ON o.id = r.order_id`

func scanAdminRefund(row pgx.Row) (AdminRefundDTO, error) {
	d, _, err := scanAdminRefundAt(row)
	return d, err
}

// scanAdminRefundAt also returns the exact requested_at, which the list's
// cursor carries (the rendered one is rounded to milliseconds).
func scanAdminRefundAt(row pgx.Row) (AdminRefundDTO, time.Time, error) {
	var (
		d                                        AdminRefundDTO
		scope                                    string
		requestedAt                              time.Time
		byCustomer                               bool
		escalatedAt, approvedAt, declinedAt, set *time.Time
	)
	err := row.Scan(&d.ID, &d.OrderID, &d.OrderCode, &d.Kind, &scope, &d.ReasonCode,
		&d.AmountCents, &d.TaxCents, &d.Currency, &d.State,
		&d.LiabilitySplit.RestaurantCents, &d.LiabilitySplit.RiderCents, &d.LiabilitySplit.PlatformCents,
		&d.Note, &requestedAt, &d.RequestedBy, &byCustomer,
		&d.ApprovalRequiredRole, &d.EscalatedBy, &escalatedAt,
		&d.ApprovedBy, &approvedAt, &d.DeclinedBy, &declinedAt,
		&d.DecisionReason, &set, &d.FailureMessage)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminRefundDTO{}, time.Time{}, ErrNotFound
	}
	if err != nil {
		return AdminRefundDTO{}, time.Time{}, err
	}
	d.Scope = &scope
	d.RequestedAt = tsFor(requestedAt)
	d.RequesterKind = "STAFF"
	if byCustomer {
		d.RequesterKind = "CUSTOMER"
	}
	d.EscalatedAt, d.ApprovedAt, d.DeclinedAt, d.SettledAt = tsPtr(escalatedAt), tsPtr(approvedAt), tsPtr(declinedAt), tsPtr(set)
	return d, requestedAt, nil
}

// getAdminRefund reads one refund as staff see it, inside or outside a
// transaction.
func getAdminRefund(ctx context.Context, q Reader, id string) (AdminRefundDTO, error) {
	return scanAdminRefund(q.QueryRow(ctx, adminRefundSelect+` WHERE r.id = $1`, id))
}

// AdminRefundFilter narrows the refund review queue (listRefundsAdmin).
type AdminRefundFilter struct {
	States         []string
	ReasonCodes    []string
	MinAmountCents *int64
	MaxAmountCents *int64
	RequestedFrom  *time.Time
	RequestedTo    *time.Time
	OrderID        string
	Limit          int
	Cursor         string
}

// reviewQueueStates is what waits for a person: the default queue.
var reviewQueueStates = []string{string(RefundRequested), string(RefundPendingApproval)}

// ListRefundsForReview implements listRefundsAdmin: refunds for staff, oldest
// request first, with keyset pagination on (requested_at, id). Staff only.
func (s *Service) ListRefundsForReview(ctx context.Context, by Staff, f AdminRefundFilter) ([]AdminRefundDTO, *string, error) {
	if err := requireStaff(by); err != nil {
		return nil, nil, err
	}
	states := f.States
	if len(states) == 0 {
		states = reviewQueueStates
	}
	args := []any{states}
	conds := []string{"r.state = ANY($1::refund_state[])"}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if len(f.ReasonCodes) > 0 {
		add("r.reason_code = ANY($%d::refund_reason_code[])", f.ReasonCodes)
	}
	if f.MinAmountCents != nil {
		add("r.amount_cents >= $%d", *f.MinAmountCents)
	}
	if f.MaxAmountCents != nil {
		add("r.amount_cents <= $%d", *f.MaxAmountCents)
	}
	if f.RequestedFrom != nil {
		add("r.requested_at >= $%d", *f.RequestedFrom)
	}
	if f.RequestedTo != nil {
		add("r.requested_at <= $%d", *f.RequestedTo)
	}
	if f.OrderID != "" {
		add("r.order_id = $%d", f.OrderID)
	}
	if f.Cursor != "" {
		at, id, err := decodeRefundCursor(f.Cursor)
		if err != nil {
			return nil, nil, domainErr("VALIDATION_FAILED", 422, "The cursor is not one this list gave out.")
		}
		args = append(args, at, id)
		conds = append(conds, fmt.Sprintf("(r.requested_at, r.id) > ($%d, $%d)", len(args)-1, len(args)))
	}
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	sql := adminRefundSelect + " WHERE " + strings.Join(conds, " AND ") +
		fmt.Sprintf(" ORDER BY r.requested_at, r.id LIMIT %d", limit+1)
	rows, err := s.repo.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	out := make([]AdminRefundDTO, 0, limit)
	ats := make([]time.Time, 0, limit)
	for rows.Next() {
		d, at, err := scanAdminRefundAt(rows)
		if err != nil {
			return nil, nil, err
		}
		out = append(out, d)
		ats = append(ats, at)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if len(out) <= limit {
		return out, nil, nil
	}
	out = out[:limit]
	next := encodeRefundCursor(ats[limit-1], out[limit-1].ID)
	return out, &next, nil
}

// The cursor is the last row's exact requested_at and id.
func encodeRefundCursor(at time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func decodeRefundCursor(c string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", err
	}
	at, id, ok := strings.Cut(string(raw), "|")
	if !ok || len(id) != 36 {
		return time.Time{}, "", errors.New("malformed cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	return t, id, err
}
