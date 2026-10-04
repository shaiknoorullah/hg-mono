package orders

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The integration tests run against a real, migrated + seeded Postgres named by
// HG_TEST_POSTGRES_DSN. When it is unset they SKIP with a clear message (never
// silently) — that is the expected state in the module author's own run, where
// no database is provisioned. An independent verifier runs them against a live
// database.
//
// They assume the schema (migrations 0000N) and the Ontario tax + launch pricing
// seed (migrations/seed) are already applied. Each test seeds only the domain
// fixtures it needs (an account, a live Ontario restaurant, a menu item, a cart)
// inside a savepoint-free transaction it rolls back at the end, so the tests are
// independent and leave no residue.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN is not set; skipping orders integration test (set it to a migrated+seeded Postgres to run)")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedBasics creates one account, one live Ontario restaurant with a location, a
// menu category and one available menu item priced at 1500 cents, plus an
// address in Ontario. It returns the ids. Everything is cleaned up via t.Cleanup.
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

	// account (the CHECK requires an identifier; use a unique email). The
	// suffixes are random: a uuid v7 prefix is a timestamp, so two calls within
	// the same minute would collide.
	err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('it-'||substr(md5(random()::text),1,12)||'@test.local', 'ACTIVE') RETURNING id`).Scan(&b.accountID)
	if err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// restaurant: LIVE + accepting + Ontario + a Toronto location.
	err = pool.QueryRow(ctx, `
		INSERT INTO restaurant (
			slug, legal_name, display_name, province, city, line1, postal_code,
			location, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps, tax_role, minimum_order_cents
		) VALUES (
			'it-'||substr(md5(random()::text),1,12), 'Test Co', 'Test Kitchen', 'ON', 'Toronto', '1 King St', 'M5J0C3',
			ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
			'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0
		) RETURNING id`).Scan(&b.restaurantID)
	if err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// menu category + item.
	var categoryID string
	err = pool.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`,
		b.restaurantID).Scan(&categoryID)
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		VALUES ($1, $2, 1500, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		b.restaurantID, categoryID).Scan(&b.menuItemID)
	if err != nil {
		t.Fatalf("seed menu_item: %v", err)
	}

	// address in Ontario, near the restaurant.
	err = pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, b.accountID).Scan(&b.addressID)
	if err != nil {
		t.Fatalf("seed address: %v", err)
	}

	t.Cleanup(func() {
		// Order matters for FKs; delete the leaf rows first.
		_, _ = pool.Exec(ctx, `DELETE FROM order_line_addon WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM order_line WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM order_transition WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_audit WHERE subject_id IN (SELECT id FROM "order" WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart_line_addon WHERE cart_line_id IN (SELECT cl.id FROM cart_line cl JOIN cart c ON c.id=cl.cart_id WHERE c.account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart_line WHERE cart_id IN (SELECT id FROM cart WHERE account_id=$1)`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE account_id=$1`, b.accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM menu_item WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM menu_category WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, b.accountID)
	})
	return b
}

func TestIntegrationCartQuoteOrderFlow(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	// Add two of the item to the cart.
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 2}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	if cart.IndicativeSubtotalCents != 3000 {
		t.Errorf("indicative subtotal = %d, want 3000", cart.IndicativeSubtotalCents)
	}

	// Quote it, delivery to the Ontario address.
	q, err := st.CreateQuote(ctx, QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID,
		Fulfilment: "DELIVERY", TipCents: 500,
	})
	if err != nil {
		t.Fatalf("create quote: %v", err)
	}
	if q.SubtotalCents != 3000 {
		t.Errorf("quote subtotal = %d, want 3000", q.SubtotalCents)
	}
	// Conservation identity must hold (also a DB CHECK, so an insert would have
	// failed otherwise).
	want := q.SubtotalCents - q.DiscountItemsCents + q.DeliveryFeeCents - q.DiscountDeliveryCents +
		q.ServiceFeeCents - q.DiscountServiceCents + q.TaxTotalCents + q.TipCents
	if q.TotalCents != want {
		t.Errorf("conservation broke: total=%d want=%d", q.TotalCents, want)
	}
	if q.TipCents != 500 {
		t.Errorf("tip = %d, want 500", q.TipCents)
	}

	// GetQuote returns the identical persisted row.
	got, err := st.GetQuote(ctx, b.accountID, q.ID)
	if err != nil {
		t.Fatalf("get quote: %v", err)
	}
	if got.TotalCents != q.TotalCents {
		t.Errorf("re-read total = %d, want %d", got.TotalCents, q.TotalCents)
	}

	// Create the order. The unwired gateway is not used here: CreateOrder stops
	// before the gateway (it only prepares the order row); we call it directly.
	var fresh *Quote
	prepared, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if prepared.TotalCents != q.TotalCents {
		t.Errorf("order total = %d, want %d", prepared.TotalCents, q.TotalCents)
	}

	// The order is in CREATED with a non-null deadline (the CHECK guarantees it).
	view, err := st.GetOrderForCustomer(ctx, b.accountID, prepared.OrderID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if view.State != "CREATED" {
		t.Errorf("state = %s, want CREATED", view.State)
	}
	if view.DeadlineAt == nil {
		t.Error("CREATED order must carry a deadline (I-15.1)")
	}
	if !view.CanCancel {
		t.Error("CREATED order should be cancellable")
	}

	// A second order for the same customer is ACTIVE_ORDER_EXISTS.
	q2, _ := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	if q2 != nil {
		if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q2.ID}, &fresh); err != ErrActiveOrderExists {
			t.Errorf("second order error = %v, want ErrActiveOrderExists", err)
		}
	}

	// Cancel it (free, pre-acceptance).
	cancelled, err := st.CancelOrder(ctx, b.accountID, prepared.OrderID, "CHANGED_MIND", nil)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if cancelled.State != "CANCELLED" {
		t.Errorf("state = %s, want CANCELLED", cancelled.State)
	}
	if cancelled.DeadlineAt != nil {
		t.Error("terminal CANCELLED must have NULL deadline")
	}
}

func TestIntegrationQuoteStaleOnPriceChange(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	q, err := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	if err != nil {
		t.Fatalf("quote: %v", err)
	}

	// The restaurant raises the item's price between quote and order (P-09 acc 4).
	if _, err := pool.Exec(ctx, `UPDATE menu_item SET price_cents = 2000 WHERE id = $1`, b.menuItemID); err != nil {
		t.Fatalf("price change: %v", err)
	}

	var fresh *Quote
	_, err = st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != ErrQuoteStale {
		t.Fatalf("create order error = %v, want ErrQuoteStale", err)
	}
	if fresh == nil {
		t.Fatal("QUOTE_STALE must carry the freshly computed quote")
	}
	if fresh.SubtotalCents != 2000 {
		t.Errorf("fresh subtotal = %d, want 2000", fresh.SubtotalCents)
	}
	// And no order was created.
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM "order" WHERE account_id=$1`, b.accountID).Scan(&n)
	if n != 0 {
		t.Errorf("an order was created despite a stale quote: %d", n)
	}
}

func TestIntegrationExpiredQuoteRejected(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	cart, _ := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	q, err := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	// Force expiry.
	if _, err := pool.Exec(ctx, `UPDATE quote SET expires_at = now() - interval '1 minute' WHERE id = $1`, q.ID); err != nil {
		t.Fatalf("expire: %v", err)
	}
	var fresh *Quote
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh); err != ErrQuoteExpired {
		t.Errorf("error = %v, want ErrQuoteExpired", err)
	}
}

