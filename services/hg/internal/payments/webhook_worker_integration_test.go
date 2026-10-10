package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	stripe "github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/webhook"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// The webhook path end to end, against the real database: Stripe's signature
// over the raw body at the public route, the stored row, and the worker that
// applies it (#231, #249). Nothing calls Stripe: each event is a recorded
// payload signed with a test secret the way Stripe signs one. Skips without
// HG_TEST_POSTGRES_DSN (see testPool).

const testWebhookSecret = "whsec_hg_webhook_tests"

type webhookHarness struct {
	t      *testing.T
	pool   *pgxpool.Pool
	svc    *Service
	router http.Handler
	worker *WebhookWorker
	run    string   // keeps this test's Stripe ids apart in the shared database
	events []string // the Stripe event ids it stored, deleted at the end
}

func newWebhookHarness(t *testing.T) *webhookHarness {
	t.Helper()
	pool := testPool(t)
	t.Cleanup(pool.Close)
	return newWebhookHarnessOn(t, pool)
}

// newWebhookHarnessOn is newWebhookHarness on a database the caller chose.
func newWebhookHarnessOn(t *testing.T, pool *pgxpool.Pool) *webhookHarness {
	t.Helper()
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	// The live client, with a key nothing uses: only its webhook verification
	// runs, and that is computation over the raw body, not a call.
	svc := NewService(NewRepo(pool), NewLiveStripe("sk_test_never_used", testWebhookSecret), config.Stripe{}, quiet).
		WithOrderHooks(orders.NewStore(pool))
	rt := httpx.NewRouter(httpx.Options{Logger: quiet, Env: string(config.EnvLocal)})
	// A development environment takes test-mode events (livemode false).
	Routes(rt, NewHandler(svc, &config.Config{Env: config.EnvLocal}))
	h := &webhookHarness{t: t, pool: pool, svc: svc, router: rt, worker: NewWebhookWorker(svc, false),
		run: strconv.FormatInt(time.Now().UnixNano(), 36)}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM webhook_event WHERE stripe_event_id = ANY($1)`, h.events)
	})
	return h
}

// id is a Stripe-style id unique to this run.
func (h *webhookHarness) id(prefix string) string { return prefix + "_wh_" + h.run }

// eventPayload is a webhook body as Stripe sends it about a platform object.
func eventPayload(id, typ string, created time.Time, object map[string]any) []byte {
	return eventPayloadFrom("", id, typ, created, object)
}

// eventPayloadFrom is a webhook body as Stripe sends it from a connected
// account: the event's account names it.
func eventPayloadFrom(account, id, typ string, created time.Time, object map[string]any) []byte {
	ev := map[string]any{
		"id": id, "object": "event", "api_version": stripe.APIVersion, "type": typ,
		"created": created.Unix(), "livemode": false, "pending_webhooks": 1,
		"data": map[string]any{"object": object},
	}
	if account != "" {
		ev["account"] = account
	}
	raw, _ := json.Marshal(ev)
	return raw
}

// signature is the Stripe-Signature header for payload, signed at `at`.
func signature(payload []byte, secret string, at time.Time) string {
	return webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{
		Payload: payload, Secret: secret, Timestamp: at}).Header
}

// post delivers a raw body to the public webhook route and returns the status.
func (h *webhookHarness) post(body []byte, sig string) int {
	req := httptest.NewRequest(http.MethodPost, "/v1/webhooks/stripe", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sig != "" {
		req.Header.Set("Stripe-Signature", sig)
	}
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	return rec.Code
}

// send delivers a correctly signed event about a platform object and
// requires the 200.
func (h *webhookHarness) send(id, typ string, created time.Time, object map[string]any) {
	h.t.Helper()
	h.sendFrom("", id, typ, created, object)
}

// sendFrom is send for an event from a connected account.
func (h *webhookHarness) sendFrom(account, id, typ string, created time.Time, object map[string]any) {
	h.t.Helper()
	h.events = append(h.events, id)
	payload := eventPayloadFrom(account, id, typ, created, object)
	if code := h.post(payload, signature(payload, testWebhookSecret, time.Now())); code != http.StatusOK {
		h.t.Fatalf("deliver %s (%s): status %d, want 200", id, typ, code)
	}
}

// process makes this test's stored events due now, rather than in the two
// seconds a delivered event waits, and runs one worker pass.
func (h *webhookHarness) process() {
	h.t.Helper()
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `
		UPDATE webhook_event SET deadline_at = now()
		 WHERE stripe_event_id = ANY($1) AND processed_at IS NULL AND dead_lettered_at IS NULL`, h.events); err != nil {
		h.t.Fatalf("make events due: %v", err)
	}
	if _, ran, err := h.worker.RunOnce(ctx); err != nil || !ran {
		h.t.Fatalf("worker pass: ran=%t err=%v", ran, err)
	}
}

// storedRow is a stored event's processing columns.
type storedRow struct {
	Rows, Attempts          int
	Processed, DeadLettered bool
	Deadline                *time.Time
	LastError               string
	ID                      string
}

func (h *webhookHarness) stored(stripeEventID string) storedRow {
	h.t.Helper()
	var r storedRow
	if err := h.pool.QueryRow(context.Background(), `
		SELECT count(*) OVER (), id::text, attempts, processed_at IS NOT NULL, dead_lettered_at IS NOT NULL,
		       deadline_at, coalesce(last_error, '')
		  FROM webhook_event WHERE stripe_event_id = $1`, stripeEventID).Scan(
		&r.Rows, &r.ID, &r.Attempts, &r.Processed, &r.DeadLettered, &r.Deadline, &r.LastError); err != nil {
		h.t.Fatalf("read stored event %s: %v", stripeEventID, err)
	}
	return r
}

func (h *webhookHarness) count(sql string, args ...any) int {
	h.t.Helper()
	var n int
	if err := h.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		h.t.Fatalf("count: %v\n%s", err, sql)
	}
	return n
}

func (h *webhookHarness) text(sql string, args ...any) string {
	h.t.Helper()
	var s string
	if err := h.pool.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		h.t.Fatalf("read: %v\n%s", err, sql)
	}
	return s
}

// opsAlerts lists the kinds of the admin.alert events raised about a subject.
func (h *webhookHarness) opsAlerts(subjectID string) []string {
	h.t.Helper()
	rows, err := h.pool.Query(context.Background(), `
		SELECT payload->>'kind' FROM realtime_event
		 WHERE channel = 'admin:ops' AND type = 'admin.alert' AND payload->>'subject_id' = $1
		 ORDER BY seq`, subjectID)
	if err != nil {
		h.t.Fatalf("read ops alerts: %v", err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			h.t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	return kinds
}

// assertLedgerZeroSum checks the double-entry ledger still decomposes to zero:
// every batch, each of these orders, and the ledger as a whole.
func (h *webhookHarness) assertLedgerZeroSum(orderIDs ...string) {
	h.t.Helper()
	if n := h.count(`SELECT count(*) FROM (SELECT order_id FROM ledger_entry WHERE order_id = ANY($1)
		GROUP BY order_id HAVING sum(amount_cents) <> 0) x`, orderIDs); n != 0 {
		h.t.Errorf("%d of this test's orders have a non-zero ledger residual", n)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch_imbalance`); n != 0 {
		h.t.Errorf("%d unbalanced ledger batches", n)
	}
	if n := h.count(`SELECT count(*) FROM ledger_global_residual`); n != 0 {
		h.t.Error("the ledger as a whole does not sum to zero")
	}
}

