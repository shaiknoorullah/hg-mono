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
			_, err := svc.assertIntentState(ctx, tx, "pi_authorised_amount", target,
				stripeAmounts{Received: received}, svc.now(), nil)
			return err
		})
		if err != nil {
			t.Fatalf("assert %s: %v", target, err)
		}
	}
	// A report carrying no amount falls back to the server-priced total.
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

// The authorised amount is what Stripe says the card holds, not the order
// total we expected: an intent created for a stale total records Stripe's
// figure and pages on-call, and a capture of the order total above it is then
// refused rather than recorded as matching.
func TestOrderIntent_AuthorisedAmountIsWhatStripeHolds(t *testing.T) {
	ctx := context.Background()
	dsn := testseed.FreshDatabase(t, "hg_authorised_stripe")
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed fixtures: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	const stripeID = "pi_authorised_stale_total"
	orderID := seedOrderWithIntent(t, pool, stripeID, "CREATED", "REQUIRES_PAYMENT_METHOD")
	if _, err := pool.Exec(ctx, `DELETE FROM payment_intent WHERE order_id = $1`, orderID); err != nil {
		t.Fatalf("clear seeded intent: %v", err)
	}
	const total, held = 3919, 3500 // the order's server-priced total; what Stripe holds
	repo := NewRepo(pool)
	svc := NewService(repo, &mockStripe{}, config.Stripe{}, nil)
	if _, err := repo.UpsertOrderIntent(ctx, orderID, &StripeIntent{
		ID: stripeID, Status: "requires_payment_method", AmountCents: total, Currency: "cad"}); err != nil {
		t.Fatalf("UpsertOrderIntent: %v", err)
	}

	assert := func(target PaymentState, amounts stripeAmounts) effect {
		t.Helper()
		var eff effect
		err := repo.tx(ctx, func(tx pgx.Tx) error {
			var err error
			eff, err = svc.assertIntentState(ctx, tx, stripeID, target, amounts, svc.now(), nil)
			return err
		})
		if err != nil {
			t.Fatalf("assert %s: %v", target, err)
		}
		return eff
	}
	assert(StateRequiresCapture, stripeAmounts{Capturable: held})
	got, err := repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrderIntent: %v", err)
	}
	if got.AmountAuthorizedCents != held {
		t.Fatalf("authorised intent reports %d cents, want Stripe's %d (not the order total %d)",
			got.AmountAuthorizedCents, held, total)
	}
	alerts := func() []string {
		t.Helper()
		rows, err := pool.Query(ctx, `
			SELECT payload->>'kind' FROM realtime_event
			 WHERE channel = 'admin:ops' AND type = 'admin.alert' AND payload->>'subject_id' = $1
			 ORDER BY seq`, got.ID)
		if err != nil {
			t.Fatalf("read ops alerts: %v", err)
		}
		kinds, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatalf("read ops alerts: %v", err)
		}
		return kinds
	}
	if k := alerts(); len(k) != 1 || k[0] != "authorisation_mismatch" {
		t.Fatalf("ops alerts after a %d-cent hold on a %d-cent order: %v, want one authorisation_mismatch", held, total, k)
	}
	// A redelivered authorisation does not page again.
	assert(StateRequiresCapture, stripeAmounts{Capturable: held})
	if k := alerts(); len(k) != 1 {
		t.Fatalf("ops alerts after a redelivery: %v, want still one", k)
	}

	// A capture of the order total is above what Stripe held: refused, not recorded.
	if eff := assert(StateSucceeded, stripeAmounts{Received: total}); eff.label != "refused:capture_above_authorisation" {
		t.Fatalf("capture of %d against a %d hold: %q, want refused:capture_above_authorisation", total, held, eff.label)
	}
	got, err = repo.GetOrderIntent(ctx, orderID)
	if err != nil {
		t.Fatalf("GetOrderIntent: %v", err)
	}
	if got.State != string(StateRequiresCapture) || got.AmountCapturedCents != 0 {
		t.Fatalf("after a refused capture: state %s captured %d, want REQUIRES_CAPTURE 0", got.State, got.AmountCapturedCents)
	}
}
