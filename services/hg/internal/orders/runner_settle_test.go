package orders

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/conformance"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// A delivered order nobody disputes is settled by its deadline: COMPLETED,
// with its receipt, once (https://github.com/shaiknoorullah/hg-mono/issues/511).
// The tests share one fresh database (a throwaway container in CI).
func TestIntegrationSettle(t *testing.T) {
	dsn := testseed.FreshDatabase(t, "hg_orders_settle")
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	t.Run("a delivered order past its settle deadline completes once with its receipt", func(t *testing.T) {
		st := NewStore(pool).WithPlatformTaxInfo("", "HalalGoes Inc.")
		runner := NewDeadlineRunner(st, nil, testLogger(), "test-settle")
		orderID, _, accountID := buildCreatedOrder(t, pool, st)
		seedCapturedIntent(t, pool, orderID)
		makeDelivered(t, pool, orderID)

		c := mustClaim(t, runner, orderID)
		if err := runner.fire(ctx, c); err != nil {
			t.Fatalf("settle: %v", err)
		}
		// The same claim fired again, as a second replica or a retry after a
		// crash would, finds a COMPLETED order and changes nothing.
		if err := runner.fire(ctx, c); err != nil {
			t.Fatalf("second settle: %v", err)
		}
		if _, ok, err := claimOne(runner, orderID); err != nil || ok {
			t.Fatalf("a completed order is claimable again (ok=%v, err=%v)", ok, err)
		}

		var state string
		var completed, audits int
		var snapshot []byte
		if err := pool.QueryRow(ctx, `
			SELECT o.state::text, o.receipt_snapshot,
			       (SELECT count(*) FROM order_transition WHERE order_id = o.id AND to_state = 'COMPLETED'),
			       (SELECT count(*) FROM deadline_audit WHERE subject_type = 'order' AND subject_id = o.id AND action = 'SETTLE')
			  FROM "order" o WHERE o.id = $1`, orderID).Scan(&state, &snapshot, &completed, &audits); err != nil {
			t.Fatalf("read the settled order: %v", err)
		}
		if state != string(machine.StateCompleted) || completed != 1 || audits != 1 {
			t.Fatalf("state %s, %d COMPLETED transitions, %d SETTLE audits; want COMPLETED, 1, 1", state, completed, audits)
		}
		if snapshot == nil {
			t.Fatal("COMPLETED without a receipt_snapshot")
		}

		// Settling moves no money: the capture and the rider's delivery
		// posted it (docs/spec/01-platform.md, P-13).
		var batches int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger_batch WHERE order_id = $1`, orderID).Scan(&batches); err != nil {
			t.Fatalf("count ledger batches: %v", err)
		}
		if batches != 0 {
			t.Errorf("settle posted %d ledger batches, want none", batches)
		}

		// What is stored is a contract Receipt, before the handler touches it.
		spec := conformance.LoadSpec(t)
		var stored any
		if err := json.Unmarshal(snapshot, &stored); err != nil {
			t.Fatalf("decode receipt_snapshot: %v", err)
		}
		if err := spec.Doc.Components.Schemas["Receipt"].Value.VisitJSON(stored); err != nil {
			t.Errorf("stored receipt_snapshot is not a contract Receipt: %v\n%s", err, snapshot)
		}

		// And the endpoint serves it: 200, valid against getOrderReceipt.
		rec, req := getReceipt(st, accountID, orderID)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET receipt = %d %s, want 200", rec.Code, rec.Body)
		}
		if _, err := conformance.ValidateResponse(t, spec, req, rec.Result()); err != nil {
			t.Errorf("%v\n%s", err, rec.Body)
		}

		// The receipt is the order's frozen money, never re-priced.
		var body struct {
			Data receiptSnapshotDTO `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode receipt: %v", err)
		}
		r := body.Data
		var total, captured int64
		var code string
		if err := pool.QueryRow(ctx, `
			SELECT o.total_cents, o.code, pi.amount_captured_cents
			  FROM "order" o JOIN payment_intent pi ON pi.order_id = o.id AND pi.kind = 'ORDER'
			 WHERE o.id = $1`, orderID).Scan(&total, &code, &captured); err != nil {
			t.Fatalf("read order money: %v", err)
		}
		m := r.Money
		var tax int64
		for _, tl := range m.TaxLines {
			tax += tl.AmountCents
			if tl.Rate == "0" || tl.Rate == "" {
				t.Errorf("tax line %s printed rate %q", tl.StatutoryLabel, tl.Rate)
			}
		}
		if m.TotalCents != total || r.Payment.AmountChargedCents != captured || r.OrderCode != code ||
			tax != m.TaxTotalCents || len(r.Lines) != 1 || r.DeliveryAddress == nil ||
			m.SubtotalCents-m.DiscountCents+m.DeliveryFeeCents+m.ServiceFeeCents+m.TaxTotalCents+m.TipCents != m.TotalCents {
			t.Errorf("receipt does not match the order: %+v", r)
		}
		if r.PlatformLegalName != "HalalGoes Inc." || r.PlatformTaxRegistrationNumber != nil {
			t.Errorf("platform name %q, registration %v; want the configured name and no number while O-01 is open",
				r.PlatformLegalName, r.PlatformTaxRegistrationNumber)
		}

		// Write-once: the trigger refuses to replace an issued receipt.
		_, err := pool.Exec(ctx, `UPDATE "order" SET receipt_snapshot = '{}'::jsonb WHERE id = $1`, orderID)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("second receipt_snapshot write: err = %v, want the write-once check_violation", err)
		}
		// Nor does a later settle rewrite it.
		var again []byte
		if err := pool.QueryRow(ctx, `SELECT receipt_snapshot FROM "order" WHERE id = $1`, orderID).Scan(&again); err != nil {
			t.Fatalf("re-read receipt: %v", err)
		}
		if string(again) != string(snapshot) {
			t.Errorf("receipt changed after it was issued")
		}
	})

	t.Run("an order disputed before its settle deadline fires is not completed", func(t *testing.T) {
		st := NewStore(pool)
		runner := NewDeadlineRunner(st, nil, testLogger(), "test-settle-disputed")
		orderID, _, accountID := buildCreatedOrder(t, pool, st)
		seedCapturedIntent(t, pool, orderID)
		makeDelivered(t, pool, orderID)

		// Claimed while DELIVERED, then the customer opens a dispute before
		// the action runs.
		c := mustClaim(t, runner, orderID)
		if err := st.Transition(ctx, TransitionRequest{
			OrderID: orderID, To: machine.StateDisputed, Actor: machine.ActorCustomer,
			ActorAccountID: accountID, Reason: "missing item",
		}); err != nil {
			t.Fatalf("dispute the delivered order: %v", err)
		}
		if err := runner.fire(ctx, c); err != nil {
			t.Fatalf("settle: %v", err)
		}

		var state string
		var hasReceipt bool
		if err := pool.QueryRow(ctx, `SELECT state::text, receipt_snapshot IS NOT NULL FROM "order" WHERE id = $1`,
			orderID).Scan(&state, &hasReceipt); err != nil {
			t.Fatalf("read order: %v", err)
		}
		if state != string(machine.StateDisputed) || hasReceipt {
			t.Fatalf("state %s, receipt written %v; want DISPUTED and no receipt", state, hasReceipt)
		}
		if rec, _ := getReceipt(st, accountID, orderID); rec.Code != http.StatusConflict {
			t.Errorf("GET receipt of a disputed order = %d, want 409 RECEIPT_NOT_READY", rec.Code)
		}
	})

	t.Run("an order whose receipt cannot be issued stays DELIVERED and is re-armed", func(t *testing.T) {
		st := NewStore(pool)
		runner := NewDeadlineRunner(st, nil, testLogger(), "test-settle-unpaid")
		orderID, _, _ := buildCreatedOrder(t, pool, st)
		makeDelivered(t, pool, orderID)

		if err := runner.fire(ctx, mustClaim(t, runner, orderID)); err == nil {
			t.Fatal("settled an order with no payment intent")
		}
		// No payment intent, so no charge to print: nothing commits but the
		// re-armed deadline and its audit.
		var state, outcome string
		var hasReceipt, rearmed bool
		var escalations int
		if err := pool.QueryRow(ctx, `
			SELECT o.state::text, o.receipt_snapshot IS NOT NULL, o.deadline_at > now(), o.deadline_escalations,
			       (SELECT outcome FROM deadline_audit WHERE subject_type = 'order' AND subject_id = o.id AND action = 'SETTLE')
			  FROM "order" o WHERE o.id = $1`, orderID).Scan(&state, &hasReceipt, &rearmed, &escalations, &outcome); err != nil {
			t.Fatalf("read order: %v", err)
		}
		if state != string(machine.StateDelivered) || hasReceipt || !rearmed || escalations != 1 || outcome != "RE_ARMED" {
			t.Fatalf("state %s, receipt %v, re-armed %v, escalations %d, audit %q; want DELIVERED, none, true, 1, RE_ARMED",
				state, hasReceipt, rearmed, escalations, outcome)
		}
	})
}

