package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Webhook handling (P-17). The HTTP boundary is store-then-process: verify the
// signature, insert the event under the (provider, stripe_event_id) unique
// index, commit, and answer 200 within the request. A redelivered event returns
// 200 without touching business state — the Postgres unique index is the
// idempotency boundary, not a Redis key (I-17.1, acceptance 1).

// webhookResult is what the HTTP layer needs to answer.
type webhookResult struct {
	Acknowledged bool
	Duplicate    bool
}

// ReceiveWebhook verifies the signature, checks livemode against the
// environment, and stores the event. Business processing happens later in the
// deadline-runner loop (I-17.4). An unsigned or badly-signed request never
// mutates a row (I-17.2) and the body is not logged.
func (s *Service) ReceiveWebhook(ctx context.Context, payload []byte, sigHeader string, envIsLive bool) (webhookResult, error) {
	if s.stripe == nil {
		return webhookResult{}, ErrStripeNotConfigured
	}
	ev, err := s.stripe.VerifyWebhook(payload, sigHeader)
	if err != nil {
		// Signature failure: 400, zero rows change, body not logged (I-17.2).
		return webhookResult{}, &DomainError{Code: "VALIDATION_FAILED", Status: 400,
			Message: "Webhook signature verification failed."}
	}
	// I-17.3: livemode on the event must match the environment or reject+alert.
	if ev.LiveMode != envIsLive {
		s.log.ErrorContext(ctx, "stripe webhook livemode mismatch — rejected",
			"event_id", ev.ID, "event_livemode", ev.LiveMode, "env_live", envIsLive)
		return webhookResult{}, &DomainError{Code: "VALIDATION_FAILED", Status: 400,
			Message: "Webhook livemode does not match this environment."}
	}
	inserted, err := s.repo.InsertWebhookEvent(ctx, ev)
	if err != nil {
		return webhookResult{}, err
	}
	// Whether newly stored or a duplicate, the answer is 200 (acceptance 1).
	return webhookResult{Acknowledged: true, Duplicate: !inserted}, nil
}

// ---------------------------------------------------------------------------
// Business processing — the state-assertion handlers (P-17 §out-of-order).
// These are called from the deadline runner, not from the HTTP request. Each is
// a state assertion, never a delta: it never moves a PI backwards.
// ---------------------------------------------------------------------------

// stripeEventEnvelope is the minimal shape parsed from a stored event payload.
type stripeEventEnvelope struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// stripePIObject is the subset of a PaymentIntent object we read from a webhook.
type stripePIObject struct {
	ID               string `json:"id"`
	Status           string `json:"status"`
	AmountReceived   int64  `json:"amount_received"`
	AmountCapturable int64  `json:"amount_capturable"`
}

// ProcessStoredEvent applies a stored webhook event's business effect. It is
// idempotent: re-running it produces exactly one state change and one ledger
// batch (I-17.1). The order state machine (owned by the orders module) is
// nudged through the exported hooks the service was built with; here we own the
// payment_intent and ledger side only.
//
// It returns the set of effects applied, for the deadline runner's audit line.
func (s *Service) ProcessStoredEvent(ctx context.Context, rawPayload []byte) (string, error) {
	var env stripeEventEnvelope
	if err := json.Unmarshal(rawPayload, &env); err != nil {
		return "", fmt.Errorf("parse stored event: %w", err)
	}
	switch env.Type {
	case "payment_intent.amount_capturable_updated":
		return s.applyPIState(ctx, env, StateRequiresCapture)
	case "payment_intent.requires_action":
		return s.applyPIState(ctx, env, StateRequiresAction)
	case "payment_intent.succeeded":
		return s.applyPISucceeded(ctx, env)
	case "payment_intent.payment_failed":
		return s.applyPIState(ctx, env, StateFailed)
	case "payment_intent.canceled":
		return s.applyPIState(ctx, env, StateCanceled)
	default:
		// Events we recognise but do not yet act on (transfers, disputes,
		// account.updated, payout.*) are marked processed by the runner without
		// a payment_intent effect. Returning no error keeps them from retrying.
		return "ignored:" + env.Type, nil
	}
}

// applyPIState advances a payment_intent to `target` only if that is not
// earlier in the lifecycle than the current state (the out-of-order guard).
func (s *Service) applyPIState(ctx context.Context, env stripeEventEnvelope, target PaymentState) (string, error) {
	var obj stripePIObject
	if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
		return "", fmt.Errorf("parse payment_intent object: %w", err)
	}
	cur, err := s.repo.GetIntentByStripeID(ctx, obj.ID)
	if errors.Is(err, ErrNotFound) {
		return "unknown_intent:" + obj.ID, nil
	}
	if err != nil {
		return "", err
	}
	if paymentStateRank[target] < paymentStateRank[PaymentState(cur.State)] {
		return fmt.Sprintf("skipped_backwards:%s<-%s", cur.State, target), nil
	}
	applied, err := s.repo.AdvanceIntentState(ctx, obj.ID, target)
	if err != nil {
		return "", err
	}
	if !applied {
		return "noop:" + string(target), nil
	}
	return "advanced:" + string(target), nil
}

// applyPISucceeded records the capture: set the captured amount and, if not
// already posted, post the CAPTURE ledger batch. The batch's idempotency key is
// the order id so a redelivered succeeded event posts exactly one batch.
func (s *Service) applyPISucceeded(ctx context.Context, env stripeEventEnvelope) (string, error) {
	var obj stripePIObject
	if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
		return "", fmt.Errorf("parse payment_intent object: %w", err)
	}
	cur, err := s.repo.GetIntentByStripeID(ctx, obj.ID)
	if errors.Is(err, ErrNotFound) {
		return "unknown_intent:" + obj.ID, nil
	}
	if err != nil {
		return "", err
	}
	captured := obj.AmountReceived
	if captured == 0 {
		captured = cur.AmountAuthorizedCents
	}
	money, _, err := s.repo.GetOrderMoney(ctx, cur.OrderID)
	if err != nil {
		return "", err
	}
	batch := BuildCaptureBatch(money, "capture:"+cur.OrderID, "system:capture")
	if err := s.repo.RecordCapture(ctx, obj.ID, captured, batch); err != nil {
		return "", err
	}
	return "captured:" + cur.OrderID, nil
}
