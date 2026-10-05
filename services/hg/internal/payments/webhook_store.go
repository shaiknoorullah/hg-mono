package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// Persistence for applying stored Stripe events. Every function here runs in
// the transaction that also marks the event processed (webhook_worker.go), so
// an event's effect and its processed_at commit together or not at all
// (#231).

// ---------------------------------------------------------------------------
// webhook_event.
// ---------------------------------------------------------------------------

// dueWebhookEvents lists stored events whose retry time has come, oldest
// Stripe event first. A dead-lettered event is not listed: it waits for a
// person.
func (r *Repo) dueWebhookEvents(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text FROM webhook_event
		 WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND deadline_at <= now()
		 ORDER BY event_created_at, received_at
		 LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list due webhook events: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// markEventProcessed stamps an applied event. processed_at is what lets the
// row drop its deadline (webhook_event_deadline_required) and, a year on, be
// deleted by the retention sweep (#221).
func markEventProcessed(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `
		UPDATE webhook_event
		   SET processed_at = now(), attempts = attempts + 1, last_error = NULL,
		       deadline_at = NULL, deadline_action = NULL, lease_until = NULL, lease_owner = NULL
		 WHERE id = $1 AND processed_at IS NULL`, id)
	return err
}

// ---------------------------------------------------------------------------
// payment_intent.
// ---------------------------------------------------------------------------

// getIntentForUpdate reads a payment_intent by its Stripe id and locks it for
// the rest of the transaction, so two events for one payment apply one after
// the other.
func getIntentForUpdate(ctx context.Context, tx pgx.Tx, stripeID string) (IntentRow, error) {
	return scanIntent(tx.QueryRow(ctx, intentSelect+` WHERE stripe_payment_intent_id = $1 FOR UPDATE`, stripeID))
}

