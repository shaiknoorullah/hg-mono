package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// The webhook worker applies stored Stripe events (#231). Until it existed a
// webhook was stored and never applied: payment states never moved on one,
// and processed_at was never set, so the year-long retention rule (#221)
// could never delete a row.
//
// Spec: docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and
// reconciliation", step 3: process under FOR UPDATE SKIP LOCKED, apply, set
// processed_at, re-arm on failure with backoff (1 m, 2 m, 4 m … cap 8
// attempts, then page on-call).
//
// One replica works at a time: a pass holds a session advisory lock (the
// lease), the same pattern as partition maintenance (internal/partitions); a
// replica that cannot take it skips the pass, and a crashed holder's lock goes
// with its connection. Each event is then applied in a transaction of its own
// that locks the row, applies the effect and sets processed_at, so the effect
// and processed_at commit together or not at all, and the on-demand catch-up
// (catchup.go), which applies through the same step, can never apply a row the
// worker is applying.

// webhookLeaseSQL is the key of the session advisory lock one pass holds.
const webhookLeaseSQL = `hashtextextended('hg.stripe_webhooks', 0)`

// webhookMaxAttempts is how many failed attempts an event gets before it is
// dead-lettered and on-call is paged (the spec: "cap 8 attempts, then ops
// page").
const webhookMaxAttempts = 8

// webhookFirstRetry is the first backoff; each later one doubles it.
const webhookFirstRetry = time.Minute

// webhookRetryAfter is the wait before the next attempt, after attempts
// failed ones: 1 m, 2 m, 4 m … 64 m.
func webhookRetryAfter(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	return webhookFirstRetry << (attempts - 1)
}

// WebhookWorker is the loop that applies stored Stripe events.
type WebhookWorker struct {
	svc *Service
	log *slog.Logger
	// tick is how often each replica asks for the lease. A stored event is
	// due two seconds after it arrives (InsertWebhookEvent).
	tick time.Duration
	// batch is how many due events one query claims; maxBatches bounds one
	// pass, so the lease changes hands now and then.
	batch, maxBatches int
	// envIsLive is whether this environment takes live-mode events
	// (production) or test-mode ones (every other environment).
	envIsLive bool
}

// NewWebhookWorker builds the worker over the payments service. envIsLive is
// the same flag the webhook route checks each event's livemode against; the
// worker checks it again before it applies a stored event.
func NewWebhookWorker(svc *Service, envIsLive bool) *WebhookWorker {
	return &WebhookWorker{svc: svc, log: svc.log, tick: time.Second, batch: 50, maxBatches: 20, envIsLive: envIsLive}
}

// Run makes a pass every tick until ctx is cancelled.
func (w *WebhookWorker) Run(ctx context.Context) {
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
			w.log.Warn("stripe webhook pass failed", slog.String("error", err.Error()))
		case ran && pass.Applied+pass.Failed+pass.DeadLettered > 0:
			w.log.Info("stripe webhook pass", slog.Int("applied", pass.Applied),
				slog.Int("failed", pass.Failed), slog.Int("dead_lettered", pass.DeadLettered))
		}
	}
}

// WebhookPass is what one pass did.
type WebhookPass struct {
	Applied      int // effect applied and processed_at set
	Failed       int // attempt failed; retried after its backoff
	DeadLettered int // eighth failure; set aside and on-call paged
}

// RunOnce takes the lease and applies every due event, oldest Stripe event
// first. ran is false when another replica holds the lease.
func (w *WebhookWorker) RunOnce(ctx context.Context) (pass WebhookPass, ran bool, err error) {
	c, err := w.svc.repo.pool.Acquire(ctx)
	if err != nil {
		return pass, false, err
	}
	conn := c.Conn()
	defer func() {
		// The lock belongs to the session, so a connection that could not
		// unlock must not go back to the pool still holding it.
		if ran {
			if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(`+webhookLeaseSQL+`)`); uerr != nil {
				_ = conn.Close(context.WithoutCancel(ctx))
			}
		}
		c.Release()
	}()
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(`+webhookLeaseSQL+`)`).Scan(&ran); err != nil || !ran {
		return pass, false, err
	}

	for range w.maxBatches {
		ids, err := w.svc.repo.dueWebhookEvents(ctx, w.batch)
		if err != nil {
			return pass, true, err
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return pass, true, err
			}
			res := w.svc.applyStoredEvent(ctx, id, w.envIsLive)
			switch res.outcome {
			case outcomeApplied:
				pass.Applied++
			case outcomeFailed:
				pass.Failed++
			case outcomeDeadLettered:
				pass.DeadLettered++
			}
		}
		if len(ids) < w.batch {
			break
		}
	}
	return pass, true, nil
}

// applyOutcome is what one attempt at a stored event came to.
type applyOutcome int

const (
	// outcomeSkipped: already processed, or another worker holds the row.
	outcomeSkipped applyOutcome = iota
	outcomeApplied
	outcomeFailed
	outcomeDeadLettered
)

type applyResult struct {
	outcome applyOutcome
	effect  effect
	err     error // the failure, for outcomeFailed and outcomeDeadLettered
}

