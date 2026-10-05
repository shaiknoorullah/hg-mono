package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// The on-demand Stripe catch-up, for after a failover or a restore from
// backup. Either one loses the last moments of writes, and with them any
// Stripe webhook this database had accepted in that window, so payment states
// can disagree with Stripe. The nightly reconciliation would find it a day
// late; this closes the gap right after the database comes back.
//
// Spec: docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and
// reconciliation" (reconciliation runs nightly and on demand).
//
// It does two things, both safe to repeat:
//
//  1. Replay. List every Stripe event created since a given time and store
//     each one through the same path a delivered webhook takes (storeEvent),
//     so the (provider, stripe_event_id) unique index drops the ones already
//     here. Then apply every stored event in that window that has not been
//     applied yet, oldest first, through the same step the webhook worker
//     takes (applyStoredEvent, webhook_worker.go). A row the worker is
//     applying at that moment is skipped, not applied twice.
//  2. Reconcile. Read back from Stripe every PaymentIntent written in the last
//     24 hours (or since the replay start, if that is earlier) and assert its
//     state through the same transition code the webhooks use. Nothing here
//     writes a payment state directly.
//
// Whatever either step will not settle by itself is filed as a
// reconciliation_exception, the table the spec keeps for exactly this, and
// every open one is listed in the report until a person resolves it. An
// event is marked applied in the same transaction that files its exception,
// so a rerun, which no longer sees the event, still reports it.

// stripeEventRetention is how far back Stripe's events API reaches.
const stripeEventRetention = 30 * 24 * time.Hour

// reconcileWindow is how recently a PaymentIntent must have been written for
// the catch-up to read it back from Stripe.
const reconcileWindow = 24 * time.Hour

// The kinds of reconciliation_exception the catch-up files. Each is a
// disagreement with Stripe that a person has to settle.
const (
	// exceptionUnknownIntent: Stripe has a payment this database has no row
	// for, such as one created after the backup a restore came from. If it
	// was captured, a customer paid for an order that does not exist here.
	exceptionUnknownIntent = "unknown_intent"
	// exceptionSettledConflict: a payment this database holds as captured,
	// Stripe holds as cancelled, or the other way round.
	exceptionSettledConflict = "settled_conflict"
	// exceptionUnmappedStatus: Stripe reports a status this code does not
	// know, so it asserts nothing rather than guess a payment state.
	exceptionUnmappedStatus = "unmapped_status"
	// exceptionDatabaseAhead: Stripe's current view of a payment is earlier
	// in its lifecycle than this database's.
	exceptionDatabaseAhead = "database_ahead_of_stripe"
)

// catchUpExceptionKinds is every kind above, and every kind applying a stored
// event files (webhook_effects.go): the open exceptions the report lists.
var catchUpExceptionKinds = []string{
	exceptionUnknownIntent, exceptionSettledConflict, exceptionUnmappedStatus, exceptionDatabaseAhead,
	exceptionUnrecordedRefund, exceptionRefundConflict, exceptionRefundFailed, exceptionChargebackLost,
	exceptionUnknownTransfer, exceptionTransferMismatch, exceptionTransferReversed, exceptionTransferFailed,
	exceptionPayoutFailed,
}

// CatchUpReport is what a catch-up did, for the operator who ran it.
type CatchUpReport struct {
	// Since is the replay start: events created at or after it were replayed.
	Since time.Time
	// ReconciledFrom is the reconciliation start: payment intents written at
	// or after it were read back from Stripe.
	ReconciledFrom time.Time
	// EventsListed counts the events Stripe returned for the window.
	EventsListed int
	// EventsNew counts the listed events this database had not stored.
	EventsNew int
	// EventsProcessed counts the stored events whose effect ran in this run.
	EventsProcessed int
	// IntentsChecked counts the payment intents read back from Stripe.
	IntentsChecked int
	// Transitions lists every state change or ledger batch written, one
	// "<event or intent id>: <effect>" line each.
	Transitions []string
	// Mismatches lists every open reconciliation_exception the catch-up has
	// filed, in this run or an earlier one: disagreements with Stripe the
	// code will not settle by itself (see catchUpExceptionKinds). A person has
	// to look at each, and it stays listed until they set its resolved_at.
	Mismatches []string
	// Failures lists the steps that errored. Re-running the catch-up is safe.
	Failures []string
}

// LeftWork reports whether anything failed or disagrees, so the run should
// not count as clean.
func (r CatchUpReport) LeftWork() bool { return len(r.Failures)+len(r.Mismatches) > 0 }

// note lists an effect that wrote something under the report's transitions.
func (r *CatchUpReport) note(subject string, eff effect) {
	if eff.kind == effectApplied {
		r.Transitions = append(r.Transitions, subject+": "+eff.String())
	}
}

