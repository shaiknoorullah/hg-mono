package testseed

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TwoGroupDish is a menu item with two required variant groups and one add-on
// group, the shape a cart line could not carry while it held one variant
// (https://github.com/shaiknoorullah/hg-mono/issues/628). Prices, in cents:
//
//	Size (required):  Regular ABSOLUTE 1500 (default), Large ABSOLUTE 2100
//	Rice (required):  Plain DELTA 0 (default), Biryani DELTA +350, Pulao DELTA +100 (switched off)
//	Sauces (choose 1 or 2): Raita 150, Toum 200, Chilli 50 (switched off)
//
// So Large + Biryani + one Raita is 2100 + 350 + 150 = 2600 a unit.
type TwoGroupDish struct {
	MenuItemID string
	SizeGroup  string
	RiceGroup  string
	Regular    string
	Large      string
	Plain      string
	Biryani    string
	Pulao      string // unavailable
	Raita      string
	Toum       string
	Chilli     string // unavailable
}

// SeedTwoGroupDish adds the TwoGroupDish's groups to an existing menu item.
// The rows go with the item: variant and add-on groups cascade from it.
func SeedTwoGroupDish(t testing.TB, pool *pgxpool.Pool, menuItemID string) TwoGroupDish {
	t.Helper()
	ctx := context.Background()
	d := TwoGroupDish{MenuItemID: menuItemID}
	one := func(dst *string, sql string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dst); err != nil {
			t.Fatalf("seed two-group dish: %v", err)
		}
	}
	group := `INSERT INTO variant_group (menu_item_id, name, required, sort_order) VALUES ($1, $2, true, $3) RETURNING id`
	absolute := `INSERT INTO variant (variant_group_id, name, pricing_mode, price_cents, is_default, sort_order)
	             VALUES ($1, $2, 'ABSOLUTE', $3, $4, $5) RETURNING id`
	delta := `INSERT INTO variant (variant_group_id, name, pricing_mode, delta_cents, is_default, is_available, sort_order)
	          VALUES ($1, $2, 'DELTA', $3, $4, $5, $6) RETURNING id`
	one(&d.SizeGroup, group, menuItemID, "Size", 0)
	one(&d.Regular, absolute, d.SizeGroup, "Regular", 1500, true, 0)
	one(&d.Large, absolute, d.SizeGroup, "Large", 2100, false, 1)
	one(&d.RiceGroup, group, menuItemID, "Rice", 1)
	one(&d.Plain, delta, d.RiceGroup, "Plain", 0, true, true, 0)
	one(&d.Biryani, delta, d.RiceGroup, "Biryani", 350, false, true, 1)
	one(&d.Pulao, delta, d.RiceGroup, "Pulao", 100, false, false, 2)

	var sauces string
	one(&sauces, `INSERT INTO addon_group (menu_item_id, name, min_select, max_select) VALUES ($1, 'Sauces', 1, 2) RETURNING id`, menuItemID)
	addon := `INSERT INTO addon (addon_group_id, name, price_cents, is_available) VALUES ($1, $2, $3, $4) RETURNING id`
	one(&d.Raita, addon, sauces, "Raita", 150, true)
	one(&d.Toum, addon, sauces, "Toum", 200, true)
	one(&d.Chilli, addon, sauces, "Chilli", 50, false)
	return d
}