// applyStoredEvent applies one stored event and marks it processed in the
// same transaction, with the row locked: processed_at is set only once the
// effect has committed, and a second call on the same row is a no-op. A
// failed attempt is rolled back whole and then counted, in a transaction of
// its own, with its backoff, or dead-lettered on the eighth. An event whose
// livemode is not this environment's is refused, not applied, even though
// the route already refused such events when they arrived.
func (s *Service) applyStoredEvent(ctx context.Context, id string, envIsLive bool) applyResult {
	var (
		eff           effect
		stripeEventID string
		found         bool
	)
	err := s.repo.tx(ctx, func(tx pgx.Tx) error {
		var payload []byte
		var live bool
		err := tx.QueryRow(ctx, `
			SELECT stripe_event_id, payload, livemode FROM webhook_event
			 WHERE id = $1 AND processed_at IS NULL
			 FOR UPDATE SKIP LOCKED`, id).Scan(&stripeEventID, &payload, &live)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		if live != envIsLive {
			ev := stripeEventEnvelope{ID: stripeEventID}
			_ = json.Unmarshal(payload, &ev)
			if eff, err = s.refuse(ctx, tx, ev, stripeEventID,
				fmt.Sprintf("its livemode is %t and this environment's is %t", live, envIsLive)); err != nil {
				return err
			}
			return markEventProcessed(ctx, tx, id)
		}
		if eff, err = s.applyEventSafely(ctx, tx, payload); err != nil {
			return err
		}
		// A payment-intent disagreement is filed with the event, so a rerun,
		// which no longer sees the event, still finds it open.
		if exc := exceptionFor(eff, false); exc != nil {
			if _, err := fileException(ctx, tx, *exc); err != nil {
				return err
			}
		}
		return markEventProcessed(ctx, tx, id)
	})
	switch {
	case err == nil && !found:
		return applyResult{outcome: outcomeSkipped}
	case err == nil:
		return applyResult{outcome: outcomeApplied, effect: eff}
	case ctx.Err() != nil:
		// Shutting down mid-event is not the event's fault.
		return applyResult{outcome: outcomeSkipped, err: err}
	}
	dead, rerr := s.repo.recordEventFailure(ctx, id, err)
	if rerr != nil {
		s.log.ErrorContext(ctx, "stripe webhook: could not record a failed attempt",
			"webhook_event_id", id, "error", err.Error(), "record_error", rerr.Error())
		return applyResult{outcome: outcomeFailed, err: errors.Join(err, rerr)}
	}
	if dead {
		s.log.ErrorContext(ctx, "stripe webhook dead-lettered after repeated failures; on-call paged",
			"webhook_event_id", id, "stripe_event_id", stripeEventID, "attempts", webhookMaxAttempts, "error", err.Error())
		return applyResult{outcome: outcomeDeadLettered, err: err}
	}
	s.log.WarnContext(ctx, "stripe webhook attempt failed; retrying with backoff",
		"webhook_event_id", id, "stripe_event_id", stripeEventID, "error", err.Error())
	return applyResult{outcome: outcomeFailed, err: err}
}

// recordEventFailure counts a failed attempt. Before the eighth it re-arms the
// row after its backoff; on the eighth it dead-letters the row (no clock, the
// error kept) and pages on-call in the same transaction. dead reports which.
func (r *Repo) recordEventFailure(ctx context.Context, id string, cause error) (dead bool, err error) {
	msg := cause.Error()
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	err = r.tx(ctx, func(tx pgx.Tx) error {
		var attempts int
		var stripeEventID, eventType string
		err := tx.QueryRow(ctx, `
			SELECT attempts, stripe_event_id, type FROM webhook_event
			 WHERE id = $1 AND processed_at IS NULL FOR UPDATE`, id).Scan(&attempts, &stripeEventID, &eventType)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // applied meanwhile, by the catch-up
		}
		if err != nil {
			return err
		}
		attempts++
		if attempts < webhookMaxAttempts {
			_, err := tx.Exec(ctx, `
				UPDATE webhook_event
				   SET attempts = $2, last_error = $3, dead_lettered_at = NULL,
				       deadline_at = now() + make_interval(secs => $4), deadline_action = 'process_webhook'
				 WHERE id = $1`, id, attempts, msg, webhookRetryAfter(attempts).Seconds())
			return err
		}
		dead = true
		if _, err := tx.Exec(ctx, `
			UPDATE webhook_event
			   SET attempts = $2, last_error = $3, dead_lettered_at = now(),
			       deadline_at = NULL, deadline_action = NULL
			 WHERE id = $1`, id, attempts, msg); err != nil {
			return err
		}
		return raiseOpsAlert(ctx, tx, opsAlert{
			Severity: "critical", Kind: "webhook_dead_letter", SubjectType: "webhook_event", SubjectID: id,
			Message: fmt.Sprintf("Stripe event %s (%s) failed %d times and was set aside; its effect is not applied. "+
				"Last error: %s. Fix the cause, then run hg stripe-catchup to retry it.",
				stripeEventID, eventType, attempts, msg),
		})
	})
	return dead, err
}