// seedRider adds a rider's payout account; the rider needs no other row.
func (h *webhookHarness) seedRider(stripeAccountID string, payoutsEnabled bool) string {
	h.t.Helper()
	rider := h.text(`SELECT uuid_generate_v7()::text`)
	if _, err := h.pool.Exec(context.Background(), `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
		VALUES ('RIDER', $1, $2, $3, $3)`, rider, stripeAccountID, payoutsEnabled); err != nil {
		h.t.Fatalf("seed connect account: %v", err)
	}
	return rider
}

// seedPayout owes the rider cents and makes the weekly payout for them.
func (h *webhookHarness) seedPayout(rider string, cents int64) string {
	h.t.Helper()
	ctx := context.Background()
	repo := NewRepo(h.pool)
	if err := repo.PostBatch(ctx, LedgerBatch{Kind: BatchAdjustment, IdempotencyKey: h.id("adj_" + rider), PostedBy: "system:test",
		Entries: []LedgerEntry{
			{Account: AcctRiderPayable, CounterpartyType: CPRider, CounterpartyID: rider, AmountCents: cents, Component: CompDeliveryFee},
			{Account: AcctPlatformAbsorbed, CounterpartyType: CPPlatform, AmountCents: -cents, Component: CompDeliveryFee},
		}}); err != nil {
		h.t.Fatalf("post the rider's earning: %v", err)
	}
	// The weekly run's own step, for one rider and a period that has just
	// closed (the run itself is payout_run.go, issue #251).
	now := time.Now()
	pp, err := repo.createPeriodPayout(ctx, PayeeRef{Type: "RIDER", ID: rider},
		PayoutPeriod{Start: now.Add(-7 * 24 * time.Hour), End: now.Add(time.Minute)},
		0, now.Add(time.Hour), now.Add(time.Hour), runActor{})
	if err != nil || pp.PayoutID == "" {
		h.t.Fatalf("make the payout: id %q, err %v", pp.PayoutID, err)
	}
	return pp.PayoutID
}

func piObject(id, status string, amountReceived int64) map[string]any {
	return map[string]any{"id": id, "object": "payment_intent", "status": status,
		"amount": 3919, "amount_received": amountReceived}
}

