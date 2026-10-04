package payments

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The handlers for refund, dispute, Connect account, transfer and bank-payout
// events (#249). Each reads the Stripe object inside the event and asserts
// the state it shows; none assumes the events before it arrived first. What
// a handler will not settle by itself is filed as a reconciliation_exception,
// which pages on-call in the same transaction (fileException).
//
// Spec: docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and
// reconciliation" (the handled-events table), "P-18 — Refunds, cancellations
// and compensation" (chargebacks) and "P-19 — Stripe Connect: onboarding and
// payouts (Canada)".

// The reconciliation_exception kinds applying a stored event files. Each is
// a disagreement with Stripe that a person has to settle.
const (
	// exceptionUnrecordedRefund: Stripe has refunded more of a charge than
	// the refunds this database knows of, such as a refund made in the
	// Stripe dashboard. Who bears it is a person's call (the table of who is
	// charged back, in "P-18 — Refunds, cancellations and compensation"), so
	// no ledger batch is guessed.
	exceptionUnrecordedRefund = "unrecorded_refund"
	// exceptionRefundConflict: Stripe reports a refund this database never
	// sent, or one it holds as declined or cancelled.
	exceptionRefundConflict = "refund_state_conflict"
	// exceptionRefundFailed: a refund failed on Stripe after its REFUND batch
	// was posted, so the ledger says the customer was paid and they were not.
	exceptionRefundFailed = "refund_failed"
	// exceptionChargebackLost: a dispute closed against us; Stripe has taken
	// the money back, and who bears it is a person's call.
	exceptionChargebackLost = "chargeback_lost"
	// exceptionUnknownTransfer: a transfer to a connected account that no
	// payout here made.
	exceptionUnknownTransfer = "unknown_transfer"
	// exceptionTransferMismatch: a transfer whose amount, or Stripe id, is not
	// the payout's.
	exceptionTransferMismatch = "transfer_mismatch"
	// exceptionTransferReversed: money transferred to a partner was taken
	// back, in full or in part, so the payout no longer stands as paid.
	exceptionTransferReversed = "transfer_reversed"
	// exceptionTransferFailed: Stripe reports a payout's transfer failed.
	exceptionTransferFailed = "transfer_failed"
	// exceptionPayoutFailed: a partner's bank payout failed or was cancelled,
	// so the money is back in their Stripe balance and not in their bank.
	exceptionPayoutFailed = "payout_failed"
)

// exceptionMessages is what the ops alert says for each kind.
var exceptionMessages = map[string]string{
	exceptionUnknownIntent:    "Stripe has a payment this database has no row for.",
	exceptionSettledConflict:  "A payment is captured on one side and cancelled on the other.",
	exceptionUnmappedStatus:   "Stripe reports a payment status this code does not know.",
	exceptionDatabaseAhead:    "This database holds a payment further along than Stripe does.",
	exceptionUnrecordedRefund: "Stripe refunded more than the refunds recorded here; decide who bears it.",
	exceptionRefundConflict:   "Stripe reports a refund this database never sent, or holds as declined.",
	exceptionRefundFailed:     "A refund failed on Stripe after it was booked; the customer has not been paid.",
	exceptionChargebackLost:   "A chargeback was lost; Stripe has taken the money back. Decide who bears it.",
	exceptionUnknownTransfer:  "Stripe made a transfer no payout here asked for.",
	exceptionTransferMismatch: "A transfer's amount or id does not match its payout.",
	exceptionTransferReversed: "Money transferred to a partner was taken back.",
	exceptionTransferFailed:   "A payout's transfer failed on Stripe.",
	exceptionPayoutFailed:     "A partner's bank payout failed; the money is back in their Stripe balance.",
}

// ---------------------------------------------------------------------------
// Refunds: charge.refunded, and the refund object events.
// ---------------------------------------------------------------------------

type stripeRefundObject struct {
	ID            string            `json:"id"`
	Amount        int64             `json:"amount"`
	Currency      string            `json:"currency"`
	Status        string            `json:"status"`
	PaymentIntent string            `json:"payment_intent"`
	FailureReason string            `json:"failure_reason"`
	Metadata      map[string]string `json:"metadata"`
}

type stripeChargeObject struct {
	ID             string `json:"id"`
	PaymentIntent  string `json:"payment_intent"`
	AmountRefunded int64  `json:"amount_refunded"`
	Currency       string `json:"currency"`
	// Refunds is only present on API versions before 2022-11-15, or when the
	// webhook endpoint expands it; each refund also has its own events.
	Refunds *struct {
		Data []stripeRefundObject `json:"data"`
	} `json:"refunds"`
}