// advanceIntentState sets a payment_intent's state to target and stamps the
// matching timestamp. A terminal state clears the deadline; a non-terminal
// one keeps it, or, for a declined card the customer retried, arms one again,
// so the deadline CHECK holds either way. last_stripe_event_created_at only
// ever moves forward. applied is false when the row was already in that state.
func advanceIntentState(ctx context.Context, tx pgx.Tx, stripeID string, target PaymentState, asOf time.Time, failure *intentFailure) (bool, error) {
	set := "state = $2, last_stripe_event_created_at = GREATEST(last_stripe_event_created_at, $3)"
	args := []any{stripeID, string(target), asOf}
	switch target {
	case StateSucceeded:
		set += ", deadline_at = NULL, deadline_action = NULL"
	case StateCanceled:
		set += ", canceled_at = coalesce(canceled_at, now()), deadline_at = NULL, deadline_action = NULL"
	case StateFailed:
		set += ", canceled_at = coalesce(canceled_at, now()), deadline_at = NULL, deadline_action = NULL"
		if failure != nil {
			args = append(args, nullStr(failure.Code), nullStr(failure.DeclineCode), nullStr(failure.Message))
			set += ", failure_code = $4, decline_code = $5, failure_message = $6"
		}
	default:
		set += `, canceled_at = NULL,
		        deadline_at = coalesce(deadline_at, now() + interval '20 minutes'),
		        deadline_action = coalesce(deadline_action, 'await_capture')`
		if target == StateRequiresCapture {
			set += ", authorized_at = coalesce(authorized_at, now())"
		}
	}
	tag, err := tx.Exec(ctx,
		`UPDATE payment_intent SET `+set+` WHERE stripe_payment_intent_id = $1 AND state <> $2`, args...)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// recordCapture stamps a captured amount and posts the CAPTURE ledger batch.
// Both are idempotent: a redelivered succeeded event captures once and posts
// one batch.
func recordCapture(ctx context.Context, tx pgx.Tx, stripeID string, capturedCents int64, asOf time.Time, batch LedgerBatch) error {
	_, err := tx.Exec(ctx, `
		UPDATE payment_intent
		   SET state = 'SUCCEEDED',
		       amount_captured_cents = $2,
		       captured_at = coalesce(captured_at, now()),
		       canceled_at = NULL,
		       last_stripe_event_created_at = GREATEST(last_stripe_event_created_at, $3),
		       deadline_at = NULL, deadline_action = NULL
		 WHERE stripe_payment_intent_id = $1`, stripeID, capturedCents, asOf)
	if err != nil {
		return err
	}
	return insertBatch(ctx, tx, batch)
}

// ---------------------------------------------------------------------------
// refund.
// ---------------------------------------------------------------------------

// refundForStripe is the refund row a Stripe refund object is about, with
// the Stripe payment intent this database recorded for it: the caller checks
// the refund object names that same payment before it touches the row.
type refundForStripe struct {
	ID, OrderID, State, StripeRefundID string
	StripePaymentIntentID              string
	AmountCents                        int64
	Split                              LiabilitySplit
}

// findRefundForUpdate finds our refund for a Stripe refund: by the Stripe id
// once it is recorded, else by the refund_id the create call put in the
// metadata. Metadata alone proves nothing (anyone with API access can set
// it), which is why the row comes back with its own payment intent to check
// against. found is false when neither matches.
func findRefundForUpdate(ctx context.Context, tx pgx.Tx, stripeRefundID, metadataRefundID string) (refundForStripe, bool, error) {
	var rf refundForStripe
	err := tx.QueryRow(ctx, `
		SELECT r.id::text, r.order_id::text, r.state::text, coalesce(r.stripe_refund_id, ''),
		       pi.stripe_payment_intent_id, r.amount_cents,
		       r.restaurant_chargeback_cents, r.rider_chargeback_cents, r.platform_absorbed_cents
		  FROM refund r
		  JOIN payment_intent pi ON pi.id = r.payment_intent_id
		 WHERE r.stripe_refund_id = $1 OR r.id = $2::uuid
		 ORDER BY (r.stripe_refund_id = $1) DESC NULLS LAST
		 LIMIT 1
		 FOR UPDATE OF r`, stripeRefundID, uuidOrNil(metadataRefundID)).Scan(
		&rf.ID, &rf.OrderID, &rf.State, &rf.StripeRefundID, &rf.StripePaymentIntentID, &rf.AmountCents,
		&rf.Split.RestaurantChargebackCents, &rf.Split.RiderChargebackCents, &rf.Split.PlatformAbsorbedCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return rf, false, nil
	}
	return rf, err == nil, err
}

// moveRefund records the state Stripe reports for a refund. A refund that
// failed on Stripe stays on a clock (refund_deadline_required: FAILED is not
// terminal) because it is an alerting condition a person has to close
// (docs/spec/01-platform.md, "P-18 — Refunds, cancellations and
// compensation": a failed refund is an alerting condition with a deadline).
//
// from is the state the caller read under its lock; the update is refused
// if the row is no longer in it.
func moveRefund(ctx context.Context, tx pgx.Tx, refundID, stripeRefundID string, from, to RefundState, failure string) error {
	// A refund Stripe has seen is no longer the sender's to send: its lease
	// goes, and its clock becomes the one for the state it is now in (an
	// AUTHORISED refund's deadline is when the sender next tries it).
	set := "state = $2, stripe_refund_id = coalesce(stripe_refund_id, $3), lease_owner = NULL, lease_until = NULL"
	args := []any{refundID, string(to), stripeRefundID, string(from)}
	switch to {
	case RefundSubmitted:
		set += `, deadline_at = now() + interval '7 days',
		        deadline_action = 'await_refund_settlement'`
	case RefundSucceeded:
		set += ", settled_at = coalesce(settled_at, now()), failure_message = NULL, deadline_at = NULL, deadline_action = NULL"
	case RefundFailed:
		args = append(args, failure)
		set += `, failure_message = $5, last_error = $5,
		        deadline_at = now() + interval '24 hours', deadline_action = 'review_failed_refund'`
	}
	tag, err := tx.Exec(ctx, `UPDATE refund SET `+set+` WHERE id = $1 AND state = $4`, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("refund %s is no longer %s", refundID, from)
	}
	return emitRefundMoved(ctx, tx, refundID, to)
}

// refundBatchPosted reports whether a refund already has its REFUND batch.
func refundBatchPosted(ctx context.Context, tx pgx.Tx, refundID string) (bool, error) {
	var posted bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ledger_batch WHERE refund_id = $1)`, refundID).Scan(&posted)
	return posted, err
}

// refundsCoveringCents is the sum of an order's refunds that have reached, or
// are on their way to, Stripe: what Stripe's refunded total should not exceed.
func refundsCoveringCents(ctx context.Context, tx pgx.Tx, orderID string) (int64, error) {
	var sum int64
	err := tx.QueryRow(ctx, `
		SELECT coalesce(sum(amount_cents), 0) FROM refund
		 WHERE order_id = $1 AND state IN ('AUTHORISED', 'SUBMITTED', 'SUCCEEDED', 'SETTLED')`, orderID).Scan(&sum)
	return sum, err
}

// ---------------------------------------------------------------------------
// chargeback.
// ---------------------------------------------------------------------------

// chargebackRow is an existing chargeback, locked.
type chargebackRow struct {
	ID          string
	Outcome     string
	State       string
	AmountCents int64
	LastEventAt *time.Time
}

func getChargebackForUpdate(ctx context.Context, tx pgx.Tx, stripeDisputeID string) (chargebackRow, bool, error) {
	var c chargebackRow
	err := tx.QueryRow(ctx, `
		SELECT id::text, coalesce(outcome, ''), state, amount_cents, last_stripe_event_created_at
		  FROM chargeback WHERE stripe_dispute_id = $1 FOR UPDATE`, stripeDisputeID).Scan(
		&c.ID, &c.Outcome, &c.State, &c.AmountCents, &c.LastEventAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, nil
	}
	return c, err == nil, err
}

// chargebackSnapshot is a dispute as Stripe last reported it.
type chargebackSnapshot struct {
	OrderID         string
	StripeDisputeID string
	AmountCents     int64
	Reason          string
	State           string
	Outcome         string // set once Stripe has closed the dispute
	EvidenceDueAt   *time.Time
	AsOf            time.Time
}

// chargebackDeadline is the clock an open chargeback is on: the evidence
// deadline Stripe gives, or, for a dispute that has none, a week.
func chargebackDeadline(c chargebackSnapshot, now time.Time) (*time.Time, *string) {
	if c.Outcome != "" {
		return nil, nil
	}
	due := now.Add(7 * 24 * time.Hour)
	if c.EvidenceDueAt != nil {
		due = *c.EvidenceDueAt
	}
	action := "submit_dispute_evidence"
	return &due, &action
}

func insertChargeback(ctx context.Context, tx pgx.Tx, c chargebackSnapshot, now time.Time) (string, error) {
	deadline, action := chargebackDeadline(c, now)
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO chargeback (order_id, stripe_dispute_id, amount_cents, reason, state, evidence_due_at,
		                        outcome, deadline_at, deadline_action, last_stripe_event_created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id::text`,
		c.OrderID, c.StripeDisputeID, c.AmountCents, nullStr(c.Reason), c.State, c.EvidenceDueAt,
		nullStr(c.Outcome), deadline, action, c.AsOf).Scan(&id)
	return id, err
}

