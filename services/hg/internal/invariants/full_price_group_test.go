package invariants

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// ---------------------------------------------------------------------------
// A dish has at most one variant group that sets its full price (owner
// decision, 2026-10-09). A group sets the full price when it holds an ABSOLUTE
// variant; the others must be DELTA, add-on amounts. Two full-price groups give
// a dish no single price, so the database refuses the menu, not the customer's
// cart (migration 00070, the variant_group_one_full_price index). The cart's
// 409 ITEM_UNAVAILABLE stays as a backstop.
// ---------------------------------------------------------------------------

func TestMenu_OneFullPriceGroupPerDish(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	ctx := context.Background()

	// One full-price group (Size, ABSOLUTE) plus an add-on group (Rice, DELTA)
	// is the shape the cart prices; the menu accepts it.
	d := testseed.SeedTwoGroupDish(t, pool, b.menuItemID)

	refused := func(t *testing.T, err error) {
		t.Helper()
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" || pgErr.ConstraintName != "variant_group_one_full_price" {
			t.Fatalf("want a unique violation on variant_group_one_full_price, got %v", err)
		}
	}

	t.Run("a second group with an ABSOLUTE variant is refused", func(t *testing.T) {
		var box string
		if err := pool.QueryRow(ctx,
			`INSERT INTO variant_group (menu_item_id, name, sort_order) VALUES ($1, 'Box', 2) RETURNING id`,
			b.menuItemID).Scan(&box); err != nil {
			t.Fatalf("an empty group sets no price and must be accepted: %v", err)
		}
		_, err := pool.Exec(ctx, `
			INSERT INTO variant (variant_group_id, name, pricing_mode, price_cents) VALUES ($1, 'Gift', 'ABSOLUTE', 2500)`, box)
		refused(t, err)

		// A DELTA variant in the same group is an add-on amount, and is accepted.
		if _, err := pool.Exec(ctx, `
			INSERT INTO variant (variant_group_id, name, pricing_mode, delta_cents) VALUES ($1, 'Gift', 'DELTA', 250)`, box); err != nil {
			t.Fatalf("a DELTA group beside one ABSOLUTE group must be accepted: %v", err)
		}
	})

	t.Run("switching an add-on group's variant to the full price is refused", func(t *testing.T) {
		_, err := pool.Exec(ctx, `
			UPDATE variant SET pricing_mode = 'ABSOLUTE', price_cents = 1850, delta_cents = NULL WHERE id = $1`, d.Biryani)
		refused(t, err)
	})

	t.Run("a value a writer supplies for the flag is ignored", func(t *testing.T) {
		_, err := pool.Exec(ctx, `UPDATE variant_group SET sets_full_price = true WHERE id = $1`, d.RiceGroup)
		if err != nil {
			t.Fatalf("update: %v", err)
		}
		var rice, size bool
		if err := pool.QueryRow(ctx, `
			SELECT (SELECT sets_full_price FROM variant_group WHERE id = $1),
			       (SELECT sets_full_price FROM variant_group WHERE id = $2)`,
			d.RiceGroup, d.SizeGroup).Scan(&rice, &size); err != nil {
			t.Fatalf("read flags: %v", err)
		}
		if rice || !size {
			t.Fatalf("flags = Rice %v, Size %v; want Rice false (all DELTA), Size true (ABSOLUTE)", rice, size)
		}
	})

	t.Run("once the full-price group is deleted, another group may set the price", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `UPDATE variant_group SET deleted_at = now() WHERE id = $1`, d.SizeGroup); err != nil {
			t.Fatalf("soft-delete Size: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			UPDATE variant SET pricing_mode = 'ABSOLUTE', price_cents = 1850, delta_cents = NULL WHERE id = $1`, d.Biryani); err != nil {
			t.Fatalf("with Size deleted, Rice may set the full price: %v", err)
		}
		// Restoring Size would make two full-price groups again.
		_, err := pool.Exec(ctx, `UPDATE variant_group SET deleted_at = NULL WHERE id = $1`, d.SizeGroup)
		refused(t, err)
	})
}
