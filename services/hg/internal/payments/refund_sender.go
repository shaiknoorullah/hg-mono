package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	stripe "github.com/stripe/stripe-go/v79"
)

// The refund sender sends approved refunds to Stripe (#318). Until it existed
// a refund was approved, its REFUND batch posted and its deadline set to
// "submit_refund_to_stripe", and nothing claimed that deadline: the ledger
// recorded the customer as refunded and Stripe never refunded them.
//
// Spec: docs/spec/01-platform.md, "P-18 — Refunds, cancellations and
// compensation": the refund, its ledger batch and the state change commit in
// one transaction, and the Stripe call happens afterwards, with retries; a
// refund Stripe refuses for good is FAILED and pages on-call.
//
// What it sends. Only an AUTHORISED refund that names the member of staff who
// approved it, which the schema also requires of it
// (refund_money_needs_approver, 00035): a customer's request (REQUESTED) and
// an approval request (PENDING_APPROVAL) are never claimed. Only against a captured payment: an authorisation that
// was never captured is voided (Service.Void, PaymentIntent.cancel), never
// refunded, and a refund row cannot exist for one (refund_within_capture).
// Never more than what is left of the capture, counting both the refunds here
// that reached Stripe and Stripe's own refunded total, which includes a refund
// made in Stripe's dashboard.
//
// How. One replica works at a time, holding a session advisory lock (the
// lease), the same pattern as the webhook worker and partition maintenance.
// Each refund is then:
//
//  1. claimed in a transaction of its own, with the row locked: the attempt is
//     counted, the row leased to this sender and its next retry time set, all
//     committed before Stripe is called, so a crash mid-call leaves a row
//     that is retried, never one that is lost or sent twice at once;
//  2. sent as Refund.create with the idempotency key "rf:<refund id>" and
//     metadata.refund_id, so a retry, or a second sender, gets Stripe's first
//     answer back instead of a second refund;
//  3. confirmed: SUBMITTED, with Stripe's refund id. The refund webhooks
//     (#323) take it on to SUCCEEDED, or FAILED.
//
// A network error, a Stripe 5xx, a rate limit or an idempotent request still
// in flight is retried after 1 m, 2 m, 4 m … (the webhook worker's
// schedule). The eighth failure sets the refund aside (its deadline action
// becomes "review_unsent_refund", its error kept) and pages on-call in the
// same transaction; it stays AUTHORISED, so its money stays counted against
// the capture until a person settles it. A refund Stripe refuses outright
// (an invalid request or a card error) is FAILED, filed as a reconciliation
// exception and paged at once: sending it again with the same key cannot
// succeed.

// RefundActionSubmit is the deadline action of an approved refund waiting to
// be sent to Stripe.
const RefundActionSubmit = "submit_refund_to_stripe"

// refundActionReview is the deadline action of a customer's refund request
// waiting for staff review (docs/spec/02-customer.md, "C-37 — Refund requests
// and refund tracking").
const refundActionReview = "await_refund_review"

// refundActionUnsent is the deadline action of a refund the sender set aside
// after its eighth failed attempt: it waits for a person.
const refundActionUnsent = "review_unsent_refund"

// refundLeaseSQL is the key of the session advisory lock one pass holds.
const refundLeaseSQL = `hashtextextended('hg.refund_sender', 0)`

// refundMaxAttempts is how many failed attempts a refund gets before it is set
// aside and on-call is paged, as for a stored webhook.
const refundMaxAttempts = webhookMaxAttempts

// refundCallTimeout bounds one Stripe call; refundRowLease, how long a claim
// holds its row, is longer, so a row is never claimed again while its call
// may still be running.
const (
	refundCallTimeout = 30 * time.Second
	refundRowLease    = 2 * time.Minute
)

// refundIdempotencyKey is the Stripe idempotency key of a refund: derived from
// the refund row, so every attempt at it, from any replica, is one request to
// Stripe (the refunds spec's idempotency_key = 'rf:' || refund_id).
func refundIdempotencyKey(refundID string) string { return "rf:" + refundID }