func updateChargeback(ctx context.Context, tx pgx.Tx, id string, c chargebackSnapshot, now time.Time) error {
	deadline, action := chargebackDeadline(c, now)
	_, err := tx.Exec(ctx, `
		UPDATE chargeback
		   SET amount_cents = $2, reason = $3, state = $4, evidence_due_at = $5, outcome = $6,
		       deadline_at = $7, deadline_action = $8, last_stripe_event_created_at = $9
		 WHERE id = $1`,
		id, c.AmountCents, nullStr(c.Reason), c.State, c.EvidenceDueAt, nullStr(c.Outcome),
		deadline, action, c.AsOf)
	return err
}

// ---------------------------------------------------------------------------
// payout.
// ---------------------------------------------------------------------------

// payoutForStripe is the payout row a Stripe transfer or bank payout is
// about, with the partner's connected account this database recorded for it:
// the caller checks the transfer's destination, or the bank payout's
// account, against that before it touches the row.
type payoutForStripe struct {
	ID, State, StripeTransferID, StripePayoutID string
	StripeAccountID, Currency                   string
	AmountCents                                 int64
}

// findPayoutForUpdate finds our payout for a Stripe transfer or bank payout:
// by the Stripe id once it is recorded, else by the payout_id the create call
// put in the metadata (every Stripe transfer and payout call is keyed by the
// payout id). Metadata alone proves nothing, which is why the row comes back
// with its partner's account to check against.
func findPayoutForUpdate(ctx context.Context, tx pgx.Tx, column, stripeID, metadataPayoutID string) (payoutForStripe, bool, error) {
	if column != "stripe_transfer_id" && column != "stripe_payout_id" {
		return payoutForStripe{}, false, fmt.Errorf("find payout by %q: not a Stripe id column", column)
	}
	var p payoutForStripe
	err := tx.QueryRow(ctx, `
		SELECT p.id::text, p.state::text, coalesce(p.stripe_transfer_id, ''), coalesce(p.stripe_payout_id, ''),
		       ca.stripe_account_id, p.currency::text, p.amount_cents
		  FROM payout p
		  JOIN connect_account ca ON ca.id = p.connect_account_id
		 WHERE p.`+column+` = $1 OR p.id = $2::uuid
		 ORDER BY (p.`+column+` = $1) DESC NULLS LAST
		 LIMIT 1
		 FOR UPDATE OF p`, stripeID, uuidOrNil(metadataPayoutID)).Scan(
		&p.ID, &p.State, &p.StripeTransferID, &p.StripePayoutID, &p.StripeAccountID, &p.Currency, &p.AmountCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, false, nil
	}
	return p, err == nil, err
}

