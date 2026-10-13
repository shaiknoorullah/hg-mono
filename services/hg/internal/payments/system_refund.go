package payments

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// PlatformAccountID is the platform's own account (migration 00056): it asks
// for and approves the refunds a deadline owes, which have no person behind
// them. It cannot sign in and holds no role.
const PlatformAccountID = "00000000-0000-7000-8000-00000000a001"

// RefundSystemCancelTx posts the full refund owed when the platform cancels a
// captured order on its own, in the caller's transaction, so the refund
// commits with the cancellation or not at all ("no timeout results in money
// kept, no food, no refund", docs/spec/01-platform.md, "P-15 — Deadlines and
// timeout actions"). The first caller is the pickup escalation cap: a ready
// order nobody collected (https://github.com/shaiknoorullah/hg-mono/issues/336).
//
// The refund is everything still captured, AUTHORISED at once under the
// owner's decided policy (the customer is refunded, the restaurant is paid,
// the platform absorbs the cost: ComputeLiabilitySplit puts NO_RIDER_FOUND
// wholly on PLATFORM_ABSORBED), with its balanced REFUND batch, and due to the
// refund sender, which sends it to Stripe (refund_sender.go). An order with
// nothing captured has nothing to refund; one already refunded in full is left
// as it is.
func RefundSystemCancelTx(ctx context.Context, tx pgx.Tx, orderID, reasonCode, note string) error {
	intent, err := scanIntent(tx.QueryRow(ctx, intentSelect+`
		 WHERE order_id = $1 AND kind = 'ORDER' FOR UPDATE`, orderID))
	if errors.Is(err, ErrNotFound) {
		// A captured order always has its PaymentIntent; fail closed rather
		// than cancel an order and skip its refund.
		return fmt.Errorf("order %s has no ORDER payment_intent to refund", orderID)
	}
	if err != nil {
		return fmt.Errorf("lock payment_intent: %w", err)
	}
	if intent.AmountCapturedCents <= 0 {
		return nil
	}
	var prior int64
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(amount_cents),0) FROM refund
		 WHERE order_id = $1 AND state NOT IN ('DECLINED','CANCELLED','FAILED')`, orderID).Scan(&prior); err != nil {
		return fmt.Errorf("sum prior refunds: %w", err)
	}
	amount := intent.AmountCapturedCents - prior
	if amount <= 0 {
		return nil
	}
	m, _, err := getOrderMoney(ctx, tx, orderID)
	if err != nil {
		return fmt.Errorf("load order money: %w", err)
	}
	tax := min(m.TaxTotalCents, amount)
	split := ComputeLiabilitySplit(reasonCode, amount, amount-tax, m.RiderEarningsCents)
	batch := BuildRefundBatch(m, split, amount, "system-cancel-refund:"+orderID, "system:"+reasonCode)
	if !batch.Balanced() {
		return fmt.Errorf("refusing to post an unbalanced cancel refund (residual %d)", batch.Residual())
	}
	_, err = insertRefund(ctx, tx, CreateRefundParams{
		OrderID: orderID, PaymentIntentID: intent.ID, Kind: RefundFull, Scope: ScopeFull,
		ReasonCode: reasonCode, Note: note, AmountCents: amount, TaxCents: tax, Split: split,
		State: RefundAuthorised, ApprovalStatus: "APPROVED",
		RequestedBy: PlatformAccountID, ApprovedBy: PlatformAccountID,
		DeadlineAction: RefundActionSubmit, Ledger: &batch, Money: m,
	})
	return err
}