// An unsigned or badly-signed delivery is refused at the route, before
// anything is stored: an unsigned or badly-signed webhook never mutates a
// row (docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and
// reconciliation"). The signature is
// Stripe's HMAC over the raw body with a 300-second tolerance, so a changed
// body or a replayed old signature fails as surely as none at all.
func TestWebhook_UnsignedOrBadlySignedIsRejectedBeforeAnythingIsStored(t *testing.T) {
	h := newWebhookHarness(t)
	id := h.id("evt_forged")
	h.events = append(h.events, id)
	payload := eventPayload(id, "payment_intent.succeeded", time.Now(), piObject(h.id("pi_forged"), "succeeded", 3919))
	tampered := bytes.Replace(payload, []byte(`"amount_received":3919`), []byte(`"amount_received":1`), 1)
	if bytes.Equal(tampered, payload) {
		t.Fatal("the tampered body is the same as the signed one")
	}
	for name, c := range map[string]struct {
		body []byte
		sig  string
	}{
		"unsigned":                                {payload, ""},
		"a header that is not a signature":        {payload, "t=1,v1=deadbeef"},
		"signed with another secret":              {payload, signature(payload, "whsec_someone_else", time.Now())},
		"signed, then the body changed":           {tampered, signature(payload, testWebhookSecret, time.Now())},
		"signed outside the 300-second tolerance": {payload, signature(payload, testWebhookSecret, time.Now().Add(-6*time.Minute))},
	} {
		if code := h.post(c.body, c.sig); code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, code)
		}
	}
	if n := h.count(`SELECT count(*) FROM webhook_event WHERE stripe_event_id = $1`, id); n != 0 {
		t.Fatalf("%d rows stored from rejected deliveries, want 0", n)
	}
	// The same body, signed properly, is stored: the refusals were the
	// signature's and nothing else's.
	if code := h.post(payload, signature(payload, testWebhookSecret, time.Now())); code != http.StatusOK {
		t.Fatalf("correctly signed delivery: status %d, want 200", code)
	}
	if r := h.stored(id); r.Rows != 1 || r.Processed {
		t.Fatalf("correctly signed delivery: %d rows, processed=%t; want 1 row waiting for the worker", r.Rows, r.Processed)
	}
}

