package payments

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// A start Stripe cannot replay from is refused before Stripe or the database
// is touched: the repo is nil and listing events fails the test, so a
// half-run catch-up cannot happen.
func TestCatchUp_RefusesAStartStripeCannotReplay(t *testing.T) {
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	mock := &mockStripe{ListEventsFn: func(time.Time) ([]StripeEvent, error) {
		t.Fatal("listed Stripe events for a start that should have been refused")
		return nil, nil
	}}
	svc := NewService(nil, mock, config.Stripe{}, nil)
	svc.now = func() time.Time { return now }

	for name, since := range map[string]time.Time{
		"in the future":       now.Add(time.Minute),
		"past Stripe's reach": now.Add(-stripeEventRetention - time.Minute),
	} {
		if _, err := svc.CatchUp(context.Background(), since, false); err == nil {
			t.Errorf("%s: want an error, got none", name)
		}
	}

	unconfigured := NewService(nil, nil, config.Stripe{}, nil)
	if _, err := unconfigured.CatchUp(context.Background(), now, false); !errors.Is(err, ErrStripeNotConfigured) {
		t.Errorf("no Stripe client: err = %v, want ErrStripeNotConfigured", err)
	}
}

// Reconciliation and the webhooks assert only states they know: a status
// never seen asserts nothing rather than a guess, and a decline asserts
// FAILED whether it comes from Stripe's current view or a payment_failed
// event.
func TestStripeIntentTarget(t *testing.T) {
	cases := []struct {
		pi   StripeIntent
		want PaymentState
		ok   bool
	}{
		{StripeIntent{Status: "requires_capture"}, StateRequiresCapture, true},
		{StripeIntent{Status: "succeeded"}, StateSucceeded, true},
		{StripeIntent{Status: "canceled"}, StateCanceled, true},
		{StripeIntent{Status: "requires_payment_method"}, StateRequiresPaymentMethod, true},
		{StripeIntent{Status: "requires_payment_method", FailureCode: "card_declined"}, StateFailed, true},
		{StripeIntent{Status: "some_future_status"}, "", false},
	}
	for _, c := range cases {
		got, ok := stripeIntentTarget(c.pi.Status, c.pi.FailureCode != "")
		if got != c.want || ok != c.ok {
			t.Errorf("stripeIntentTarget(%q, declined=%q) = (%q, %t), want (%q, %t)",
				c.pi.Status, c.pi.FailureCode, got, ok, c.want, c.ok)
		}
	}
}
