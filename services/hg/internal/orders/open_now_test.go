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
)

// The order path refuses a restaurant that is not open now, by the rule the
// customer card shows (internal/openhours): outside its hours, on a closed day,
// paused, with its toggle off or with its order screen offline, adding a line,
// quoting and placing an order all fail with RESTAURANT_CLOSED, and the saved
// cart is kept but says why it cannot be quoted.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/648
func TestIntegrationOrderRefusesClosedRestaurant(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()

	t.Run("open: the order is placed", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		cart, err := st.GetCart(ctx, pc.accountID)
		if err != nil {
			t.Fatalf("get cart: %v", err)
		}
		if !cart.IsQuotable || cart.RestaurantAvailability != "OPEN" {
			t.Errorf("open cart: is_quotable = %v, availability = %q, blocking_reasons = %v",
				cart.IsQuotable, cart.RestaurantAvailability, cart.BlockingReasons)
		}
		var fresh *Quote
		if _, err := st.CreateOrder(ctx, OrderInput{AccountID: pc.accountID, QuoteID: pc.quoteID}, &fresh); err != nil {
			t.Fatalf("create order: %v", err)
		}
	})

	cases := []struct {
		name string
		// close makes the restaurant closed now; its args are the restaurant id.
		close string
		// card is what the cart's restaurant card shows (C-14).
		card string
	}{
		{"outside its hours", `
			WITH local AS (SELECT (now() AT TIME ZONE r.timezone) AS t FROM restaurant r WHERE r.id = $1),
			     gone AS (DELETE FROM restaurant_hours WHERE restaurant_id = $1)
			INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)
			SELECT $1, d, (t + interval '2 hours')::time, (t + interval '3 hours')::time,
			       (t + interval '3 hours')::time < (t + interval '2 hours')::time
			  FROM local CROSS JOIN generate_series(0, 6) AS d`, "CLOSED_HOURS"},
		{"closed today by an override", `
			INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed)
			SELECT r.id, (now() AT TIME ZONE r.timezone)::date, true FROM restaurant r WHERE r.id = $1`, "CLOSED_HOURS"},
		{"paused until later", `UPDATE restaurant SET pause_until = now() + interval '20 minutes' WHERE id = $1`, "PAUSED"},
		{"not accepting orders", `UPDATE restaurant SET is_accepting_orders = false WHERE id = $1`, "PAUSED"},
		{"order screen offline for 6 minutes", `UPDATE restaurant SET last_heartbeat_at = now() - interval '6 minutes' WHERE id = $1`, "PAUSED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pc := checkoutWhileCertified(t, st, pool)
			mustExec(t, pool, tc.close, pc.restaurantID)

			var fresh *Quote
			if _, err := st.CreateOrder(ctx, OrderInput{AccountID: pc.accountID, QuoteID: pc.quoteID}, &fresh); !errors.Is(err, ErrRestaurantClosed) {
				t.Errorf("create order from the quote taken while open: err = %v, want ErrRestaurantClosed", err)
			}
			var orders int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM "order" WHERE account_id = $1`, pc.accountID).Scan(&orders); err != nil {
				t.Fatalf("count orders: %v", err)
			}
			if orders != 0 {
				t.Errorf("%d order(s) written for a closed restaurant", orders)
			}
			if _, err := st.CreateQuote(ctx, QuoteRequest{
				AccountID: pc.accountID, CartID: pc.cartID, DeliveryAddressID: &pc.addressID, Fulfilment: "DELIVERY",
			}); !errors.Is(err, ErrRestaurantClosed) {
				t.Errorf("create quote: err = %v, want ErrRestaurantClosed", err)
			}
			if _, err := st.AddCartLine(ctx, pc.accountID, pc.restaurantID,
				CartLineInput{MenuItemID: pc.menuItemID, Quantity: 1}, false); !errors.Is(err, ErrRestaurantClosed) {
				t.Errorf("add cart line: err = %v, want ErrRestaurantClosed", err)
			}

			cart, err := st.GetCart(ctx, pc.accountID)
			if err != nil {
				t.Fatalf("get cart: %v", err)
			}
			if len(cart.Lines) != 1 || cart.ItemCount != 1 {
				t.Errorf("the cart must be kept as it was: %d lines, %d items", len(cart.Lines), cart.ItemCount)
			}
			if cart.IsQuotable || !slices.Contains(cart.BlockingReasons, "RESTAURANT_CLOSED") {
				t.Errorf("cart: is_quotable = %v, blocking_reasons = %v; want false with RESTAURANT_CLOSED",
					cart.IsQuotable, cart.BlockingReasons)
			}
			if cart.RestaurantAvailability != tc.card {
				t.Errorf("cart restaurant availability = %q, want %q", cart.RestaurantAvailability, tc.card)
			}
		})
	}

	// On the wire it is the contract's 409 RESTAURANT_CLOSED.
	rec := httptest.NewRecorder()
	NewHandler(nil, nil, slog.Default()).fail(rec, httptest.NewRequest(http.MethodPost, "/v1/quotes", nil),
		fmt.Errorf("create quote: %w", ErrRestaurantClosed))
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusConflict || env.Error.Code != "RESTAURANT_CLOSED" {
		t.Errorf("response = %d %s, want 409 RESTAURANT_CLOSED", rec.Code, env.Error.Code)
	}
}
