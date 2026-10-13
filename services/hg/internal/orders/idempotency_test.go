package orders

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// A phone that times out on checkout sends POST /v1/orders again with the
// same Idempotency-Key. It must get the first answer back, client secret and
// all, not ACTIVE_ORDER_EXISTS for the order its first attempt made
// (https://github.com/shaiknoorullah/hg-mono/issues/363; the contract's
// createOrder and docs/spec/01-platform.md, "P-37 — Idempotency keys").

type countingGateway struct{ calls map[string]int }

func (g *countingGateway) CreateOrderIntent(_ context.Context, in CreateIntentInput) (CreateIntentResult, error) {
	g.calls[in.OrderID]++
	return CreateIntentResult{ClientSecret: "secret-for-" + in.OrderID}, nil
}

func postOrder(t *testing.T, h *Handler, accountID, key, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/orders", strings.NewReader(body))
	ctx := httpx.WithPrincipalForTest(req.Context(), httpx.Principal{
		AccountID: accountID, Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"otp"},
	})
	req = req.WithContext(httpx.WithIdempotencyKeyForTest(ctx, key))
	rec := httptest.NewRecorder()
	h.CreateOrder(rec, req)
	return rec
}

func TestCreateOrder_ARetryWithTheSameKeyReplaysTheFirstAnswer(t *testing.T) {
	pool := pausePool(t)
	st := NewStore(pool)
	b, _, q := quoted(t, pool, st)
	gw := &countingGateway{calls: map[string]int{}}
	h := NewHandler(st, gw, slog.Default())
	body := `{"quote_id":"` + q.ID + `"}`
	const key = "checkout-retry-key-0001"

	first := postOrder(t, h, b.accountID, key, body)
	if first.Code != http.StatusCreated {
		t.Fatalf("first attempt = %d %s, want 201", first.Code, first.Body)
	}
	var created struct {
		Data struct {
			Order struct {
				ID string `json:"id"`
			} `json:"order"`
			ClientSecret string `json:"client_secret"`
		} `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &created); err != nil || created.Data.ClientSecret == "" {
		t.Fatalf("first answer %s: %v; want an order and a client secret", first.Body, err)
	}

	again := postOrder(t, h, b.accountID, key, body)
	if again.Code != http.StatusCreated || again.Body.String() != first.Body.String() ||
		again.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("retry = %d %s (replayed=%q); want the first answer, byte for byte, marked replayed",
			again.Code, again.Body, again.Header().Get("Idempotency-Replayed"))
	}
	if n := countOrders(t, pool, b.accountID); n != 1 || gw.calls[created.Data.Order.ID] != 1 {
		t.Fatalf("orders = %d, PaymentIntent requests = %d; want one of each", n, gw.calls[created.Data.Order.ID])
	}

	// The same key on a different request is refused, never replayed.
	if status, code := errorCodeKeyed(t, h, b.accountID, key, `{"quote_id":"`+q.ID+`","special_instructions":"x"}`); status != http.StatusConflict || code != "IDEMPOTENCY_KEY_REUSE" {
		t.Errorf("same key, different body = %d %s, want 409 IDEMPOTENCY_KEY_REUSE", status, code)
	}

	// The process died after the order committed and before it answered: the
	// record holds the order but no answer, and its lease has run out. The
	// retry finishes that attempt: same order, same PaymentIntent request
	// (keyed by the order id), no second order.
	if _, err := pool.Exec(context.Background(), `
		UPDATE idempotency_record
		   SET state = 'IN_PROGRESS', response_status = NULL, response_body = NULL, completed_at = NULL,
		       lease_until = now() - interval '1 second'
		 WHERE key = $1`, key); err != nil {
		t.Fatal(err)
	}
	resumed := postOrder(t, h, b.accountID, key, body)
	if resumed.Code != http.StatusCreated || !strings.Contains(resumed.Body.String(), created.Data.Order.ID) {
		t.Fatalf("retry after a crash = %d %s, want 201 for order %s", resumed.Code, resumed.Body, created.Data.Order.ID)
	}
	if n := countOrders(t, pool, b.accountID); n != 1 {
		t.Fatalf("orders after the crash and retry = %d, want 1", n)
	}
}

func errorCodeKeyed(t *testing.T, h *Handler, accountID, key, body string) (int, string) {
	t.Helper()
	rec := postOrder(t, h, accountID, key, body)
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env.Error.Code
}