// errCaptureNotRecorded makes a refund or dispute event wait, through the
// worker's backoff, for the capture it is about: events arrive out of order,
// and money this database has not yet seen captured is not something to
// judge yet.
var errCaptureNotRecorded = errors.New("the payment's capture is not recorded yet; retrying")

// applyChargeRefunded reconciles a charge's refunded total against the
// refunds this database holds (the handled-events table: "reconcile refund
// rows, post the REFUND batch if not already posted").
func (s *Service) applyChargeRefunded(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var ch stripeChargeObject
	if err := ev.object(&ch); err != nil {
		return effect{}, err
	}
	if ch.PaymentIntent == "" {
		return effect{}, fmt.Errorf("%s %s: charge %s carries no payment intent", ev.Type, ev.ID, ch.ID)
	}
	if !ourCurrency(ch.Currency) {
		return s.refuse(ctx, tx, ev, ch.ID, "the charge is in "+ch.Currency+", not CAD")
	}
	// The payment is found by the Stripe id this database recorded when it
	// created it; nothing in the event's free fields picks the row.
	pi, err := getIntentForUpdate(ctx, tx, ch.PaymentIntent)
	if errors.Is(err, ErrNotFound) {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionUnknownIntent, StripeObjectID: ch.PaymentIntent,
			ActualCents: int64Ptr(ch.AmountRefunded)})
		return filedEffect(filed, exceptionUnknownIntent, ch.PaymentIntent), err
	}
	if err != nil {
		return effect{}, err
	}
	if PaymentState(pi.State) != StateSucceeded {
		return effect{}, errCaptureNotRecorded
	}

	var outcomes []effect
	if ch.Refunds != nil {
		for _, rf := range ch.Refunds.Data {
			eff, err := s.applyRefundObject(ctx, tx, ev, rf)
			if err != nil {
				return effect{}, err
			}
			outcomes = append(outcomes, eff)
		}
	}
	covered, err := refundsCoveringCents(ctx, tx, pi.OrderID)
	if err != nil {
		return effect{}, err
	}
	switch {
	case ch.AmountRefunded > covered || ch.AmountRefunded > pi.AmountCapturedCents:
		// Money left Stripe that no refund here accounts for. The payment's
		// refunded total stays in step with the ledger (the charge identity,
		// ledger_charge_identity_breach) until a person records who bore it.
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionUnrecordedRefund, StripeObjectID: ch.ID,
			OrderID: pi.OrderID, ExpectedCents: int64Ptr(covered), ActualCents: int64Ptr(ch.AmountRefunded)})
		if err != nil {
			return effect{}, err
		}
		outcomes = append(outcomes, filedEffect(filed, exceptionUnrecordedRefund, ch.ID))
	case ch.AmountRefunded > pi.AmountRefundedCents:
		// The refunded total only grows, and never past what was captured
		// (refund_le_capture).
		if _, err := tx.Exec(ctx, `UPDATE payment_intent SET amount_refunded_cents = $2 WHERE id = $1`,
			pi.ID, ch.AmountRefunded); err != nil {
			return effect{}, err
		}
		outcomes = append(outcomes, effect{kind: effectApplied, label: fmt.Sprintf("refunded_total:%d", ch.AmountRefunded)})
	}
	out := combine(outcomes)
	out.stripeID, out.orderID = ch.PaymentIntent, pi.OrderID
	return out, nil
}

// applyRefundEvent handles the events whose object is the refund itself.
func (s *Service) applyRefundEvent(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var rf stripeRefundObject
	if err := ev.object(&rf); err != nil {
		return effect{}, err
	}
	return s.applyRefundObject(ctx, tx, ev, rf)
}

// refundTarget is the refund state a Stripe refund status asserts.
func refundTarget(status string) (RefundState, bool) {
	switch status {
	case "pending", "requires_action":
		return RefundSubmitted, true
	case "succeeded":
		return RefundSucceeded, true
	case "failed", "canceled":
		return RefundFailed, true
	}
	return "", false
}

// refundRank orders the refund states a Stripe refund can be in. A refund
// can fail on Stripe after it succeeded (the card was closed), so FAILED is
// last. The states missing here are ones that never reach Stripe.
var refundRank = map[RefundState]int{
	RefundAuthorised: 0,
	RefundSubmitted:  1,
	RefundSucceeded:  2,
	RefundSettled:    2,
	RefundFailed:     3,
}

