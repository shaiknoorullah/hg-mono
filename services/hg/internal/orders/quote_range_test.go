package orders

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"testing"
)

// A delivery beyond the restaurant's delivery_radius_m is refused with 409
// ADDRESS_OUT_OF_RANGE, by the same measure and boundary as the restaurant
// card's OUT_OF_RANGE (C-14); within the radius it still quotes. createOrder
// resolves through the same gate, so an earlier quote cannot be placed once
// the address is out of range.
// https://github.com/shaiknoorullah/hg-mono/issues/723
func TestCreateQuote_RefusesDeliveryBeyondRadius(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	req := QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"}

	// The seeded address is about 90 m from the restaurant; the default radius
	// (8 km) covers it.
	q, err := st.CreateQuote(ctx, req)
	if err != nil {
		t.Fatalf("in-range quote: %v", err)
	}

	setRadius := func(m int) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE restaurant SET delivery_radius_m = $2 WHERE id = $1`, b.restaurantID, m); err != nil {
			t.Fatalf("set radius: %v", err)
		}
	}
	setRadius(50)

	if _, err := st.CreateQuote(ctx, req); !errors.Is(err, ErrAddressOutOfRange) {
		t.Fatalf("out-of-range quote: err = %v, want ErrAddressOutOfRange", err)
	}
	body := `{"cart_id":"` + cart.ID + `","delivery_address_id":"` + b.addressID + `","fulfilment":"DELIVERY"}`
	h := NewHandler(st, nil, slog.Default())
	if status, code := errorCode(t, b.accountID, h.CreateQuote, "/v1/quotes", body); status != http.StatusConflict || code != "ADDRESS_OUT_OF_RANGE" {
		t.Errorf("createQuote out of range = %d %s, want 409 ADDRESS_OUT_OF_RANGE", status, code)
	}
	var fresh *Quote
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh); !errors.Is(err, ErrAddressOutOfRange) {
		t.Errorf("createOrder from an earlier quote: err = %v, want ErrAddressOutOfRange", err)
	}

	// Back in range, the same cart quotes again.
	setRadius(8000)
	if _, err := st.CreateQuote(ctx, req); err != nil {
		t.Fatalf("quote after radius restored: %v", err)
	}
}