// payoutStripeIDs are the Stripe ids to record on a payout; an empty one is
// left as it is.
type payoutStripeIDs struct{ Transfer, Payout string }

func setPayoutStripeIDs(ctx context.Context, tx pgx.Tx, payoutID string, ids payoutStripeIDs) error {
	_, err := tx.Exec(ctx, `
		UPDATE payout SET stripe_transfer_id = coalesce(stripe_transfer_id, $2),
		                  stripe_payout_id = coalesce(stripe_payout_id, $3)
		 WHERE id = $1`, payoutID, nullStr(ids.Transfer), nullStr(ids.Payout))
	return err
}

// markPayoutPaidTx records that Stripe holds the money as paid to the
// partner. Neither it nor markPayoutFailedTx touches the amount or the
// ledger entries the payout claimed: a webhook never changes what a partner
// is owed. from is the state the caller read under its lock.
func markPayoutPaidTx(ctx context.Context, tx pgx.Tx, payoutID, from string, ids payoutStripeIDs) error {
	return movePayout(ctx, tx, payoutID, from, `
		UPDATE payout
		   SET state = 'PAID', stripe_transfer_id = coalesce(stripe_transfer_id, $3),
		       stripe_payout_id = coalesce(stripe_payout_id, $4), paid_at = coalesce(paid_at, now()),
		       failure_message = NULL, deadline_at = NULL, deadline_action = NULL
		 WHERE id = $1 AND state = $2`, nullStr(ids.Transfer), nullStr(ids.Payout))
}

// markPayoutFailedTx records that the money did not reach the partner.
func markPayoutFailedTx(ctx context.Context, tx pgx.Tx, payoutID, from string, ids payoutStripeIDs, msg string) error {
	return movePayout(ctx, tx, payoutID, from, `
		UPDATE payout
		   SET state = 'FAILED', stripe_transfer_id = coalesce(stripe_transfer_id, $3),
		       stripe_payout_id = coalesce(stripe_payout_id, $4), failure_message = $5, last_error = $5,
		       deadline_at = NULL, deadline_action = NULL
		 WHERE id = $1 AND state = $2`, nullStr(ids.Transfer), nullStr(ids.Payout), msg)
}

