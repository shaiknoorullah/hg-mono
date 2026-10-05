package payments

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Staff decide the refunds that wait for a person (#172): a customer's request
// (REQUESTED, docs/spec/02-customer.md, "C-37 — Refund requests and refund
// tracking": every one human-reviewed at launch) and an approval request
// (PENDING_APPROVAL: a refund above its requester's authority, or a goodwill
// refund above CAD 50). The rules are docs/spec/05-admin.md, "A-33 — Refund
// issuance and authority limits":
//
//   - within the approver's rolling 24-hour limit a request is approved at
//     once; above it, it is sent up one level for a second person, never
//     rejected (A-33: "the customer's request is never lost");
//   - nobody approves their own request, nor one they sent up;
//   - a goodwill refund above CAD 50 always needs a second person
//     (docs/decisions/README.md, "Goodwill refund that needs a second
//     approver");
//   - approving moves money, so it needs a session signed in with an
//     authenticator code (rule R6 of that section: MFA within 12 hours);
//   - the decision, its reason, the ledger batch and the audit event commit in
//     one transaction (rule R7: every refund state change is audited, with
//     the authority used), and nothing reaches Stripe until they have:
//     the refund sender (refund_sender.go) sends only AUTHORISED refunds.

// RefundDecisionInput is the contract RefundApprovalInput: why the refund is
// approved.
type RefundDecisionInput struct {
	ReasonText string  `json:"reason_text"`
	CaseID     *string `json:"case_id"`
}

// RefundDeclineInput is the contract RefundDeclineInput.
type RefundDeclineInput struct {
	ReasonText      string  `json:"reason_text"`
	CustomerMessage *string `json:"customer_message"`
	CaseID          *string `json:"case_id"`
}

// Outbox writes a notification into the caller's transaction (the
// transactional outbox, docs/spec/01-platform.md, "P-24 — Notification router:
// which event, which role, which channel"). *notify.Enqueuer
// is one.
type Outbox interface {
	Enqueue(ctx context.Context, tx pgx.Tx, n notify.New) (notify.EnqueueResult, error)
}

// WithOutbox sets where the service's notifications go: customers told about
// refund decisions, and partners told about their payouts (payout_notices.go;
// it sets the repo's outbox too, which the payout run shares). The server
// wires the notify module's enqueuer (cmd/hg). Declining a customer's request
// without it is refused: the customer must be told.
func (s *Service) WithOutbox(o Outbox) *Service {
	s.outbox = o
	if s.repo != nil {
		s.repo.WithOutbox(o)
	}
	return s
}

// awaitApprovalAction is the deadline action of a refund waiting for a second
// person.
const awaitApprovalAction = "await_refund_approval"

func validReason(text string, min, max int) bool {
	n := utf8.RuneCountInString(text)
	return n >= min && n <= max
}

// pendingRefund is a refund waiting for a decision, locked for it.
type pendingRefund struct {
	ID, OrderID, State, Kind  string
	RequestedBy, RequiredRole string
	EscalatedBy               string
	CustomerID, OrderCode     string
	AmountCents               int64
	Split                     LiabilitySplit
}

func lockRefundForDecision(ctx context.Context, tx pgx.Tx, refundID string) (pendingRefund, error) {
	var p pendingRefund
	err := tx.QueryRow(ctx, `
		SELECT r.id::text, r.order_id::text, r.state::text, r.kind::text,
		       r.requested_by::text, coalesce(r.approval_required_role::text, ''), coalesce(r.escalated_by::text, ''),
		       o.account_id::text, o.code,
		       r.amount_cents, r.restaurant_chargeback_cents, r.rider_chargeback_cents, r.platform_absorbed_cents
		  FROM refund r JOIN "order" o ON o.id = r.order_id
		 WHERE r.id = $1
		   FOR UPDATE OF r`, refundID).Scan(
		&p.ID, &p.OrderID, &p.State, &p.Kind,
		&p.RequestedBy, &p.RequiredRole, &p.EscalatedBy,
		&p.CustomerID, &p.OrderCode,
		&p.AmountCents, &p.Split.RestaurantChargebackCents, &p.Split.RiderChargebackCents, &p.Split.PlatformAbsorbedCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, domainErr(httpxNotFound, 404, "No such refund.")
	}
	return p, err
}

// ApproveRefund is a member of staff's approval of a refund waiting for one
// (approveRefund). A customer's request within the approver's limit, or an
// approval request they may decide, is AUTHORISED with its balanced REFUND
// batch (200). A customer's request above the approver's limit is sent up to
// the role one level up instead (202), and waits for a second person. idem,
// when set, makes a retried click replay the first answer.
func (s *Service) ApproveRefund(ctx context.Context, refundID string, by Staff, in RefundDecisionInput, idem *Idempotency) (Outcome, error) {
	if err := requireStaff(by); err != nil {
		return Outcome{}, err
	}
	if err := requireMoneyMFA(by); err != nil {
		return Outcome{}, err
	}
	if !validReason(in.ReasonText, 10, 1000) {
		return Outcome{}, domainErr("VALIDATION_FAILED", 422, "reason_text must be 10–1000 characters.")
	}
	return s.repo.once(ctx, idem, func(tx pgx.Tx) (Outcome, error) {
		p, err := lockRefundForDecision(ctx, tx, refundID)
		if err != nil {
			return Outcome{}, err
		}
		if by.AccountID == p.RequestedBy {
			return Outcome{}, domainErr(string(CodeSelfApprovalForbidden), 409, "Nobody may approve their own refund request.")
		}
		cap, uncapped := operatorCap(by.Roles)
		used, err := authorityUsed(ctx, tx, by.AccountID, s.now())
		if err != nil {
			return Outcome{}, err
		}
		authority := map[string]any{"cap_applied_cents": cap, "uncapped": uncapped, "used_24h_cents": used}

		switch RefundState(p.State) {
		case RefundRequested:
			if requiresApproval(RefundKind(p.Kind), p.AmountCents, used, cap, uncapped) {
				return s.escalateTx(ctx, tx, p, by, in, authority)
			}
		case RefundPendingApproval:
			if by.AccountID == p.EscalatedBy {
				return Outcome{}, domainErr(string(CodeSelfApprovalForbidden), 409,
					"You sent this refund up for a second person; someone else must approve it.")
			}
			if !by.has(p.RequiredRole) && !by.has("SUPER_ADMIN") {
				return Outcome{}, domainErr(string(httpx.CodeForbidden), 403,
					fmt.Sprintf("This refund needs approval from someone with the %s role.", p.RequiredRole))
			}
			if !uncapped && used+p.AmountCents > cap {
				return Outcome{}, domainErr(string(CodeDailyCapExceeded), 409,
					"Approving this would take you past your 24-hour refund limit; a super admin can approve it.")
			}
		default:
			return Outcome{}, domainErr(codeAlreadyDecided, 409, "This refund is not waiting for a decision; it is "+p.State+".")
		}
		return s.authoriseTx(ctx, tx, p, by, in.ReasonText, in.CaseID, authority)
	})
}

// authoriseTx approves a locked refund: its balanced REFUND batch, the
// approver, the reason and the sender's clock, with its audit event, in the
// caller's transaction. Until it commits nothing about the refund reaches
// Stripe, and the schema refuses a refund that moves money without an
// approver (refund_money_needs_approver, 00046) or one approved by whoever
// sent it up (refund_second_person, 00048).
func (s *Service) authoriseTx(ctx context.Context, tx pgx.Tx, p pendingRefund, by Staff, reason string, caseID *string, authority map[string]any) (Outcome, error) {
	money, _, err := getOrderMoney(ctx, tx, p.OrderID)
	if err != nil {
		return Outcome{}, err
	}
	// Keyed by the refund, as the webhook's fallback batch for the same refund
	// is (webhook_effects.go), so the refund's batch is posted once.
	batch := BuildRefundBatch(money, p.Split, p.AmountCents, "refund:"+p.ID, "admin:"+by.AccountID)
	batch.RefundID = p.ID
	posted, err := postBatchTx(ctx, tx, batch)
	if err != nil {
		return Outcome{}, err
	}
	// A rider chargeback reverses the rider's earnings in the same transaction
	// (rider_earnings.go), as a refund recorded at creation does.
	if err := writeRiderClawbacksTx(ctx, tx, batch, posted); err != nil {
		return Outcome{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refund
		   SET state = 'AUTHORISED', approval_status = 'APPROVED', approved_by = $2, approved_at = now(),
		       decision_reason = $3, deadline_at = now(), deadline_action = $4
		 WHERE id = $1`, p.ID, by.AccountID, reason, RefundActionSubmit); err != nil {
		return Outcome{}, err
	}
	approvers := []string{by.AccountID}
	if p.EscalatedBy != "" {
		approvers = []string{p.EscalatedBy, by.AccountID}
	}
	after := map[string]any{
		"state": RefundAuthorised, "approved_by": by.AccountID, "required_role": nullStr(p.RequiredRole),
		"approver_ids": approvers, "case_id": caseID,
	}
	for k, v := range authority {
		after[k] = v
	}
	if err := writeStaffAudit(ctx, tx, by, staffAudit{
		Action: "refund.approve", SubjectType: "refund", SubjectID: p.ID,
		Reason: reason, AmountCents: int64Ptr(p.AmountCents),
		Before: map[string]any{"state": p.State}, After: after,
	}); err != nil {
		return Outcome{}, err
	}
	d, err := getAdminRefund(ctx, tx, p.ID)
	if err != nil {
		return Outcome{}, err
	}
	return Outcome{Status: http.StatusOK, Data: d}, nil
}

// escalateTx sends a customer's request above the reviewer's limit up one
// level: PENDING_APPROVAL for the next role, naming who sent it up, on a
// clock. No money moves.
func (s *Service) escalateTx(ctx context.Context, tx pgx.Tx, p pendingRefund, by Staff, in RefundDecisionInput, authority map[string]any) (Outcome, error) {
	required := escalationRole(by.Roles)
	if _, err := tx.Exec(ctx, `
		UPDATE refund
		   SET state = 'PENDING_APPROVAL', approval_status = 'PENDING', approval_required_role = $2::role_name,
		       escalated_by = $3, escalated_at = now(), decision_reason = $4,
		       deadline_at = now() + make_interval(secs => $5::float8), deadline_action = $6
		 WHERE id = $1`, p.ID, required, by.AccountID, in.ReasonText, refundWaitForReview.Seconds(), awaitApprovalAction); err != nil {
		return Outcome{}, err
	}
	after := map[string]any{"state": RefundPendingApproval, "required_role": required, "escalated_by": by.AccountID, "case_id": in.CaseID}
	for k, v := range authority {
		after[k] = v
	}
	if err := writeStaffAudit(ctx, tx, by, staffAudit{
		Action: "refund.escalate", SubjectType: "refund", SubjectID: p.ID,
		ReasonCode: "EXCEEDS_REFUND_CAP", Reason: in.ReasonText, AmountCents: int64Ptr(p.AmountCents),
		Before: map[string]any{"state": p.State}, After: after,
	}); err != nil {
		return Outcome{}, err
	}
	d, err := getAdminRefund(ctx, tx, p.ID)
	if err != nil {
		return Outcome{}, err
	}
	return Outcome{Status: http.StatusAccepted, Data: d}, nil
}

// DeclineRefund is a member of staff's decline of a refund waiting for a
// decision (declineRefund). The refund ends DECLINED with who declined it and
// why; nothing is sent to Stripe and no ledger batch is posted. When the
// customer asked for it, they are told in the same transaction, through the
// outbox, in customer_message or a plain sentence, never the staff reason.
func (s *Service) DeclineRefund(ctx context.Context, refundID string, by Staff, in RefundDeclineInput, idem *Idempotency) (Outcome, error) {
	if err := requireStaff(by); err != nil {
		return Outcome{}, err
	}
	if !validReason(in.ReasonText, 10, 1000) {
		return Outcome{}, domainErr("VALIDATION_FAILED", 422, "reason_text must be 10–1000 characters.")
	}
	if in.CustomerMessage != nil && !validReason(*in.CustomerMessage, 10, 500) {
		return Outcome{}, domainErr("VALIDATION_FAILED", 422, "customer_message must be 10–500 characters.")
	}
	return s.repo.once(ctx, idem, func(tx pgx.Tx) (Outcome, error) {
		p, err := lockRefundForDecision(ctx, tx, refundID)
		if err != nil {
			return Outcome{}, err
		}
		switch RefundState(p.State) {
		case RefundRequested:
		case RefundPendingApproval:
			// The role it was sent up to decides it, either way.
			if !by.has(p.RequiredRole) && !by.has("SUPER_ADMIN") {
				return Outcome{}, domainErr(string(httpx.CodeForbidden), 403,
					fmt.Sprintf("This refund is waiting for someone with the %s role to decide it.", p.RequiredRole))
			}
		default:
			return Outcome{}, domainErr(codeAlreadyDecided, 409, "This refund is not waiting for a decision; it is "+p.State+".")
		}
		if _, err := tx.Exec(ctx, `
			UPDATE refund
			   SET state = 'DECLINED', approval_status = 'DECLINED', declined_by = $2, declined_at = now(),
			       decision_reason = $3, deadline_at = NULL, deadline_action = NULL
			 WHERE id = $1`, p.ID, by.AccountID, in.ReasonText); err != nil {
			return Outcome{}, err
		}
		toCustomer := p.RequestedBy == p.CustomerID
		if err := writeStaffAudit(ctx, tx, by, staffAudit{
			Action: "refund.decline", SubjectType: "refund", SubjectID: p.ID,
			Reason: in.ReasonText, AmountCents: int64Ptr(p.AmountCents),
			Before: map[string]any{"state": p.State},
			After:  map[string]any{"state": RefundDeclined, "declined_by": by.AccountID, "customer_told": toCustomer, "case_id": in.CaseID},
		}); err != nil {
			return Outcome{}, err
		}
		if toCustomer {
			if err := s.tellCustomerDeclined(ctx, tx, p, in.CustomerMessage); err != nil {
				return Outcome{}, err
			}
		}
		d, err := getAdminRefund(ctx, tx, p.ID)
		if err != nil {
			return Outcome{}, err
		}
		return Outcome{Status: http.StatusOK, Data: d}, nil
	})
}

// tellCustomerDeclined writes the customer's notification into the decline's
// transaction, so they are told if and only if the decline commits.
func (s *Service) tellCustomerDeclined(ctx context.Context, tx pgx.Tx, p pendingRefund, message *string) error {
	if s.outbox == nil {
		return errors.New("payments: no notification outbox is wired; a customer's refund request cannot be declined without telling them")
	}
	orderID, err := uuid.Parse(p.OrderID)
	if err != nil {
		return err
	}
	customerID, err := uuid.Parse(p.CustomerID)
	if err != nil {
		return err
	}
	msg := ""
	if message != nil {
		msg = *message
	}
	_, err = s.outbox.Enqueue(ctx, tx, notify.NotifyRefundDeclined(notify.RefundEvent{
		RefundID: p.ID, OrderID: orderID, OrderShortCode: p.OrderCode, AccountID: customerID,
	}, msg))
	return err
}