// exceptionFor is the exception an effect leaves for a person, or nil.
// fromStripeNow says whether the asserted state is Stripe's current view of
// the intent (reconciliation) rather than an event, which may be older than
// what the database already holds: only the current view being behind the
// database is a disagreement.
func exceptionFor(eff effect, fromStripeNow bool) *catchUpException {
	var kind string
	switch {
	case eff.kind == effectMismatch:
		kind = eff.exception
	case eff.kind == effectBehind && fromStripeNow:
		kind = exceptionDatabaseAhead
	default:
		return nil
	}
	if kind == "" {
		// A handler that filed its own exception (webhook_effects.go).
		return nil
	}
	return &catchUpException{Kind: kind, StripeObjectID: eff.stripeID, OrderID: eff.orderID}
}

// mismatchLine is how an open exception reads in the report.
func mismatchLine(e catchUpException) string {
	line := e.StripeObjectID + ": " + e.Kind
	if e.OrderID != "" {
		line += " (order " + e.OrderID + ")"
	}
	return line
}

func (r *CatchUpReport) fail(subject string, err error) {
	r.Failures = append(r.Failures, subject+": "+err.Error())
}

// CatchUp replays the Stripe events created since `since`, then reconciles
// the recently written payment intents against Stripe. envIsLive is the same
// flag the webhook handler checks each event's livemode against.
//
// A single event or intent that fails is recorded in the report and the run
// carries on; an error is returned only when a whole step cannot start.
func (s *Service) CatchUp(ctx context.Context, since time.Time, envIsLive bool) (CatchUpReport, error) {
	if s.stripe == nil {
		return CatchUpReport{}, ErrStripeNotConfigured
	}
	now := s.now()
	if since.After(now) {
		return CatchUpReport{}, fmt.Errorf("catch-up start %s is in the future", since.Format(time.RFC3339))
	}
	if now.Sub(since) > stripeEventRetention {
		return CatchUpReport{}, fmt.Errorf("catch-up start %s is more than 30 days ago, and Stripe keeps events for 30 days",
			since.Format(time.RFC3339))
	}
	// Stripe filters event times in whole seconds; so does the stored copy.
	since = since.Truncate(time.Second)
	rep := CatchUpReport{Since: since, ReconciledFrom: now.Add(-reconcileWindow)}
	if since.Before(rep.ReconciledFrom) {
		rep.ReconciledFrom = since
	}

	if err := s.replayEvents(ctx, &rep, envIsLive); err != nil {
		return rep, err
	}
	reconcileErr := s.reconcileIntents(ctx, &rep)
	open, err := s.repo.OpenCatchUpExceptions(ctx)
	if err != nil {
		return rep, errors.Join(reconcileErr, err)
	}
	for _, e := range open {
		rep.Mismatches = append(rep.Mismatches, mismatchLine(e))
	}
	return rep, reconcileErr
}

func (s *Service) replayEvents(ctx context.Context, rep *CatchUpReport, envIsLive bool) error {
	events, err := s.stripe.ListEventsSince(ctx, rep.Since)
	if err != nil {
		return err
	}
	rep.EventsListed = len(events)
	for _, ev := range events {
		if err := ctx.Err(); err != nil {
			return err
		}
		res, err := s.storeEvent(ctx, ev, envIsLive)
		if err != nil {
			rep.fail(ev.ID, err)
			continue
		}
		if !res.Duplicate {
			rep.EventsNew++
		}
	}

	pending, err := s.repo.UnprocessedWebhookEventsSince(ctx, rep.Since)
	if err != nil {
		return err
	}
	for _, e := range pending {
		if err := ctx.Err(); err != nil {
			return err
		}
		// The same step the webhook worker takes: apply and mark processed in
		// one transaction, or count a failed attempt with its backoff.
		res := s.applyStoredEvent(ctx, e.ID, envIsLive)
		switch res.outcome {
		case outcomeApplied:
			rep.EventsProcessed++
			rep.note(e.StripeEventID, res.effect)
		case outcomeFailed, outcomeDeadLettered:
			rep.fail(e.StripeEventID, res.err)
		}
	}
	return nil
}

func (s *Service) reconcileIntents(ctx context.Context, rep *CatchUpReport) error {
	ids, err := s.repo.IntentStripeIDsTouchedSince(ctx, rep.ReconciledFrom)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return err
		}
		pi, err := s.stripe.GetPaymentIntent(ctx, id)
		if err != nil {
			rep.fail(id, err)
			continue
		}
		rep.IntentsChecked++
		var eff effect
		// The assertion and the exception it leaves commit together.
		err = s.repo.tx(ctx, func(tx pgx.Tx) error {
			if target, ok := stripeIntentTarget(pi.Status, pi.FailureCode != ""); ok {
				// Stripe's current view is as new as anything can be.
				if eff, err = s.assertIntentState(ctx, tx, id, target, pi.AmountReceivedCents, s.now(), nil); err != nil {
					return err
				}
			} else {
				eff = effect{kind: effectMismatch, label: exceptionUnmappedStatus + ":" + pi.Status,
					exception: exceptionUnmappedStatus, stripeID: id}
			}
			if exc := exceptionFor(eff, true); exc != nil {
				if _, err := fileException(ctx, tx, *exc); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			rep.fail(id, err)
			continue
		}
		rep.note(id, eff)
	}
	return nil
}
