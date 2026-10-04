package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Rider earnings: the ledger posting and the rider's earning lines for one
// order, written in the transaction that ends the delivery
// (https://github.com/shaiknoorullah/hg-mono/issues/306).
//
// The rules (docs/spec/04-rider.md, "D-26 — Earnings formula and per-delivery
// ledger"):
//
//   - The rider is paid the order's delivery fee as priced at checkout, times
//     the surge multiplier frozen on the offer they accepted (1.00 at launch),
//     plus 100% of the tip. No rate card, no floor (docs/decisions/README.md,
//     "Settled — reconciliations", rider pay).
//   - The tip is the one the customer pays at delivery. If it is lower than
//     the tip the rider saw on the offer, the platform pays the difference
//     only when config.RiderPay.TipMakeUp is on (off by default; the owner's
//     open question, https://github.com/shaiknoorullah/hg-mono/issues/164).
//   - A rider who brings an undeliverable order back to the restaurant is
//     paid the delivery fee, not the tip, when config.RiderPay.
//     PayReturnedDelivery is on (on by default, docs/spec/04-rider.md "D-32 —
//     Incident reporting & mid-delivery exceptions"; also open on #164).
//
// The money: at capture the rider is not known yet, so BuildCaptureBatch parks
// the rider's share in PLATFORM_REVENUE. The batch here moves it to the rider's
// RIDER_PAYABLE, one posting per component (delivery fee, tip), and funds a tip
// make-up from PLATFORM_ABSORBED. The batch balances by construction, so the
// order's ledger still sums to zero (docs/spec/01-platform.md, "P-13 — The
// ledger and the zero-residual invariant").
//
// Each RIDER_PAYABLE posting gets one earning_entry line that mirrors it; the
// database refuses a line that disagrees with its posting, and carries the
// payout run's stamp from the posting to the line
// (migrations/00036_rider_earnings_follow_ledger.sql).
//
// Exactly once: the batch's idempotency key is the order, so a re-run or a
// duplicate transition posts nothing and writes no line; the unique index
// earning_entry_once_per_order is the backstop.

// riderPayFormulaVersion is stamped on every line, so a line can be recomputed
// from its stored inputs (the earnings formula section above: every entry is
// reproducible).
const riderPayFormulaVersion = 1

// surgeOne is a multiplier of 1.00 in basis points.
const surgeOne = 10000

// Earning line types (the earning_entry_type enum).
const (
	EarningDelivery   = "DELIVERY"
	EarningTip        = "TIP"
	EarningAdjustment = "ADJUSTMENT"
)

// RiderPayInput is what a rider's pay for one order is computed from. Every
// field comes from the server's own rows, never from a client.
type RiderPayInput struct {
	// DeliveryFeeCents is the order's delivery fee as priced at checkout.
	DeliveryFeeCents int64
	// SurgeMultiplierBps is frozen on the offer the rider accepted;
	// 10000 is 1.00. Zero or less means no offer recorded one: 1.00.
	SurgeMultiplierBps int32
	// TipCents is the order's tip at delivery.
	TipCents int64
	// OfferedTipCents is the tip shown on the offer the rider accepted.
	OfferedTipCents int64
	// Returned is a delivery that ended with the order brought back to the
	// restaurant instead of handed over.
	Returned bool
}

// RiderPay is a rider's pay for one order, by component. Every amount is
// zero or more.
type RiderPay struct {
	DeliveryCents  int64 // the delivery fee after the frozen surge
	TipCents       int64 // the customer's tip, in full
	TipMakeUpCents int64 // platform-funded: the tip shown at accept less the tip paid
}

