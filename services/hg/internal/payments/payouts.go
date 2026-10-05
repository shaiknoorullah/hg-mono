package payments

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Payout execution: weekly, every Monday, automatic, no minimum
// (docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding and payouts
// (Canada)"; decision log, "Settled — client decisions", payout cadence).
//
// Separate charges and transfers. Each payout sums the partner's unpaid
// RIDER_PAYABLE (or RESTAURANT_PAYABLE) ledger entries, stamps payout_id on
// exactly those rows so a row is never paid twice, and its amount_cents equals
// their sum, enforced by a deferred trigger. The Stripe transfer is
// idempotency-keyed by the payout id. A partner with payouts_enabled=false gets
// a HELD payout with Stripe's exact requirement list, and no transfer is
// attempted.
//
// The weekly run that drives all of this is payout_run.go; its storage is
// payout_store.go.

// PayoutPreview is what a run would pay a partner before it is executed.
type PayoutPreview struct {
	ConnectAccountID string
	StripeAccountID  string
	PayoutsEnabled   bool
	AmountCents      int64
	EntryCount       int32
	EntryIDs         []int64
	HoldReason       string
}

// payableAccount is the ledger account a partner type draws from.
func payableAccount(ownerType string) LedgerAccount {
	if ownerType == PayeeRider {
		return AcctRiderPayable
	}
	return AcctRestaurantPayable
}

// previewPayout sums what is due to a partner for the period that ends at
// cutoff: their unpaid payable entries created before the cutoff that are
//
//   - deductions (refunds and chargebacks charged to them), netted at once;
//   - not tied to an order (an adjustment); or
//   - tied to an order that is settled — completed, resolved after a dispute,
//     or ended (cancelled, rejected, failed) — at least hold before the cutoff.
//
// An order still in progress, delivered but not yet settled, or under dispute
// pays nothing yet; its earnings wait for a later run. Ledger entries exist
// only for captured money (the capture posts them), so an authorisation that
// was never captured, or was voided, pays nothing. Because every deduction is
// counted and only earnings wait, the sum is never more than the partner's
// unpaid balance. Both boundaries are exclusive: an entry created at the
// cutoff, or an order whose hold ends at the cutoff, belongs to the next week.
func (r *Repo) previewPayout(ctx context.Context, tx pgx.Tx, c ConnectRow, ownerType, ownerID string,
	cutoff time.Time, hold time.Duration) (PayoutPreview, error) {
	p := PayoutPreview{ConnectAccountID: c.ID, StripeAccountID: c.StripeAccountID, PayoutsEnabled: c.PayoutsEnabled}
	rows, err := tx.Query(ctx, `
		SELECT le.id, le.amount_cents
		  FROM ledger_entry le
		  LEFT JOIN "order" o ON o.id = le.order_id
		 WHERE le.account = $1
		   AND le.counterparty_type = $2
		   AND le.counterparty_id = $3
		   AND le.payout_id IS NULL
		   AND le.created_at < $4
		   AND (le.amount_cents < 0
		        OR le.order_id IS NULL
		        OR (o.state IN ('COMPLETED', 'RESOLVED', 'CANCELLED', 'REJECTED', 'FAILED')
		            AND COALESCE(o.delivered_at, o.cancelled_at, o.completed_at, o.updated_at)
		                + $5::bigint * interval '1 second' < $4))
		 FOR UPDATE OF le`,
		string(payableAccount(ownerType)), ownerType, ownerID, cutoff, int64(hold/time.Second))
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, amt int64
		if err := rows.Scan(&id, &amt); err != nil {
			return p, err
		}
		p.EntryIDs = append(p.EntryIDs, id)
		p.AmountCents += amt
		p.EntryCount++
	}
	return p, rows.Err()
}

func joinComma(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