// Stripe delivers an event more than once. However often it arrives, it is
// stored once and applied once: one state change, one move of the order, one
// CAPTURE batch ("P-17 — Webhooks, idempotency and reconciliation"). The
// authorisation is what presents a paid order to the restaurant (created to
// authorised, then to restaurant pending), so applying it twice
// must not move the order twice.
func TestWebhookWorker_ADuplicatedEventIsAppliedOnce(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	pi := h.id("pi_dup")
	order := seedOrderWithIntent(t, h.pool, pi, "CREATED", "REQUIRES_ACTION")
	authorised, captured := h.id("evt_dup_auth"), h.id("evt_dup_cap")
	t0 := time.Now().Add(-time.Minute)

	for range 3 {
		h.send(authorised, "payment_intent.amount_capturable_updated", t0, piObject(pi, "requires_capture", 0))
	}
	h.process()
	h.process()
	if r := h.stored(authorised); r.Rows != 1 || !r.Processed || r.Attempts != 1 || r.Deadline != nil {
		t.Errorf("authorisation event: %+v; want one row, processed on its first attempt, its deadline cleared", r)
	}
	if got := intentState(t, h.pool, pi); got != "REQUIRES_CAPTURE" {
		t.Errorf("payment is %s, want REQUIRES_CAPTURE", got)
	}
	if got := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); got != "RESTAURANT_PENDING" {
		t.Errorf("order is %s, want RESTAURANT_PENDING", got)
	}
	for _, to := range []string{"AUTHORIZED", "RESTAURANT_PENDING"} {
		if n := h.count(`SELECT count(*) FROM order_transition WHERE order_id = $1 AND to_state = $2`, order, to); n != 1 {
			t.Errorf("order moved to %s %d times, want once", to, n)
		}
	}

	// The capture, delivered again after it was applied.
	h.send(captured, "payment_intent.succeeded", t0.Add(30*time.Second), piObject(pi, "succeeded", 3919))
	h.process()
	h.send(captured, "payment_intent.succeeded", t0.Add(30*time.Second), piObject(pi, "succeeded", 3919))
	h.process()
	// A replay through the catch-up's store step is a duplicate, and applying
	// the stored row again is a no-op.
	replay := eventPayload(captured, "payment_intent.succeeded", t0.Add(30*time.Second), piObject(pi, "succeeded", 3919))
	res, err := h.svc.storeEvent(ctx, StripeEvent{ID: captured, Type: "payment_intent.succeeded",
		Created: t0.Add(30 * time.Second).Unix(), RawPayload: replay}, false)
	if err != nil || !res.Duplicate {
		t.Errorf("replayed capture: duplicate=%t err=%v; want a duplicate", res.Duplicate, err)
	}
	if out := h.svc.applyStoredEvent(ctx, h.stored(captured).ID, false); out.outcome != outcomeSkipped {
		t.Errorf("applying the processed capture again: outcome %d, want skipped", out.outcome)
	}
	if r := h.stored(captured); r.Rows != 1 || !r.Processed || r.Attempts != 1 {
		t.Errorf("capture event: %+v; want one row, processed once", r)
	}
	if got := intentState(t, h.pool, pi); got != "SUCCEEDED" {
		t.Errorf("payment is %s, want SUCCEEDED", got)
	}
	if n := h.count(`SELECT amount_captured_cents FROM payment_intent WHERE stripe_payment_intent_id = $1`, pi); n != 3919 {
		t.Errorf("captured %d cents, want 3919", n)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE order_id = $1 AND kind = 'CAPTURE'`, order); n != 1 {
		t.Errorf("%d CAPTURE batches, want 1", n)
	}
	h.assertLedgerZeroSum(order)
}

// Stripe does not deliver in order. The capture can be applied before the
// authorisation that preceded it; the late authorisation is then recorded
// and skipped, and the payment stays captured (the out-of-order acceptance
// criterion of "P-17 — Webhooks, idempotency and reconciliation"). A declined
// card the customer then retried is the opposite case: the newer
// authorisation moves the payment on from FAILED, while an older one,
// arriving after the decline, does not.
func TestWebhookWorker_OutOfOrderEventsReachTheRightState(t *testing.T) {
	h := newWebhookHarness(t)
	t0 := time.Now().Add(-10 * time.Minute)

	t.Run("capture, then the authorisation before it", func(t *testing.T) {
		pi := h.id("pi_ooo")
		order := seedOrderWithIntent(t, h.pool, pi, "PREPARING", "REQUIRES_CAPTURE")
		auth, capt := h.id("evt_ooo_auth"), h.id("evt_ooo_cap")
		h.send(capt, "payment_intent.succeeded", t0.Add(time.Minute), piObject(pi, "succeeded", 3919))
		h.process()
		h.send(auth, "payment_intent.amount_capturable_updated", t0, piObject(pi, "requires_capture", 0))
		h.process()

		if got := intentState(t, h.pool, pi); got != "SUCCEEDED" {
			t.Errorf("payment is %s, want SUCCEEDED", got)
		}
		if r := h.stored(auth); !r.Processed || r.Attempts != 1 {
			t.Errorf("the late authorisation: %+v; want it recorded as processed, on its first attempt", r)
		}
		if got := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); got != "PREPARING" {
			t.Errorf("order is %s, want PREPARING: a late event moved it", got)
		}
		if n := h.count(`SELECT count(*) FROM order_transition WHERE order_id = $1`, order); n != 0 {
			t.Errorf("%d order transitions from the events, want none", n)
		}
		if n := h.count(`SELECT count(*) FROM ledger_batch WHERE order_id = $1 AND kind = 'CAPTURE'`, order); n != 1 {
			t.Errorf("%d CAPTURE batches, want 1", n)
		}
		h.assertLedgerZeroSum(order)
	})

	t.Run("a decline, then a retried card", func(t *testing.T) {
		pi := h.id("pi_retry")
		order := seedOrderWithIntent(t, h.pool, pi, "CREATED", "REQUIRES_PAYMENT_METHOD")
		declined := piObject(pi, "requires_payment_method", 0)
		declined["last_payment_error"] = map[string]any{"code": "card_declined", "decline_code": "insufficient_funds"}
		h.send(h.id("evt_retry_declined"), "payment_intent.payment_failed", t0.Add(time.Minute), declined)
		h.process()
		// An authorisation from before the decline, delivered late: behind.
		h.send(h.id("evt_retry_stale"), "payment_intent.amount_capturable_updated", t0, piObject(pi, "requires_capture", 0))
		h.process()
		if got := intentState(t, h.pool, pi); got != "FAILED" {
			t.Fatalf("after a decline and an older authorisation the payment is %s, want FAILED", got)
		}
		if got := h.text(`SELECT coalesce(decline_code, '') FROM payment_intent WHERE stripe_payment_intent_id = $1`, pi); got != "insufficient_funds" {
			t.Errorf("decline code %q, want insufficient_funds", got)
		}
		// The customer's second card, authorised after the decline.
		h.send(h.id("evt_retry_auth"), "payment_intent.amount_capturable_updated", t0.Add(2*time.Minute),
			piObject(pi, "requires_capture", 0))
		h.process()
		if got := intentState(t, h.pool, pi); got != "REQUIRES_CAPTURE" {
			t.Errorf("after the retried card the payment is %s, want REQUIRES_CAPTURE", got)
		}
		if got := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); got != "RESTAURANT_PENDING" {
			t.Errorf("order is %s, want RESTAURANT_PENDING once the retried card is authorised", got)
		}
	})
}

// capturedOrderForDispute seeds a completed order whose payment Stripe captured
// (the capture webhook already processed) and returns what a dispute test needs:
// the intent and dispute ids, the order, when the capture was sent, the evidence
// deadline, and a builder for the dispute object in a given Stripe status. The
// rows a dispute creates are removed when the test ends.
func (h *webhookHarness) capturedOrderForDispute(ctx context.Context, piKey, disputeKey, captureEvent string) (
	pi, dispute, order string, t0, due time.Time, disputeObject func(status string) map[string]any,
) {
	t := h.t
	pi, dispute = h.id(piKey), h.id(disputeKey)
	order = seedOrderWithIntent(t, h.pool, pi, "COMPLETED", "REQUIRES_CAPTURE")
	t.Cleanup(func() {
		_, _ = h.pool.Exec(ctx, `DELETE FROM reconciliation_exception WHERE stripe_object_id = $1`, dispute)
		_, _ = h.pool.Exec(ctx, `DELETE FROM chargeback WHERE stripe_dispute_id = $1`, dispute)
	})
	t0 = time.Now().Add(-10 * time.Minute)
	h.send(h.id(captureEvent), "payment_intent.succeeded", t0, piObject(pi, "succeeded", 3919))
	h.process()

	due = time.Now().Add(7 * 24 * time.Hour).Truncate(time.Second).UTC()
	disputeObject = func(status string) map[string]any {
		return map[string]any{"id": dispute, "object": "dispute", "amount": 3919, "currency": "cad",
			"payment_intent": pi, "reason": "fraudulent", "status": status,
			"evidence_details": map[string]any{"due_by": due.Unix()}}
	}
	return pi, dispute, order, t0, due, disputeObject
}

// A chargeback opens its chargeback row, the record that holds the
// partners' payout up to the disputed amount ("P-18 — Refunds, cancellations
// and compensation"), with the
// evidence deadline as its clock; it pages ops and is audited with the
// webhook as the actor. Losing it leaves the loss for a person; an older
// snapshot arriving after the close never reopens it; the order's own state
// is left alone throughout.
func TestWebhookWorker_ADisputeOpensTheChargebackHoldAndIsAudited(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	_, dispute, order, t0, due, disputeObject := h.capturedOrderForDispute(ctx, "pi_dispute", "dp", "evt_dp_cap")
	opened := h.id("evt_dp_created")
	h.send(opened, "charge.dispute.created", t0.Add(time.Minute), disputeObject("needs_response"))
	h.process()

	var chargebackID string
	var amount int64
	var deadline *time.Time
	var outcome *string
	if err := h.pool.QueryRow(ctx, `
		SELECT id::text, amount_cents, deadline_at, outcome FROM chargeback WHERE stripe_dispute_id = $1 AND order_id = $2`,
		dispute, order).Scan(&chargebackID, &amount, &deadline, &outcome); err != nil {
		t.Fatalf("read the chargeback: %v", err)
	}
	if amount != 3919 || outcome != nil || deadline == nil || !deadline.Equal(due) {
		t.Errorf("chargeback: %d cents, outcome %v, deadline %v; want 3919 cents held, open, due %v",
			amount, outcome, deadline, due)
	}
	if got := h.opsAlerts(chargebackID); !slices.Contains(got, "chargeback_opened") {
		t.Errorf("ops alerts about the chargeback: %v; want chargeback_opened", got)
	}
	if got := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); got != "COMPLETED" {
		t.Errorf("order is %s; a chargeback is reviewed by ops, it does not move the order", got)
	}

	h.send(h.id("evt_dp_closed"), "charge.dispute.closed", t0.Add(3*time.Minute), disputeObject("lost"))
	h.process()
	// An older snapshot of the open dispute, delivered after it closed.
	late := h.id("evt_dp_late")
	h.send(late, "charge.dispute.updated", t0.Add(2*time.Minute), disputeObject("under_review"))
	h.process()
	if r := h.stored(late); !r.Processed {
		t.Errorf("the late dispute update was not recorded as processed: %+v", r)
	}
	if got := h.text(`SELECT coalesce(outcome, 'open') || '/' || (deadline_at IS NULL)::text FROM chargeback WHERE id = $1`,
		chargebackID); got != "lost/true" {
		t.Errorf("chargeback after close and a late update: %s, want lost/true (closed, off the clock)", got)
	}
	if n := h.count(`SELECT count(*) FROM reconciliation_exception
		WHERE kind = 'chargeback_lost' AND stripe_object_id = $1 AND order_id = $2 AND resolved_at IS NULL`,
		dispute, order); n != 1 {
		t.Errorf("%d open chargeback_lost exceptions, want 1 for a person to decide who bears it", n)
	}

	rows, err := h.pool.Query(ctx, `
		SELECT action, actor_kind, coalesce(amount_cents, 0), coalesce(correlation_id, '')
		  FROM audit_event WHERE subject_type = 'chargeback' AND subject_id = $1 ORDER BY day, seq`, chargebackID)
	if err != nil {
		t.Fatalf("read the audit trail: %v", err)
	}
	defer rows.Close()
	var trail []string
	for rows.Next() {
		var action, actor, eventID string
		var cents int64
		if err := rows.Scan(&action, &actor, &cents, &eventID); err != nil {
			t.Fatal(err)
		}
		if actor != "WEBHOOK" || cents != 3919 {
			t.Errorf("audit %s: actor %s, %d cents; want WEBHOOK and 3919", action, actor, cents)
		}
		if action == "payment.chargeback_opened" && eventID != opened {
			t.Errorf("the opening audit row points at event %q, want %q", eventID, opened)
		}
		trail = append(trail, action)
	}
	if want := []string{"payment.chargeback_opened", "payment.chargeback_closed"}; !slices.Equal(trail, want) {
		t.Errorf("audit trail %v, want %v (the late update audits nothing)", trail, want)
	}
	h.assertLedgerZeroSum(order)
}

// A dispute Stripe closes as prevented is final like won or lost (#365): the
// chargeback takes the outcome, leaves its evidence-deadline clock and drops
// out of the open list, and nothing is left for a person to decide.
func TestWebhookWorker_ADisputeClosedAsPreventedIsClosed(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	_, dispute, order, t0, _, disputeObject := h.capturedOrderForDispute(ctx, "pi_prevented", "dp_prevented", "evt_pv_cap")
	h.send(h.id("evt_pv_created"), "charge.dispute.created", t0.Add(time.Minute), disputeObject("needs_response"))
	h.process()
	closed := h.id("evt_pv_closed")
	h.send(closed, "charge.dispute.closed", t0.Add(2*time.Minute), disputeObject("prevented"))
	h.process()
	if r := h.stored(closed); !r.Processed {
		t.Fatalf("the prevented close was not processed: %+v", r)
	}

	if got := h.text(`SELECT coalesce(outcome, 'open') || '/' || (deadline_at IS NULL)::text FROM chargeback
		WHERE stripe_dispute_id = $1 AND order_id = $2`, dispute, order); got != "prevented/true" {
		t.Errorf("chargeback after a prevented close: %s, want prevented/true (closed, off the clock)", got)
	}
	open := true
	list, _, err := h.svc.ListChargebacks(ctx, staffAs(h.id("agent"), "SUPPORT_AGENT"), ChargebackFilter{Open: &open, OrderID: order})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Errorf("open chargebacks for the order: %d, want 0 once the dispute is prevented", len(list))
	}
	if n := h.count(`SELECT count(*) FROM reconciliation_exception WHERE stripe_object_id = $1`, dispute); n != 0 {
		t.Errorf("%d reconciliation exceptions for a prevented dispute, want 0: nothing was lost", n)
	}
	h.assertLedgerZeroSum(order)
}

// An event whose effect fails is rolled back whole, kept unprocessed and
// retried after a backoff that doubles from a minute; the eighth failure
// sets it aside for a person and pages on-call in the same transaction
// ("P-17 — Webhooks, idempotency and reconciliation", processing step 3). A dead letter is not retried by the worker.
func TestWebhookWorker_AFailingEventBacksOffThenIsDeadLettered(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	broken := h.id("evt_broken")
	// Signed and stored, but its payment intent has no id: the handler fails.
	h.send(broken, "payment_intent.succeeded", time.Now(), map[string]any{"object": "payment_intent", "status": "succeeded"})
	h.process()
	r := h.stored(broken)
	if r.Processed || r.DeadLettered || r.Attempts != 1 || !strings.Contains(r.LastError, "no payment intent id") {
		t.Fatalf("after one failure: %+v; want unprocessed, attempt 1, the error kept", r)
	}
	if r.Deadline == nil || time.Until(*r.Deadline) < 50*time.Second || time.Until(*r.Deadline) > 70*time.Second {
		t.Errorf("first retry at %v, want about a minute from now", r.Deadline)
	}

	if _, err := h.pool.Exec(ctx, `UPDATE webhook_event SET attempts = $2, deadline_at = now() WHERE id = $1`,
		r.ID, webhookMaxAttempts-1); err != nil {
		t.Fatal(err)
	}
	if _, _, err := h.worker.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	r = h.stored(broken)
	if r.Processed || !r.DeadLettered || r.Deadline != nil || r.Attempts != webhookMaxAttempts {
		t.Fatalf("after the eighth failure: %+v; want dead-lettered, off the clock, %d attempts", r, webhookMaxAttempts)
	}
	if got := h.opsAlerts(r.ID); !slices.Equal(got, []string{"webhook_dead_letter"}) {
		t.Errorf("ops alerts about the event: %v, want one webhook_dead_letter", got)
	}
	if _, _, err := h.worker.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if again := h.stored(broken); again.Attempts != webhookMaxAttempts {
		t.Errorf("the worker retried a dead letter: %d attempts", again.Attempts)
	}
}

// A partner's payout account, the transfer to it and the bank payout each
// move their row once (#249, #301): an older account snapshot never undoes a
// newer one, a duplicated transfer moves the payout to TRANSFERRED once, and a
// bank payout the bank returned stays failed when Stripe's earlier "paid"
// arrives after it, its payout back to TRANSFERRED for the next run to retry.
func TestWebhookWorker_ConnectTransferAndPayoutEventsMoveTheirRowsOnce(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	acct, tr, po := h.id("acct"), h.id("tr"), h.id("po")
	t.Cleanup(func() {
		_, _ = h.pool.Exec(ctx, `DELETE FROM reconciliation_exception WHERE stripe_object_id = ANY($1)`, []string{tr, po})
	})
	rider := h.seedRider(acct, false)
	t0 := time.Now().Add(-10 * time.Minute)
	account := func(payouts bool, due []string) map[string]any {
		return map[string]any{"id": acct, "object": "account", "charges_enabled": false, "payouts_enabled": payouts,
			"details_submitted": payouts, "requirements": map[string]any{"currently_due": due}}
	}
	h.sendFrom(acct, h.id("evt_acct_new"), "account.updated", t0.Add(2*time.Minute), account(true, []string{}))
	h.process()
	h.sendFrom(acct, h.id("evt_acct_old"), "account.updated", t0.Add(time.Minute), account(false, []string{"external_account"}))
	h.process()
	if got := h.text(`SELECT payouts_enabled::text FROM connect_account WHERE stripe_account_id = $1`, acct); got != "true" {
		t.Fatalf("payouts_enabled = %s after a newer and then an older snapshot, want true", got)
	}

	// The rider is owed $12.00, and the weekly run makes their payout.
	payout := h.seedPayout(rider, 1200)
	transfer := map[string]any{"id": tr, "object": "transfer", "amount": 1200, "currency": "cad", "destination": acct,
		"metadata": map[string]any{"payout_id": payout}}
	h.send(h.id("evt_tr"), "transfer.created", t0.Add(3*time.Minute), transfer)
	h.send(h.id("evt_tr"), "transfer.created", t0.Add(3*time.Minute), transfer)
	h.process()
	if got := h.text(`SELECT state::text || '/' || coalesce(stripe_transfer_id, '') FROM payout WHERE id = $1`, payout); got != "TRANSFERRED/"+tr {
		t.Errorf("payout after its transfer: %s, want TRANSFERRED/%s", got, tr)
	}

	// The run records its bank payout attempt before it asks Stripe.
	if _, err := h.pool.Exec(ctx, `INSERT INTO payout_bank_attempt (payout_id, attempt, amount_cents) VALUES ($1, 1, 1200)`, payout); err != nil {
		t.Fatal(err)
	}
	bankPayout := func(status string) map[string]any {
		return map[string]any{"id": po, "object": "payout", "amount": 1200, "currency": "cad", "status": status,
			"failure_code": "account_closed", "metadata": map[string]any{"payout_id": payout, "attempt": "1"}}
	}
	h.sendFrom(acct, h.id("evt_po_failed"), "payout.failed", t0.Add(5*time.Minute), bankPayout("failed"))
	h.process()
	h.sendFrom(acct, h.id("evt_po_paid"), "payout.paid", t0.Add(4*time.Minute), bankPayout("paid"))
	h.process()
	if got := h.text(`SELECT state::text || '/' || coalesce(stripe_payout_id, '') FROM payout WHERE id = $1`, payout); got != "TRANSFERRED/" {
		t.Errorf("payout after the bank returned it: %s, want TRANSFERRED/ (no bank payout on its way)", got)
	}
	if got := h.text(`SELECT state || '/' || stripe_payout_id FROM payout_bank_attempt WHERE payout_id = $1`, payout); got != "FAILED/"+po {
		t.Errorf("bank payout attempt after the bank returned it: %s, want FAILED/%s", got, po)
	}
	if n := h.count(`SELECT count(*) FROM reconciliation_exception
		WHERE kind = 'payout_failed' AND stripe_object_id = $1 AND payout_id = $2 AND resolved_at IS NULL`, po, payout); n != 1 {
		t.Errorf("%d open payout_failed exceptions, want 1", n)
	}
	var trail []string
	rows, err := h.pool.Query(ctx, `SELECT action FROM audit_event WHERE subject_type = 'payout' AND subject_id = $1 ORDER BY day, seq`, payout)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			t.Fatal(err)
		}
		trail = append(trail, a)
	}
	// payout.created is the payout run's own audit row, written when the payout is made.
	if want := []string{"payout.created", "payment.payout_transferred", "payment.bank_payout_failed"}; !slices.Equal(trail, want) {
		t.Errorf("payout audit trail %v, want %v", trail, want)
	}
	h.assertLedgerZeroSum()
}

// An event changes only the row it is genuinely about. Metadata (a
// payout_id, a refund_id) names a row but proves nothing, since anyone with
// API access to the object can set it; the row is accepted only when the
// Stripe ids this database recorded for it match the event: the transfer's
// destination, the account a bank payout or account update came from, the
// payment a refund is against. Anything else changes nothing and pages
// on-call. So does a payment event from a connected account, which is never
// about one of the platform's payments.
func TestWebhookWorker_AnEventIsAppliedOnlyToTheRowsItIsAbout(t *testing.T) {
	h := newWebhookHarness(t)
	ctx := context.Background()
	victimAcct, otherAcct, unknownAcct := h.id("acct_victim"), h.id("acct_other"), h.id("acct_unknown")
	victim := h.seedRider(victimAcct, true)
	h.seedRider(otherAcct, true)
	payout := h.seedPayout(victim, 1500)
	t0 := time.Now().Add(-10 * time.Minute)
	refused := func(eventID string) {
		t.Helper()
		if r := h.stored(eventID); !r.Processed {
			t.Errorf("%s was not recorded as processed: %+v", eventID, r)
		}
		if got := h.opsAlerts(eventID); !slices.Equal(got, []string{"webhook_refused"}) {
			t.Errorf("ops alerts about %s: %v, want one webhook_refused", eventID, got)
		}
	}

	// Another rider's account, pointed at the victim's payout by metadata.
	toOther := h.id("evt_tr_other")
	h.send(toOther, "transfer.created", t0, map[string]any{"id": h.id("tr_other"), "object": "transfer",
		"amount": 1500, "currency": "cad", "destination": otherAcct, "metadata": map[string]any{"payout_id": payout}})
	fromOther := h.id("evt_po_other")
	h.sendFrom(otherAcct, fromOther, "payout.paid", t0, map[string]any{"id": h.id("po_other"), "object": "payout",
		"amount": 1500, "currency": "cad", "status": "paid", "metadata": map[string]any{"payout_id": payout}})
	h.process()
	if got := h.text(`SELECT state::text || '/' || coalesce(stripe_transfer_id, '-') || '/' || coalesce(stripe_payout_id, '-')
		FROM payout WHERE id = $1`, payout); got != "READY/-/-" {
		t.Errorf("the victim's payout after events naming it from another account: %s, want READY/-/-", got)
	}
	refused(toOther)
	refused(fromOther)

	// Account updates: one sent by another account about the victim's, and
	// one about an account that is no one's.
	about := func(id string) map[string]any {
		return map[string]any{"id": id, "object": "account", "payouts_enabled": false, "details_submitted": false,
			"requirements": map[string]any{"currently_due": []string{"external_account"}}}
	}
	mismatched, unknown := h.id("evt_acct_mismatched"), h.id("evt_acct_unknown")
	h.sendFrom(otherAcct, mismatched, "account.updated", t0, about(victimAcct))
	h.sendFrom(unknownAcct, unknown, "account.updated", t0, about(unknownAcct))
	h.process()
	if got := h.text(`SELECT payouts_enabled::text FROM connect_account WHERE stripe_account_id = $1`, victimAcct); got != "true" {
		t.Errorf("the victim's payouts_enabled = %s after another account's update, want true", got)
	}
	if n := h.count(`SELECT count(*) FROM connect_account WHERE stripe_account_id = $1`, unknownAcct); n != 0 {
		t.Errorf("an update about an unknown account created %d rows", n)
	}
	refused(mismatched)
	refused(unknown)

	// A refund on another payment, pointed at this order's refund by
	// metadata; and a payment event from a connected account naming this
	// order's payment.
	pi := h.id("pi_victim")
	order := seedOrderWithIntent(t, h.pool, pi, "COMPLETED", "REQUIRES_CAPTURE")
	h.send(h.id("evt_victim_cap"), "payment_intent.succeeded", t0, piObject(pi, "succeeded", 3919))
	h.process()
	var refund string
	if err := h.pool.QueryRow(ctx, `
		INSERT INTO refund (order_id, payment_intent_id, kind, reason_code, amount_cents, state, requested_by,
		                    approved_by, deadline_at, deadline_action)
		SELECT o.id, p.id, 'FULL', 'PLATFORM_ERROR', 3919, 'AUTHORISED', o.account_id,
		       o.account_id, now() + interval '2 minutes', 'submit_refund_to_stripe'
		  FROM "order" o JOIN payment_intent p ON p.order_id = o.id WHERE o.id = $1
		RETURNING id::text`, order).Scan(&refund); err != nil {
		t.Fatalf("seed refund: %v", err)
	}
	t.Cleanup(func() { cleanupRefund(t, h.pool, refund) })
	elsewhere := h.id("evt_re_elsewhere")
	h.send(elsewhere, "refund.updated", t0.Add(time.Minute), map[string]any{"id": h.id("re_elsewhere"), "object": "refund",
		"amount": 3919, "currency": "cad", "status": "succeeded", "payment_intent": h.id("pi_someone_else"),
		"metadata": map[string]any{"refund_id": refund}})
	fromConnected := h.id("evt_pi_connected")
	h.sendFrom(otherAcct, fromConnected, "payment_intent.canceled", t0.Add(time.Minute), piObject(pi, "canceled", 0))
	h.process()
	if got := h.text(`SELECT state::text || '/' || coalesce(stripe_refund_id, '-') FROM refund WHERE id = $1`, refund); got != "AUTHORISED/-" {
		t.Errorf("this order's refund after a refund of another payment named it: %s, want AUTHORISED/-", got)
	}
	if got := intentState(t, h.pool, pi); got != "SUCCEEDED" {
		t.Errorf("payment is %s after a connected account's event named it, want SUCCEEDED", got)
	}
	refused(elsewhere)
	refused(fromConnected)
	h.assertLedgerZeroSum(order)
}
