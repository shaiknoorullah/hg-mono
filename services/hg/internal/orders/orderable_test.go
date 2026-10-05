package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The order path refuses a restaurant the platform cannot vouch for: adding a
// line, quoting and placing an order all fail with RESTAURANT_UNAVAILABLE.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/292

// TestOrderableFailsClosed pins the decision itself: only a listed, LIVE
// restaurant whose halal state, as of now and from admin-verified certificate
// data, is CERTIFIED or EXPIRING_SOON can take an order. A missing, NULL or
// unknown value refuses.
func TestOrderableFailsClosed(t *testing.T) {
	str := func(s string) *string { return &s }
	good := restaurantGate{Listed: true, AccountState: str("LIVE"), StoredHalal: str("CERTIFIED"), HalalNow: str("CERTIFIED")}
	cases := []struct {
		name string
		edit func(*restaurantGate)
		want bool
	}{
		{"verified and live", func(*restaurantGate) {}, true},
		{"expiring soon is still verified", func(g *restaurantGate) { g.HalalNow = str("EXPIRING_SOON") }, true},
		{"expired now, before any job re-derives the stored state", func(g *restaurantGate) { g.HalalNow = str("EXPIRED") }, false},
		{"no admin-verified certificate", func(g *restaurantGate) { g.HalalNow = str("UNVERIFIED") }, false},
		{"NULL halal state", func(g *restaurantGate) { g.HalalNow = nil }, false},
		{"unknown halal state", func(g *restaurantGate) { g.HalalNow = str("SELF_DECLARED") }, false},
		{"empty halal state", func(g *restaurantGate) { g.HalalNow = str("") }, false},
		{"hidden by the catalog", func(g *restaurantGate) { g.StoredHalal = str("EXPIRED") }, false},
		{"NULL stored halal state", func(g *restaurantGate) { g.StoredHalal = nil }, false},
		{"delisted", func(g *restaurantGate) { g.AccountState = str("DELISTED") }, false},
		{"suspended", func(g *restaurantGate) { g.AccountState = str("SUSPENDED") }, false},
		{"banned", func(g *restaurantGate) { g.AccountState = str("BANNED") }, false},
		{"pending approval", func(g *restaurantGate) { g.AccountState = str("PENDING") }, false},
		{"NULL account state", func(g *restaurantGate) { g.AccountState = nil }, false},
		{"soft-deleted", func(g *restaurantGate) { g.Listed = false }, false},
	}
	for _, tc := range cases {
		g := good
		tc.edit(&g)
		if got := g.orderable(); got != tc.want {
			t.Errorf("%s: orderable() = %v, want %v", tc.name, got, tc.want)
		}
	}
	if err := (restaurantGate{}).refuseUnorderable(); !errors.Is(err, ErrRestaurantUnavailable) {
		t.Errorf("the zero gate must refuse with ErrRestaurantUnavailable, got %v", err)
	}

	// On the wire it is the contract's 409 RESTAURANT_UNAVAILABLE, the code the
	// apps branch on to show the halal copy and keep the cart.
	rec := httptest.NewRecorder()
	NewHandler(nil, nil, slog.Default()).fail(rec, httptest.NewRequest(http.MethodPost, "/v1/orders", nil),
		fmt.Errorf("create order: %w", ErrRestaurantUnavailable))
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusConflict || env.Error.Code != "RESTAURANT_UNAVAILABLE" {
		t.Errorf("response = %d %s, want 409 RESTAURANT_UNAVAILABLE", rec.Code, env.Error.Code)
	}
}

// pastCheckout is a cart with one line and a quote, taken while the restaurant
// could still be vouched for.
type pastCheckout struct {
	basics
	cartID  string
	quoteID string
}

func checkoutWhileCertified(t *testing.T, st *Store, pool *pgxpool.Pool) pastCheckout {
	t.Helper()
	ctx := context.Background()
	b := seedBasics(t, pool) // certified for 300 days
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line while certified: %v", err)
	}
	q, err := st.CreateQuote(ctx, QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("quote while certified: %v", err)
	}
	return pastCheckout{basics: b, cartID: cart.ID, quoteID: q.ID}
}

