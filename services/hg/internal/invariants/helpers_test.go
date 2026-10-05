// Package invariants holds the repo's kept invariant suite: a small, deliberately
// short list of tests that pin the properties the rest of the codebase must never
// violate (AGENTS.md §3), rather than the exhaustive per-handler coverage that
// lives beside each module. Each test here is chosen because the invariant it
// pins was violated by the previous system and cost real money or real safety.
//
// Every test requires a real, migrated Postgres named by HG_TEST_POSTGRES_DSN —
// several of these invariants (the ledger's deferred trigger, the deadline
// CHECK) are enforced by the database, not by Go, and can only be pinned by
// hitting the database for real. When the DSN is unset the whole package SKIPs
// with a clear message, never a silent pass.
package invariants

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN is not set; skipping invariant test (set it to a migrated Postgres to run)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// basics is one account + one live Ontario restaurant + one $15 menu item +
// one Ontario delivery address — the minimum fixture the checkout path needs.
// It mirrors internal/orders/integration_test.go's seedBasics (same shape,
// re-seeded here because the fixture is unexported and this is a different
// package). Everything is cleaned up in FK order via t.Cleanup.
type basics struct {
	accountID    string
	restaurantID string
	menuItemID   string
	addressID    string
}

func seedBasics(t *testing.T, pool *pgxpool.Pool) basics {
	t.Helper()
	ctx := context.Background()
	var b basics

	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('inv-'||substr(uuid_generate_v7()::text,1,12)||'@test.local', 'ACTIVE') RETURNING id`,
	).Scan(&b.accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (
			slug, legal_name, display_name, province, city, line1, postal_code,
			location, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps, tax_role, minimum_order_cents
		) VALUES (
			'inv-'||substr(uuid_generate_v7()::text,1,8), 'Invariant Test Co', 'Invariant Kitchen',
			'ON', 'Toronto', '1 King St', 'M5J0C3',
			ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
			'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0
		) RETURNING id`,
	).Scan(&b.restaurantID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	var categoryID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`,
		b.restaurantID).Scan(&categoryID); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		VALUES ($1, $2, 1500, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		b.restaurantID, categoryID).Scan(&b.menuItemID); err != nil {
		t.Fatalf("seed menu_item: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, b.accountID).Scan(&b.addressID); err != nil {
		t.Fatalf("seed address: %v", err)
	}

	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM order_line_addon WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM order_line WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM order_transition WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM deadline_audit WHERE subject_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM payment_intent WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM "order" WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM quote WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM cart_line_addon WHERE cart_line_id IN (SELECT cl.id FROM cart_line cl JOIN cart c2 ON c2.id=cl.cart_id WHERE c2.account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM cart_line WHERE cart_id IN (SELECT id FROM cart WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM cart WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM address WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(c, `DELETE FROM menu_item WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(c, `DELETE FROM menu_category WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(c, `DELETE FROM restaurant WHERE id=$1`, b.restaurantID)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id=$1`, b.accountID)
	})
	// Certified through the real chain (an admin-verified certificate): the
	// order path refuses a restaurant the platform cannot vouch for.
	// https://github.com/shaiknoorullah/hg-mono/issues/292
	testseed.CertifyRestaurant(t, pool, b.restaurantID, 300)
	return b
}

// quoteAndOrder drives cart -> quote -> order through the real orders.Store, the
// same store production uses, and returns the order id plus its total. gw is
// the payment gateway (see paymentGateway below): passing one that authorises
// through the payments module with the fake Stripe client keeps this a real,
// end-to-end path rather than a mock of the seam under test.
func quoteAndOrder(t *testing.T, st *orders.Store, b basics, gw orders.PaymentGateway) (orderID string, totalCents int64) {
	t.Helper()
	ctx := context.Background()

	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		orders.CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	q, err := st.CreateQuote(ctx, orders.QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID,
		Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("create quote: %v", err)
	}

	var fresh *orders.Quote
	prepared, err := st.CreateOrder(ctx, orders.OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}

	if gw != nil {
		if _, err := gw.CreateOrderIntent(ctx, orders.CreateIntentInput{
			OrderID: prepared.OrderID, QuoteID: q.ID, AccountID: b.accountID,
			RestaurantID: b.restaurantID, AmountCents: prepared.TotalCents, Currency: "cad",
		}); err != nil {
			t.Fatalf("authorise: %v", err)
		}
	}
	return prepared.OrderID, prepared.TotalCents
}

// paymentsService builds a real payments.Service over the fake, LOCAL-DEV-ONLY
// Stripe client (see internal/payments/fake_stripe.go): no network call, but
// every other line of the auth/capture/void code path runs for real, including
// the payment_intent row it writes.
func paymentsService(pool *pgxpool.Pool) *payments.Service {
	return payments.NewService(payments.NewRepo(pool), payments.NewFakeStripe(), config.Stripe{}, slog.Default())
}

// localGateway implements orders.PaymentGateway exactly the way cmd/hg/main.go's
// orderPaymentGateway does in local/fake-Stripe mode: authorise through the
// payments module, then advance CREATED -> AUTHORIZED -> RESTAURANT_PENDING
// synchronously (production does this from the Stripe webhook, which the fake
// client cannot send).
type localGateway struct {
	pay   *payments.Service
	store *orders.Store
}

func (g localGateway) CreateOrderIntent(ctx context.Context, in orders.CreateIntentInput) (orders.CreateIntentResult, error) {
	row, err := g.pay.Authorise(ctx, payments.AuthoriseInput{
		OrderID: in.OrderID, AmountCents: in.AmountCents, Currency: in.Currency,
		IdempotencyKey: "order:" + in.OrderID,
	})
	if err != nil {
		return orders.CreateIntentResult{}, err
	}
	if err := g.store.Transition(ctx, orders.TransitionRequest{
		OrderID: in.OrderID, To: machine.StateAuthorized, Actor: machine.ActorSystem, Reason: "payment authorised (invariant test fake)",
	}); err != nil {
		return orders.CreateIntentResult{}, err
	}
	if err := g.store.Transition(ctx, orders.TransitionRequest{
		OrderID: in.OrderID, To: machine.StateRestaurantPending, Actor: machine.ActorSystem, Reason: "presented to restaurant",
	}); err != nil {
		return orders.CreateIntentResult{}, err
	}
	return orders.CreateIntentResult{ClientSecret: row.StripePaymentIntentID + "_secret"}, nil
}

// restaurantPay bridges restaurant.PaymentActions to a real payments.Service,
// exactly like cmd/hg/main.go's restaurantPayAdapter.
type restaurantPay struct{ svc *payments.Service }

func (a restaurantPay) Capture(ctx context.Context, orderID string, amountCents int64) error {
	_, err := a.svc.Capture(ctx, orderID, amountCents)
	return err
}

func (a restaurantPay) Void(ctx context.Context, orderID string) error {
	_, err := a.svc.Void(ctx, orderID)
	return err
}

var _ restaurant.PaymentActions = restaurantPay{}
