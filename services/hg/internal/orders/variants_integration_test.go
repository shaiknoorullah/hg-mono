package orders

import (
	"context"
	"errors"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// A cart line carries one variant per variant group, and the server checks it
// against the menu before the cart changes
// (https://github.com/shaiknoorullah/hg-mono/issues/628,
// https://github.com/shaiknoorullah/hg-mono/issues/629).

// TestIntegrationAddCartLineRefusesWhatTheMenuDoesNotAllow: each line the menu
// does not allow is refused with the field that is wrong, and the cart is
// never created.
func TestIntegrationAddCartLineRefusesWhatTheMenuDoesNotAllow(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)
	d := testseed.SeedTwoGroupDish(t, pool, b.menuItemID)

	// A second item on the same menu, with a variant of its own.
	var otherItem, otherGroup, otherVariant string
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		SELECT restaurant_id, category_id, 900, 'AVAILABLE', 'PREPARED_FOOD' FROM menu_item WHERE id = $1
		RETURNING id`, b.menuItemID).Scan(&otherItem); err != nil {
		t.Fatalf("seed other item: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO variant_group (menu_item_id, name) VALUES ($1, 'Spice') RETURNING id`,
		otherItem).Scan(&otherGroup); err != nil {
		t.Fatalf("seed other group: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO variant (variant_group_id, name, pricing_mode, delta_cents) VALUES ($1, 'Mild', 'DELTA', 0) RETURNING id`,
		otherGroup).Scan(&otherVariant); err != nil {
		t.Fatalf("seed other variant: %v", err)
	}

	raita := []CartAddonInput{{AddonID: d.Raita, Quantity: 1}}
	type want struct {
		code, field, fieldCode string
	}
	for _, tc := range []struct {
		name string
		in   CartLineInput
		want want
	}{
		{"a required group with no choice",
			CartLineInput{VariantIDs: []string{d.Large}, Addons: raita},
			want{"VALIDATION_FAILED", "variant_ids", "required_group_missing"}},
		{"a variant from another item",
			CartLineInput{VariantIDs: []string{d.Large, otherVariant}, Addons: raita},
			want{"VALIDATION_FAILED", "variant_ids[1]", "not_on_item"}},
		{"two variants from one group",
			CartLineInput{VariantIDs: []string{d.Large, d.Regular, d.Plain}, Addons: raita},
			want{"VALIDATION_FAILED", "variant_ids[1]", "one_per_group"}},
		{"an add-on group below its minimum",
			CartLineInput{VariantIDs: []string{d.Large, d.Plain}},
			want{"VALIDATION_FAILED", "addons", "min_select"}},
		{"an add-on that is not the item's",
			CartLineInput{VariantIDs: []string{d.Large, d.Plain}, Addons: []CartAddonInput{{AddonID: d.Raita, Quantity: 1}, {AddonID: otherVariant, Quantity: 1}}},
			want{"INVALID_ADDON", "addons[1]", "not_on_item"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.in.MenuItemID, tc.in.Quantity = b.menuItemID, 1
			_, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, tc.in, false)
			var lv *LineValidationError
			if !errors.As(err, &lv) {
				t.Fatalf("err = %v, want a LineValidationError (422)", err)
			}
			if string(lv.Code) != tc.want.code {
				t.Errorf("code = %s, want %s", lv.Code, tc.want.code)
			}
			found := false
			for _, f := range lv.Fields {
				found = found || (f.Field == tc.want.field && f.Code == tc.want.fieldCode)
			}
			if !found {
				t.Errorf("fields = %+v, want %s/%s among them", lv.Fields, tc.want.field, tc.want.fieldCode)
			}
		})
	}

	// On the item, but switched off: 409 naming the choice.
	_, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 1, VariantIDs: []string{d.Large, d.Pulao}, Addons: raita}, false)
	var vu *VariantUnavailableError
	if !errors.As(err, &vu) || vu.VariantID != d.Pulao {
		t.Errorf("unavailable variant: err = %v, want VariantUnavailableError{%s}", err, d.Pulao)
	}
	_, err = st.AddCartLine(ctx, b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 1, VariantIDs: []string{d.Large, d.Plain},
			Addons: []CartAddonInput{{AddonID: d.Chilli, Quantity: 1}}}, false)
	var au *AddonUnavailableError
	if !errors.As(err, &au) || au.AddonID != d.Chilli {
		t.Errorf("unavailable add-on: err = %v, want AddonUnavailableError{%s}", err, d.Chilli)
	}

	// Nothing above reached the cart.
	cart, err := st.GetCart(ctx, b.accountID)
	if err != nil {
		t.Fatalf("get cart: %v", err)
	}
	if len(cart.Lines) != 0 {
		t.Errorf("cart has %d lines after only refused adds, want 0", len(cart.Lines))
	}
}