// ComputeRiderPay applies the rider pay rules to one order.
func ComputeRiderPay(in RiderPayInput, policy config.RiderPay) RiderPay {
	bps := int64(in.SurgeMultiplierBps)
	if bps <= 0 {
		bps = surgeOne
	}
	// round half up, in integer cents (money is never a float).
	delivery := (max(in.DeliveryFeeCents, 0)*bps + surgeOne/2) / surgeOne

	if in.Returned {
		if !policy.PayReturnedDelivery {
			return RiderPay{}
		}
		return RiderPay{DeliveryCents: delivery}
	}
	pay := RiderPay{DeliveryCents: delivery, TipCents: max(in.TipCents, 0)}
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

// BuildRiderEarningsBatch builds the balanced batch that pays a rider for one
// order, and the earning lines that mirror its RIDER_PAYABLE postings. It
// returns no lines (and a batch with no entries) when there is nothing to pay.
func BuildRiderEarningsBatch(orderID, riderID string, pay RiderPay, idempotencyKey, postedBy string) (LedgerBatch, []riderEarningLine) {
	b := LedgerBatch{
		Kind:           BatchSettle,
		OrderID:        orderID,
		IdempotencyKey: idempotencyKey,
		PostedBy:       postedBy,
		Memo:           "rider earnings",
	}
	var lines []riderEarningLine
	credit := func(typ string, cents int64, comp LedgerComponent, memo string) {
		if cents <= 0 {
			return
		}
		lines = append(lines, riderEarningLine{Type: typ, EntryIndex: len(b.Entries), Cents: cents})
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: riderID,
			AmountCents: cents, Component: comp, Memo: memo,
		})
	}
	credit(EarningDelivery, pay.DeliveryCents, CompDeliveryFee, "rider delivery fee")
	credit(EarningTip, pay.TipCents, CompTip, "tip pass-through")
	// The share BuildCaptureBatch parked in platform revenue (its residual
	// line, component COMMISSION) leaves it for the rider. A surge above 1.00
	// is paid from the same account.
	if released := pay.DeliveryCents + pay.TipCents; released > 0 {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctPlatformRevenue, CounterpartyType: CPPlatform,
			AmountCents: -released, Component: CompCommission, Memo: "rider's share released at delivery",
		})
	}
	// A tip make-up is not a tip: the tip pass-through check counts only
	// what the customer paid, so the make-up is rider pay funded by the
	// platform.
	credit(EarningAdjustment, pay.TipMakeUpCents, CompDeliveryFee, "tip make-up, platform-funded")
	if pay.TipMakeUpCents > 0 {
		b.Entries = append(b.Entries, LedgerEntry{
			Account: AcctPlatformAbsorbed, CounterpartyType: CPPlatform,
			AmountCents: -pay.TipMakeUpCents, Component: CompDeliveryFee, Memo: "platform makes up a lowered tip",
		})
	}
	return b, lines
}

// riderEarningsKey is the batch's idempotency key: one rider earnings batch
// per order, whether the delivery ended handed over or brought back.
func riderEarningsKey(orderID string) string { return "rider-earnings:" + orderID }

// riderDelivery is what the earning lines are written from.
type riderDelivery struct {
	OrderID           string
	OrderCode         string
	AssignmentID      string
	RiderID           string
	BillableDistanceM *int32
	DistanceSource    *string
	SurgeBps          int32
	EarnedAt          time.Time
}

// CreditDeliveryTx pays the rider for a delivered order inside the
// transaction that moves it to DELIVERED, so a delivered order always has its
// earnings and never has them twice. It implements orders.RiderEarnings.
//
// riderAccountID is the rider completing the delivery. The order must have an
// assignment for that rider; a delivery without one is refused, which rolls
// the transition back rather than leaving an unpaid delivery behind.
func (s *Service) CreditDeliveryTx(ctx context.Context, tx pgx.Tx, orderID, riderAccountID string) error {
	if riderAccountID == "" {
		return fmt.Errorf("rider earnings: order %s delivered with no rider named", orderID)
	}
	var (
		d                  riderDelivery
		feeCents, tipCents int64
		offeredTipCents    int64
	)
	err := tx.QueryRow(ctx, `
		SELECT o.id::text, o.code, o.delivery_fee_cents, o.tip_cents, coalesce(o.delivered_at, now()),
		       a.id::text, a.rider_account_id::text, a.billable_distance_m, a.distance_source::text,
		       coalesce(off.surge_multiplier_bps, 10000), coalesce(off.tip_estimate_cents, o.tip_cents)
		  FROM "order" o
		  JOIN assignment a ON a.order_id = o.id
		  LEFT JOIN dispatch_offer off ON off.id = a.dispatch_offer_id
		 WHERE o.id = $1 AND a.rider_account_id = $2
		   AND a.state NOT IN ('REASSIGNED', 'CANCELLED_BY_PLATFORM', 'UNDELIVERABLE', 'RETURNING', 'RETURNED')
		 ORDER BY a.created_at DESC
		 LIMIT 1`, orderID, riderAccountID).Scan(
		&d.OrderID, &d.OrderCode, &feeCents, &tipCents, &d.EarnedAt,
		&d.AssignmentID, &d.RiderID, &d.BillableDistanceM, &d.DistanceSource,
		&d.SurgeBps, &offeredTipCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("rider earnings: order %s has no assignment for rider %s", orderID, riderAccountID)
	}
	if err != nil {
		return fmt.Errorf("rider earnings: load delivery: %w", err)
	}
	pay := ComputeRiderPay(RiderPayInput{
		DeliveryFeeCents:   feeCents,
		SurgeMultiplierBps: d.SurgeBps,
		TipCents:           tipCents,
		OfferedTipCents:    offeredTipCents,
	}, s.riderPay)
	return writeRiderEarningsTx(ctx, tx, d, pay, "system:delivery")
}

