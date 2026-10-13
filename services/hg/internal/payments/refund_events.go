package payments

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// Refund events on the order's channel (contracts/websocket.md section 4.3):
// refund.created when a refund is recorded, refund.settled when Stripe
// reports it succeeded, refund.failed when it fails, each written in the
// transaction that makes the change, so the event exists if and only if the
// change commits. Who receives them is the realtime allow-list's: the
// customer and support.

// refundFailedMessage is what refund.failed tells the customer. It is never
// Stripe's own failure text, which is for staff.
const refundFailedMessage = "We could not complete this refund. Our team has been alerted and will follow up with you."

type refundEventRow struct {
	orderID, currency, reason, state string
	amount                           int64
	settledAt                        *time.Time
}

func loadRefundEventRow(ctx context.Context, tx pgx.Tx, refundID string) (refundEventRow, error) {
	var r refundEventRow
	err := tx.QueryRow(ctx, `
		SELECT r.order_id::text, o.currency::text, r.reason_code::text, r.state::text, r.amount_cents, r.settled_at
		  FROM refund r
		  JOIN "order" o ON o.id = r.order_id
		 WHERE r.id = $1`, refundID).Scan(&r.orderID, &r.currency, &r.reason, &r.state, &r.amount, &r.settledAt)
	if err != nil {
		return r, fmt.Errorf("refund event: load refund %s: %w", refundID, err)
	}
	return r, nil
}

// EmitRefundCreated writes refund.created for a refund just inserted in tx.
// Every refund the payments module records calls it (insertRefund); the
// admin cancel, which inserts its own refund row, calls it too.
func EmitRefundCreated(ctx context.Context, tx pgx.Tx, refundID string) error {
	r, err := loadRefundEventRow(ctx, tx, refundID)
	if err != nil {
		return err
	}
	return realtime.EmitOrder(ctx, tx, r.orderID, realtime.RefundCreated{
		OrderID: r.orderID, RefundID: refundID, AmountCents: r.amount, Currency: r.currency,
		ReasonCode: contract.RefundReasonCode(r.reason), State: contract.RefundState(r.state),
	})
}

// emitRefundMoved writes the event for a refund that just moved to state to:
// refund.settled for SUCCEEDED, refund.failed for FAILED, nothing otherwise.
func emitRefundMoved(ctx context.Context, tx pgx.Tx, refundID string, to RefundState) error {
	if to != RefundSucceeded && to != RefundFailed {
		return nil
	}
	r, err := loadRefundEventRow(ctx, tx, refundID)
	if err != nil {
		return err
	}
	if to == RefundFailed {
		return realtime.EmitOrder(ctx, tx, r.orderID, realtime.RefundFailed{
			OrderID: r.orderID, RefundID: refundID, Message: refundFailedMessage,
		})
	}
	settled := time.Now()
	if r.settledAt != nil {
		settled = *r.settledAt
	}
	return realtime.EmitOrder(ctx, tx, r.orderID, realtime.RefundSettled{
		OrderID: r.orderID, RefundID: refundID, AmountCents: r.amount, Currency: r.currency,
		SettledAt: realtime.At(settled),
	})
}
