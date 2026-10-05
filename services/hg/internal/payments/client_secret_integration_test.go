package payments

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The order's payment is confirmed on the phone with Stripe's own client
// secret. Authorise passes it through from Stripe's answer and never builds
// one from the intent id (https://github.com/shaiknoorullah/hg-mono/issues/509).
func TestAuthorise_ReturnsStripesOwnClientSecret(t *testing.T) {
	ctx := context.Background()
	// A database of its own with the shared fixtures (the seeded order needs a
	// restaurant, a cart and a delivery address from them).
	dsn := testseed.FreshDatabase(t, "hg_client_secret")
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	orderID := seedOrderWithIntent(t, pool, "pi_seeded_client_secret", "CREATED", "REQUIRES_PAYMENT_METHOD")

	const stripeSecret = "pi_seeded_client_secret_secret_Zq81LmNo"
	mock := &mockStripe{CreateIntentFn: func(in CreateIntentInput) (*StripeIntent, error) {
		return &StripeIntent{
			ID:           "pi_seeded_client_secret",
			Status:       "requires_payment_method",
			AmountCents:  in.AmountCents,
			Currency:     in.Currency,
			ClientSecret: stripeSecret,
		}, nil
	}}
	svc := NewService(NewRepo(pool), mock, config.Stripe{}, nil)

	row, err := svc.Authorise(ctx, AuthoriseInput{OrderID: orderID, AmountCents: 2500, IdempotencyKey: "order:" + orderID})
	if err != nil {
		t.Fatalf("Authorise: %v", err)
	}
	if row.ClientSecret != stripeSecret {
		t.Fatalf("client secret = %q, want Stripe's own %q", row.ClientSecret, stripeSecret)
	}
	if row.ClientSecret == row.StripePaymentIntentID+"_secret" {
		t.Fatalf("client secret was built from the intent id: %q", row.ClientSecret)
	}

	// Reads never carry it: the secret is passed through, not stored.
	stored, err := NewRepo(pool).GetOrderIntent(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrderIntent: %v", err)
	}
	if stored.ClientSecret != "" {
		t.Fatalf("a read returned a client secret %q; it must not be stored", stored.ClientSecret)
	}
}
