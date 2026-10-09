package payments

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	stripe "github.com/stripe/stripe-go/v79"
)

// keyedTestKey is the secret key the live client is built with here: a made-up
// test-mode key that only has to arrive.
const keyedTestKey = "sk_test_hg_keyed_calls"

// keyedReplies is what the stand-in for Stripe answers each request with: just
// enough of each object for the live client to read an id back.
var keyedReplies = map[string]string{
	"POST /v1/setup_intents":                   `{"id":"seti_stub","object":"setup_intent","client_secret":"seti_stub_secret"}`,
	"POST /v1/accounts":                        `{"id":"acct_stub","object":"account"}`,
	"GET /v1/accounts/acct_stub":               `{"id":"acct_stub","object":"account"}`,
	"POST /v1/account_links":                   `{"object":"account_link","url":"https://connect.stripe.com/setup/e/acct_stub","expires_at":1767225600}`,
	"POST /v1/transfers":                       `{"id":"tr_stub","object":"transfer"}`,
	"POST /v1/payouts":                         `{"id":"po_stub","object":"payout","status":"pending"}`,
	"GET /v1/payouts":                          `{"object":"list","url":"/v1/payouts","has_more":false,"data":[{"id":"po_stub","object":"payout","status":"pending","metadata":{"payout_id":"po_1","attempt":"1"}}]}`,
	"POST /v1/refunds":                         `{"id":"re_stub","object":"refund","status":"pending"}`,
	"POST /v1/payment_intents":                 `{"id":"pi_stub","object":"payment_intent","status":"requires_capture"}`,
	"POST /v1/payment_intents/pi_stub/capture": `{"id":"pi_stub","object":"payment_intent","status":"succeeded"}`,
	"POST /v1/payment_intents/pi_stub/cancel":  `{"id":"pi_stub","object":"payment_intent","status":"canceled"}`,
	"GET /v1/payment_intents/pi_stub":          `{"id":"pi_stub","object":"payment_intent","status":"requires_capture"}`,
	"GET /v1/events":                           `{"object":"list","url":"/v1/events","has_more":false,"data":[]}`,
}

// keyedRequest is one request as the stand-in received it.
type keyedRequest struct {
	method, path, auth, version, idempotencyKey, account string
}

