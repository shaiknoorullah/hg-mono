package catalog

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// menuItemRow is the customer projection of a menu item plus its live version.
type menuItemRow struct {
	id                string
	categoryID        string
	name              string
	description       *string
	ingredientsText   *string
	priceCents        int64
	currency          string
	availabilityState string
	outOfStockUntil   *time.Time
	taxCategory       string
	prepMinutes       *int32
	dietaryTags       []string
	allergenTags      []string
}

// categoryRow is a menu category header.
type categoryRow struct {
	id          string
	name        string
	description *string
	sortOrder   int32
	isActive    bool
}

// getCustomerMenu loads the customer-facing menu for a visible restaurant:
// live_version content only, out-of-stock items returned and marked unavailable
// (never hidden), categories ordered by sort_order. HIDDEN items are excluded,
// OUT_OF_STOCK/BLOCKED are returned with their state.
func (rp *Repo) getCustomerMenu(ctx context.Context, restaurantID string) ([]categoryRow, map[string][]menuItemRow, error) {
	// First gate on visibility: a menu for an invisible restaurant is a 404.
	const gate = `SELECT 1 FROM restaurant r WHERE r.id = $1::uuid AND ` + visiblePredicate
	var one int
	if err := rp.db.QueryRow(ctx, gate, restaurantID).Scan(&one); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, errNotFound
		}
		return nil, nil, err
	}

	const catQ = `
		SELECT id, name, description, sort_order, is_active
		  FROM menu_category
		 WHERE restaurant_id = $1::uuid AND deleted_at IS NULL AND is_active
		 ORDER BY sort_order, name`
	catRows, err := rp.db.Query(ctx, catQ, restaurantID)
	if err != nil {
		return nil, nil, err
	}
	defer catRows.Close()
	var cats []categoryRow
	for catRows.Next() {
		var c categoryRow
		if err := catRows.Scan(&c.id, &c.name, &c.description, &c.sortOrder, &c.isActive); err != nil {
			return nil, nil, err
		}
		cats = append(cats, c)
	}
	if err := catRows.Err(); err != nil {
		return nil, nil, err
	}

	// Items joined to their live version. Only items with a published live
	// version are customer-visible; HIDDEN items are excluded.
	const itemQ = `
		SELECT mi.id, mi.category_id, mv.name, mv.description, mv.ingredients_text,
		       mi.price_cents, mi.currency::text, mi.availability_state::text,
		       mi.out_of_stock_until, mi.tax_category::text, mi.prep_minutes,
		       mv.dietary_tags::text[], mv.allergen_tags::text[]
		  FROM menu_item mi
		  JOIN menu_item_version mv ON mv.id = mi.live_version_id
		 WHERE mi.restaurant_id = $1::uuid
		   AND mi.deleted_at IS NULL
		   AND mi.availability_state <> 'HIDDEN'
		 ORDER BY mi.sort_order, mv.name`
	itemRows, err := rp.db.Query(ctx, itemQ, restaurantID)
	if err != nil {
		return nil, nil, err
	}
	defer itemRows.Close()
	byCat := map[string][]menuItemRow{}
	for itemRows.Next() {
		var it menuItemRow
		if err := itemRows.Scan(&it.id, &it.categoryID, &it.name, &it.description, &it.ingredientsText,
			&it.priceCents, &it.currency, &it.availabilityState, &it.outOfStockUntil,
			&it.taxCategory, &it.prepMinutes, &it.dietaryTags, &it.allergenTags); err != nil {
			return nil, nil, err
		}
		byCat[it.categoryID] = append(byCat[it.categoryID], it)
	}
	return cats, byCat, itemRows.Err()
}

// variantGroupRow / variantRow / addonGroupRow / addonRow are the option rows for
// a single item.
type variantGroupRow struct {
	id       string
	name     string
	required bool
}
type variantRow struct {
	groupID     string
	id          string
	name        string
	pricingMode string
	priceCents  *int64
	deltaCents  *int64
	isDefault   bool
	isAvailable bool
}
type addonGroupRow struct {
	id        string
	name      string
	minSelect int32
	maxSelect int32
}
type addonRow struct {
	groupID     string
	id          string
	name        string
	priceCents  int64
	isAvailable bool
}