func (s *Service) applyRefundObject(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope, rf stripeRefundObject) (effect, error) {
	target, ok := refundTarget(rf.Status)
	if !ok {
		return effect{kind: effectUnchanged, label: "refund_unmapped_status:" + rf.Status, stripeID: rf.ID}, nil
	}
	row, found, err := findRefundForUpdate(ctx, tx, rf.ID, rf.Metadata["refund_id"])
	if err != nil {
		return effect{}, err
	}
	if !found {
		// A refund made outside this system. charge.refunded compares the
		// charge's refunded total with the refunds held here and files it.
		return effect{kind: effectUnchanged, label: "refund_unmatched:" + rf.ID, stripeID: rf.ID}, nil
	}
	// A refund_id in the metadata names a row; it does not prove the refund
	// is that row's. Stripe's refund must be against the payment this
	// database recorded for the refund, in CAD.
	if rf.PaymentIntent != row.StripePaymentIntentID {
		return s.refuse(ctx, tx, ev, rf.ID, fmt.Sprintf("it names refund %s, which this database holds against payment %s, "+
			"but Stripe's refund is against payment %q", row.ID, row.StripePaymentIntentID, rf.PaymentIntent))
	}
	if !ourCurrency(rf.Currency) {
		return s.refuse(ctx, tx, ev, rf.ID, "the refund is in "+rf.Currency+", not CAD")
	}
	cur := RefundState(row.State)
	curRank, sendable := refundRank[cur]
	if !sendable || (row.StripeRefundID != "" && row.StripeRefundID != rf.ID) || rf.Amount != row.AmountCents {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionRefundConflict, StripeObjectID: rf.ID,
			OrderID: row.OrderID, ExpectedCents: int64Ptr(row.AmountCents), ActualCents: int64Ptr(rf.Amount)})
		return filedEffect(filed, exceptionRefundConflict, rf.ID), err
	}
	if refundRank[target] <= curRank {
		if row.StripeRefundID == "" {
			if _, err := tx.Exec(ctx, `UPDATE refund SET stripe_refund_id = $2 WHERE id = $1`, row.ID, rf.ID); err != nil {
				return effect{}, err
			}
		}
		if refundRank[target] == curRank {
			return effect{kind: effectUnchanged, label: "noop:refund_" + string(cur), stripeID: rf.ID, orderID: row.OrderID}, nil
		}
		return effect{kind: effectBehind, label: fmt.Sprintf("refund_skipped:%s<-%s", cur, target), stripeID: rf.ID,
			orderID: row.OrderID}, nil
	}
	failure := rf.FailureReason
	if failure == "" {
		failure = "Stripe reported the refund " + rf.Status
	}
	if err := moveRefund(ctx, tx, row.ID, rf.ID, cur, target, failure); err != nil {
		return effect{}, err
	}
	// The REFUND batch is normally posted when the refund is authorised
	// (service.go); a refund that reached Stripe without one gets it now,
	// from the liability split stored on the row.
	if target != RefundFailed {
		posted, err := refundBatchPosted(ctx, tx, row.ID)
		if err != nil {
			return effect{}, err
		}
		if !posted {
			money, _, err := getOrderMoney(ctx, tx, row.OrderID)
			if err != nil {
				return effect{}, err
			}
			batch := BuildRefundBatch(money, row.Split, row.AmountCents, "refund:"+row.ID, "system:webhook")
			batch.RefundID = row.ID
			if err := insertBatch(ctx, tx, batch); err != nil {
				return effect{}, err
			}
		}
	}
	if err := writeWebhookAudit(ctx, tx, webhookAudit{
		Action: "payment.refund_" + strings.ToLower(string(target)), SubjectType: "refund", SubjectID: row.ID,
		AmountCents: int64Ptr(row.AmountCents), EventID: ev.ID,
		After: map[string]any{"state": target, "stripe_refund_id": rf.ID, "from": cur},
	}); err != nil {
		return effect{}, err
	}
	if target == RefundFailed {
		if _, err := fileException(ctx, tx, catchUpException{Kind: exceptionRefundFailed, StripeObjectID: rf.ID,
			OrderID: row.OrderID, ExpectedCents: int64Ptr(row.AmountCents)}); err != nil {
			return effect{}, err
		}
	}
	return effect{kind: effectApplied, label: fmt.Sprintf("refund:%s->%s", cur, target), stripeID: rf.ID,
		orderID: row.OrderID}, nil
}

