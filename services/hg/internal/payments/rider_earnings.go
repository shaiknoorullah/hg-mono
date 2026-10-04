package payments

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Rider earnings: the ledger postings and the rider's earning lines for one
// order, written in the transaction that moves the order to DELIVERED
// (https://github.com/shaiknoorullah/hg-mono/issues/306).
//
// Who is paid. Only the rider whose dispatch assignment for the order is
// DELIVERED with its proof of delivery recorded, read and locked from our own
// rows. The rider named on the request is never used to choose the payee; it
// must match, or the delivery is refused. A rider whose assignment was
// reassigned, cancelled or returned is paid nothing for the order: wait-time
// pay and cancellation compensation are deferred (docs/decisions/README.md,
// "Settled — reconciliations"), and pay for an interrupted delivery is a
// server decision, never the rider's own step (docs/spec/04-rider.md, "D-32 —
// Incident reporting & mid-delivery exceptions"; the owner's open question,
// https://github.com/shaiknoorullah/hg-mono/issues/164).
//
// What is paid (docs/spec/04-rider.md, "D-26 — Earnings formula and
// per-delivery ledger"): the order's delivery fee and its tip, exactly as the
// server priced them at checkout, in int64 cents. No rate card, no floor, and
// no recomputation: the surge multiplier is 1.00 at launch (the surge model is
// still open) and is recorded as such. The tip goes to the delivering rider in
// full. A tip lowered after the rider accepted is made up by the platform only
// when config.RiderPay.TipMakeUp is on (off by default; #164).
//
// Nothing is paid for an order refunded in full before it was delivered.
//
// The money. Capture runs before a rider is known, so BuildCaptureBatch leaves
// the rider's share in PLATFORM_REVENUE (its residual line, component
// COMMISSION), where a cancelled order's refund finds it. Each earning is then
// its own balanced pair: the rider's RIDER_PAYABLE is credited and the share
// held in platform revenue is debited by the same amount. A tip make-up is
// debited to PLATFORM_ABSORBED. The order's ledger still sums to zero
// (docs/spec/01-platform.md, "P-13 — The ledger and the zero-residual
// invariant"), and platform revenue never carries a TIP row.
//
// Reversal. A later refund that charges the rider back posts a negative
// RIDER_PAYABLE entry; writeRiderClawbacksTx mirrors it as a CLAWBACK line in
// the refund's transaction. Nothing is ever updated or deleted.
//
// Exactly once: the batch's idempotency key is the order, so a replay or a
// duplicate transition posts nothing and writes no line; the unique index
// earning_entry_once_per_order is the backstop, and the database refuses a
// line that disagrees with its posting
// (migrations/00036_rider_earnings_follow_ledger.sql).

// riderPayFormulaVersion is stamped on every line, so a line can be recomputed
// from its stored inputs.
const riderPayFormulaVersion = 1

// surgeOne is a multiplier of 1.00 in basis points: the only one paid until
// the surge model is decided.
const surgeOne = 10000

// Earning line types (the earning_entry_type enum).
const (
	EarningDelivery   = "DELIVERY"
	EarningTip        = "TIP"
	EarningAdjustment = "ADJUSTMENT"
	EarningClawback   = "CLAWBACK"
)

// RiderPayInput is what a rider's pay for one order is computed from: the
// order's own priced components and the offer the rider accepted, all read
// from the server's rows.
type RiderPayInput struct {
	DeliveryFeeCents int64 // the order's delivery fee as priced at checkout
	TipCents         int64 // the order's tip at delivery
	OfferedTipCents  int64 // the tip shown on the offer the rider accepted
}

// RiderPay is a rider's pay for one order, by component. Every amount is
// zero or more.
type RiderPay struct {
	DeliveryCents  int64 // the delivery fee
	TipCents       int64 // the customer's tip, in full
	TipMakeUpCents int64 // platform-funded: the tip shown at accept less the tip paid
}

// ComputeRiderPay applies the rider pay rules to one order.
func ComputeRiderPay(in RiderPayInput, policy config.RiderPay) RiderPay {
	pay := RiderPay{DeliveryCents: max(in.DeliveryFeeCents, 0), TipCents: max(in.TipCents, 0)}
	if policy.TipMakeUp && in.OfferedTipCents > pay.TipCents {
		pay.TipMakeUpCents = in.OfferedTipCents - pay.TipCents
	}
	return pay
}

// riderEarningLine is one earning_entry line and the RIDER_PAYABLE posting it
// mirrors (an index into the batch's entries).
type riderEarningLine struct {
	Type       string
	EntryIndex int
	Cents      int64
}