// getItemOptions loads variant and add-on groups for a set of item ids in two
// queries, avoiding an N+1 across a menu.
func (rp *Repo) getItemOptions(ctx context.Context, itemIDs []string) (
	map[string][]variantGroupRow, map[string][]variantRow,
	map[string][]addonGroupRow, map[string][]addonRow, error) {
	vGroups := map[string][]variantGroupRow{}
	variants := map[string][]variantRow{}
	aGroups := map[string][]addonGroupRow{}
	addons := map[string][]addonRow{}
	if len(itemIDs) == 0 {
		return vGroups, variants, aGroups, addons, nil
	}

	const vgQ = `
		SELECT menu_item_id::text, id::text, name, required
		  FROM variant_group
		 WHERE menu_item_id = ANY($1::uuid[]) AND deleted_at IS NULL
		 ORDER BY sort_order, name`
	vgRows, err := rp.db.Query(ctx, vgQ, itemIDs)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	var groupIDs []string
	for vgRows.Next() {
		var itemID string
		var g variantGroupRow
		if err := vgRows.Scan(&itemID, &g.id, &g.name, &g.required); err != nil {
			vgRows.Close()
			return nil, nil, nil, nil, err
		}
		vGroups[itemID] = append(vGroups[itemID], g)
		groupIDs = append(groupIDs, g.id)
	}
	vgRows.Close()
	if err := vgRows.Err(); err != nil {
		return nil, nil, nil, nil, err
	}

	if len(groupIDs) > 0 {
		const vQ = `
			SELECT variant_group_id::text, id::text, name, pricing_mode::text,
			       price_cents, delta_cents, is_default, is_available
			  FROM variant
			 WHERE variant_group_id = ANY($1::uuid[]) AND deleted_at IS NULL
			 ORDER BY sort_order, name`
		vRows, err := rp.db.Query(ctx, vQ, groupIDs)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		for vRows.Next() {
			var v variantRow
			if err := vRows.Scan(&v.groupID, &v.id, &v.name, &v.pricingMode,
				&v.priceCents, &v.deltaCents, &v.isDefault, &v.isAvailable); err != nil {
				vRows.Close()
				return nil, nil, nil, nil, err
			}
			variants[v.groupID] = append(variants[v.groupID], v)
		}
		vRows.Close()
		if err := vRows.Err(); err != nil {
			return nil, nil, nil, nil, err
		}
	}

	const agQ = `
		SELECT menu_item_id::text, id::text, name, min_select, max_select
		  FROM addon_group
		 WHERE menu_item_id = ANY($1::uuid[]) AND deleted_at IS NULL
		 ORDER BY sort_order, name`
	agRows, err := rp.db.Query(ctx, agQ, itemIDs)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	var addonGroupIDs []string
	for agRows.Next() {
		var itemID string
		var g addonGroupRow
		if err := agRows.Scan(&itemID, &g.id, &g.name, &g.minSelect, &g.maxSelect); err != nil {
			agRows.Close()
			return nil, nil, nil, nil, err
		}
		aGroups[itemID] = append(aGroups[itemID], g)
		addonGroupIDs = append(addonGroupIDs, g.id)
	}
	agRows.Close()
	if err := agRows.Err(); err != nil {
		return nil, nil, nil, nil, err
	}

	if len(addonGroupIDs) > 0 {
		const aQ = `
			SELECT addon_group_id::text, id::text, name, price_cents, is_available
			  FROM addon
			 WHERE addon_group_id = ANY($1::uuid[]) AND deleted_at IS NULL
			 ORDER BY sort_order, name`
		aRows, err := rp.db.Query(ctx, aQ, addonGroupIDs)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		for aRows.Next() {
			var a addonRow
			if err := aRows.Scan(&a.groupID, &a.id, &a.name, &a.priceCents, &a.isAvailable); err != nil {
				aRows.Close()
				return nil, nil, nil, nil, err
			}
			addons[a.groupID] = append(addons[a.groupID], a)
		}
		aRows.Close()
		if err := aRows.Err(); err != nil {
			return nil, nil, nil, nil, err
		}
	}

	return vGroups, variants, aGroups, addons, nil
}
