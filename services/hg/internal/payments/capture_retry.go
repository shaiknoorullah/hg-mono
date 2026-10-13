package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

// A capture that failed when the restaurant accepted is retried (#741).
//
// The restaurant's acceptance commits the order to PREPARING first and
// captures afterwards (store-then-process). If Stripe could not be reached, or
// the process died between the two, nothing used to try again: the payment
// stayed REQUIRES_CAPTURE, the food was cooked and delivered, and the
// authorisation lapsed after about seven days with the money never taken.
//
// Spec: docs/spec/01-platform.md, "P-16 — PaymentIntent lifecycle and capture
// timing"; AGENTS.md invariant 5 (authorise, then capture).
//
// How. A payment that is REQUIRES_CAPTURE for an order the restaurant has
// accepted carries deadline_action = 'await_capture' (intents.go). This loop
// claims such rows whose deadline_at has come, one at a time, with
// FOR UPDATE SKIP LOCKED and a short lease, so two replicas never capture the
// same order at once, and calls Service.Capture: the same code, and the same
// Stripe idempotency key ("capture:<order id>"), as the first attempt, so a
// retry whose predecessor in fact reached Stripe gets Stripe's first answer
// back and captures nothing twice. The CAPTURE ledger batch is not posted
// here: it is posted, once, by the payment_intent.succeeded webhook
// (recordSucceeded, keyed "capture:<order id>"), which this changes nothing
// about.
//
// Every failed attempt, whether made here or at acceptance, is counted in
// payment_intent.deadline_escalations by Service.Capture and the next attempt
// is set 1 m, 2 m, 4 m ... later (the webhook worker's schedule). The eighth
// failure, or one Stripe refuses for good, sets the payment aside (its
// deadline action becomes "review_uncaptured_accept") and pages on-call in
// the same transaction: roughly two hours after acceptance, days before the
// authorisation lapses. Only the pages and the row say a person is needed; the
// order itself carries on.

// captureActionAwait is the deadline action of an authorised payment whose
// order the restaurant accepted and whose capture has not gone through.
const captureActionAwait = "await_capture"

// captureActionReview is the deadline action of a payment the retrier gave up
// on: it waits for a person.
const captureActionReview = "review_uncaptured_accept"

// captureMaxAttempts is how many failed captures a payment gets, counting the
// one at acceptance, before on-call is paged.
const captureMaxAttempts = webhookMaxAttempts

const (
	// captureCallTimeout bounds one Stripe call; captureRowLease, how long a
	// claim holds its row, is longer, so a row is never claimed again while its
	// call may still be running.
	captureCallTimeout = 30 * time.Second
	captureRowLease    = 2 * time.Minute
)

// captureAcceptedStates are the order states in which the restaurant has
// accepted the order and the money is owed. A payment for an order still
// waiting on the restaurant (or one rejected, timed out or cancelled) must
// never be captured by this loop.
const captureAcceptedStates = `'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED', 'DELIVERED', 'COMPLETED'`

// CaptureRetrier is the loop that retries captures that failed at acceptance.
type CaptureRetrier struct {
	svc *Service
	log *slog.Logger
	// tick is how often each replica looks for due captures.
	tick time.Duration
	// batch bounds how many captures one pass attempts.
	batch int
	// owner names this retrier on the rows it leases.
	owner string
}

// NewCaptureRetrier builds the retrier over the payments service.
func NewCaptureRetrier(svc *Service) *CaptureRetrier {
	host, _ := os.Hostname()
	return &CaptureRetrier{svc: svc, log: svc.log, tick: 10 * time.Second, batch: 20,
		owner: fmt.Sprintf("capture-retrier:%s:%d", host, os.Getpid())}
}

// Run makes a pass every tick until ctx is cancelled.
func (w *CaptureRetrier) Run(ctx context.Context) {
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		n, err := w.RunOnce(ctx)
		switch {
		case err != nil && !errors.Is(err, context.Canceled):
			w.log.Warn("capture retrier pass failed", slog.String("error", err.Error()))
		case n > 0:
			w.log.Info("capture retrier pass", slog.Int("attempted", n))
		}
	}
}

// RunOnce attempts every due capture, the longest-waiting first, and returns
// how many it attempted.
func (w *CaptureRetrier) RunOnce(ctx context.Context) (int, error) {
	if w.svc.stripe == nil {
		return 0, ErrStripeNotConfigured
	}
	attempted := 0
	for range w.batch {
		if err := ctx.Err(); err != nil {
			return attempted, err
		}
		orderID, total, ok, err := w.svc.repo.claimDueCapture(ctx, w.owner)
		if err != nil {
			return attempted, err
		}
		if !ok {
			return attempted, nil
		}
		attempted++
		callCtx, cancel := context.WithTimeout(ctx, captureCallTimeout)
		// Capture counts a failure and sets the next attempt (or pages).
		_, capErr := w.svc.Capture(callCtx, orderID, total)
		cancel()
		if capErr != nil {
			w.log.WarnContext(ctx, "capture retry failed", "order_id", orderID, "error", capErr.Error())
		} else {
			w.log.InfoContext(ctx, "capture retry succeeded", "order_id", orderID)
		}
		if err := w.svc.repo.releaseCaptureLease(context.WithoutCancel(ctx), orderID, w.owner); err != nil {
			w.log.ErrorContext(ctx, "could not release a capture lease; it ends by itself", "order_id", orderID, "error", err.Error())
		}
	}
	return attempted, nil
}