// RefundSender is the loop that sends approved refunds.
type RefundSender struct {
	svc *Service
	log *slog.Logger
	// tick is how often each replica asks for the lease.
	tick time.Duration
	// batch is how many due refunds one query lists; maxBatches bounds one
	// pass, so the lease changes hands now and then.
	batch, maxBatches int
	// owner names this sender on the rows it leases.
	owner string
}

// NewRefundSender builds the sender over the payments service.
func NewRefundSender(svc *Service) *RefundSender {
	host, _ := os.Hostname()
	return &RefundSender{svc: svc, log: svc.log, tick: 2 * time.Second, batch: 20, maxBatches: 10,
		owner: fmt.Sprintf("refund-sender:%s:%d", host, os.Getpid())}
}

// Run makes a pass every tick until ctx is cancelled.
func (w *RefundSender) Run(ctx context.Context) {
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		pass, ran, err := w.RunOnce(ctx)
		switch {
		case err != nil && !errors.Is(err, context.Canceled):
			w.log.Warn("refund sender pass failed", slog.String("error", err.Error()))
		case ran && pass != (RefundPass{}):
			w.log.Info("refund sender pass", slog.Int("submitted", pass.Submitted), slog.Int("retrying", pass.Retrying),
				slog.Int("failed", pass.Failed), slog.Int("set_aside", pass.SetAside))
		}
	}
}

// RefundPass is what one pass did.
type RefundPass struct {
	Submitted int // sent; Stripe's refund id recorded
	Retrying  int // attempt failed; retried after its backoff
	Failed    int // refused for good; FAILED, filed and paged
	SetAside  int // eighth failure; set aside and paged
}

// RunOnce takes the lease and sends every due refund, the longest-waiting
// first. ran is false when another replica holds the lease.
func (w *RefundSender) RunOnce(ctx context.Context) (pass RefundPass, ran bool, err error) {
	if w.svc.stripe == nil {
		return pass, false, ErrStripeNotConfigured
	}
	c, err := w.svc.repo.pool.Acquire(ctx)
	if err != nil {
		return pass, false, err
	}
	conn := c.Conn()
	defer func() {
		// The lock belongs to the session, so a connection that could not
		// unlock must not go back to the pool still holding it.
		if ran {
			if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(`+refundLeaseSQL+`)`); uerr != nil {
				_ = conn.Close(context.WithoutCancel(ctx))
			}
		}
		c.Release()
	}()
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(`+refundLeaseSQL+`)`).Scan(&ran); err != nil || !ran {
		return pass, false, err
	}

	for range w.maxBatches {
		ids, err := w.svc.repo.dueRefunds(ctx, w.batch)
		if err != nil {
			return pass, true, err
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return pass, true, err
			}
			switch w.svc.sendRefund(ctx, id, w.owner) {
			case sendSubmitted:
				pass.Submitted++
			case sendRetrying:
				pass.Retrying++
			case sendFailed:
				pass.Failed++
			case sendSetAside:
				pass.SetAside++
			}
		}
		if len(ids) < w.batch {
			break
		}
	}
	return pass, true, nil
}