// BuildRiderEarningsBatch builds the batch that pays a rider for one order:
// one balanced pair per earning, and the lines that mirror the rider's
// postings. It returns no lines, and a batch with no entries, when there is
// nothing to pay.
func BuildRiderEarningsBatch(orderID, riderID string, pay RiderPay, idempotencyKey, postedBy string) (LedgerBatch, []riderEarningLine) {
	b := LedgerBatch{
		Kind:           BatchSettle,
		OrderID:        orderID,
		IdempotencyKey: idempotencyKey,
		PostedBy:       postedBy,
		Memo:           "rider earnings",
	}
	var lines []riderEarningLine
	pair := func(typ string, cents int64, comp LedgerComponent, memo string, from LedgerAccount, fromComp LedgerComponent, fromMemo string) {
		if cents <= 0 {
			return
		}
		lines = append(lines, riderEarningLine{Type: typ, EntryIndex: len(b.Entries), Cents: cents})
		b.Entries = append(b.Entries,
			LedgerEntry{
				Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: riderID,
				AmountCents: cents, Component: comp, Memo: memo,
			},
			LedgerEntry{
				Account: from, CounterpartyType: CPPlatform,
				AmountCents: -cents, Component: fromComp, Memo: fromMemo,
			})
	}
	// The delivery fee and the tip leave the share BuildCaptureBatch held in
	// platform revenue on its residual line (component COMMISSION).
	pair(EarningDelivery, pay.DeliveryCents, CompDeliveryFee, "rider delivery fee",
		AcctPlatformRevenue, CompCommission, "delivery fee held at capture, paid to the rider")
	pair(EarningTip, pay.TipCents, CompTip, "tip pass-through",
		AcctPlatformRevenue, CompCommission, "tip held at capture, paid to the rider")
	// A tip make-up is not a tip: the tip pass-through check counts only what
	// the customer paid, so the make-up is rider pay the platform funds.
	pair(EarningAdjustment, pay.TipMakeUpCents, CompDeliveryFee, "tip make-up, platform-funded",
		AcctPlatformAbsorbed, CompDeliveryFee, "platform makes up a lowered tip")
	return b, lines
}

// riderEarningsKey is the batch's idempotency key: one rider earnings batch
// per order.
func riderEarningsKey(orderID string) string { return "rider-earnings:" + orderID }

// deliveredAssignment is the assignment that completed an order's delivery.
type deliveredAssignment struct {
	ID                string
	RiderID           string
	BillableDistanceM *int32
	DistanceSource    *string
	OfferedTipCents   *int64
}