// claimDueCapture leases the longest-overdue accepted-but-uncaptured payment
// that no replica holds. The amount is the order's total, as at acceptance.
func (r *Repo) claimDueCapture(ctx context.Context, owner string) (orderID string, totalCents int64, ok bool, err error) {
	err = r.pool.QueryRow(ctx, `
		UPDATE payment_intent pi
		   SET lease_owner = $1, lease_until = now() + make_interval(secs => $2)
		  FROM "order" o
		 WHERE o.id = pi.order_id
		   AND pi.id = (
		     SELECT p.id FROM payment_intent p JOIN "order" od ON od.id = p.order_id
		      WHERE p.kind = 'ORDER' AND p.state = 'REQUIRES_CAPTURE'
		        AND p.deadline_action = $3 AND p.deadline_at <= now()
		        AND (p.lease_until IS NULL OR p.lease_until <= now())
		        AND od.state IN (`+captureAcceptedStates+`)
		      ORDER BY p.deadline_at, p.id
		      LIMIT 1
		      FOR UPDATE OF p SKIP LOCKED)
		RETURNING pi.order_id::text, o.total_cents`,
		owner, captureRowLease.Seconds(), captureActionAwait).Scan(&orderID, &totalCents)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, fmt.Errorf("claim due capture: %w", err)
	}
	return orderID, totalCents, true, nil
}

func (r *Repo) releaseCaptureLease(ctx context.Context, orderID, owner string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE payment_intent SET lease_owner = NULL, lease_until = NULL
		 WHERE order_id = $1 AND kind = 'ORDER' AND lease_owner = $2`, orderID, owner)
	return err
}

// recordCaptureFailure counts a failed capture and sets what happens next, in
// one transaction: a retry after the backoff, or, at the eighth failure or on
// a refusal that retrying cannot change, the payment set aside and on-call
// paged. A payment no longer REQUIRES_CAPTURE (a webhook settled it meanwhile)
// is left alone.
func (r *Repo) recordCaptureFailure(ctx context.Context, orderID string, amountCents int64, callErr error) error {
	return r.tx(ctx, func(tx pgx.Tx) error {
		var id string
		var failures int
		err := tx.QueryRow(ctx, `
			SELECT id::text, deadline_escalations FROM payment_intent
			 WHERE order_id = $1 AND kind = 'ORDER' AND state = 'REQUIRES_CAPTURE'
			 FOR UPDATE`, orderID).Scan(&id, &failures)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		failures++
		msg := truncate(callErr.Error())
		if failures < captureMaxAttempts && !stripeErrorIsPermanent(callErr) {
			_, err := tx.Exec(ctx, `
				UPDATE payment_intent
				   SET deadline_escalations = $2, deadline_action = $3,
				       deadline_at = now() + make_interval(secs => $4),
				       lease_owner = NULL, lease_until = NULL, updated_at = now()
				 WHERE id = $1`, id, failures, captureActionAwait, webhookRetryAfter(failures).Seconds())
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE payment_intent
			   SET deadline_escalations = $2, deadline_action = $3, deadline_at = now() + interval '24 hours',
			       lease_owner = NULL, lease_until = NULL, updated_at = now()
			 WHERE id = $1`, id, failures, captureActionReview); err != nil {
			return err
		}
		if err := raiseOpsAlert(ctx, tx, opsAlert{
			Severity: "critical", Kind: "capture_dead_letter", SubjectType: "payment_intent", SubjectID: id,
			Message: fmt.Sprintf("The payment for order %s (%d cents) could not be captured after the restaurant accepted it "+
				"(%d failed attempts) and was set aside; the authorisation lapses after about seven days and the money "+
				"is then lost. Last error: %s. Capture it in Stripe or void it, per the runbook.",
				orderID, amountCents, failures, msg),
		}); err != nil {
			return err
		}
		return writeWebhookAudit(ctx, tx, webhookAudit{
			ActorKind: "JOB", Action: "payment.capture_set_aside", SubjectType: "payment_intent", SubjectID: id,
			AmountCents: int64Ptr(amountCents), After: map[string]any{"attempts": failures, "error": msg},
		})
	})
}
