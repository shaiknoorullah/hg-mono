package payments

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

// A capture that failed at acceptance is retried (#741). The restaurant's
// acceptance has committed the order to PREPARING and the one capture call
// failed; the retrier then captures it, under the same Stripe idempotency key,
// and the payment_intent.succeeded webhook posts the CAPTURE batch exactly
// once. A payment that never succeeds is set aside with an ops alert after
// eight failures, and a payment whose order the restaurant has not accepted is
// never captured. Skips without HG_TEST_POSTGRES_DSN (see testPool).
func TestCaptureRetrier_RetriesAFailedCaptureThenPagesWhenItNeverSucceeds(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	retrier := NewCaptureRetrier(h.svc)

	flakyPI := h.id("pi_flaky")
	okOrder := seedOrderWithIntent(t, h.pool, flakyPI, "PREPARING", "REQUIRES_CAPTURE")
	downPI := h.id("pi_down")
	downOrder := seedOrderWithIntent(t, h.pool, downPI, "PREPARING", "REQUIRES_CAPTURE")
	pendingPI := h.id("pi_pending")
	pendingOrder := seedOrderWithIntent(t, h.pool, pendingPI, "RESTAURANT_PENDING", "REQUIRES_CAPTURE")

	calls := map[string][]string{} // idempotency keys by payment intent
	failuresLeft := map[string]int{flakyPI: 2, downPI: 1 << 30}
	live := h.svc.stripe // verifies the webhook; the mock only captures
	h.svc.stripe = &mockStripe{CaptureFn: func(id string, amount int64, key string) (*StripeIntent, error) {
		calls[id] = append(calls[id], key)
		if failuresLeft[id] > 0 {
			failuresLeft[id]--
			return nil, errors.New("stripe capture payment intent: connection reset by peer")
		}
		return &StripeIntent{ID: id, Status: "succeeded", AmountCents: amount, AmountReceivedCents: amount, Currency: "cad"}, nil
	}}
	due := func(order string) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, `UPDATE payment_intent SET deadline_at = now() WHERE order_id = $1 AND deadline_at IS NOT NULL`, order); err != nil {
			t.Fatalf("make the capture due: %v", err)
		}
	}
	pass := func() int {
		t.Helper()
		n, err := retrier.RunOnce(ctx)
		if err != nil {
			t.Fatalf("capture retrier pass: %v", err)
		}
		return n
	}
	row := func(order string) string {
		return h.text(`SELECT state::text || '/' || deadline_escalations || '/' || coalesce(deadline_action, '')
			FROM payment_intent WHERE order_id = $1`, order)
	}
	// The other orders in a shared database may also be due: only these three
	// matter, so each pass is made due for them alone and the counts below are
	// read from the mock, not from the pass.
	due(pendingOrder)

	// Acceptance: the one capture call fails. It is counted and armed for a
	// retry a minute on, not left to a deadline nobody reads.
	if _, err := h.svc.Capture(ctx, okOrder, 3919); err == nil {
		t.Fatal("the first capture should have failed")
	}
	if _, err := h.svc.Capture(ctx, downOrder, 3919); err == nil {
		t.Fatal("the first capture should have failed")
	}
	if got := row(okOrder); got != "REQUIRES_CAPTURE/1/await_capture" {
		t.Errorf("after the failed capture at acceptance: %s", got)
	}
	if wait := h.count(`SELECT round(extract(epoch FROM deadline_at - now()))::int FROM payment_intent WHERE order_id = $1`, okOrder); wait < 55 || wait > 60 {
		t.Errorf("the retry waits %d s, want about 60", wait)
	}

	// Not yet due: nothing is attempted for it.
	pass()
	if n := len(calls[flakyPI]); n != 1 {
		t.Errorf("Stripe saw %d capture calls before the backoff ended, want 1", n)
	}

	// Second failure: the backoff doubles. Third attempt succeeds.
	due(okOrder)
	pass()
	if got := row(okOrder); got != "REQUIRES_CAPTURE/2/await_capture" {
		t.Errorf("after the second failure: %s", got)
	}
	if wait := h.count(`SELECT round(extract(epoch FROM deadline_at - now()))::int FROM payment_intent WHERE order_id = $1`, okOrder); wait < 115 || wait > 120 {
		t.Errorf("the second retry waits %d s, want about 120", wait)
	}
	due(okOrder)
	pass()
	if got := h.text(`SELECT state::text || '/' || amount_captured_cents || '/' || (deadline_at IS NULL)::text || '/' || (lease_owner IS NULL)::text
		FROM payment_intent WHERE order_id = $1`, okOrder); got != "SUCCEEDED/3919/true/true" {
		t.Errorf("after the retry succeeded: %s, want SUCCEEDED/3919/true/true", got)
	}
	if want := []string{"capture:" + okOrder, "capture:" + okOrder, "capture:" + okOrder}; !slices.Equal(calls[flakyPI], want) {
		t.Errorf("idempotency keys across the attempts: %v, want the order's key every time", calls[flakyPI])
	}
	due(okOrder)
	pass()
	if n := len(calls[flakyPI]); n != 3 {
		t.Errorf("a captured payment was captured again (%d calls)", n)
	}

	// The success path: Stripe's webhook posts the CAPTURE batch, once, even
	// when it is delivered twice.
	capturing := h.svc.stripe
	h.svc.stripe = live
	for _, evt := range []string{"evt_cap_a", "evt_cap_b"} {
		h.send(h.id(evt), "payment_intent.succeeded", time.Now(),
			map[string]any{"id": flakyPI, "object": "payment_intent", "status": "succeeded", "amount": 3919, "amount_received": 3919})
		h.process()
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE order_id = $1 AND kind = 'CAPTURE'`, okOrder); n != 1 {
		t.Errorf("%d CAPTURE batches for the retried order, want 1", n)
	}
	h.svc.stripe = capturing
	h.assertLedgerZeroSum(okOrder)

	// A payment Stripe never captures: eight failures, counting acceptance's,
	// then it is set aside and on-call is paged once.
	for attempt := 2; attempt <= captureMaxAttempts; attempt++ {
		due(downOrder)
		pass()
	}
	if got := row(downOrder); got != "REQUIRES_CAPTURE/8/review_uncaptured_accept" {
		t.Errorf("after eight failures: %s, want it set aside", got)
	}
	subject := h.text(`SELECT id::text FROM payment_intent WHERE order_id = $1`, downOrder)
	if got := h.opsAlerts(subject); !slices.Equal(got, []string{"capture_dead_letter"}) {
		t.Errorf("ops alerts about the uncaptured payment: %v, want one capture_dead_letter", got)
	}
	due(downOrder)
	pass()
	if n := len(calls[downPI]); n != captureMaxAttempts {
		t.Errorf("Stripe received %d capture calls for the unreachable payment, want %d", n, captureMaxAttempts)
	}

	// An order the restaurant has not accepted is never captured, due or not.
	if n := len(calls[pendingPI]); n != 0 {
		t.Errorf("a payment for an unaccepted order was captured (%d calls)", n)
	}
}
