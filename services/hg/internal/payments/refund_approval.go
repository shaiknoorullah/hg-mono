package payments

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ApproveRefund is the second person's decision on an approval request: a
// refund above its requester's authority, which IssueAdminRefund recorded in
// PENDING_APPROVAL. That is a goodwill refund above CAD 50, whoever asked
// (docs/decisions/README.md, "Goodwill refund that needs a second approver"),
// or one past the requester's 24-hour cap. The approver may not be the person
// who asked (the contract's issueRefund: "Nobody may approve their own
// above-cap request") and must hold the role the request was escalated to, or
// be a super admin.
//
// Approval posts the refund's balanced REFUND batch, records the approver and
// puts the refund on the sender's clock (refund_sender.go), with its audit row,
// in one transaction. Until then nothing about it reaches Stripe, and the
// schema refuses a refund that moves money without an approver
// (refund_money_needs_approver, 00035). The HTTP route that calls this is
// #172.
func (s *Service) ApproveRefund(ctx context.Context, refundID, approverID string, approverRoles []string) (RefundDTO, error) {
	err := s.repo.tx(ctx, func(tx pgx.Tx) error {
		var (
			orderID, state, requestedBy, requiredRole string
			amount                                    int64
			split                                     LiabilitySplit
		)
		err := tx.QueryRow(ctx, `
			SELECT order_id::text, state::text, requested_by::text, coalesce(approval_required_role::text, ''),
			       amount_cents, restaurant_chargeback_cents, rider_chargeback_cents, platform_absorbed_cents
			  FROM refund WHERE id = $1 FOR UPDATE`, refundID).Scan(
			&orderID, &state, &requestedBy, &requiredRole,
			&amount, &split.RestaurantChargebackCents, &split.RiderChargebackCents, &split.PlatformAbsorbedCents)
		if errors.Is(err, pgx.ErrNoRows) {
			return domainErr(httpxNotFound, 404, "No such refund.")
		}
		if err != nil {
			return err
		}
		if RefundState(state) != RefundPendingApproval {
			return domainErr(string(CodeConflict), 409, "This refund is not waiting for approval; it is "+state+".")
		}
		if approverID == requestedBy {
			return domainErr(string(CodeSelfApprovalForbidden), 409, "Nobody may approve their own refund request.")
		}
		if !slices.Contains(approverRoles, requiredRole) && !slices.Contains(approverRoles, "SUPER_ADMIN") {
			return domainErr(string(httpx.CodeForbidden), 403,
				fmt.Sprintf("This refund needs approval from a %s.", requiredRole))
		}

		money, _, err := getOrderMoney(ctx, tx, orderID)
		if err != nil {
			return err
		}
		// Keyed by the refund, as the webhook's fallback batch for the same
		// refund is (webhook_effects.go), so the refund's batch is posted once.
		batch := BuildRefundBatch(money, split, amount, "refund:"+refundID, "admin:"+approverID)
		batch.RefundID = refundID
		if err := insertBatch(ctx, tx, batch); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE refund
			   SET state = 'AUTHORISED', approval_status = 'APPROVED', approved_by = $2,
			       deadline_at = now(), deadline_action = $3
			 WHERE id = $1`, refundID, approverID, RefundActionSubmit); err != nil {
			return err
		}
		return writeWebhookAudit(ctx, tx, webhookAudit{
			ActorKind: "ACCOUNT", ActorAccountID: approverID,
			Action: "refund.approve", SubjectType: "refund", SubjectID: refundID,
			AmountCents: int64Ptr(amount),
			After:       map[string]any{"state": RefundAuthorised, "approved_by": approverID, "required_role": requiredRole},
		})
	})
	if err != nil {
		return RefundDTO{}, err
	}
	rr, err := s.repo.GetRefund(ctx, refundID)
	if err != nil {
		return RefundDTO{}, err
	}
	return refundToDTO(rr), nil
}
