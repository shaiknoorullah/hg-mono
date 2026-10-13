package conformance

// Refund review and chargebacks (#172): listRefundsAdmin, approveRefund,
// declineRefund, listChargebacks, getChargeback and addChargebackEvidenceNote,
// driven against a live payments module (local fake Stripe, the notification
// outbox with its delivery job stubbed) and validated against the contract.
// Every row a case writes is removed when it ends, so the shared captured
// fixture order is left as it was found.

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// noRiver stands in for River's insert: the notification row is real, its
// delivery job is not needed to validate a response.
type noRiver struct{}

func (noRiver) InsertTx(context.Context, pgx.Tx, river.JobArgs, *river.InsertOpts) (*rivertype.JobInsertResult, error) {
	return &rivertype.JobInsertResult{Job: &rivertype.JobRow{}}, nil
}

func newRefundReviewHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})
	cfg := &config.Config{Env: config.EnvLocal}
	svc := payments.NewService(payments.NewRepo(pool), payments.NewFakeStripe(), cfg.Stripe, slog.Default()).
		WithOutbox(notify.NewEnqueuer(notify.NewRepo(), noRiver{}))
	payments.Routes(router, payments.NewHandler(svc, cfg))
	if err := router.Verify(); err != nil {
		t.Fatalf("payments router policy verify: %v", err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: LoadSpec(t), covered: map[string]bool{}}
}

// customerRequest asks for a refund as the fixture order's customer and
// removes it, with anything it led to, when the case ends.
func customerRequest(t *testing.T, h *Harness, key string, body map[string]any) string {
	t.Helper()
	body["order_id"] = fxOrderID
	_, resp := h.Do(t, Request{Method: "POST", Path: "/v1/refunds", AccountID: fxCustomerID,
		Roles: []string{roleCustomer}, IdemKey: key, Body: body})
	defer resp.Body.Close()
	id := extractRefundID(t, resp)
	if id == "" {
		t.Fatalf("customer refund request: status %d", resp.StatusCode)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = h.Pool.Exec(ctx, `DELETE FROM notification WHERE dedupe_key = $1`, "refund_declined:"+id)
		cleanupRefundByID(t, h.Pool, id)
	})
	return id
}

func TestConformance_RefundReview(t *testing.T) {
	pool := openPool(t)
	h := newRefundReviewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	run := fmt.Sprint(time.Now().UnixNano())
	staff := func(rq Request) Request {
		rq.AccountID, rq.Roles = fxSuperAdminID, []string{"SUPPORT_AGENT"}
		return rq
	}

	t.Run("listRefundsAdmin", func(t *testing.T) {
		customerRequest(t, h, "conf-review-list-"+run, map[string]any{
			"kind": "PARTIAL_ITEMS", "reason_code": "ITEM_MISSING",
			"lines": []map[string]any{{"order_line_no": 1, "quantity": 1}}})
		h.CheckResponse(t, staff(Request{Method: "GET", Path: "/v1/admin/refunds",
			Query: "order_id=" + fxOrderID}), http.StatusOK)
		h.CheckResponse(t, staff(Request{Method: "GET", Path: "/v1/admin/refunds",
			Query: "state=REQUESTED,PENDING_APPROVAL&reason_code=ITEM_MISSING&min_amount_cents=1&limit=1"}), http.StatusOK)
	})

	t.Run("approveRefund", func(t *testing.T) {
		id := customerRequest(t, h, "conf-review-approve-"+run, map[string]any{
			"kind": "PARTIAL_ITEMS", "reason_code": "ITEM_MISSING",
			"lines": []map[string]any{{"order_line_no": 1, "quantity": 1}}})
		rq := staff(Request{Method: "POST", Path: "/v1/admin/refunds/" + id + "/approve",
			IdemKey: "conf-approve-" + run, Body: map[string]any{"reason_text": "the photo shows the missing item"}})
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, rq)); err != nil {
			t.Fatalf("approveRefund body is not contract-valid (fix the test, not the server): %v", err)
		}
		h.CheckResponse(t, rq, http.StatusOK)
		// The same click again replays the first answer.
		_, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK || resp.Header.Get("Idempotency-Replayed") != "true" {
			t.Errorf("retried approval: %d replayed=%q; want 200 replayed", resp.StatusCode, resp.Header.Get("Idempotency-Replayed"))
		}
	})

	t.Run("declineRefund", func(t *testing.T) {
		id := customerRequest(t, h, "conf-review-decline-"+run, map[string]any{
			"kind": "FEES_ONLY", "reason_code": "LATE_DELIVERY"})
		rq := staff(Request{Method: "POST", Path: "/v1/admin/refunds/" + id + "/decline",
			IdemKey: "conf-decline-" + run, Body: map[string]any{
				"reason_text":      "the delivery was on time per the trace",
				"customer_message": "Your order arrived within the time we gave you.",
			}})
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, rq)); err != nil {
			t.Fatalf("declineRefund body is not contract-valid (fix the test, not the server): %v", err)
		}
		h.CheckResponse(t, rq, http.StatusOK)
	})

	t.Run("chargebacks", func(t *testing.T) {
		ctx := context.Background()
		var cb string
		if err := pool.QueryRow(ctx, `
			INSERT INTO chargeback (order_id, stripe_dispute_id, amount_cents, reason, state, evidence_due_at,
			                        deadline_at, deadline_action)
			VALUES ($1, $2, 1500, 'product_not_received', 'needs_response', now() + interval '5 days',
			        now() + interval '5 days', 'submit_dispute_evidence')
			RETURNING id::text`, fxOrderID, "dp_conf_"+run).Scan(&cb); err != nil {
			t.Fatalf("seed a chargeback: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(ctx, `DELETE FROM chargeback_evidence_note WHERE chargeback_id = $1`, cb)
			_, _ = pool.Exec(ctx, `DELETE FROM chargeback WHERE id = $1`, cb)
		})
		note := staff(Request{Method: "POST", Path: "/v1/admin/chargebacks/" + cb + "/evidence-notes",
			IdemKey: "conf-cb-note-" + run, Body: map[string]any{"body": "Proof of delivery photo at the door, 19:42."}})
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, note)); err != nil {
			t.Fatalf("addChargebackEvidenceNote body is not contract-valid (fix the test, not the server): %v", err)
		}
		h.CheckResponse(t, note, http.StatusCreated)
		h.CheckResponse(t, staff(Request{Method: "GET", Path: "/v1/admin/chargebacks", Query: "open=true&order_id=" + fxOrderID}), http.StatusOK)
		h.CheckResponse(t, staff(Request{Method: "GET", Path: "/v1/admin/chargebacks/" + cb}), http.StatusOK)
	})
}