// assertRefused checks that every step of the order path now refuses with
// RESTAURANT_UNAVAILABLE, in the order a client would try them: placing the
// order from the quote it already holds, quoting again, adding another line.
// No order row is written, and the saved cart is kept but is not quotable.
func assertRefused(t *testing.T, st *Store, pool *pgxpool.Pool, pc pastCheckout) {
	t.Helper()
	ctx := context.Background()

	var fresh *Quote
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: pc.accountID, QuoteID: pc.quoteID}, &fresh); !errors.Is(err, ErrRestaurantUnavailable) {
		t.Errorf("create order from the quote taken earlier: err = %v, want ErrRestaurantUnavailable", err)
	}
	var orders int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM "order" WHERE account_id = $1`, pc.accountID).Scan(&orders); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orders != 0 {
		t.Errorf("%d order(s) written for a restaurant that cannot take orders", orders)
	}

	if _, err := st.CreateQuote(ctx, QuoteRequest{
		AccountID: pc.accountID, CartID: pc.cartID, DeliveryAddressID: &pc.addressID, Fulfilment: "DELIVERY",
	}); !errors.Is(err, ErrRestaurantUnavailable) {
		t.Errorf("create quote: err = %v, want ErrRestaurantUnavailable", err)
	}

	if _, err := st.AddCartLine(ctx, pc.accountID, pc.restaurantID,
		CartLineInput{MenuItemID: pc.menuItemID, Quantity: 1}, false); !errors.Is(err, ErrRestaurantUnavailable) {
		t.Errorf("add cart line: err = %v, want ErrRestaurantUnavailable", err)
	}

	cart, err := st.GetCart(ctx, pc.accountID)
	if err != nil {
		t.Fatalf("get cart: %v", err)
	}
	if len(cart.Lines) != 1 || cart.ItemCount != 1 {
		t.Errorf("the cart must be kept as it was: %d lines, %d items", len(cart.Lines), cart.ItemCount)
	}
	if cart.IsQuotable || !slices.Contains(cart.BlockingReasons, "RESTAURANT_UNAVAILABLE") {
		t.Errorf("cart: is_quotable = %v, blocking_reasons = %v; want false with RESTAURANT_UNAVAILABLE",
			cart.IsQuotable, cart.BlockingReasons)
	}
}

// assertNoOptimisticBadge checks the cart does not show a halal badge for a
// restaurant whose certificate no longer vouches for it.
func assertNoOptimisticBadge(t *testing.T, st *Store, accountID, want string) {
	t.Helper()
	cart, err := st.GetCart(context.Background(), accountID)
	if err != nil {
		t.Fatalf("get cart: %v", err)
	}
	if cart.HalalStatus != want {
		t.Errorf("cart halal badge = %q, want %q", cart.HalalStatus, want)
	}
}

func TestIntegrationOrderRefusesRestaurantItCannotVouchFor(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()

	t.Run("verified and live: the order is placed", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		var fresh *Quote
		if _, err := st.CreateOrder(ctx, OrderInput{AccountID: pc.accountID, QuoteID: pc.quoteID}, &fresh); err != nil {
			t.Fatalf("create order: %v", err)
		}
	})

	t.Run("certificate expired, before any job has run", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		// The certificate's last day passes. The stored row is left as it stood
		// the day before: LIVE and CERTIFIED, the state a restaurant keeps until
		// something derives it again (https://github.com/shaiknoorullah/hg-mono/issues/252).
		// The catalog would still show it.
		mustExec(t, pool, `
			UPDATE halal_certificate SET issued_on = current_date - 367, expires_on = current_date - 2
			 WHERE restaurant_id = $1`, pc.restaurantID)
		mustExec(t, pool, `
			UPDATE restaurant SET halal_status = 'CERTIFIED', account_state = 'LIVE', delist_reasons = '{}'
			 WHERE id = $1`, pc.restaurantID)
		assertRefused(t, st, pool, pc)
		assertNoOptimisticBadge(t, st, pc.accountID, "EXPIRED")
	})

	for _, state := range []string{"DELISTED", "SUSPENDED", "BANNED"} {
		t.Run("restaurant "+state, func(t *testing.T) {
			pc := checkoutWhileCertified(t, st, pool)
			mustExec(t, pool, `UPDATE restaurant SET account_state = $2::restaurant_account_state WHERE id = $1`,
				pc.restaurantID, state)
			assertRefused(t, st, pool, pc)
		})
	}

	t.Run("no admin-verified certificate, while the stored row claims CERTIFIED", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		// The approval is withdrawn back to an unverified upload, while the
		// stored row still claims CERTIFIED. Only what an admin verified counts.
		mustExec(t, pool, `
			UPDATE halal_certificate SET status = 'PENDING', verified_by = NULL, verified_at = NULL
			 WHERE restaurant_id = $1`, pc.restaurantID)
		mustExec(t, pool, `UPDATE restaurant SET halal_status = 'CERTIFIED' WHERE id = $1`, pc.restaurantID)
		var halalNow *string
		if err := pool.QueryRow(ctx,
			`SELECT (halal_certification_at($1, now())).certificate_id::text`, pc.restaurantID).Scan(&halalNow); err != nil {
			t.Fatalf("read certification: %v", err)
		}
		if halalNow != nil {
			t.Fatalf("an unverified upload must not count as the restaurant's certificate, got %s", *halalNow)
		}
		assertRefused(t, st, pool, pc)
		assertNoOptimisticBadge(t, st, pc.accountID, "UNVERIFIED")
	})
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}