// dueRefunds lists approved refunds whose send time has come and that no
// sender holds.
func (r *Repo) dueRefunds(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text FROM refund
		 WHERE state = 'AUTHORISED' AND approved_by IS NOT NULL AND deadline_action = $1 AND deadline_at <= now()
		   AND (lease_until IS NULL OR lease_until <= now())
		 ORDER BY deadline_at, id
		 LIMIT $2`, RefundActionSubmit, limit)
	if err != nil {
		return nil, fmt.Errorf("list due refunds: %w", err)
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

// sendOutcome is what one attempt at a refund came to.
type sendOutcome int

const (
	// sendSkipped: not due, already sent, or another sender holds the row.
	sendSkipped sendOutcome = iota
	sendSubmitted
	sendRetrying
	sendFailed
	sendSetAside
)

// refundClaim is a claimed refund and the payment it refunds.
type refundClaim struct {
	orderID, reasonCode                   string
	amount                                int64
	attempt                               int
	stripeIntentID, intentState, currency string
	captured, stripeRefunded, sentHere    int64
}

// sendRefund makes one attempt at one refund: claim, send, record.
func (s *Service) sendRefund(ctx context.Context, id, owner string) sendOutcome {
	var (
		c       refundClaim
		claimed bool
		refused bool
	)
	err := s.repo.tx(ctx, func(tx pgx.Tx) error {
		// The payment is locked with the refund, so a webhook moving either
		// waits for the claim, and the claim sees one consistent view.
		err := tx.QueryRow(ctx, `
			SELECT r.order_id::text, r.reason_code::text, r.amount_cents, r.attempts,
			       pi.stripe_payment_intent_id, pi.state::text, pi.currency::text,
			       pi.amount_captured_cents, pi.amount_refunded_cents
			  FROM refund r JOIN payment_intent pi ON pi.id = r.payment_intent_id
			 WHERE r.id = $1 AND r.state = 'AUTHORISED' AND r.approved_by IS NOT NULL
			   AND r.deadline_action = $2 AND r.deadline_at <= now()
			   AND (r.lease_until IS NULL OR r.lease_until <= now())
			 FOR UPDATE OF r, pi SKIP LOCKED`, id, RefundActionSubmit).Scan(
			&c.orderID, &c.reasonCode, &c.amount, &c.attempt,
			&c.stripeIntentID, &c.intentState, &c.currency, &c.captured, &c.stripeRefunded)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		claimed = true
		// The refunds of this payment that reached Stripe; Stripe's own
		// refunded total is the other measure, and the larger one counts.
		if err := tx.QueryRow(ctx, `
			SELECT coalesce(sum(r.amount_cents), 0) FROM refund r
			 WHERE r.payment_intent_id = (SELECT payment_intent_id FROM refund WHERE id = $1)
			   AND r.id <> $1 AND r.state IN ('SUBMITTED', 'SUCCEEDED', 'SETTLED')`, id).Scan(&c.sentHere); err != nil {
			return err
		}
		if why := refundRefusal(c); why != "" {
			refused = true
			return failRefund(ctx, tx, id, c, why, why)
		}
		c.attempt++
		_, err = tx.Exec(ctx, `
			UPDATE refund
			   SET attempts = $2, lease_owner = $3, lease_until = now() + make_interval(secs => $4),
			       deadline_at = now() + make_interval(secs => $5)
			 WHERE id = $1`, id, c.attempt, owner, refundRowLease.Seconds(), webhookRetryAfter(c.attempt).Seconds())
		return err
	})
	switch {
	case err != nil:
		s.log.ErrorContext(ctx, "refund sender: could not claim a refund", "refund_id", id, "error", err.Error())
		return sendSkipped
	case !claimed:
		return sendSkipped
	case refused:
		s.log.ErrorContext(ctx, "refund refused before Stripe was called; FAILED and on-call paged", "refund_id", id)
		return sendFailed
	}

	// The claim is committed: whatever happens to this call, the row says an
	// attempt was made and when to make the next.
	callCtx, cancel := context.WithTimeout(ctx, refundCallTimeout)
	rf, callErr := s.stripe.CreateRefund(callCtx, CreateRefundInput{
		StripePaymentIntentID: c.stripeIntentID,
		AmountCents:           c.amount,
		Reason:                stripeRefundReason(c.reasonCode),
		IdempotencyKey:        refundIdempotencyKey(id),
		RefundID:              id,
	})
	cancel()
	if callErr == nil && (rf == nil || rf.ID == "") {
		callErr = errors.New("stripe answered the refund with no refund id")
	}
	// Record the outcome even while shutting down: the call may have reached
	// Stripe.
	rctx := context.WithoutCancel(ctx)
	out, err := s.recordSendOutcome(rctx, id, owner, c, rf, callErr)
	if err != nil {
		s.log.ErrorContext(ctx, "refund sender: could not record an attempt; it is retried when its lease ends",
			"refund_id", id, "error", err.Error())
		return sendRetrying
	}
	switch out {
	case sendFailed:
		s.log.ErrorContext(ctx, "Stripe refused a refund; FAILED and on-call paged", "refund_id", id, "error", callErr.Error())
	case sendSetAside:
		s.log.ErrorContext(ctx, "refund set aside after repeated failures; on-call paged",
			"refund_id", id, "attempts", c.attempt, "error", callErr.Error())
	case sendRetrying:
		s.log.WarnContext(ctx, "refund attempt failed; retrying with backoff", "refund_id", id,
			"attempt", c.attempt, "error", callErr.Error())
	}
	return out
}

// recordSendOutcome records what Stripe answered, in one transaction.
func (s *Service) recordSendOutcome(ctx context.Context, id, owner string, c refundClaim, rf *StripeRefund, callErr error) (sendOutcome, error) {
	out := sendRetrying
	err := s.repo.tx(ctx, func(tx pgx.Tx) error {
		switch {
		case callErr == nil:
			out = sendSubmitted
			return confirmSubmitted(ctx, tx, id, rf.ID, c)
		case stripeErrorIsPermanent(callErr):
			out = sendFailed
			return failRefund(ctx, tx, id, c, "Stripe refused the refund: "+stripeErrorSummary(callErr), callErr.Error())
		case c.attempt >= refundMaxAttempts:
			out = sendSetAside
			return setRefundAside(ctx, tx, id, c, callErr)
		default:
			out = sendRetrying
			// The next attempt's time was set by the claim; the lease goes,
			// so the refund is claimable again once that time comes.
			_, err := tx.Exec(ctx, `
				UPDATE refund SET last_error = $2, lease_owner = NULL, lease_until = NULL
				 WHERE id = $1 AND state = 'AUTHORISED' AND lease_owner = $3`, id, truncate(callErr.Error()), owner)
			return err
		}
	})
	return out, err
}

// confirmSubmitted records Stripe's refund id and moves the refund to
// SUBMITTED. A refund webhook may have moved it on already (it can be applied
// while the call is still in flight); then only its lease is released.
func confirmSubmitted(ctx context.Context, tx pgx.Tx, id, stripeRefundID string, c refundClaim) error {
	tag, err := tx.Exec(ctx, `
		UPDATE refund
		   SET state = 'SUBMITTED', stripe_refund_id = coalesce(stripe_refund_id, $2), last_error = NULL,
		       deadline_at = now() + interval '7 days', deadline_action = 'await_refund_settlement',
		       lease_owner = NULL, lease_until = NULL
		 WHERE id = $1 AND state = 'AUTHORISED'`, id, stripeRefundID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		_, err := tx.Exec(ctx, `
			UPDATE refund SET stripe_refund_id = coalesce(stripe_refund_id, $2), lease_owner = NULL, lease_until = NULL
			 WHERE id = $1`, id, stripeRefundID)
		return err
	}
	return writeWebhookAudit(ctx, tx, webhookAudit{
		ActorKind: "JOB", Action: "payment.refund_submitted", SubjectType: "refund", SubjectID: id,
		AmountCents: int64Ptr(c.amount),
		After:       map[string]any{"state": RefundSubmitted, "stripe_refund_id": stripeRefundID, "attempt": c.attempt},
	})
}

// failRefund moves a refund that cannot be sent to FAILED, on the 24-hour
// review clock a failed refund keeps (refund_deadline_required), files it as a
// reconciliation exception, which pages on-call in the same transaction, and
// audits it. The REFUND batch stays: the ledger is append-only, and the
// exception is the record that the customer has not been paid. The exception
// names the idempotency key the refund was, or would have been, sent under:
// no Stripe refund exists to name.
func failRefund(ctx context.Context, tx pgx.Tx, id string, c refundClaim, failure, detail string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE refund
		   SET state = 'FAILED', failure_message = $2, last_error = $3,
		       deadline_at = now() + interval '24 hours', deadline_action = 'review_failed_refund',
		       lease_owner = NULL, lease_until = NULL
		 WHERE id = $1 AND state = 'AUTHORISED'`, id, truncate(failure), truncate(detail))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("refund %s is no longer AUTHORISED", id)
	}
	if _, err := fileException(ctx, tx, catchUpException{Kind: exceptionRefundFailed, StripeObjectID: refundIdempotencyKey(id),
		OrderID: c.orderID, ExpectedCents: int64Ptr(c.amount)}); err != nil {
		return err
	}
	return writeWebhookAudit(ctx, tx, webhookAudit{
		ActorKind: "JOB", Action: "payment.refund_failed", SubjectType: "refund", SubjectID: id,
		AmountCents: int64Ptr(c.amount), After: map[string]any{"state": RefundFailed, "failure": failure},
	})
}

