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
	return s.storeEvent(ctx, ev, envIsLive)
}

// storeEvent is everything a webhook does after its signature checks out: the
// livemode gate, then the insert under the (provider, stripe_event_id) unique
// index. The on-demand catch-up (catchup.go) feeds events listed from the
// Stripe API through here too, so a replayed event and a delivered one are
// the same row, stored at most once.
func (s *Service) storeEvent(ctx context.Context, ev StripeEvent, envIsLive bool) (webhookResult, error) {
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

// effectKind sorts what applying an event or a reconciliation did, so the
// catch-up can count changes and list what needs a person without parsing
// labels.
type effectKind int

const (
	// effectUnchanged: already in that state, or an event we do not act on.
	effectUnchanged effectKind = iota
	// effectApplied: a state change or a ledger batch was written.
	effectApplied
	// effectBehind: the asserted state is earlier in the lifecycle than the
	// database's, so nothing moved. From a webhook that is only a late,
	// out-of-order event; from Stripe's current view of the intent it means
	// the database is ahead of Stripe, which is a mismatch.
	effectBehind
	// effectMismatch: Stripe and the database disagree in a way the code
	// will not settle by itself, so a person has to look.
	effectMismatch
)

// effect is the outcome of one state assertion. Its label is the audit line.
type effect struct {
	kind  effectKind
	label string
}

func (e effect) String() string { return e.label }

// ProcessStoredEvent applies a stored webhook event's business effect. It is
// idempotent: re-running it produces exactly one state change and one ledger
// batch (I-17.1). The order state machine (owned by the orders module) is
// nudged through the exported hooks the service was built with; here we own the
// payment_intent and ledger side only.
//
// It returns the set of effects applied, for the deadline runner's audit line.
func (s *Service) ProcessStoredEvent(ctx context.Context, rawPayload []byte) (string, error) {
	eff, err := s.processEvent(ctx, rawPayload)
	return eff.String(), err
}

func (s *Service) processEvent(ctx context.Context, rawPayload []byte) (effect, error) {
	var env stripeEventEnvelope
	if err := json.Unmarshal(rawPayload, &env); err != nil {
		return effect{}, fmt.Errorf("parse stored event: %w", err)
	}
	var target PaymentState
	switch env.Type {
	case "payment_intent.amount_capturable_updated":
		target = StateRequiresCapture
	case "payment_intent.requires_action":
		target = StateRequiresAction
	case "payment_intent.succeeded":
		target = StateSucceeded
	case "payment_intent.payment_failed":
		target = StateFailed
	case "payment_intent.canceled":
		target = StateCanceled
	default:
		// Events we recognise but do not yet act on (transfers, disputes,
		// account.updated, payout.*) are marked processed by the runner without
		// a payment_intent effect. Returning no error keeps them from retrying.
		return effect{effectUnchanged, "ignored:" + env.Type}, nil
	}
	var obj stripePIObject
	if err := json.Unmarshal(env.Data.Object, &obj); err != nil {
		return effect{}, fmt.Errorf("parse payment_intent object: %w", err)
	}
	return s.assertIntentState(ctx, obj.ID, target, obj.AmountReceived)
}

// assertIntentState is the one transition path for a payment_intent, shared by
// webhook processing and the catch-up's reconciliation. It is a state
// assertion, never a delta: it never moves a PI backwards (out-of-order
// safety, docs/spec/01-platform.md "Webhooks, idempotency and
// reconciliation"), and never moves a captured or cancelled one at all.
// amountReceived is read only for SUCCEEDED.
func (s *Service) assertIntentState(ctx context.Context, stripeID string, target PaymentState, amountReceived int64) (effect, error) {
	cur, err := s.repo.GetIntentByStripeID(ctx, stripeID)
	if errors.Is(err, ErrNotFound) {
		return effect{effectMismatch, "unknown_intent:" + stripeID}, nil
	}
	if err != nil {
		return effect{}, err
	}
	curState := PaymentState(cur.State)
	if paymentStateRank[target] < paymentStateRank[curState] {
		return effect{effectBehind, fmt.Sprintf("skipped_backwards:%s<-%s", curState, target)}, nil
	}
	// A captured or cancelled payment is settled: Stripe never moves one of
	// those to another final state, so an assertion that it did is a
	// disagreement for a person, not a transition. Above all, a cancelled
	// authorisation never has money captured against it here.
	if (curState == StateSucceeded || curState == StateCanceled) && target != curState {
		return effect{effectMismatch, fmt.Sprintf("settled_conflict:%s<-%s", curState, target)}, nil
	}
	if target == StateSucceeded {
		return s.recordSucceeded(ctx, cur, amountReceived)
	}
	applied, err := s.repo.AdvanceIntentState(ctx, stripeID, target)
	if err != nil {
		return effect{}, err
	}
	if !applied {
		return effect{effectUnchanged, "noop:" + string(target)}, nil
	}
	return effect{effectApplied, "advanced:" + string(target)}, nil
}

// recordSucceeded records the capture: set the captured amount and, if not
// already posted, post the CAPTURE ledger batch. The batch's idempotency key is
// the order id so a redelivered succeeded event posts exactly one batch.
func (s *Service) recordSucceeded(ctx context.Context, cur IntentRow, amountReceived int64) (effect, error) {
	captured := amountReceived
	if captured == 0 {
		captured = cur.AmountAuthorizedCents
	}
	key := "capture:" + cur.OrderID
	if PaymentState(cur.State) == StateSucceeded && cur.AmountCapturedCents == captured {
		posted, err := s.repo.LedgerBatchPosted(ctx, key)
		if err != nil {
			return effect{}, err
		}
		if posted {
			return effect{effectUnchanged, "noop:" + string(StateSucceeded)}, nil
		}
	}
	money, _, err := s.repo.GetOrderMoney(ctx, cur.OrderID)
	if err != nil {
		return effect{}, err
	}
	batch := BuildCaptureBatch(money, key, "system:capture")
	if err := s.repo.RecordCapture(ctx, cur.StripePaymentIntentID, captured, batch); err != nil {
		return effect{}, err
	}
	return effect{effectApplied, "captured:" + cur.OrderID}, nil
}
