package payments

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	stripe "github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/client"
)

// stripeStub is a stand-in for Stripe's API on an httptest server, so the
// live client (liveStripe, the Stripe Go SDK) is exercised end to end with no
// call to Stripe. It keeps Stripe's two promises the refund sender relies on:
// a request with an idempotency key it has answered gets the same answer
// again and creates nothing, and a refund is never larger than what is left
// of the capture. Only the two endpoints the refund and void paths call exist.
type stripeStub struct {
	t      *testing.T
	srv    *httptest.Server
	prefix string // keeps this run's refund ids apart in the shared database

	mu sync.Mutex
	// captured is what each payment intent has captured; refunded, what
	// Stripe has refunded of it.
	captured, refunded map[string]int64
	// fail makes every refund request against a payment intent answer with
	// this error instead, before anything is created.
	fail map[string]stubError
	// dropAfterCreate is how many of the next refunds are created and then
	// have their response lost, as a timeout after Stripe acted would.
	dropAfterCreate int
	replies         map[string]stubReply // by idempotency key
	refundCalls     []stubCall
	cancelCalls     []stubCall
	created         int
	authorised      bool // every request carried the secret key
}

type stubError struct {
	status    int
	typ, code string
}

type stubReply struct {
	status int
	body   []byte
}

// stubCall is one request as the stub received it.
type stubCall struct {
	Key, PaymentIntent, RefundID, Reason string
	Amount                               int64
}

func newStripeStub(t *testing.T, prefix string) *stripeStub {
	s := &stripeStub{t: t, prefix: prefix, captured: map[string]int64{}, refunded: map[string]int64{},
		fail: map[string]stubError{}, replies: map[string]stubReply{}, authorised: true}
	s.srv = httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(s.srv.Close)
	return s
}

// client is the live client, pointed at the stub, with the SDK's own network
// retries off so every retry the test sees is the refund sender's.
func (s *stripeStub) client() StripeClient {
	backend := stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		URL:               stripe.String(s.srv.URL),
		MaxNetworkRetries: stripe.Int64(0),
		LeveledLogger:     &stripe.LeveledLogger{Level: stripe.LevelNull},
	})
	api := &client.API{}
	api.Init("sk_test_hg_refund_stub", &stripe.Backends{API: backend, Connect: backend, Uploads: backend})
	return &liveStripe{api: api, webhookSecret: testWebhookSecret}
}

func (s *stripeStub) capture(pi string, cents int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.captured[pi] = cents
}

// refundsFor is every refund request made against a payment intent.
func (s *stripeStub) refundsFor(pi string) []stubCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []stubCall
	for _, c := range s.refundCalls {
		if c.PaymentIntent == pi {
			out = append(out, c)
		}
	}
	return out
}

func (s *stripeStub) cancelsFor(pi string) []stubCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []stubCall
	for _, c := range s.cancelCalls {
		if c.PaymentIntent == pi {
			out = append(out, c)
		}
	}
	return out
}

func (s *stripeStub) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer sk_test_hg_refund_stub" {
		s.authorised = false
		s.reply(w, stubReply{http.StatusUnauthorized, stubErrorBody("invalid_request_error", "", "no API key")})
		return
	}
	if err := r.ParseForm(); err != nil {
		s.t.Errorf("stripe stub: unreadable form: %v", err)
	}
	key := r.Header.Get("Idempotency-Key")
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/refunds":
		amount, _ := strconv.ParseInt(r.PostForm.Get("amount"), 10, 64)
		call := stubCall{Key: key, PaymentIntent: r.PostForm.Get("payment_intent"), Amount: amount,
			RefundID: r.PostForm.Get("metadata[refund_id]"), Reason: r.PostForm.Get("reason")}
		s.refundCalls = append(s.refundCalls, call)
		if prev, ok := s.replies[key]; ok && key != "" {
			s.reply(w, prev)
			return
		}
		if e, ok := s.fail[call.PaymentIntent]; ok {
			// Refused before Stripe acted, so nothing is kept for the key.
			s.reply(w, stubReply{e.status, stubErrorBody(e.typ, e.code, "stub: "+e.code)})
			return
		}
		rep := s.createRefund(call)
		s.replies[key] = rep
		if rep.status == http.StatusOK && s.dropAfterCreate > 0 {
			s.dropAfterCreate--
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				s.t.Errorf("stripe stub: hijack: %v", err)
				return
			}
			_ = conn.Close() // Stripe acted; the answer never arrives
			return
		}
		s.reply(w, rep)

	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/payment_intents/") &&
		strings.HasSuffix(r.URL.Path, "/cancel"):
		pi := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/payment_intents/"), "/cancel")
		s.cancelCalls = append(s.cancelCalls, stubCall{Key: key, PaymentIntent: pi})
		if prev, ok := s.replies[key]; ok && key != "" {
			s.reply(w, prev)
			return
		}
		body, _ := json.Marshal(map[string]any{"id": pi, "object": "payment_intent", "status": "canceled",
			"amount": 3919, "amount_capturable": 0, "amount_received": 0, "currency": "cad"})
		rep := stubReply{http.StatusOK, body}
		s.replies[key] = rep
		s.reply(w, rep)

	default:
		s.t.Errorf("stripe stub: unexpected %s %s", r.Method, r.URL.Path)
		s.reply(w, stubReply{http.StatusNotFound, stubErrorBody("invalid_request_error", "resource_missing", "no such route")})
	}
}

// createRefund is Stripe's own check: a payment it does not know is missing,
// and a refund larger than what is left of the capture is refused.
func (s *stripeStub) createRefund(c stubCall) stubReply {
	captured, ok := s.captured[c.PaymentIntent]
	if !ok {
		return stubReply{http.StatusNotFound, stubErrorBody("invalid_request_error", "resource_missing", "No such payment_intent")}
	}
	if c.Amount <= 0 || c.Amount > captured-s.refunded[c.PaymentIntent] {
		return stubReply{http.StatusBadRequest, stubErrorBody("invalid_request_error", "amount_too_large",
			"Refund amount is greater than unrefunded amount on charge")}
	}
	s.refunded[c.PaymentIntent] += c.Amount
	s.created++
	body, _ := json.Marshal(map[string]any{
		"id": fmt.Sprintf("re_%s_%d", s.prefix, s.created), "object": "refund", "amount": c.Amount,
		"currency": "cad", "payment_intent": c.PaymentIntent, "status": "pending", "reason": c.Reason,
		"metadata": map[string]string{"refund_id": c.RefundID},
	})
	return stubReply{http.StatusOK, body}
}

func (s *stripeStub) reply(w http.ResponseWriter, rep stubReply) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Request-Id", "req_stub")
	w.WriteHeader(rep.status)
	_, _ = w.Write(rep.body)
}

func stubErrorBody(typ, code, msg string) []byte {
	e := map[string]any{"type": typ, "message": msg}
	if code != "" {
		e["code"] = code
	}
	b, _ := json.Marshal(map[string]any{"error": e})
	return b
}
