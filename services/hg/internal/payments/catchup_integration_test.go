package payments

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// The catch-up after a simulated outage, against the real database and the
// stubbed Stripe client. Two payments moved on Stripe while this database
// was not looking:
//
//   - one was captured, and its payment_intent.succeeded webhook was lost;
//   - one was cancelled, and no event for it falls in the replay window, so
//     only reading it back from Stripe can find it.
//
// Two more need a person, and the catch-up must list them and touch nothing:
// an event for a payment this database never saw (it was created after the
// backup), and a payment this database voided that Stripe reports captured.
//
// Two are routine and must raise no exception: a decline event that arrives
// after the order's deadline voided the payment (a late event, not a
// conflict), and a dispute on the captured payment, which opens its
// chargeback through the same handler the webhook worker uses (#249).
//
// The first run must apply each of these exactly once; the second must change
// nothing and still list both payments that need a person, because nothing
// has resolved them. Skips without HG_TEST_POSTGRES_DSN (see testPool).
func TestIntegration_CatchUp_AppliesMissedEventsOnceAndARerunChangesNothing(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	run := strconv.FormatInt(time.Now().UnixNano(), 36)
	capturedPI, canceledPI, ghostPI := "pi_cu_cap_"+run, "pi_cu_void_"+run, "pi_cu_ghost_"+run
	voidedHerePI, declinedPI := "pi_cu_voided_here_"+run, "pi_cu_declined_"+run
	capturedEvt, ghostEvt := "evt_cu_cap_"+run, "evt_cu_ghost_"+run
	declinedEvt, disputeEvt := "evt_cu_declined_"+run, "evt_cu_dispute_"+run
	pis := []string{capturedPI, canceledPI, voidedHerePI, declinedPI, ghostPI}
	disputeID := "dp_cu_" + run
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM webhook_event WHERE stripe_event_id = ANY($1)`,
			[]string{capturedEvt, ghostEvt, declinedEvt, disputeEvt})
		_, _ = pool.Exec(c, `DELETE FROM chargeback WHERE stripe_dispute_id = $1`, disputeID)
		_, _ = pool.Exec(c, `DELETE FROM reconciliation_exception WHERE stripe_object_id = ANY($1)`, pis)
		_, _ = pool.Exec(c, `DELETE FROM payment_intent WHERE stripe_payment_intent_id = ANY($1)`, pis)
	})
	capturedOrder := seedAuthorisedOrder(t, pool, capturedPI)
	seedAuthorisedOrder(t, pool, canceledPI)
	voidedHereOrder := seedAuthorisedOrder(t, pool, voidedHerePI)
	seedAuthorisedOrder(t, pool, declinedPI)
	for _, pi := range []string{voidedHerePI, declinedPI} {
		if _, err := pool.Exec(ctx, `
			UPDATE payment_intent SET state = 'CANCELED', canceled_at = now(), deadline_at = NULL, deadline_action = NULL
			 WHERE stripe_payment_intent_id = $1`, pi); err != nil {
			t.Fatalf("void %s: %v", pi, err)
		}
	}

	since := time.Now().Add(-time.Hour)
	events := []StripeEvent{
		paymentIntentEvent(capturedEvt, "payment_intent.succeeded", capturedPI, 3919, since.Add(time.Minute)),
		paymentIntentEvent(ghostEvt, "payment_intent.amount_capturable_updated", ghostPI, 0, since.Add(2*time.Minute)),
		paymentIntentEvent(declinedEvt, "payment_intent.payment_failed", declinedPI, 0, since.Add(3*time.Minute)),
		listedEvent(disputeEvt, "charge.dispute.created", since.Add(4*time.Minute), map[string]any{
			"id": disputeID, "object": "dispute", "amount": 3919, "payment_intent": capturedPI,
			"reason": "fraudulent", "status": "needs_response",
		}),
	}
	onStripe := map[string]*StripeIntent{
		capturedPI:   {ID: capturedPI, Status: "succeeded", AmountReceivedCents: 3919},
		canceledPI:   {ID: canceledPI, Status: "canceled"},
		voidedHerePI: {ID: voidedHerePI, Status: "succeeded", AmountReceivedCents: 3919},
		declinedPI:   {ID: declinedPI, Status: "canceled"},
	}
	mock := &mockStripe{
		ListEventsFn: func(time.Time) ([]StripeEvent, error) { return events, nil },
		GetIntentFn: func(id string) (*StripeIntent, error) {
			if pi, ok := onStripe[id]; ok {
				return pi, nil
			}
			// Rows other tests left in the shared database: not ours to judge.
			return nil, fmt.Errorf("not part of this test: %s", id)
		},
	}
	svc := NewService(NewRepo(pool), mock, config.Stripe{}, nil)

	first, err := svc.CatchUp(ctx, since, false)
	if err != nil {
		t.Fatalf("first catch-up: %v", err)
	}
	if first.EventsNew != 4 {
		t.Errorf("first run stored %d new events, want 4", first.EventsNew)
	}
	if got := intentState(t, pool, capturedPI); got != "SUCCEEDED" {
		t.Errorf("captured payment is %s after the catch-up, want SUCCEEDED", got)
	}
	if got := intentState(t, pool, canceledPI); got != "CANCELED" {
		t.Errorf("cancelled payment is %s after the catch-up, want CANCELED", got)
	}
	if got := intentState(t, pool, voidedHerePI); got != "CANCELED" {
		t.Errorf("the payment voided here is %s after the catch-up, want it left CANCELED for a person", got)
	}
	if got := intentState(t, pool, declinedPI); got != "CANCELED" {
		t.Errorf("the declined-then-voided payment is %s after the catch-up, want CANCELED", got)
	}
	// Exactly these two need a person: no more (a late decline is not a
	// conflict), no fewer.
	wantMismatches := []string{
		ghostPI + ": unknown_intent",
		voidedHerePI + ": settled_conflict (order " + voidedHereOrder + ")",
	}
	if got := ours(first.Mismatches, run); !slices.Equal(got, wantMismatches) {
		t.Errorf("mismatches for a person = %v, want %v", got, wantMismatches)
	}
	if !first.LeftWork() {
		t.Error("a run with mismatches reports no work left, so the command would exit zero")
	}

	second, err := svc.CatchUp(ctx, since, false)
	if err != nil {
		t.Fatalf("second catch-up: %v", err)
	}
	if second.EventsNew != 0 || second.EventsProcessed != 0 || len(second.Transitions) != 0 {
		t.Errorf("second run changed something: %d new events, %d applied, transitions %v",
			second.EventsNew, second.EventsProcessed, second.Transitions)
	}
	// The ghost payment's event was applied on the first run, so only its
	// stored exception can still report it: money taken with no order here
	// must not drop out of the report because the command ran twice.
	if got := ours(second.Mismatches, run); !slices.Equal(got, wantMismatches) {
		t.Errorf("second run's mismatches for a person = %v, want the first run's %v", got, wantMismatches)
	}
	if !second.LeftWork() {
		t.Error("a rerun with unresolved mismatches reports no work left, so the command would exit zero")
	}

	// Rows other suites left in the shared database fail the read-back by
	// design (GetIntentFn); none of this test's own may fail.
	if f := append(ours(first.Failures, run), ours(second.Failures, run)...); len(f) != 0 {
		t.Errorf("failures for this test's events and payments: %v; want none", f)
	}

	// Exactly once, in the database itself: one row per event, each event
	// applied, and one CAPTURE batch however many times the capture was seen.
	// One exception per payment for a person, however many runs saw it.
	var rows, processed int
	if err := pool.QueryRow(ctx, `
		SELECT count(*), count(processed_at) FROM webhook_event WHERE stripe_event_id = ANY($1)`,
		[]string{capturedEvt, ghostEvt, declinedEvt, disputeEvt}).Scan(&rows, &processed); err != nil {
		t.Fatalf("count webhook events: %v", err)
	}
	if rows != 4 || processed != 4 {
		t.Errorf("webhook_event: %d rows, %d applied; want 4 and 4", rows, processed)
	}
	var chargebacks int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM chargeback WHERE stripe_dispute_id = $1 AND order_id = $2 AND outcome IS NULL`,
		disputeID, capturedOrder).Scan(&chargebacks); err != nil {
		t.Fatalf("count chargebacks: %v", err)
	}
	if chargebacks != 1 {
		t.Errorf("the dispute opened %d chargebacks on the captured order, want 1", chargebacks)
	}
	var exceptions int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM reconciliation_exception WHERE stripe_object_id = ANY($1) AND resolved_at IS NULL`,
		pis).Scan(&exceptions); err != nil {
		t.Fatalf("count reconciliation exceptions: %v", err)
	}
	if exceptions != 2 {
		t.Errorf("%d open reconciliation exceptions for this test's payments, want 2", exceptions)
	}
	var batches int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_batch WHERE order_id = $1 AND kind = 'CAPTURE'`,
		capturedOrder).Scan(&batches); err != nil {
		t.Fatalf("count capture batches: %v", err)
	}
	if batches != 1 {
		t.Errorf("captured order has %d CAPTURE batches, want 1", batches)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_batch WHERE order_id = $1`,
		voidedHereOrder).Scan(&batches); err != nil {
		t.Fatalf("count batches for the voided order: %v", err)
	}
	if batches != 0 {
		t.Errorf("the order voided here has %d ledger batches, want none: money was posted against a cancelled authorisation", batches)
	}
}

// ours keeps the report lines about this run's payments: the database is
// shared, and another suite's open exceptions are not this test's to judge.
func ours(lines []string, run string) []string {
	var out []string
	for _, l := range lines {
		if strings.Contains(l, run) {
			out = append(out, l)
		}
	}
	return out
}

// seedAuthorisedOrder adds a delivered order with its card authorised but not
// captured. It goes on a fresh account so no other suite sees it in a list.
// The order and its account stay behind: once a CAPTURE batch is posted the
// append-only ledger holds a reference to the order (as other suites' batches
// do), and the batch balances, so the ledger-wide zero sum still holds.
func seedAuthorisedOrder(t *testing.T, pool *pgxpool.Pool, stripeID string) string {
	t.Helper()
	return seedOrderWithIntent(t, pool, stripeID, "COMPLETED", "REQUIRES_CAPTURE")
}

// seedOrderWithIntent adds a $39.19 order in orderState with its payment
// intent in piState, on a fresh account, with the deadlines the CHECKs ask of
// a state that is not final.
func seedOrderWithIntent(t *testing.T, pool *pgxpool.Pool, stripeID, orderState, piState string) string {
	t.Helper()
	ctx := context.Background()
	orderDeadline := map[string]string{"CREATED": "EXPIRE_PAYMENT", "RESTAURANT_PENDING": "RESTAURANT_TIMEOUT",
		"PREPARING": "PREP_OVERDUE"}[orderState]
	var accountID, orderID string
	// The whole random UUID: a version 7 UUID's first characters are its
	// millisecond, which two seeds in a row share (#304).
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('catchup-'||gen_random_uuid()::text||'@test.local', 'ACTIVE') RETURNING id`,
	).Scan(&accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		WITH q AS (
		  INSERT INTO quote (account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
		                     pricing_config_id, tax_jurisdiction_code, subtotal_cents, delivery_fee_cents,
		                     service_fee_cents, tax_total_cents, tip_cents, total_cents,
		                     input_hash, state_hash, expires_at)
		  SELECT $1, '66666666-6666-4666-8666-666666666666', $2, '22222222-2222-4222-8222-222222222222',
		         'DELIVERY', pc.id, 'CA-ON', 3000, 419, 0, 0, 500, 3919,
		         digest($3, 'sha256'), digest($3, 'sha256'), now() + interval '10 minutes'
		    FROM pricing_config pc WHERE pc.version = 1
		  RETURNING id)
		INSERT INTO "order" (code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
		                     state, subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                     restaurant_net_cents, delivered_at, deadline_at, deadline_action)
		SELECT 'HG-'||upper(substr(md5($3),1,8)), q.id, $1, $2, '22222222-2222-4222-8222-222222222222',
		       'DELIVERY', $4::order_state, 3000, 419, 500, 3919, 3000,
		       CASE WHEN $4 = 'COMPLETED' THEN now() END,
		       CASE WHEN $5 <> '' THEN now() + interval '15 minutes' END, nullif($5, '')
		  FROM q RETURNING id`,
		accountID, fxRestaurant, stripeID, orderState, orderDeadline).Scan(&orderID); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO payment_intent (order_id, stripe_payment_intent_id, state, amount_authorized_cents,
		                            authorized_at, deadline_at, deadline_action)
		VALUES ($1, $2, $3::payment_state, 3919,
		        CASE WHEN $3 = 'REQUIRES_CAPTURE' THEN now() END,
		        now() + interval '20 minutes', 'await_capture')`,
		orderID, stripeID, piState); err != nil {
		t.Fatalf("seed payment_intent: %v", err)
	}
	return orderID
}

// paymentIntentEvent is a Stripe event as the events API returns it.
func paymentIntentEvent(id, typ, piID string, amountReceived int64, created time.Time) StripeEvent {
	return listedEvent(id, typ, created, map[string]any{
		"id": piID, "object": "payment_intent", "amount_received": amountReceived,
	})
}

// listedEvent is a Stripe event carrying object, as the events API returns it.
func listedEvent(id, typ string, created time.Time, object map[string]any) StripeEvent {
	raw, _ := json.Marshal(map[string]any{
		"id": id, "object": "event", "type": typ, "created": created.Unix(), "livemode": false,
		"data": map[string]any{"object": object},
	})
	return StripeEvent{ID: id, Type: typ, Created: created.Unix(), RawPayload: raw}
}

func intentState(t *testing.T, pool *pgxpool.Pool, stripeID string) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM payment_intent WHERE stripe_payment_intent_id = $1`, stripeID).Scan(&state); err != nil {
		t.Fatalf("read payment_intent %s: %v", stripeID, err)
	}
	return state
}