// setRefundAside stops retrying a refund after its eighth failure and pages
// on-call in the same transaction. It stays AUTHORISED: it may yet have
// reached Stripe, and if it did, its refund webhook still finds it by
// metadata.refund_id and moves it on.
func setRefundAside(ctx context.Context, tx pgx.Tx, id string, c refundClaim, cause error) error {
	msg := truncate(cause.Error())
	tag, err := tx.Exec(ctx, `
		UPDATE refund
		   SET last_error = $2, deadline_at = now() + interval '24 hours', deadline_action = $3,
		       lease_owner = NULL, lease_until = NULL
		 WHERE id = $1 AND state = 'AUTHORISED'`, id, msg, refundActionUnsent)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("refund %s is no longer AUTHORISED", id)
	}
	if err := raiseOpsAlert(ctx, tx, opsAlert{
		Severity: "critical", Kind: "refund_dead_letter", SubjectType: "refund", SubjectID: id,
		Message: fmt.Sprintf("Refund %s (%d cents, order %s) could not be sent to Stripe after %d attempts and was set aside; "+
			"the customer has not been paid. Last error: %s. See the runbook: a refund was set aside.",
			id, c.amount, c.orderID, c.attempt, msg),
	}); err != nil {
		return err
	}
	return writeWebhookAudit(ctx, tx, webhookAudit{
		ActorKind: "JOB", Action: "payment.refund_set_aside", SubjectType: "refund", SubjectID: id,
		AmountCents: int64Ptr(c.amount), After: map[string]any{"attempts": c.attempt, "error": msg},
	})
}