// TestLiveStripeSendsTheKeyOnEveryCall drives every call the live client
// (liveStripe) makes against an httptest stand-in for Stripe's API, and checks
// each request carries the configured secret key, the pinned API version and,
// where the call has one, its idempotency key.
//
// Saving a card, creating and reading a Connect account, minting an onboarding
// link and transferring to a partner used to go through the SDK's package-level
// functions, which read the global stripe.Key that nothing sets, so each went
// out with no key (https://github.com/shaiknoorullah/hg-mono/issues/338). The
// SDK's global backend points at the same stand-in here, so a call that slips
// back to a package-level function arrives with an empty key and fails this
// test instead of going out to Stripe.
func TestLiveStripeSendsTheKeyOnEveryCall(t *testing.T) {
	var (
		mu  sync.Mutex
		got []keyedRequest
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = append(got, keyedRequest{r.Method, r.URL.Path, r.Header.Get("Authorization"),
			r.Header.Get("Stripe-Version"), r.Header.Get("Idempotency-Key"), r.Header.Get("Stripe-Account")})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer "+keyedTestKey {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"stub: no valid API key"}}`))
			return
		}
		body, ok := keyedReplies[r.Method+" "+r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"stub: no such route"}}`))
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	backend := stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		URL:               stripe.String(srv.URL),
		MaxNetworkRetries: stripe.Int64(0),
		LeveledLogger:     &stripe.LeveledLogger{Level: stripe.LevelNull},
	})
	stripe.SetBackend(stripe.APIBackend, backend)
	stripe.SetBackend(stripe.ConnectBackend, backend)
	t.Cleanup(func() {
		// nil puts the SDK's own backends back on next use.
		stripe.SetBackend(stripe.APIBackend, nil)
		stripe.SetBackend(stripe.ConnectBackend, nil)
	})
	sc := newLiveStripe(keyedTestKey, "", &stripe.Backends{API: backend, Connect: backend, Uploads: backend})
	ctx := context.Background()

	cases := []struct {
		name, method, path, idempotencyKey, wantID string
		call                                       func() (string, error)
	}{
		{"save a card", "POST", "/v1/setup_intents", "si:test", "seti_stub", func() (string, error) {
			si, err := sc.CreateSetupIntent(ctx, "cus_stub", "si:test")
			return idOf(si, err, func() string { return si.ID })
		}},
		{"create a Connect account", "POST", "/v1/accounts", "ca:test", "acct_stub", func() (string, error) {
			a, err := sc.CreateConnectAccount(ctx, CreateConnectInput{Email: "owner@example.com",
				OwnerType: "RESTAURANT", OwnerID: "r_1", IdempotencyKey: "ca:test"})
			return idOf(a, err, func() string { return a.ID })
		}},
		{"mint an onboarding link", "POST", "/v1/account_links", "", "https://connect.stripe.com/setup/e/acct_stub", func() (string, error) {
			l, err := sc.CreateAccountLink(ctx, "acct_stub", "https://example.com/return", "https://example.com/refresh")
			return idOf(l, err, func() string { return l.URL })
		}},
		{"read a Connect account", "GET", "/v1/accounts/acct_stub", "", "acct_stub", func() (string, error) {
			a, err := sc.GetConnectAccount(ctx, "acct_stub")
			return idOf(a, err, func() string { return a.ID })
		}},
		{"transfer to a partner", "POST", "/v1/transfers", "po:test", "tr_stub", func() (string, error) {
			tr, err := sc.CreateTransfer(ctx, CreateTransferInput{AmountCents: 1250, Currency: "cad",
				DestinationAcct: "acct_stub", IdempotencyKey: "po:test", PayoutID: "po_1"})
			return idOf(tr, err, func() string { return tr.ID })
		}},
		{"pay a partner's balance out to their bank", "POST", "/v1/payouts", "pb:po_1:1", "po_stub", func() (string, error) {
			po, err := sc.CreateBankPayout(ctx, CreateBankPayoutInput{StripeAccountID: "acct_stub", AmountCents: 1250,
				Currency: "cad", IdempotencyKey: "pb:po_1:1", PayoutID: "po_1", Attempt: 1})
			return idOf(po, err, func() string { return po.ID })
		}},
		{"find a bank payout", "GET", "/v1/payouts", "", "po_stub", func() (string, error) {
			po, err := sc.FindBankPayout(ctx, "acct_stub", "po_1", 1, time.Unix(1767225600, 0))
			return idOf(po, err, func() string { return po.ID })
		}},
		{"refund", "POST", "/v1/refunds", "rf:test", "re_stub", func() (string, error) {
			rf, err := sc.CreateRefund(ctx, CreateRefundInput{StripePaymentIntentID: "pi_stub",
				AmountCents: 500, IdempotencyKey: "rf:test", RefundID: "rf_1"})
			return idOf(rf, err, func() string { return rf.ID })
		}},
		{"authorise", "POST", "/v1/payment_intents", "pi:test", "pi_stub", func() (string, error) {
			pi, err := sc.CreatePaymentIntent(ctx, CreateIntentInput{AmountCents: 3919, Currency: "cad",
				IdempotencyKey: "pi:test", OrderID: "o_1"})
			return idOf(pi, err, func() string { return pi.ID })
		}},
		{"capture", "POST", "/v1/payment_intents/pi_stub/capture", "cap:test", "pi_stub", func() (string, error) {
			pi, err := sc.CapturePaymentIntent(ctx, "pi_stub", 3919, "cap:test")
			return idOf(pi, err, func() string { return pi.ID })
		}},
		{"void", "POST", "/v1/payment_intents/pi_stub/cancel", "void:test", "pi_stub", func() (string, error) {
			pi, err := sc.CancelPaymentIntent(ctx, "pi_stub", "void:test")
			return idOf(pi, err, func() string { return pi.ID })
		}},
		{"read a payment intent", "GET", "/v1/payment_intents/pi_stub", "", "pi_stub", func() (string, error) {
			pi, err := sc.GetPaymentIntent(ctx, "pi_stub")
			return idOf(pi, err, func() string { return pi.ID })
		}},
		{"list events", "GET", "/v1/events", "", "0 events", func() (string, error) {
			evs, err := sc.ListEventsSince(ctx, time.Unix(1767225600, 0))
			return fmt.Sprintf("%d events", len(evs)), err
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			mu.Lock()
			got = nil
			mu.Unlock()
			id, err := c.call()
			mu.Lock()
			reqs := got
			mu.Unlock()

			if len(reqs) != 1 {
				t.Fatalf("the stand-in saw %d requests, want 1 (%s %s): %+v (call error: %v)",
					len(reqs), c.method, c.path, reqs, err)
			}
			r := reqs[0]
			if r.auth != "Bearer "+keyedTestKey {
				t.Errorf("Authorization = %q, want %q: the call did not go through the keyed client",
					r.auth, "Bearer "+keyedTestKey)
			}
			if r.method != c.method || r.path != c.path {
				t.Errorf("request = %s %s, want %s %s", r.method, r.path, c.method, c.path)
			}
			// The webhook endpoints are created in this version, and
			// webhook.ConstructEvent refuses events in any other
			// (https://github.com/shaiknoorullah/hg-mono/issues/320). A stripe-go
			// upgrade that moves it fails here until the endpoints move with it.
			if r.version != "2024-06-20" || StripeAPIVersion != "2024-06-20" {
				t.Errorf("Stripe-Version = %q (StripeAPIVersion %q), want 2024-06-20", r.version, StripeAPIVersion)
			}
			// A bank payout moves the partner's balance, so it is made on their
			// connected account, never on the platform's.
			if c.path == "/v1/payouts" && r.account != "acct_stub" {
				t.Errorf("Stripe-Account = %q, want acct_stub: a bank payout is made on the partner's account", r.account)
			}
			if c.idempotencyKey != "" && r.idempotencyKey != c.idempotencyKey {
				t.Errorf("Idempotency-Key = %q, want %q", r.idempotencyKey, c.idempotencyKey)
			}
			if err != nil {
				t.Fatalf("call failed: %v", err)
			}
			if id != c.wantID {
				t.Errorf("read back %q, want %q", id, c.wantID)
			}
		})
	}
}

// idOf reads an id off a call's result, or passes its error on.
func idOf[T any](v *T, err error, id func() string) (string, error) {
	if err != nil || v == nil {
		return "", err
	}
	return id(), nil
}
