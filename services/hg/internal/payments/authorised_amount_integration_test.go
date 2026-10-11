package payments

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// An order still waiting for its card has authorised nothing: the intent
// stores 0 until it reaches REQUIRES_CAPTURE, then the order total, and a
// capture of that total still fits under it
// (https://github.com/shaiknoorullah/hg-mono/issues/729).
func TestOrderIntent_AuthorisedAmountIsZeroUntilTheCardIsAuthorised(t *testing.T) {
	ctx := context.Background()
	dsn := testseed.FreshDatabase(t, "hg_authorised_amount")
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	orderID := seedOrderWithIntent(t, pool, "pi_authorised_amount", "CREATED", "REQUIRES_PAYMENT_METHOD")
	// Start from an order with no intent, as checkout does.
	if _, err := pool.Exec(ctx, `DELETE FROM payment_intent WHERE order_id = $1`, orderID); err != nil {
		t.Fatalf("clear seeded intent: %v", err)
	}
	const total = 3919
	repo := NewRepo(pool)
	svc := NewService(repo, &mockStripe{}, config.Stripe{}, nil)

	row, err := repo.UpsertOrderIntent(ctx, orderID, &StripeIntent{
		ID: "pi_authorised_amount", Status: "requires_payment_method", AmountCents: total, Currency: "cad"})
	if err != nil {
		t.Fatalf("UpsertOrderIntent: %v", err)
	}
	if row.AmountAuthorizedCents != 0 {
		t.Fatalf("unconfirmed intent authorised %d cents, want 0", row.AmountAuthorizedCents)
	}

	assert := func(target PaymentState, received int64) {
		t.Helper()
		err := repo.tx(ctx, func(tx pgx.Tx) error {
			_, err := svc.assertIntentState(ctx, tx, "pi_authorised_amount", target, received, svc.now(), nil)
			return err
		})
		if err != nil {
			t.Fatalf("assert %s: %v", target, err)
		}
	}
	assert(StateRequiresCapture, 0)
	got, err := repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrderIntent: %v", err)
	}
	if got.AmountAuthorizedCents != total {
		t.Fatalf("authorised intent reports %d cents, want %d", got.AmountAuthorizedCents, total)
	}

	assert(StateSucceeded, total)
	got, err = repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrderIntent: %v", err)
	}
	if got.State != string(StateSucceeded) || got.AmountCapturedCents != total || got.AmountAuthorizedCents != total {
		t.Fatalf("after capture: state %s captured %d authorised %d, want SUCCEEDED %d %d",
			got.State, got.AmountCapturedCents, got.AmountAuthorizedCents, total, total)
	}
}
