package orders

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestRoutesVerify asserts every registered route carries a coherent policy and
// the two MONEY routes are Idempotent (Router.Verify enforces I-37.4). This is
// the boot check that would panic the server on a defective policy.
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	Routes(r, NewHandler(nil, nil, slog.Default()))
	if err := r.Verify(); err != nil {
		t.Fatalf("route policies are defective: %v", err)
	}
	// None of the orders routes may be public (deny by default).
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("orders registered public routes: %v", pub)
	}
}

// TestCreateQuoteRejectsPriceField is the G-3 boundary: a body carrying any
// price-shaped field is 422 UNKNOWN_FIELD and no work happens. The store is nil
// here precisely to prove the request never reaches it.
func TestCreateQuoteRejectsPriceField(t *testing.T) {
	h := NewHandler(nil, nil, slog.Default())
	body := `{"cart_id":"c","fulfilment":"DELIVERY","total_cents":10684}`
	req := httptest.NewRequest(http.MethodPost, "/v1/quotes", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.CreateQuote(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Details []struct {
				Field string `json:"field"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "UNKNOWN_FIELD" {
		t.Errorf("code = %q, want UNKNOWN_FIELD (body: %s)", env.Error.Code, rec.Body.String())
	}
	if len(env.Error.Details) == 0 || env.Error.Details[0].Field != "total_cents" {
		t.Errorf("expected details naming total_cents, got %s", rec.Body.String())
	}
}

// TestCreateOrderRejectsAmountField: the createOrder DTO carries no amount, so
// a body with one is 422 UNKNOWN_FIELD (P-09 acceptance 1). Store is nil to
// prove no order/quote/PI is created.
func TestCreateOrderRejectsAmountField(t *testing.T) {
	h := NewHandler(nil, nil, slog.Default())
	body := `{"quote_id":"q","amount_cents":5000}`
	req := httptest.NewRequest(http.MethodPost, "/v1/orders", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.CreateOrder(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateCartLineRejectsZeroQuantity: quantity 0 is rejected — removal is
// DELETE, never a sentinel quantity (C-19).
func TestUpdateCartLineRejectsZeroQuantity(t *testing.T) {
	h := NewHandler(nil, nil, slog.Default())
	req := httptest.NewRequest(http.MethodPatch, "/v1/cart/lines/x", strings.NewReader(`{"quantity":0}`))
	rec := httptest.NewRecorder()
	h.UpdateCartLine(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}

func TestDecodeStrictAcceptsValid(t *testing.T) {
	var in quoteInputDTO
	dec := json.NewDecoder(bytes.NewReader([]byte(`{"cart_id":"c","fulfilment":"PICKUP","tip_cents":300}`)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		t.Fatalf("valid body rejected: %v", err)
	}
	if in.TipCents == nil || *in.TipCents != 300 {
		t.Errorf("tip not decoded: %+v", in)
	}
}