// makeDelivered puts an order in DELIVERED, delivered a few minutes ago, with
// its settle deadline just passed.
func makeDelivered(t *testing.T, pool *pgxpool.Pool, orderID string) {
	t.Helper()
	makeDue(t, pool, orderID, machine.StateDelivered, machine.ActionSettle, 0)
	if _, err := pool.Exec(context.Background(),
		`UPDATE "order" SET delivered_at = now() - interval '3 minutes' WHERE id = $1`, orderID); err != nil {
		t.Fatalf("stamp delivered_at: %v", err)
	}
}

// seedCapturedIntent records the order's payment as captured in full, as the
// restaurant's acceptance leaves it.
func seedCapturedIntent(t *testing.T, pool *pgxpool.Pool, orderID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO payment_intent (
			order_id, kind, stripe_payment_intent_id, state,
			amount_authorized_cents, amount_captured_cents, currency,
			card_brand, card_last4, authorized_at, captured_at
		)
		SELECT id, 'ORDER', 'pi_test_'||substr(md5(random()::text),1,12), 'SUCCEEDED',
		       total_cents, total_cents, currency, 'visa', '4242', now(), now()
		  FROM "order" WHERE id = $1`, orderID); err != nil {
		t.Fatalf("seed payment_intent: %v", err)
	}
}

// getReceipt calls GET /v1/orders/{orderId}/receipt as the order's customer.
func getReceipt(st *Store, accountID, orderID string) (*httptest.ResponseRecorder, *http.Request) {
	r := chi.NewRouter()
	r.Get("/v1/orders/{orderId}/receipt", NewHandler(st, nil, slog.Default()).GetOrderReceipt)
	req := httptest.NewRequest(http.MethodGet, "/v1/orders/"+orderID+"/receipt", nil)
	req = req.WithContext(httpx.WithPrincipalForTest(req.Context(), httpx.Principal{
		AccountID: accountID, Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"otp"},
	}))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec, req
}