// markPayoutTransferredTx records that the money is in the partner's Stripe
// balance: the transfer went through. The bank payout is due at once (#301).
func markPayoutTransferredTx(ctx context.Context, tx pgx.Tx, payoutID, from string, ids payoutStripeIDs) error {
	return movePayout(ctx, tx, payoutID, from, `
		UPDATE payout
		   SET state = 'TRANSFERRED', stripe_transfer_id = coalesce(stripe_transfer_id, $3),
		       failure_message = NULL, last_error = NULL, deadline_at = now(), deadline_action = 'create_bank_payout',
		       lease_until = NULL, lease_owner = NULL
		 WHERE id = $1 AND state = $2`, nullStr(ids.Transfer))
}

// markBankPayoutReturnedTx records that a payout's bank payout failed or was
// returned: the money is back in the partner's Stripe balance, so the payout
// is TRANSFERRED again, with no bank payout on its way, due for the next run.
// A payout that was PAID has its rider lines owed again, until a bank payout
// is paid.
func markBankPayoutReturnedTx(ctx context.Context, tx pgx.Tx, payoutID, from, msg string) error {
	if err := movePayout(ctx, tx, payoutID, from, `
		UPDATE payout
		   SET state = 'TRANSFERRED', stripe_payout_id = NULL, paid_at = NULL,
		       failure_message = $3, last_error = $3, deadline_at = now(), deadline_action = 'create_bank_payout'
		 WHERE id = $1 AND state = $2`, msg); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE earning_entry SET status = 'AVAILABLE' WHERE payout_id = $1 AND status = 'PAID'`, payoutID)
	return err
}

// bankAttempt is one payout_bank_attempt row, locked.
type bankAttempt struct {
	PayoutID       string
	Attempt        int
	State          string
	StripePayoutID string
}

// findBankAttemptForUpdate finds the bank payout attempt an event is about:
// by its Stripe id, or, when the webhook beat the run's own record of it, by
// the payout id and attempt number the run put in its metadata. It locks the
// payout first and then the attempt, the order the run takes them in.
func findBankAttemptForUpdate(ctx context.Context, tx pgx.Tx, stripeID, metadataPayoutID, metadataAttempt string) (
	bankAttempt, payoutForStripe, bool, error) {
	attempt, _ := strconv.Atoi(metadataAttempt)
	var a bankAttempt
	err := tx.QueryRow(ctx, `
		SELECT payout_id::text FROM payout_bank_attempt
		 WHERE stripe_payout_id = $1 OR (payout_id = $2::uuid AND attempt = $3 AND stripe_payout_id IS NULL)
		 ORDER BY (stripe_payout_id = $1) DESC NULLS LAST
		 LIMIT 1`, stripeID, uuidOrNil(metadataPayoutID), attempt).Scan(&a.PayoutID)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, payoutForStripe{}, false, nil
	}
	if err != nil {
		return a, payoutForStripe{}, false, err
	}
	p, found, err := findPayoutForUpdate(ctx, tx, "stripe_payout_id", stripeID, a.PayoutID)
	if err != nil || !found || p.ID != a.PayoutID {
		return a, p, false, err
	}
	err = tx.QueryRow(ctx, `
		SELECT attempt, state, coalesce(stripe_payout_id, '') FROM payout_bank_attempt
		 WHERE payout_id = $1 AND (stripe_payout_id = $2 OR (attempt = $3 AND stripe_payout_id IS NULL))
		 FOR UPDATE`, a.PayoutID, stripeID, attempt).Scan(&a.Attempt, &a.State, &a.StripePayoutID)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, p, false, nil
	}
	return a, p, err == nil, err
}

// settleBankAttemptTx records Stripe's final word on a bank payout attempt:
// PAID, or FAILED with Stripe's reason.
func settleBankAttemptTx(ctx context.Context, tx pgx.Tx, a bankAttempt, stripeID, state, code, msg string) error {
	_, err := tx.Exec(ctx, `
		UPDATE payout_bank_attempt
		   SET state = $3, stripe_payout_id = coalesce(stripe_payout_id, $4), failure_code = $5, failure_message = $6,
		       lease_owner = NULL, lease_until = NULL
		 WHERE payout_id = $1 AND attempt = $2`, a.PayoutID, a.Attempt, state, stripeID, nullStr(code), nullStr(msg))
	return err
}

func movePayout(ctx context.Context, tx pgx.Tx, payoutID, from, sql string, args ...any) error {
	tag, err := tx.Exec(ctx, sql, append([]any{payoutID, from}, args...)...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("payout %s is no longer %s", payoutID, from)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Ops alerts and the audit trail.
// ---------------------------------------------------------------------------

// opsAlert is an admin.alert for the admin:ops channel (contracts/websocket.md,
// "Admin" events: {severity, kind, subject_type, subject_id, message, at}).
// It is how this module pages on-call: the event is written in the same
// transaction as what it reports, so an alert is never lost and never sent
// for a change that rolled back.
type opsAlert struct {
	Severity    string // "high" or "critical"
	Kind        string
	SubjectType string
	SubjectID   string
	Message     string
}

func raiseOpsAlert(ctx context.Context, tx pgx.Tx, a opsAlert) error {
	payload, err := json.Marshal(map[string]string{
		"severity": a.Severity, "kind": a.Kind, "subject_type": a.SubjectType,
		"subject_id": a.SubjectID, "message": a.Message,
		"at": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.AdminOpsChannel, "admin.alert", 1, nil,
		json.RawMessage(payload), nil, nil); err != nil {
		return fmt.Errorf("raise ops alert %s: %w", a.Kind, err)
	}
	return nil
}

// webhookAudit is one audit_event for a money change a Stripe event made. The
// actor is the webhook (docs/spec/01-platform.md, "P-35 — Append-only audit
// trail"; audit_event's actor_kind 'WEBHOOK'), and correlation_id is the Stripe event id, so the
// row leads back to the stored event that caused it.
type webhookAudit struct {
	Action      string
	SubjectType string
	SubjectID   string
	ReasonCode  string
	AmountCents *int64
	After       map[string]any
	EventID     string
	// ActorKind is who made the change when it was not a webhook: 'JOB' for
	// the refund sender, 'ACCOUNT' (with ActorAccountID) for a person.
	// Empty means 'WEBHOOK'.
	ActorKind      string
	ActorAccountID string
}

// writeWebhookAudit appends the audit row in the caller's transaction; the
// table's trigger fills day, seq and the hash chain (00021_audit.sql).
func writeWebhookAudit(ctx context.Context, tx pgx.Tx, a webhookAudit) error {
	after, err := json.Marshal(a.After)
	if err != nil {
		return err
	}
	actor := a.ActorKind
	if actor == "" {
		actor = "WEBHOOK"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_event
		  (actor_kind, actor_account_id, action, subject_type, subject_id, outcome, reason_code, after, amount_cents,
		   correlation_id, day, seq, prev_hash, hash)
		VALUES ($8, $9, $1, $2, $3, 'SUCCESS', $4, $5, $6, $7, current_date, 0, '\x00'::bytea, '\x00'::bytea)`,
		a.Action, a.SubjectType, nullUUID(a.SubjectID), nullStr(a.ReasonCode), after, a.AmountCents, nullStr(a.EventID),
		actor, nullUUID(a.ActorAccountID))
	if err != nil {
		return fmt.Errorf("audit %s: %w", a.Action, err)
	}
	return nil
}

// uuidOrNil passes a metadata id through only if it is a UUID, so a stray
// value from a Stripe object never makes the lookup error out.
func uuidOrNil(s string) any {
	if len(s) != 36 {
		return nil
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return nil
			}
		default:
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
				return nil
			}
		}
	}
	return s
}

func int64Ptr(v int64) *int64 { return &v }