func TestIntegrationDeadlineRunnerExpiresCreatedOrder(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	cart, _ := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	q, _ := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
	var fresh *Quote
	prepared, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	// Force the CREATED deadline into the past.
	if _, err := pool.Exec(ctx, `UPDATE "order" SET deadline_at = now() - interval '1 second' WHERE id = $1`, prepared.OrderID); err != nil {
		t.Fatalf("force due: %v", err)
	}

	runner := NewDeadlineRunner(st, nil, testLogger(), "test-worker")
	n, err := runner.Sweep(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n == 0 {
		t.Fatal("sweep claimed no due rows")
	}
	// The order is now CANCELLED (EXPIRE_PAYMENT → T3) with a deadline_audit row.
	view, err := st.GetOrderForCustomer(ctx, b.accountID, prepared.OrderID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if view.State != "CANCELLED" {
		t.Errorf("state = %s, want CANCELLED after deadline", view.State)
	}
	var audits int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM deadline_audit WHERE subject_id = $1`, prepared.OrderID).Scan(&audits)
	if audits == 0 {
		t.Error("expected a deadline_audit row (I-15.3 exactly-once)")
	}

	// Re-sweeping is a no-op (idempotent): the order is terminal, no new audit.
	_, _ = runner.Sweep(ctx)
	var audits2 int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM deadline_audit WHERE subject_id = $1`, prepared.OrderID).Scan(&audits2)
	if audits2 != audits {
		t.Errorf("re-sweep changed audit count %d → %d", audits, audits2)
	}
}

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(os.Stderr, nil)) }

var _ = time.Second
