package invariants

import (
	"context"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// ---------------------------------------------------------------------------
// Invariants 1 and 6 for a dish with two variant groups: the server prices the
// line from every chosen variant, the quote and the order carry the same
// decomposition, and the captured charge decomposes to zero residual.
// https://github.com/shaiknoorullah/hg-mono/issues/628
// ---------------------------------------------------------------------------

func TestServerPrices_TwoGroupDishPricedEndToEnd(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	d := testseed.SeedTwoGroupDish(t, pool, b.menuItemID)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)
	ctx := context.Background()

	// Two of: Large (ABSOLUTE 2100, replaces the 1500 base) + Biryani (DELTA
	// +350) + one Raita (150) = 2600 a unit, 5200 the line.
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, orders.CartLineInput{
		MenuItemID: b.menuItemID, Quantity: 2,
		VariantIDs: []string{d.Biryani, d.Large},
		Addons:     []orders.CartAddonInput{{AddonID: d.Raita, Quantity: 1}},
	}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	if cart.IndicativeSubtotalCents != 5200 {
		t.Fatalf("cart subtotal = %d, want 5200", cart.IndicativeSubtotalCents)
	}

	q, err := st.CreateQuote(ctx, orders.QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("create quote: %v", err)
	}
	if len(q.Lines) != 1 {
		t.Fatalf("quote has %d lines, want 1", len(q.Lines))
	}
	ql := q.Lines[0]
	if ql.BasePriceCents != 1500 || ql.VariantPartCents != 2450 || ql.AddonsPartCents != 150 ||
		ql.LineUnitCents != 2600 || ql.LineTotalCents != 5200 || q.SubtotalCents != 5200 {
		t.Fatalf("quote line = base %d, variant part %d, add-ons %d, unit %d, total %d (subtotal %d); "+
			"want 1500, 2450, 150, 2600, 5200 (5200)", ql.BasePriceCents, ql.VariantPartCents, ql.AddonsPartCents,
			ql.LineUnitCents, ql.LineTotalCents, q.SubtotalCents)
	}
	if len(ql.Variants) != 2 || ql.VariantName == nil || *ql.VariantName != "Large, Biryani" || ql.VariantID != nil {
		t.Errorf("quote line variants = %+v (name %v, id %v), want Large and Biryani, joined, with no single id",
			ql.Variants, ql.VariantName, ql.VariantID)
	}

	gw := localGateway{pay: pay, store: st}
	var fresh *orders.Quote
	prepared, err := st.CreateOrder(ctx, orders.OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if _, err := gw.CreateOrderIntent(ctx, orders.CreateIntentInput{
		OrderID: prepared.OrderID, QuoteID: q.ID, AccountID: b.accountID,
		RestaurantID: b.restaurantID, AmountCents: prepared.TotalCents, Currency: "cad",
	}); err != nil {
		t.Fatalf("authorise: %v", err)
	}

	// The order line copies the quote's decomposition, variant by variant.
	view, err := st.GetOrderForCustomer(ctx, b.accountID, prepared.OrderID)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	ol := view.Lines[0]
	if ol.UnitPriceCents != 2600 || ol.LineTotalCents != 5200 || len(ol.Variants) != 2 ||
		ol.Variants[0].VariantID != d.Large || ol.Variants[1].VariantID != d.Biryani {
		t.Fatalf("order line = unit %d, total %d, variants %+v; want 2600, 5200, Large then Biryani",
			ol.UnitPriceCents, ol.LineTotalCents, ol.Variants)
	}

	// Accept, capture, and post the capture batch the way the Stripe webhook
	// does: the charge decomposes across the parties with nothing left over.
	if _, err := restaurant.NewRepo(pool).AcceptOrder(ctx, b.restaurantID, prepared.OrderID, b.accountID, nil); err != nil {
		t.Fatalf("accept order: %v", err)
	}
	if err := (restaurantPay{svc: pay}).Capture(ctx, prepared.OrderID, prepared.TotalCents); err != nil {
		t.Fatalf("capture: %v", err)
	}
	repo := payments.NewRepo(pool)
	money, _, err := repo.GetOrderMoney(ctx, prepared.OrderID)
	if err != nil {
		t.Fatalf("order money: %v", err)
	}
	if money.SubtotalCents != 5200 {
		t.Fatalf("order subtotal = %d, want 5200", money.SubtotalCents)
	}
	if err := repo.PostBatch(ctx, payments.BuildCaptureBatch(money, "capture:"+prepared.OrderID, "system:capture")); err != nil {
		t.Fatalf("post capture batch: %v", err)
	}
	var residual, charged int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(sum(amount_cents), 0),
		       -COALESCE(sum(amount_cents) FILTER (WHERE account = 'CUSTOMER_CHARGES'), 0)
		  FROM ledger_entry WHERE order_id = $1`, prepared.OrderID).Scan(&residual, &charged); err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if residual != 0 || charged != prepared.TotalCents {
		t.Fatalf("ledger: residual %d, charged %d; want 0 and the order total %d", residual, charged, prepared.TotalCents)
	}
}
