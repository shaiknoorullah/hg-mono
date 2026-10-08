package orders

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
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
	// unique parts are random: a UUIDv7's leading characters are the clock, so
	// two seeds in the same moment used to collide.
	err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('it-'||substr(gen_random_uuid()::text,1,12)||'@test.local', 'ACTIVE') RETURNING id`).Scan(&b.accountID)
	if err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// restaurant: LIVE + accepting + Ontario + a Toronto location. The slug is
	// random: a UUIDv7's first eight characters are its timestamp and repeat
	// for about a minute, so two restaurants seeded in that minute collided.
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

	testseed.CleanUpOrderFixtures(t, pool, b.accountID, b.restaurantID)
	// Certified through the real chain (an admin-verified certificate): the
	// order path refuses a restaurant the platform cannot vouch for.
	// https://github.com/shaiknoorullah/hg-mono/issues/292
	testseed.CertifyRestaurant(t, pool, b.restaurantID, 300)
	// Open now: hours and a fresh order screen (open_now.go).
	// https://github.com/shaiknoorullah/hg-mono/issues/648
	testseed.OpenRestaurant(t, pool, b.restaurantID)
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

// A menu item deleted after it was put in a cart stays in the cart annotated
// ITEM_DELETED (never silently removed), is refused by the quote exactly as an
// unavailable item is, and cannot reach an order through a quote taken before
// the delete. An item never deleted still quotes
// (https://github.com/shaiknoorullah/hg-mono/issues/513). It runs on a database
// of its own so it runs in CI too, where HG_TEST_POSTGRES_DSN is unset and
// FreshDatabase starts a container.
func TestIntegrationDeletedItemUnavailableInCartAndRefusedByQuote(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), testseed.FreshDatabase(t, "hg_orders_deleted_item"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	// A second item in the same restaurant that is never deleted.
	var keptItemID string
	err = pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		SELECT restaurant_id, category_id, 900, 'AVAILABLE', 'PREPARED_FOOD' FROM menu_item WHERE id = $1
		RETURNING id`, b.menuItemID).Scan(&keptItemID)
	if err != nil {
		t.Fatalf("seed second menu_item: %v", err)
	}

	if _, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false); err != nil {
		t.Fatalf("add deleted-to-be item: %v", err)
	}
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: keptItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add kept item: %v", err)
	}
	quoteReq := QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"}
	preDelete, err := st.CreateQuote(ctx, quoteReq)
	if err != nil {
		t.Fatalf("quote before delete: %v", err)
	}

	// The restaurant (deleteMenuItem) or an admin on its behalf
	// (deleteMenuItemOnBehalf) soft-deletes the item; the row stays AVAILABLE.
	if _, err := pool.Exec(ctx, `UPDATE menu_item SET deleted_at = now() WHERE id = $1`, b.menuItemID); err != nil {
		t.Fatalf("delete item: %v", err)
	}

	// The cart keeps the line, annotated unavailable with ITEM_DELETED.
	got, err := st.GetCart(ctx, b.accountID)
	if err != nil {
		t.Fatalf("get cart: %v", err)
	}
	if len(got.Lines) != 2 {
		t.Fatalf("cart lines = %d, want 2 (a deleted item's line is never silently removed)", len(got.Lines))
	}
	var deletedLineID string
	for _, l := range got.Lines {
		switch l.MenuItemID {
		case b.menuItemID:
			deletedLineID = l.ID
			if l.IsAvailable {
				t.Error("deleted item's line is_available = true, want false")
			}
			if l.UnavailReason == nil || *l.UnavailReason != "ITEM_DELETED" {
				t.Errorf("deleted item's unavailable_reason = %v, want ITEM_DELETED", l.UnavailReason)
			}
		case keptItemID:
			if !l.IsAvailable || l.UnavailReason != nil {
				t.Errorf("kept item's line available=%v reason=%v, want available with no reason", l.IsAvailable, l.UnavailReason)
			}
		}
	}

	// The quote refuses it exactly as it refuses an unavailable item.
	if _, err := st.CreateQuote(ctx, quoteReq); !errors.Is(err, ErrItemUnavailable) {
		t.Fatalf("quote with deleted item error = %v, want ErrItemUnavailable", err)
	}

	// A quote taken before the delete cannot carry the item into an order.
	var fresh *Quote
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: preDelete.ID}, &fresh); !errors.Is(err, ErrItemUnavailable) {
		t.Fatalf("order from pre-delete quote error = %v, want ErrItemUnavailable", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM "order" WHERE account_id=$1`, b.accountID).Scan(&n); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if n != 0 {
		t.Errorf("an order was created holding a deleted item: %d", n)
	}

	// Once the customer removes the deleted line, the never-deleted item quotes.
	if _, err := st.RemoveCartLine(ctx, b.accountID, deletedLineID); err != nil {
		t.Fatalf("remove deleted line: %v", err)
	}
	q, err := st.CreateQuote(ctx, quoteReq)
	if err != nil {
		t.Fatalf("quote with only the kept item: %v", err)
	}
	if q.SubtotalCents != 900 {
		t.Errorf("subtotal = %d, want 900", q.SubtotalCents)
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

// A restaurant the weekly payout run has blocked for a balance below zero too
// long (restaurant_collection, internal/payments/payout_run.go) gets no quote,
// and so no order, until the block is lifted. Whether to block at all is the
// owner's open question: https://github.com/shaiknoorullah/hg-mono/issues/164.
func TestIntegrationQuoteRefusedWhileRestaurantBlockedForNegativeBalance(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)

	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	quote := func() error {
		_, err := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: cart.ID,
			DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"})
		return err
	}
	if err := quote(); err != nil {
		t.Fatalf("quote before the block: %v", err)
	}

	var runID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO payout_run (kind, period_start, period_end, as_of, due_at)
		VALUES ('SCHEDULED', now() - interval '7 days', now(), now(), now()) RETURNING id`).Scan(&runID); err != nil {
		t.Fatalf("seed payout run: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_collection WHERE restaurant_id = $1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM payout_run WHERE id = $1`, runID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_collection (restaurant_id, balance_cents, negative_since, opened_by_run)
		VALUES ($1, -500, now() - interval '31 days', $2)`, b.restaurantID, runID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if err := quote(); err != ErrRestaurantClosed {
		t.Fatalf("quote while blocked: err = %v, want ErrRestaurantClosed", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE restaurant_collection SET closed_at = now(), closed_by_run = $2, close_reason = 'BALANCE_RECOVERED'
		 WHERE restaurant_id = $1`, b.restaurantID, runID); err != nil {
		t.Fatalf("lift: %v", err)
	}
	if err := quote(); err != nil {
		t.Fatalf("quote after the block lifts: %v", err)
	}
}