// refundRefusal is why a claimed refund must not be sent at all, or "": the
// payment is not in CAD, it was never captured (the refunds spec: an
// authorisation is voided, never refunded), or the refund is more than is
// left of the capture.
// Already refunded is the larger of the refunds here that reached Stripe and
// Stripe's own refunded total, which also counts a refund made in Stripe's
// dashboard.
func refundRefusal(c refundClaim) string {
	if !ourCurrency(c.currency) {
		return "the payment is in " + c.currency + ", not CAD"
	}
	if PaymentState(c.intentState) != StateSucceeded || c.captured <= 0 {
		return "the payment was never captured (" + c.intentState + "): an authorisation is voided, not refunded"
	}
	already := max(c.stripeRefunded, c.sentHere)
	if c.amount > c.captured-already {
		return fmt.Sprintf("it would refund %d cents of a %d-cent capture of which %d cents are already refunded",
			c.amount, c.captured, already)
	}
	return ""
}

// stripeRefundReason is the reason Stripe records on a refund. Stripe knows
// three; "fraudulent" also blocks the card, which is never this module's call.
func stripeRefundReason(reasonCode string) string {
	if reasonCode == "DUPLICATE_CHARGE" {
		return "duplicate"
	}
	return "requested_by_customer"
}

// stripeErrorIsPermanent reports whether Stripe refused the request itself,
// so sending it again under the same key cannot succeed: an invalid request
// or a card error, which Stripe answers with a 4xx. Everything else is worth
// retrying: a network error, Stripe's own 5xx, a rate limit (429), the same
// key still in flight (409), and a key Stripe does not accept (401, 403),
// which is a fault of ours to fix, not the refund's.
func stripeErrorIsPermanent(err error) bool {
	var se *stripe.Error
	if !errors.As(err, &se) {
		return false
	}
	switch se.HTTPStatusCode {
	case 401, 403, 409, 429:
		return false
	}
	return se.HTTPStatusCode >= 400 && se.HTTPStatusCode < 500
}

// stripeErrorSummary is a Stripe error's code, or its message.
func stripeErrorSummary(err error) string {
	var se *stripe.Error
	if errors.As(err, &se) {
		if se.Code != "" {
			return string(se.Code)
		}
		if se.Msg != "" {
			return se.Msg
		}
	}
	return err.Error()
}

// truncate keeps an error short enough to store.
func truncate(s string) string {
	if len(s) > 2000 {
		return s[:2000]
	}
	return s
}
