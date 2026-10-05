package payments

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// With no webhook delivered (a laptop: Stripe has no public URL to call), the
// app's read of the order's payment after the customer confirmed the card is
// what moves the order on: GetOrderPayment asks Stripe and applies the same
// transition the webhook would (reconcile_read.go). The webhook arriving
// afterwards changes nothing, and a decline delivered late does not undo the
// authorisation.
func TestGetOrderPayment_ReconcilesTheIntentOnRead(t *testing.T) {
	ctx := context.Background()
	dsn := testseed.FreshDatabase(t, "hg_pay_reconcile_read")
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	h := newWebhookHarnessOn(t, pool)

	// What Stripe says about each intent, set per case.
	stripeSays := map[string]*StripeIntent{}
	reads := 0
	mock := &mockStripe{GetIntentFn: func(id string) (*StripeIntent, error) {
		reads++
		return stripeSays[id], nil
	}}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(NewRepo(pool), mock, config.Stripe{}, quiet).WithOrderHooks(orders.NewStore(pool))

	t.Run("an authorised card presents the order to the restaurant", func(t *testing.T) {
		pi := h.id("pi_read_auth")
		order := seedOrderWithIntent(t, pool, pi, "CREATED", "REQUIRES_PAYMENT_METHOD")
		stripeSays[pi] = &StripeIntent{ID: pi, Status: "requires_capture", Currency: "cad",
			AmountCents: 3919, AmountCapturableCents: 3919, ClientSecret: pi + "_secret"}

		got, err := svc.GetOrderPayment(ctx, order, "", true)
		if err != nil || got.State != string(StateRequiresCapture) || got.ClientSecret != nil {
			t.Fatalf("read after confirming: %+v err=%v; want REQUIRES_CAPTURE and no secret", got, err)
		}
		if s := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); s != "RESTAURANT_PENDING" {
			t.Fatalf("order is %s, want RESTAURANT_PENDING", s)
		}

		// The webhook, delivered afterwards, finds the work done.
		h.send(h.id("evt_read_auth"), "payment_intent.amount_capturable_updated", time.Now(),
			piObject(pi, "requires_capture", 0))
		h.process()
		for _, to := range []string{"AUTHORIZED", "RESTAURANT_PENDING"} {
			if n := h.count(`SELECT count(*) FROM order_transition WHERE order_id = $1 AND to_state = $2`, order, to); n != 1 {
				t.Errorf("order moved to %s %d times, want once", to, n)
			}
		}

		// A decline from before the authorisation, delivered late, is behind.
		declined := piObject(pi, "requires_payment_method", 0)
		declined["last_payment_error"] = map[string]any{"code": "card_declined", "decline_code": "generic_decline"}
		h.send(h.id("evt_read_stale_decline"), "payment_intent.payment_failed", time.Now().Add(-time.Minute), declined)
		h.process()
		if s := intentState(t, pool, pi); s != "REQUIRES_CAPTURE" {
			t.Errorf("after a late decline the payment is %s, want REQUIRES_CAPTURE", s)
		}

		// Authorised: later reads (tracking) never ask Stripe.
		before := reads
		if _, err := svc.GetOrderPayment(ctx, order, "", true); err != nil || reads != before {
			t.Errorf("read of an authorised payment asked Stripe %d times (err=%v), want none", reads-before, err)
		}
	})

	t.Run("a 3-D Secure challenge re-issues the secret and leaves the order waiting", func(t *testing.T) {
		pi := h.id("pi_read_3ds")
		order := seedOrderWithIntent(t, pool, pi, "CREATED", "REQUIRES_PAYMENT_METHOD")
		stripeSays[pi] = &StripeIntent{ID: pi, Status: "requires_action", Currency: "cad", ClientSecret: pi + "_secret_live"}

		got, err := svc.GetOrderPayment(ctx, order, "", true)
		if err != nil || got.State != string(StateRequiresAction) || got.ClientSecret == nil || *got.ClientSecret != pi+"_secret_live" {
			t.Fatalf("read during a challenge: %+v err=%v; want REQUIRES_ACTION with Stripe's secret", got, err)
		}
		if s := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); s != "CREATED" {
			t.Fatalf("order is %s, want CREATED until the card is authorised", s)
		}
	})

	t.Run("a declined card records the decline and leaves the order waiting", func(t *testing.T) {
		pi := h.id("pi_read_decline")
		order := seedOrderWithIntent(t, pool, pi, "CREATED", "REQUIRES_PAYMENT_METHOD")
		stripeSays[pi] = &StripeIntent{ID: pi, Status: "requires_payment_method", Currency: "cad",
			FailureCode: "card_declined", DeclineCode: "generic_decline"}

		got, err := svc.GetOrderPayment(ctx, order, "", true)
		if err != nil || got.State != string(StateFailed) || got.DeclineCode == nil || *got.DeclineCode != "generic_decline" {
			t.Fatalf("read after a decline: %+v err=%v; want FAILED with the decline code", got, err)
		}
		if s := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); s != "CREATED" {
			t.Fatalf("order is %s, want CREATED: the customer may try another card", s)
		}

		// The customer's second card is authorised on the same intent.
		stripeSays[pi] = &StripeIntent{ID: pi, Status: "requires_capture", Currency: "cad", AmountCapturableCents: 3919}
		if got, err := svc.GetOrderPayment(ctx, order, "", true); err != nil || got.State != string(StateRequiresCapture) {
			t.Fatalf("read after the retried card: %+v err=%v; want REQUIRES_CAPTURE", got, err)
		}
		if s := h.text(`SELECT state::text FROM "order" WHERE id = $1`, order); s != "RESTAURANT_PENDING" {
			t.Fatalf("order is %s, want RESTAURANT_PENDING", s)
		}
	})
}