// CreditDeliveryTx pays the rider who delivered the order, inside the
// transaction that moves it to DELIVERED, so a delivered order has its
// earnings once and an undelivered one never has them. It implements
// orders.RiderEarnings; the orders module calls it only for the rider's own
// DELIVERED transition.
//
// actorAccountID is the rider the transition names. It is only checked: the
// payee is the rider of the order's DELIVERED assignment with its proof of
// delivery, locked here. A mismatch refuses the delivery. An order with no
// such assignment (a delivery confirmed some other way) is delivered without
// earnings, and logged so operations can see it.
func (s *Service) CreditDeliveryTx(ctx context.Context, tx pgx.Tx, orderID, actorAccountID string) error {
	var (
		code, state, fulfilment string
		feeCents, tipCents      int64
		totalCents, refunded    int64
		deliveredAt             time.Time
	)
	if err := tx.QueryRow(ctx, `
		SELECT o.code, o.state::text, o.fulfilment::text, o.delivery_fee_cents, o.tip_cents, o.total_cents,
		       coalesce(o.delivered_at, now()),
		       (SELECT coalesce(sum(r.amount_cents), 0) FROM refund r
		         WHERE r.order_id = o.id AND r.state NOT IN ('DECLINED', 'CANCELLED', 'FAILED'))
		  FROM "order" o WHERE o.id = $1
		   FOR UPDATE OF o`, orderID).Scan(
		&code, &state, &fulfilment, &feeCents, &tipCents, &totalCents, &deliveredAt, &refunded); err != nil {
		return fmt.Errorf("rider earnings: load order %s: %w", orderID, err)
	}
	// Only the order's real transition pays: inside it the order is DELIVERED.
	if state != "DELIVERED" {
		return fmt.Errorf("rider earnings: order %s is %s, not DELIVERED", orderID, state)
	}
	if fulfilment != "DELIVERY" {
		return nil
	}
	if refunded >= totalCents && totalCents > 0 {
		s.log.WarnContext(ctx, "delivered order was refunded in full before delivery; no rider earnings written",
			slog.String("order_id", orderID))
		return nil
	}

	rows, err := tx.Query(ctx, `
		SELECT a.id::text, a.rider_account_id::text, a.billable_distance_m, a.distance_source::text,
		       off.tip_estimate_cents
		  FROM assignment a
		  LEFT JOIN dispatch_offer off ON off.id = a.dispatch_offer_id
		 WHERE a.order_id = $1 AND a.state = 'DELIVERED' AND a.pod_recorded
		   FOR UPDATE OF a`, orderID)
	if err != nil {
		return fmt.Errorf("rider earnings: load delivered assignment: %w", err)
	}
	var delivered []deliveredAssignment
	for rows.Next() {
		var d deliveredAssignment
		if err := rows.Scan(&d.ID, &d.RiderID, &d.BillableDistanceM, &d.DistanceSource, &d.OfferedTipCents); err != nil {
			rows.Close()
			return fmt.Errorf("rider earnings: read delivered assignment: %w", err)
		}
		delivered = append(delivered, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rider earnings: read delivered assignment: %w", err)
	}
	switch {
	case len(delivered) == 0:
		s.log.WarnContext(ctx, "order delivered with no completed assignment and proof of delivery; no rider earnings written",
			slog.String("order_id", orderID), slog.String("actor_account_id", actorAccountID))
		return nil
	case len(delivered) > 1:
		return fmt.Errorf("rider earnings: order %s has %d delivered assignments", orderID, len(delivered))
	}
	d := delivered[0]
	if actorAccountID != d.RiderID {
		return fmt.Errorf("rider earnings: order %s was delivered by assignment %s, not by the rider completing it",
			orderID, d.ID)
	}

	offered := tipCents
	if d.OfferedTipCents != nil {
		offered = *d.OfferedTipCents
	}
	pay := ComputeRiderPay(RiderPayInput{
		DeliveryFeeCents: feeCents, TipCents: tipCents, OfferedTipCents: offered,
	}, s.riderPay)

	batch, lines := BuildRiderEarningsBatch(orderID, d.RiderID, pay, riderEarningsKey(orderID), "system:delivery")
	if len(lines) == 0 {
		return nil
	}
	posted, err := postBatchTx(ctx, tx, batch)
	if err != nil {
		return fmt.Errorf("rider earnings: post batch: %w", err)
	}
	if posted == nil {
		return nil // this order's rider is already paid
	}
	for _, l := range lines {
		var base, tip, adjustment int64
		distance, source := (*int32)(nil), (*string)(nil)
		switch l.Type {
		case EarningDelivery:
			base, distance, source = l.Cents, d.BillableDistanceM, d.DistanceSource
		case EarningTip:
			tip = l.Cents
		case EarningAdjustment:
			adjustment = l.Cents
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO earning_entry (
			  account_id, assignment_id, order_id, order_code, type, status,
			  base_cents, tip_cents, adjustment_cents, gross_cents, surge_multiplier_bps,
			  billable_distance_m, distance_source, formula_version,
			  ledger_batch_id, ledger_entry_id, earned_at)
			VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, $10, $11, $12::route_source, $13, $14, $15, $16)`,
			d.RiderID, d.ID, orderID, code, l.Type,
			base, tip, adjustment, l.Cents, surgeOne,
			distance, source, riderPayFormulaVersion,
			posted.ID, posted.EntryIDs[l.EntryIndex], deliveredAt); err != nil {
			return fmt.Errorf("rider earnings: write %s line: %w", l.Type, err)
		}
	}
	return nil
}

// writeRiderClawbacksTx mirrors each rider chargeback a refund batch posted (a
// negative RIDER_PAYABLE entry) as a CLAWBACK line, in the refund's
// transaction, so the rider's earnings and balance follow the ledger. The
// original lines are never changed (docs/decisions/README.md, "Settled —
// redesign decisions (owner, 2026-09-28)", reversed earnings).
func writeRiderClawbacksTx(ctx context.Context, tx pgx.Tx, b LedgerBatch, posted *postedBatch) error {
	if posted == nil {
		return nil
	}
	for i, e := range b.Entries {
		if e.Account != AcctRiderPayable || e.CounterpartyType != CPRider || e.CounterpartyID == "" || e.AmountCents >= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO earning_entry (
			  account_id, order_id, order_code, type, status, adjustment_cents, gross_cents,
			  formula_version, ledger_batch_id, ledger_entry_id)
			SELECT $1, o.id, o.code, 'CLAWBACK', 'PENDING', $2, $2, $3, $4, $5
			  FROM "order" o WHERE o.id = $6`,
			e.CounterpartyID, e.AmountCents, riderPayFormulaVersion,
			posted.ID, posted.EntryIDs[i], b.OrderID); err != nil {
			return fmt.Errorf("rider earnings: write clawback line: %w", err)
		}
	}
	return nil
}
