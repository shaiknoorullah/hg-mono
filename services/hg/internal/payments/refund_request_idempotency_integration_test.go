package payments

import (
	"context"
	"encoding/json"
	"testing"
)

// A customer's refund request retried with the same Idempotency-Key gets the
// first answer back and leaves one request, not two for staff to approve
// (https://github.com/shaiknoorullah/hg-mono/issues/363). Before, a FEES_ONLY
// or PARTIAL_ITEMS retry inserted a second REQUESTED refund for the same fees.
func TestRefundRequest_ARetryWithTheSameKeyReplaysTheFirstAnswer(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	order, _ := h.capturedOrder("request-retry", 8000)
	customer := h.text(`SELECT account_id::text FROM "order" WHERE id = $1`, order)
	in := RefundInput{OrderID: order, Kind: RefundFeesOnly, ReasonCode: "LATE_DELIVERY"}
	key := &Idempotency{AccountID: customer, Method: "POST", PathTemplate: "/v1/refunds",
		Key: "refund-request-" + h.run, RequestHash: []byte("the same request")}

	first, err := h.svc.RequestRefundOnce(ctx, in, customer, key)
	if err != nil || first.Status != 201 || first.Replayed {
		t.Fatalf("request: %+v err=%v; want 201", first, err)
	}
	again, err := h.svc.RequestRefundOnce(ctx, in, customer, key)
	want, _ := json.Marshal(map[string]any{"data": first.Data})
	if err != nil || !again.Replayed || again.Status != 201 || string(again.Body) != string(want) {
		t.Fatalf("retried request: %+v err=%v; want the first answer replayed", again, err)
	}
	if n := h.count(`SELECT count(*) FROM refund WHERE order_id = $1`, order); n != 1 {
		t.Fatalf("%d refund requests after one request and its retry, want 1", n)
	}

	key.RequestHash = []byte("a different request")
	_, err = h.svc.RequestRefundOnce(ctx, in, customer, key)
	wantDomainErr(t, err, "IDEMPOTENCY_KEY_REUSE")
}