// TestIntegrationMultiVariantLineIdentity: the same choices merge into one
// line whatever order the variants arrive in, and an add-on quantity of 0 is
// the stored quantity of 1; a different choice is a different line.
func TestIntegrationMultiVariantLineIdentity(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)
	d := testseed.SeedTwoGroupDish(t, pool, b.menuItemID)

	add := func(variants []string, raitaQty int) *Cart {
		t.Helper()
		c, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{
			MenuItemID: b.menuItemID, Quantity: 1, VariantIDs: variants,
			Addons: []CartAddonInput{{AddonID: d.Raita, Quantity: raitaQty}},
		}, false)
		if err != nil {
			t.Fatalf("add %v: %v", variants, err)
		}
		return c
	}
	add([]string{d.Large, d.Biryani}, 1)
	c := add([]string{d.Biryani, d.Large}, 0) // same choices, other order; 0 is stored as 1
	if len(c.Lines) != 1 || c.Lines[0].Quantity != 2 {
		t.Fatalf("identical choices: %d lines (quantity %d), want 1 line of 2", len(c.Lines), c.Lines[0].Quantity)
	}
	line := c.Lines[0]
	if len(line.Variants) != 2 || line.Variants[0].VariantID != d.Large || line.Variants[1].VariantID != d.Biryani {
		t.Errorf("variants = %+v, want Large then Biryani (the menu's group order)", line.Variants)
	}
	if line.Variant != nil {
		t.Errorf("the deprecated one-variant field = %+v, want nil for a two-variant line", line.Variant)
	}
	// 2100 (Large replaces the base) + 350 (Biryani) + 150 (Raita).
	if line.UnitPriceCents != 2600 {
		t.Errorf("indicative unit = %d, want 2600", line.UnitPriceCents)
	}

	c = add([]string{d.Large, d.Plain}, 1)
	if len(c.Lines) != 2 {
		t.Fatalf("a different rice: %d lines, want 2", len(c.Lines))
	}
}

// TestIntegrationDifferentRestaurantNamesTheCart: the 409 carries what the
// "Start a new cart?" dialog says (C-20).
func TestIntegrationDifferentRestaurantNamesTheCart(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b := seedBasics(t, pool)
	other := seedBasics(t, pool)

	if _, err := st.AddCartLine(ctx, b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 3}, false); err != nil {
		t.Fatalf("add: %v", err)
	}
	_, err := st.AddCartLine(ctx, b.accountID, other.restaurantID,
		CartLineInput{MenuItemID: other.menuItemID, Quantity: 1}, false)
	var dr *DifferentRestaurantError
	if !errors.As(err, &dr) || !errors.Is(err, ErrDifferentRestaurant) {
		t.Fatalf("err = %v, want DifferentRestaurantError", err)
	}
	if dr.RestaurantID != b.restaurantID || dr.RestaurantName != "Test Kitchen" || dr.LineCount != 1 || dr.ItemCount != 3 {
		t.Errorf("details = %+v, want the first restaurant, 1 line, 3 items", dr)
	}
}