// ---------------------------------------------------------------------------
// Disputes: charge.dispute.*.
// ---------------------------------------------------------------------------

type stripeDisputeObject struct {
	ID              string `json:"id"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
	Charge          string `json:"charge"`
	PaymentIntent   string `json:"payment_intent"`
	Reason          string `json:"reason"`
	Status          string `json:"status"`
	EvidenceDetails struct {
		DueBy int64 `json:"due_by"`
	} `json:"evidence_details"`
}

// disputeClosed reports whether a dispute status is final.
func disputeClosed(status string) bool {
	switch status {
	case "won", "lost", "warning_closed", "charge_refunded":
		return true
	}
	return false
}

// applyDisputeEvent keeps the chargeback row for a Stripe dispute current
// ("P-18 — Refunds, cancellations and compensation": "open a chargeback
// row with the evidence-due deadline … and notify ops"). Opening it alerts
// ops, who own the review. The order's own state is left alone, because the
// order machine gives the system no edge into DISPUTED ("P-14 — Order
// lifecycle states and transitions": a customer, the restaurant or support
// opens a dispute). The payment is found by the Stripe id this database
// recorded for it. A closed dispute never reopens, and an older snapshot of
// an open one never overwrites a newer one.
func (s *Service) applyDisputeEvent(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var d stripeDisputeObject
	if err := ev.object(&d); err != nil {
		return effect{}, err
	}
	if d.ID == "" || d.Amount <= 0 {
		return effect{}, fmt.Errorf("%s %s: dispute without an id or a positive amount", ev.Type, ev.ID)
	}
	if d.PaymentIntent == "" {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionUnknownIntent, StripeObjectID: d.ID,
			ActualCents: int64Ptr(d.Amount)})
		return filedEffect(filed, exceptionUnknownIntent, d.ID), err
	}
	pi, err := getIntentForUpdate(ctx, tx, d.PaymentIntent)
	if errors.Is(err, ErrNotFound) {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionUnknownIntent, StripeObjectID: d.PaymentIntent,
			ActualCents: int64Ptr(d.Amount)})
		return filedEffect(filed, exceptionUnknownIntent, d.PaymentIntent), err
	}
	if err != nil {
		return effect{}, err
	}
	// A dispute is only ever of money captured here, and never of more.
	if PaymentState(pi.State) != StateSucceeded {
		return effect{}, errCaptureNotRecorded
	}
	if !ourCurrency(d.Currency) || d.Amount > pi.AmountCapturedCents {
		return s.refuse(ctx, tx, ev, d.ID, fmt.Sprintf("it disputes %d %s on payment %s, which captured %d cents CAD",
			d.Amount, d.Currency, d.PaymentIntent, pi.AmountCapturedCents))
	}
	snap := chargebackSnapshot{
		OrderID: pi.OrderID, StripeDisputeID: d.ID, AmountCents: d.Amount, Reason: d.Reason,
		State: d.Status, AsOf: ev.asOf(),
	}
	if disputeClosed(d.Status) {
		snap.Outcome = d.Status
	}
	if d.EvidenceDetails.DueBy > 0 {
		due := time.Unix(d.EvidenceDetails.DueBy, 0).UTC()
		snap.EvidenceDueAt = &due
	}
	audit := webhookAudit{SubjectType: "chargeback", ReasonCode: d.Reason, AmountCents: int64Ptr(d.Amount),
		EventID: ev.ID, After: map[string]any{
			"stripe_dispute_id": d.ID, "order_id": pi.OrderID, "status": d.Status, "outcome": snap.Outcome,
		}}

	cur, exists, err := getChargebackForUpdate(ctx, tx, d.ID)
	if err != nil {
		return effect{}, err
	}
	now := s.now()
	if !exists {
		id, err := insertChargeback(ctx, tx, snap, now)
		if err != nil {
			return effect{}, err
		}
		audit.Action, audit.SubjectID = "payment.chargeback_opened", id
		if err := writeWebhookAudit(ctx, tx, audit); err != nil {
			return effect{}, err
		}
		if err := raiseOpsAlert(ctx, tx, opsAlert{Severity: "high", Kind: "chargeback_opened", SubjectType: "chargeback",
			SubjectID: id, Message: fmt.Sprintf("A customer disputed order %s with their bank (%s, %d cents). "+
				"Evidence is due by the chargeback's deadline.", pi.OrderID, d.Reason, d.Amount)}); err != nil {
			return effect{}, err
		}
		// TODO(#307): hold the restaurant's and the rider's payout up to the
		// disputed amount until the chargeback closes (the acceptance criteria
		// of "P-18 — Refunds, cancellations and compensation" and "P-19 —
		// Stripe Connect: onboarding and payouts (Canada)"). #307's payout run withholds the earnings of an
		// order in DISPUTED, but a chargeback leaves the order's state alone
		// (see above), so that run must also withhold an order with an open
		// chargeback (chargeback.outcome IS NULL). This row is the hold's
		// record until then. Tracked in #319, with gathering the evidence.
		if snap.Outcome != "" {
			return s.closeChargeback(ctx, tx, id, snap, audit, "opened_closed:"+d.ID)
		}
		return effect{kind: effectApplied, label: "chargeback_opened:" + d.ID, stripeID: d.ID, orderID: pi.OrderID}, nil
	}
	if cur.Outcome != "" || (cur.LastEventAt != nil && snap.AsOf.Before(*cur.LastEventAt)) {
		return effect{kind: effectBehind, label: "chargeback_skipped:" + d.ID, stripeID: d.ID, orderID: pi.OrderID}, nil
	}
	if err := updateChargeback(ctx, tx, cur.ID, snap, now); err != nil {
		return effect{}, err
	}
	if snap.Outcome != "" {
		return s.closeChargeback(ctx, tx, cur.ID, snap, audit, "chargeback_closed:"+d.ID)
	}
	audit.Action, audit.SubjectID = "payment.chargeback_updated", cur.ID
	if err := writeWebhookAudit(ctx, tx, audit); err != nil {
		return effect{}, err
	}
	return effect{kind: effectApplied, label: "chargeback_updated:" + d.ID, stripeID: d.ID, orderID: pi.OrderID}, nil
}

// closeChargeback audits a chargeback's close and, when it was lost, leaves
// the loss for a person: Stripe has debited the platform, and which party
// bears it is a person's call under the refund liability table, not
// something to post unseen.
func (s *Service) closeChargeback(ctx context.Context, tx pgx.Tx, id string, snap chargebackSnapshot,
	audit webhookAudit, label string) (effect, error) {
	audit.Action, audit.SubjectID = "payment.chargeback_closed", id
	if err := writeWebhookAudit(ctx, tx, audit); err != nil {
		return effect{}, err
	}
	if snap.Outcome == "lost" {
		if _, err := fileException(ctx, tx, catchUpException{Kind: exceptionChargebackLost,
			StripeObjectID: snap.StripeDisputeID, OrderID: snap.OrderID, ActualCents: int64Ptr(snap.AmountCents)}); err != nil {
			return effect{}, err
		}
	}
	// TODO(#307): release the payout hold described in applyDisputeEvent.
	return effect{kind: effectApplied, label: label + ":" + snap.Outcome, stripeID: snap.StripeDisputeID,
		orderID: snap.OrderID}, nil
}

// ---------------------------------------------------------------------------
// Connect accounts: account.updated.
// ---------------------------------------------------------------------------

type stripeAccountObject struct {
	ID               string `json:"id"`
	ChargesEnabled   bool   `json:"charges_enabled"`
	PayoutsEnabled   bool   `json:"payouts_enabled"`
	DetailsSubmitted bool   `json:"details_submitted"`
	Requirements     *struct {
		CurrentlyDue    []string `json:"currently_due"`
		EventuallyDue   []string `json:"eventually_due"`
		PastDue         []string `json:"past_due"`
		DisabledReason  string   `json:"disabled_reason"`
		CurrentDeadline int64    `json:"current_deadline"`
	} `json:"requirements"`
}

// applyAccountUpdated keeps a restaurant's or rider's payout account current
// ("P-19 — Stripe Connect: onboarding and payouts (Canada)", onboarding
// step 4). payouts_enabled=false is what holds that partner's payouts, as no
// transfer is made to such an account, so a restricted account is noticed
// the moment Stripe says so.
func (s *Service) applyAccountUpdated(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var a stripeAccountObject
	if err := ev.object(&a); err != nil {
		return effect{}, err
	}
	if a.ID == "" {
		return effect{}, fmt.Errorf("%s %s carries no account id", ev.Type, ev.ID)
	}
	// Stripe sends a connected account's account.updated from that account.
	// One sent from account A about account B is not B's to apply: account A
	// must never change another partner's payout account.
	if ev.Account != a.ID {
		return s.refuse(ctx, tx, ev, a.ID, "connected account "+ev.Account+" sent an update about account "+a.ID)
	}
	acct := &StripeAccount{ID: a.ID, ChargesEnabled: a.ChargesEnabled, PayoutsEnabled: a.PayoutsEnabled,
		DetailsSubmitted: a.DetailsSubmitted}
	if r := a.Requirements; r != nil {
		acct.CurrentlyDue, acct.EventuallyDue, acct.PastDue = r.CurrentlyDue, r.EventuallyDue, r.PastDue
		acct.DisabledReason = r.DisabledReason
		if r.CurrentDeadline != 0 {
			d := r.CurrentDeadline
			acct.Deadline = &d
		}
	}
	res, err := updateConnectFromStripe(ctx, tx, acct, ev.asOf())
	if err != nil {
		return effect{}, err
	}
	switch res {
	case connectApplied:
		return effect{kind: effectApplied, label: fmt.Sprintf("connect_account:%s payouts_enabled=%t", a.ID, a.PayoutsEnabled),
			stripeID: a.ID}, nil
	case connectStale:
		return effect{kind: effectBehind, label: "connect_account_skipped:" + a.ID, stripeID: a.ID}, nil
	}
	// No partner's payout account has this Stripe id: an account created by
	// a request whose own write failed, or not ours at all. It changes
	// nothing, and a person is told.
	return s.refuse(ctx, tx, ev, a.ID, "no restaurant's or rider's payout account is "+a.ID)
}

// ---------------------------------------------------------------------------
// Transfers and bank payouts.
// ---------------------------------------------------------------------------

type stripeTransferObject struct {
	ID             string            `json:"id"`
	Amount         int64             `json:"amount"`
	AmountReversed int64             `json:"amount_reversed"`
	Currency       string            `json:"currency"`
	Reversed       bool              `json:"reversed"`
	Destination    string            `json:"destination"`
	Metadata       map[string]string `json:"metadata"`
}

// payoutRank orders a payout's states by how far the money has gone. A
// payout can still fail after it was paid (a reversed transfer, a bank
// payout the bank returned), so FAILED is last.
var payoutRank = map[string]int{
	"DRAFT": 0, "READY": 0, "TRANSFERRING": 0, "HELD": 0,
	"TRANSFERRED": 1,
	"PAID":        2,
	"FAILED":      3,
}

// applyTransferEvent reconciles a payout with its Stripe transfer (the
// handled-events table: "transfer.created / transfer.reversed — reconcile
// payout ledger"). On main a
// transfer that went through is the end of a payout, so the payout is PAID;
// #301 moves that to the bank payout. A FAILED payout is moved back to PAID
// only when the failure was our own call's (no transfer id recorded): a
// transfer Stripe reversed or failed is final until a person says otherwise.
func (s *Service) applyTransferEvent(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var tr stripeTransferObject
	if err := ev.object(&tr); err != nil {
		return effect{}, err
	}
	if tr.ID == "" {
		return effect{}, fmt.Errorf("%s %s carries no transfer id", ev.Type, ev.ID)
	}
	p, found, err := findPayoutForUpdate(ctx, tx, "stripe_transfer_id", tr.ID, tr.Metadata["payout_id"])
	if err != nil {
		return effect{}, err
	}
	if !found {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionUnknownTransfer, StripeObjectID: tr.ID,
			ActualCents: int64Ptr(tr.Amount)})
		return filedEffect(filed, exceptionUnknownTransfer, tr.ID), err
	}
	// A payout_id in the metadata names a row; it does not prove the
	// transfer is that payout's. It must go to the partner's own connected
	// account, recorded here when they onboarded, in CAD.
	if tr.Destination != p.StripeAccountID {
		return s.refuse(ctx, tx, ev, tr.ID, fmt.Sprintf("it names payout %s, which is owed to account %s, "+
			"but the transfer went to %q", p.ID, p.StripeAccountID, tr.Destination))
	}
	if !ourCurrency(tr.Currency) {
		return s.refuse(ctx, tx, ev, tr.ID, "the transfer is in "+tr.Currency+", not CAD")
	}
	if (p.StripeTransferID != "" && p.StripeTransferID != tr.ID) || tr.Amount != p.AmountCents {
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionTransferMismatch, StripeObjectID: tr.ID,
			PayoutID: p.ID, ExpectedCents: int64Ptr(p.AmountCents), ActualCents: int64Ptr(tr.Amount)})
		return filedEffect(filed, exceptionTransferMismatch, tr.ID), err
	}
	ids := payoutStripeIDs{Transfer: tr.ID}
	reversed := tr.Reversed || (tr.Amount > 0 && tr.AmountReversed >= tr.Amount)

	switch {
	case ev.Type == "transfer.failed" || reversed:
		kind, msg := exceptionTransferFailed, "Stripe reported the transfer failed."
		if reversed {
			kind, msg = exceptionTransferReversed, "The transfer was reversed on Stripe."
		}
		if p.State == "FAILED" && p.StripeTransferID == tr.ID {
			return effect{kind: effectUnchanged, label: "noop:payout_failed", stripeID: tr.ID}, nil
		}
		if err := markPayoutFailedTx(ctx, tx, p.ID, p.State, ids, msg); err != nil {
			return effect{}, err
		}
		if err := s.auditPayout(ctx, tx, ev, p, "FAILED", tr.ID); err != nil {
			return effect{}, err
		}
		if _, err := fileException(ctx, tx, catchUpException{Kind: kind, StripeObjectID: tr.ID, PayoutID: p.ID,
			ExpectedCents: int64Ptr(p.AmountCents), ActualCents: int64Ptr(tr.AmountReversed)}); err != nil {
			return effect{}, err
		}
		return effect{kind: effectApplied, label: fmt.Sprintf("payout:%s->FAILED (%s)", p.State, kind), stripeID: tr.ID}, nil

	case tr.AmountReversed > 0:
		// Partly taken back: the payout stands, short by that much.
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionTransferReversed, StripeObjectID: tr.ID,
			PayoutID: p.ID, ExpectedCents: int64Ptr(p.AmountCents), ActualCents: int64Ptr(tr.AmountReversed)})
		return filedEffect(filed, exceptionTransferReversed, tr.ID), err
	}

	// The transfer went through.
	switch {
	case p.State == "READY" || p.State == "TRANSFERRING" || (p.State == "FAILED" && p.StripeTransferID == ""):
		// Waiting for, or in the middle of, its transfer; or failed on our
		// side, such as a create call that timed out after Stripe made it.
	case p.State == "HELD" || p.State == "DRAFT":
		// A held payout makes no transfer. If Stripe has one, a person has
		// to find out why.
		filed, err := fileException(ctx, tx, catchUpException{Kind: exceptionTransferMismatch, StripeObjectID: tr.ID,
			PayoutID: p.ID, ExpectedCents: int64Ptr(0), ActualCents: int64Ptr(tr.Amount)})
		return filedEffect(filed, exceptionTransferMismatch, tr.ID), err
	default:
		// Already past the transfer, or failed by this very transfer (a
		// reversal applied before this older snapshot arrived).
		if p.StripeTransferID == "" {
			if err := setPayoutStripeIDs(ctx, tx, p.ID, ids); err != nil {
				return effect{}, err
			}
		}
		return effect{kind: effectUnchanged, label: "noop:payout_" + p.State, stripeID: tr.ID}, nil
	}
	if err := markPayoutPaidTx(ctx, tx, p.ID, p.State, ids); err != nil {
		return effect{}, err
	}
	if err := s.auditPayout(ctx, tx, ev, p, "PAID", tr.ID); err != nil {
		return effect{}, err
	}
	return effect{kind: effectApplied, label: fmt.Sprintf("payout:%s->PAID", p.State), stripeID: tr.ID}, nil
}

type stripePayoutObject struct {
	ID             string            `json:"id"`
	Amount         int64             `json:"amount"`
	Currency       string            `json:"currency"`
	Status         string            `json:"status"`
	FailureCode    string            `json:"failure_code"`
	FailureMessage string            `json:"failure_message"`
	Metadata       map[string]string `json:"metadata"`
}

// applyPayoutEvent follows a partner's bank payout: the money leaving their
// Stripe balance for their bank ("P-19 — Stripe Connect: onboarding and
// payouts (Canada)", payout execution; #301 is what will create them). The payout's status in the event is the truth: a bank can
// return a payout after Stripe reported it paid, so a failure overrides a
// payment, and a late "paid" never overrides a failure.
func (s *Service) applyPayoutEvent(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var po stripePayoutObject
	if err := ev.object(&po); err != nil {
		return effect{}, err
	}
	if po.ID == "" {
		return effect{}, fmt.Errorf("%s %s carries no payout id", ev.Type, ev.ID)
	}
	p, found, err := findPayoutForUpdate(ctx, tx, "stripe_payout_id", po.ID, po.Metadata["payout_id"])
	if err != nil {
		return effect{}, err
	}
	if !found {
		// Accounts are on a manual schedule, so only a payout made by hand in
		// the partner's Stripe dashboard lands here: their own balance, not a
		// payout of ours. It changes nothing, and a person is told.
		return s.refuse(ctx, tx, ev, po.ID, "no payout here is bank payout "+po.ID)
	}
	// The bank payout must come from the account of the partner the payout
	// is owed to: an event from account A never moves partner B's payout,
	// whatever payout_id A put in the metadata. It must be for the payout's
	// amount, in CAD.
	if ev.Account != p.StripeAccountID {
		return s.refuse(ctx, tx, ev, po.ID, fmt.Sprintf("connected account %s sent it about payout %s, which is owed to account %s",
			ev.Account, p.ID, p.StripeAccountID))
	}
	if !ourCurrency(po.Currency) || po.Amount != p.AmountCents {
		return s.refuse(ctx, tx, ev, po.ID, fmt.Sprintf("it pays out %d %s against payout %s of %d cents CAD",
			po.Amount, po.Currency, p.ID, p.AmountCents))
	}
	ids := payoutStripeIDs{Payout: po.ID}
	var target string
	switch po.Status {
	case "paid":
		target = "PAID"
	case "failed", "canceled":
		target = "FAILED"
	default: // pending, in_transit: on its way, nothing to assert yet
		if p.StripePayoutID == "" {
			if err := setPayoutStripeIDs(ctx, tx, p.ID, ids); err != nil {
				return effect{}, err
			}
		}
		return effect{kind: effectUnchanged, label: "bank_payout_" + po.Status + ":" + po.ID, stripeID: po.ID}, nil
	}
	if payoutRank[target] < payoutRank[p.State] || (target == p.State) {
		if p.StripePayoutID == "" {
			if err := setPayoutStripeIDs(ctx, tx, p.ID, ids); err != nil {
				return effect{}, err
			}
		}
		kind := effectUnchanged
		if target != p.State {
			kind = effectBehind
		}
		return effect{kind: kind, label: fmt.Sprintf("bank_payout_skipped:%s<-%s", p.State, target), stripeID: po.ID}, nil
	}
	if target == "PAID" {
		if err := markPayoutPaidTx(ctx, tx, p.ID, p.State, ids); err != nil {
			return effect{}, err
		}
	} else {
		msg := po.FailureMessage
		if msg == "" {
			msg = "The bank payout " + po.Status + " (" + po.FailureCode + ")."
		}
		if err := markPayoutFailedTx(ctx, tx, p.ID, p.State, ids, msg); err != nil {
			return effect{}, err
		}
		if _, err := fileException(ctx, tx, catchUpException{Kind: exceptionPayoutFailed, StripeObjectID: po.ID,
			PayoutID: p.ID, ExpectedCents: int64Ptr(p.AmountCents), ActualCents: int64Ptr(po.Amount)}); err != nil {
			return effect{}, err
		}
	}
	if err := s.auditPayout(ctx, tx, ev, p, target, po.ID); err != nil {
		return effect{}, err
	}
	return effect{kind: effectApplied, label: fmt.Sprintf("payout:%s->%s", p.State, target), stripeID: po.ID}, nil
}

func (s *Service) auditPayout(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope, p payoutForStripe, to, stripeID string) error {
	return writeWebhookAudit(ctx, tx, webhookAudit{
		Action: "payment.payout_" + strings.ToLower(to), SubjectType: "payout", SubjectID: p.ID,
		AmountCents: int64Ptr(p.AmountCents), EventID: ev.ID,
		After: map[string]any{"state": to, "from": p.State, "stripe_object_id": stripeID},
	})
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

// filedEffect is the effect of a handler whose whole outcome is an exception
// for a person.
func filedEffect(filed bool, kind, stripeID string) effect {
	label := kind + ":" + stripeID
	if !filed {
		label += " (already open)"
	}
	return effect{kind: effectMismatch, label: label, stripeID: stripeID}
}

// combine folds several outcomes of one event into one: the labels join, so
// the line names everything that happened, and the event counts as applied if
// any part of it wrote something.
func combine(outcomes []effect) effect {
	if len(outcomes) == 0 {
		return effect{kind: effectUnchanged, label: "noop:refunded"}
	}
	out := outcomes[0]
	for _, o := range outcomes[1:] {
		if o.kind == effectApplied || (out.kind != effectApplied && o.kind > out.kind) {
			out.kind = o.kind
		}
		out.label += "; " + o.label
	}
	return out
}
