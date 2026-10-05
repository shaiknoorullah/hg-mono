package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Webhook handling (docs/spec/01-platform.md, "P-17 — Webhooks, idempotency
// and reconciliation"). The HTTP boundary is store-then-process: verify the
// signature over the raw body, insert the event under the (provider,
// stripe_event_id) unique index, commit, and answer 200 within the request. A
// redelivered event returns 200 without touching business state — the
// Postgres unique index is the idempotency boundary, not a Redis key.
//
// Processing happens later, from the stored row: the webhook worker
// (webhook_worker.go) applies each event and marks it processed in one
// transaction, retrying with backoff and setting it aside for a person after
// eight failures (#231). Every handler below is a state assertion read from
// the object inside the event, never a step that assumes the events before it
// arrived first: Stripe does not deliver in order.

// webhookResult is what the HTTP layer needs to answer.
type webhookResult struct {
	Acknowledged bool
	Duplicate    bool
}

// ReceiveWebhook verifies the signature, checks livemode against the
// environment, and stores the event. Business processing happens later in the
// webhook worker, so no business work holds up the response. An unsigned or
// badly-signed request never mutates a row, and its body is not logged.
func (s *Service) ReceiveWebhook(ctx context.Context, payload []byte, sigHeader string, envIsLive bool) (webhookResult, error) {
	if s.stripe == nil {
		return webhookResult{}, ErrStripeNotConfigured
	}
	ev, err := s.stripe.VerifyWebhook(payload, sigHeader)
	if err != nil {
		// Signature failure: 400, zero rows change, body not logged.
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
	// Livemode on the event must match the environment (live in production,
	// test elsewhere), or the event is refused and logged.
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
// Applying a stored event.
// ---------------------------------------------------------------------------

// stripeEventEnvelope is the part of a stored event payload every handler
// reads. Account is set on an event about an object on a partner's
// connected account (its account.updated, its bank payouts) and on nothing
// else.
type stripeEventEnvelope struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Created  int64  `json:"created"`
	Account  string `json:"account"`
	LiveMode bool   `json:"livemode"`
	Data     struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// asOf is when Stripe created the event: how old the snapshot in it is.
func (e stripeEventEnvelope) asOf() time.Time { return time.Unix(e.Created, 0).UTC() }

// object parses the event's data.object into v.
func (e stripeEventEnvelope) object(v any) error {
	if err := json.Unmarshal(e.Data.Object, v); err != nil {
		return fmt.Errorf("parse %s object: %w", e.Type, err)
	}
	return nil
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
// For a payment-intent mismatch, exception is the kind of
// reconciliation_exception it leaves (catchup.go), and stripeID and orderID
// say which payment a person has to look at; orderID is empty when this
// database has no row for the payment. stripeID and orderID are set on
// effectBehind too, which is a mismatch when it comes from Stripe's current
// view rather than an event. The other handlers file their exceptions
// themselves, in the same transaction (webhook_effects.go).
type effect struct {
	kind      effectKind
	label     string
	exception string
	stripeID  string
	orderID   string
}

func (e effect) String() string { return e.label }

// eventHandler applies one event type inside the transaction that will also
// mark the event processed.
type eventHandler func(s *Service, ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error)

// eventHandlers is every event type with an effect, and the spec's table of
// events and effects is docs/spec/01-platform.md, "P-17 — Webhooks,
// idempotency and reconciliation". Any other type is stored and applied as
// ignored. capability.updated is one of those on purpose: Stripe sends
// account.updated for every capability change, and that is the event that
// carries the account's payouts_enabled.
var eventHandlers = map[string]eventHandler{
	// Payment intents (#231): what the order flow relies on.
	"payment_intent.amount_capturable_updated": (*Service).applyIntentEvent,
	"payment_intent.requires_action":           (*Service).applyIntentEvent,
	"payment_intent.succeeded":                 (*Service).applyIntentEvent,
	"payment_intent.payment_failed":            (*Service).applyIntentEvent,
	"payment_intent.canceled":                  (*Service).applyIntentEvent,
	// Refunds, disputes, Connect accounts, transfers and bank payouts (#249).
	"charge.refunded":                 (*Service).applyChargeRefunded,
	"charge.refund.updated":           (*Service).applyRefundEvent,
	"refund.created":                  (*Service).applyRefundEvent,
	"refund.updated":                  (*Service).applyRefundEvent,
	"refund.failed":                   (*Service).applyRefundEvent,
	"charge.dispute.created":          (*Service).applyDisputeEvent,
	"charge.dispute.updated":          (*Service).applyDisputeEvent,
	"charge.dispute.closed":           (*Service).applyDisputeEvent,
	"charge.dispute.funds_withdrawn":  (*Service).applyDisputeEvent,
	"charge.dispute.funds_reinstated": (*Service).applyDisputeEvent,
	"account.updated":                 (*Service).applyAccountUpdated,
	"transfer.created":                (*Service).applyTransferEvent,
	"transfer.updated":                (*Service).applyTransferEvent,
	"transfer.reversed":               (*Service).applyTransferEvent,
	"transfer.failed":                 (*Service).applyTransferEvent,
	"payout.paid":                     (*Service).applyPayoutEvent,
	"payout.failed":                   (*Service).applyPayoutEvent,
	"payout.canceled":                 (*Service).applyPayoutEvent,
	"payout.updated":                  (*Service).applyPayoutEvent,
}

// applyEvent applies a stored event's business effect inside tx. It is
// idempotent: re-running it on the same event produces no second state change
// and no second ledger batch; the caller's single-transaction mark
// of processed_at is what makes a replay a no-op in the first place.
func (s *Service) applyEvent(ctx context.Context, tx pgx.Tx, payload []byte) (effect, error) {
	var ev stripeEventEnvelope
	if err := json.Unmarshal(payload, &ev); err != nil {
		return effect{}, fmt.Errorf("parse stored event: %w", err)
	}
	h, ok := eventHandlers[ev.Type]
	if !ok {
		return effect{kind: effectUnchanged, label: "ignored:" + ev.Type}, nil
	}
	// Whose object is it? A partner's account and bank payouts come with
	// the event's account set; every other handled object lives on the
	// platform account and comes without one.
	switch {
	case connectEventTypes[ev.Type] && ev.Account == "":
		// The platform's own account or its own bank payouts: not a
		// partner's, nothing here to keep current.
		return effect{kind: effectUnchanged, label: "ignored:platform_" + ev.Type}, nil
	case !connectEventTypes[ev.Type] && ev.Account != "":
		// A connected account's own payment, refund, dispute or transfer.
		// Partners never take payments here, and such an object is never
		// one of ours, whatever ids it carries.
		return s.refuse(ctx, tx, ev, ev.Account, "it is about an object on connected account "+ev.Account+
			", and only the platform's own payments, refunds, disputes and transfers are applied")
	}
	return h(s, ctx, tx, ev)
}

// connectEventTypes are the handled events about an object on a partner's
// connected account.
var connectEventTypes = map[string]bool{
	"account.updated": true,
	"payout.paid":     true, "payout.failed": true, "payout.canceled": true, "payout.updated": true,
}

// refuse leaves an event unapplied because it is not genuinely about the row
// it points at: the Stripe object it names is not the one this database
// recorded for that row, or its amount, currency or account does not match
// ours. Such an event changes nothing; it is logged and pages on-call in the
// transaction that marks it processed, since applying it again would only
// refuse it again.
func (s *Service) refuse(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope, stripeID, reason string) (effect, error) {
	s.log.WarnContext(ctx, "stripe webhook refused: not applied",
		"event_id", ev.ID, "type", ev.Type, "account", ev.Account, "object", stripeID, "reason", reason)
	if err := raiseOpsAlert(ctx, tx, opsAlert{
		Severity: "high", Kind: "webhook_refused", SubjectType: "stripe_event", SubjectID: ev.ID,
		Message: fmt.Sprintf("Stripe event %s (%s) was not applied: %s.", ev.ID, ev.Type, reason),
	}); err != nil {
		return effect{}, err
	}
	return effect{kind: effectMismatch, label: "refused:" + stripeID, stripeID: stripeID}, nil
}

// ourCurrency is the one currency money moves in (CAD; amounts are int64
// cents). A Stripe object in any other currency is not one of ours.
func ourCurrency(c string) bool { return c == "" || strings.EqualFold(c, "cad") }

// applyEventSafely is applyEvent with a panicking handler turned into a
// failed attempt, so the event is retried and, in the end, set aside for a
// person rather than taking the worker down: the spec's acceptance criterion
// that a panicking handler is retried and its eighth failure pages on-call.
func (s *Service) applyEventSafely(ctx context.Context, tx pgx.Tx, payload []byte) (eff effect, err error) {
	defer func() {
		if r := recover(); r != nil {
			eff, err = effect{}, fmt.Errorf("event handler panicked: %v", r)
		}
	}()
	return s.applyEvent(ctx, tx, payload)
}

// ---------------------------------------------------------------------------
// Payment intents: the state-assertion handlers.
// ---------------------------------------------------------------------------

// intentEventTargets maps each payment_intent event type to the payment state
// it asserts when the object inside carries no status this code knows.
var intentEventTargets = map[string]PaymentState{
	"payment_intent.amount_capturable_updated": StateRequiresCapture,
	"payment_intent.requires_action":           StateRequiresAction,
	"payment_intent.succeeded":                 StateSucceeded,
	"payment_intent.payment_failed":            StateFailed,
	"payment_intent.canceled":                  StateCanceled,
}

// stripePIObject is the subset of a PaymentIntent object we read from a webhook.
type stripePIObject struct {
	ID               string              `json:"id"`
	Status           string              `json:"status"`
	AmountReceived   int64               `json:"amount_received"`
	AmountCapturable int64               `json:"amount_capturable"`
	Currency         string              `json:"currency"`
	LastPaymentError *stripePaymentError `json:"last_payment_error"`
}

type stripePaymentError struct {
	Code        string `json:"code"`
	DeclineCode string `json:"decline_code"`
	Message     string `json:"message"`
}

// intentFailure is why a card was declined, kept on the payment_intent row so
// the customer's payment screen can say so.
type intentFailure struct {
	Code, DeclineCode, Message string
}

// stripeIntentTarget is the payment state a Stripe PaymentIntent status
// asserts. After a decline Stripe puts the intent back to needing a card,
// with the decline in last_payment_error; that is FAILED here. A status this
// code does not know asserts nothing: guessing a payment state is how money
// goes missing.
func stripeIntentTarget(status string, declined bool) (PaymentState, bool) {
	switch status {
	case "requires_payment_method":
		if declined {
			return StateFailed, true
		}
		return StateRequiresPaymentMethod, true
	case "requires_confirmation", "requires_action", "processing", "requires_capture", "succeeded", "canceled":
		return stateFromStripe(status), true
	}
	return "", false
}

// applyIntentEvent asserts the payment state the event's PaymentIntent is in.
// The object's own status is the truth; the event type is only the fallback
// for an object without one. An authorisation also moves the order on
// (docs/spec/01-platform.md, "P-14 — Order lifecycle states and
// transitions": created to authorised, then to restaurant pending), which is
// what presents a paid order to the restaurant. A decline leaves the order in
// CREATED: the customer may try another card until the 15-minute CREATED
// deadline cancels the order and voids the authorisation.
func (s *Service) applyIntentEvent(ctx context.Context, tx pgx.Tx, ev stripeEventEnvelope) (effect, error) {
	var obj stripePIObject
	if err := ev.object(&obj); err != nil {
		return effect{}, err
	}
	if obj.ID == "" {
		return effect{}, fmt.Errorf("%s %s carries no payment intent id", ev.Type, ev.ID)
	}
	if !ourCurrency(obj.Currency) {
		return s.refuse(ctx, tx, ev, obj.ID, "the payment is in "+obj.Currency+", not CAD")
	}
	target := intentEventTargets[ev.Type]
	if t, ok := stripeIntentTarget(obj.Status, obj.LastPaymentError != nil); ok {
		target = t
	}
	var failure *intentFailure
	if target == StateFailed && obj.LastPaymentError != nil {
		failure = &intentFailure{Code: obj.LastPaymentError.Code, DeclineCode: obj.LastPaymentError.DeclineCode,
			Message: obj.LastPaymentError.Message}
	}
	eff, err := s.assertIntentState(ctx, tx, obj.ID, target, obj.AmountReceived, ev.asOf(), failure)
	if err != nil {
		return effect{}, err
	}
	// Authorised now, whether by this event or by the API response the
	// checkout already recorded: the order may still be waiting in CREATED.
	if target == StateRequiresCapture && s.orders != nil && eff.orderID != "" &&
		(eff.kind == effectApplied || eff.kind == effectUnchanged) {
		moved, err := s.orders.PaymentAuthorised(ctx, tx, eff.orderID)
		if err != nil {
			return effect{}, fmt.Errorf("move order %s past authorisation: %w", eff.orderID, err)
		}
		if moved {
			eff.kind = effectApplied
			eff.label += "; order presented to the restaurant"
		}
	}
	return eff, nil
}

// assertIntentState is the one transition path for a payment_intent, shared by
// webhook processing and the catch-up's reconciliation, and run inside the
// caller's transaction with the row locked. It is a state assertion, never a
// delta: it never moves a PI backwards (out-of-order safety,
// docs/spec/01-platform.md "Webhooks, idempotency and reconciliation"), and
// never moves a captured or cancelled one at all. asOf is how current the
// asserted state is: the event's creation time, or now for Stripe's current
// view. amountReceived is read only for SUCCEEDED.
func (s *Service) assertIntentState(ctx context.Context, tx pgx.Tx, stripeID string, target PaymentState,
	amountReceived int64, asOf time.Time, failure *intentFailure) (effect, error) {
	cur, err := getIntentForUpdate(ctx, tx, stripeID)
	if errors.Is(err, ErrNotFound) {
		return effect{kind: effectMismatch, label: exceptionUnknownIntent + ":" + stripeID,
			exception: exceptionUnknownIntent, stripeID: stripeID}, nil
	}
	if err != nil {
		return effect{}, err
	}
	curState := PaymentState(cur.State)
	settled := curState == StateSucceeded || curState == StateCanceled
	// A declined card is not the end on Stripe: the customer can try another
	// on the same intent, and Stripe then reports it authorised. That is a
	// newer fact than the decline only if it is newer than the last event
	// applied here; an authorisation from before the decline, arriving late,
	// is still behind.
	retried := curState == StateFailed && target != StateFailed && target != StateCanceled &&
		paymentStateRank[target] > paymentStateRank[StateRequiresConfirmation] &&
		(cur.LastEventAt == nil || asOf.After(*cur.LastEventAt))
	// Stripe never fails an intent it has captured or cancelled, so a FAILED
	// assertion against a settled payment is always an older event arriving
	// late: the card was declined, then the customer abandoned the order or
	// its 15-minute deadline voided the authorisation (transition T3, created
	// to cancelled, in docs/spec/01-platform.md, "P-14 — Order lifecycle
	// states and transitions"). FAILED ranks with the final states, so the
	// rank check alone would not catch it.
	if !retried && (paymentStateRank[target] < paymentStateRank[curState] || (settled && target == StateFailed)) {
		return effect{kind: effectBehind, label: fmt.Sprintf("skipped_backwards:%s<-%s", curState, target),
			stripeID: stripeID, orderID: cur.OrderID}, nil
	}
	// A captured or cancelled payment is settled: Stripe never moves one
	// between captured and cancelled, so an assertion that it did is a
	// disagreement for a person, not a transition. Above all, a cancelled
	// authorisation never has money captured against it here.
	if settled && target != curState {
		return effect{kind: effectMismatch, label: fmt.Sprintf("%s:%s<-%s", exceptionSettledConflict, curState, target),
			exception: exceptionSettledConflict, stripeID: stripeID, orderID: cur.OrderID}, nil
	}
	if target == StateSucceeded {
		return s.recordSucceeded(ctx, tx, cur, amountReceived, asOf)
	}
	applied, err := advanceIntentState(ctx, tx, stripeID, target, asOf, failure)
	if err != nil {
		return effect{}, err
	}
	if !applied {
		return effect{kind: effectUnchanged, label: "noop:" + string(target), stripeID: stripeID, orderID: cur.OrderID}, nil
	}
	return effect{kind: effectApplied, label: "advanced:" + string(target), stripeID: stripeID, orderID: cur.OrderID}, nil
}

// recordSucceeded records the capture: set the captured amount and, if not
// already posted, post the CAPTURE ledger batch, in the caller's transaction.
// The batch's idempotency key is the order id so a redelivered succeeded
// event posts exactly one batch.
func (s *Service) recordSucceeded(ctx context.Context, tx pgx.Tx, cur IntentRow, amountReceived int64, asOf time.Time) (effect, error) {
	captured := amountReceived
	if captured == 0 {
		captured = cur.AmountAuthorizedCents
	}
	if captured > cur.AmountAuthorizedCents {
		// Stripe never captures more than it authorised, and the amount we
		// authorised is the server-priced order total. A larger figure is
		// not this payment's capture: record nothing and page on-call.
		if err := raiseOpsAlert(ctx, tx, opsAlert{Severity: "high", Kind: "webhook_refused",
			SubjectType: "payment_intent", SubjectID: cur.ID,
			Message: fmt.Sprintf("Stripe reports %d cents captured on %s, more than the %d authorised; nothing was recorded.",
				captured, cur.StripePaymentIntentID, cur.AmountAuthorizedCents)}); err != nil {
			return effect{}, err
		}
		return effect{kind: effectMismatch, label: "refused:capture_above_authorisation",
			stripeID: cur.StripePaymentIntentID, orderID: cur.OrderID}, nil
	}
	key := "capture:" + cur.OrderID
	if PaymentState(cur.State) == StateSucceeded && cur.AmountCapturedCents == captured {
		posted, err := ledgerBatchPosted(ctx, tx, key)
		if err != nil {
			return effect{}, err
		}
		if posted {
			return effect{kind: effectUnchanged, label: "noop:" + string(StateSucceeded),
				stripeID: cur.StripePaymentIntentID, orderID: cur.OrderID}, nil
		}
	}
	money, _, err := getOrderMoney(ctx, tx, cur.OrderID)
	if err != nil {
		return effect{}, err
	}
	// The rider's share is credited once, at delivery, by the rider earnings
	// batch (rider_earnings.go, issue #306). A capture recorded late, after
	// the delivery, must leave it parked in platform revenue like any other
	// capture, or the rider would be credited twice.
	money.RiderID = ""
	batch := BuildCaptureBatch(money, key, "system:capture")
	if err := recordCapture(ctx, tx, cur.StripePaymentIntentID, captured, asOf, batch); err != nil {
		return effect{}, err
	}
	return effect{kind: effectApplied, label: "captured:" + cur.OrderID,
		stripeID: cur.StripePaymentIntentID, orderID: cur.OrderID}, nil
}