// CreditReturnedTx pays the rider whose assignment just ended RETURNED, inside
// the transaction that records it. It implements dispatch.ReturnedEarnings.
func (s *Service) CreditReturnedTx(ctx context.Context, tx pgx.Tx, assignmentID string) error {
	var (
		d        riderDelivery
		feeCents int64
	)
	err := tx.QueryRow(ctx, `
		SELECT o.id::text, o.code, o.delivery_fee_cents, now(),
		       a.id::text, a.rider_account_id::text, a.billable_distance_m, a.distance_source::text,
		       coalesce(off.surge_multiplier_bps, 10000)
		  FROM assignment a
		  JOIN "order" o ON o.id = a.order_id
		  LEFT JOIN dispatch_offer off ON off.id = a.dispatch_offer_id
		 WHERE a.id = $1`, assignmentID).Scan(
		&d.OrderID, &d.OrderCode, &feeCents, &d.EarnedAt,
		&d.AssignmentID, &d.RiderID, &d.BillableDistanceM, &d.DistanceSource, &d.SurgeBps)
	if err != nil {
		return fmt.Errorf("rider earnings: load returned assignment %s: %w", assignmentID, err)
	}
	pay := ComputeRiderPay(RiderPayInput{
		DeliveryFeeCents:   feeCents,
		SurgeMultiplierBps: d.SurgeBps,
		Returned:           true,
	}, s.riderPay)
	return writeRiderEarningsTx(ctx, tx, d, pay, "system:returned")
}

// writeRiderEarningsTx posts the batch and writes one line per RIDER_PAYABLE
// posting. When the order's batch is already posted it writes nothing.
func writeRiderEarningsTx(ctx context.Context, tx pgx.Tx, d riderDelivery, pay RiderPay, postedBy string) error {
	batch, lines := BuildRiderEarningsBatch(d.OrderID, d.RiderID, pay, riderEarningsKey(d.OrderID), postedBy)
	if len(lines) == 0 {
		return nil
	}
	posted, err := postBatchTx(ctx, tx, batch)
	if err != nil {
		return fmt.Errorf("rider earnings: post batch: %w", err)
	}
	if posted == nil {
		return nil // already paid for this order
	}
	for _, l := range lines {
		var base, tip, adjustment int64
		surge := int32(surgeOne)
		distance, source := (*int32)(nil), (*string)(nil)
		switch l.Type {
		case EarningDelivery:
			base, surge = l.Cents, d.SurgeBps
			distance, source = d.BillableDistanceM, d.DistanceSource
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
			d.RiderID, d.AssignmentID, d.OrderID, d.OrderCode, l.Type,
			base, tip, adjustment, l.Cents, surge,
			distance, source, riderPayFormulaVersion,
			posted.ID, posted.EntryIDs[l.EntryIndex], d.EarnedAt); err != nil {
			return fmt.Errorf("rider earnings: write %s line: %w", l.Type, err)
		}
	}
	return nil
}
