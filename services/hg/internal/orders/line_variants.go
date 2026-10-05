package orders

// line_variants.go checks an add-to-cart line against the item's menu and reads
// a cart's chosen variants. A line carries one chosen variant per variant group
// (https://github.com/shaiknoorullah/hg-mono/issues/628), and the server, not
// the app, decides whether the line is one the menu allows
// (https://github.com/shaiknoorullah/hg-mono/issues/629).

import (
	"context"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// LineValidationError is a line the item's variant and add-on groups do not
// allow: 422 with a FieldError per problem. Code is VALIDATION_FAILED, or
// INVALID_ADDON when every problem is an add-on that is not one of the item's.
type LineValidationError struct {
	Code   httpx.ErrorCode
	Fields []httpx.FieldError
}

func (e *LineValidationError) Error() string {
	return fmt.Sprintf("cart line not allowed by the menu: %d problem(s)", len(e.Fields))
}

// VariantUnavailableError is a chosen variant that is on the item but cannot be
// ordered now (switched off or removed): 409 VARIANT_UNAVAILABLE {variant_id}.
type VariantUnavailableError struct{ VariantID string }

func (e *VariantUnavailableError) Error() string {
	return "variant " + e.VariantID + " is unavailable"
}

// AddonUnavailableError is a chosen add-on that is on the item but cannot be
// ordered now: 409 ADDON_UNAVAILABLE {addon_id}.
type AddonUnavailableError struct{ AddonID string }

func (e *AddonUnavailableError) Error() string {
	return "add-on " + e.AddonID + " is unavailable"
}

// DifferentRestaurantError is ErrDifferentRestaurant on addCartLine, with what
// the "Start a new cart?" dialog names (C-20): the cart's restaurant, its line
// count and its item count.
type DifferentRestaurantError struct {
	RestaurantID   string
	RestaurantName string
	LineCount      int
	ItemCount      int
}

func (e *DifferentRestaurantError) Error() string { return ErrDifferentRestaurant.Error() }

// Is lets errors.Is(err, ErrDifferentRestaurant) match.
func (e *DifferentRestaurantError) Is(target error) bool { return target == ErrDifferentRestaurant }

func amountPtr(c *int64) *money.Amount {
	if c == nil {
		return nil
	}
	a := money.Amount(*c)
	return &a
}

func centsPtr(a *money.Amount) *int64 {
	if a == nil {
		return nil
	}
	c := a.Cents()
	return &c
}

// differentRestaurant builds the 409 details from the account's current cart.
func differentRestaurant(ctx context.Context, tx pgx.Tx, cartID string) error {
	e := &DifferentRestaurantError{}
	err := tx.QueryRow(ctx, `
		SELECT r.id, r.display_name, count(cl.id), COALESCE(sum(cl.quantity), 0)
		  FROM cart c
		  JOIN restaurant r ON r.id = c.restaurant_id
		  LEFT JOIN cart_line cl ON cl.cart_id = c.id
		 WHERE c.id = $1
		 GROUP BY r.id, r.display_name`, cartID).
		Scan(&e.RestaurantID, &e.RestaurantName, &e.LineCount, &e.ItemCount)
	if err != nil {
		return fmt.Errorf("read the current cart for DIFFERENT_RESTAURANT: %w", err)
	}
	return e
}

// loadCartLineVariants reads every chosen variant of a cart's lines, keyed by
// line id and in the menu's group order, with the menu's current names and
// money. gone marks a line holding a variant, or a variant group, that has been
// switched off or removed since it was added.
func loadCartLineVariants(ctx context.Context, tx pgx.Tx, cartID string) (map[string][]pricing.VariantChoice, map[string]bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT clv.cart_line_id, vg.id, vg.name, v.id, v.name, v.pricing_mode::text,
		       v.price_cents, v.delta_cents,
		       v.is_available AND v.deleted_at IS NULL AND vg.deleted_at IS NULL
		  FROM cart_line_variant clv
		  JOIN cart_line cl ON cl.id = clv.cart_line_id
		  JOIN variant v ON v.id = clv.variant_id
		  JOIN variant_group vg ON vg.id = clv.variant_group_id
		 WHERE cl.cart_id = $1
		 ORDER BY clv.cart_line_id, vg.sort_order, vg.id`, cartID)
	if err != nil {
		return nil, nil, fmt.Errorf("load cart line variants: %w", err)
	}
	defer rows.Close()
	byLine := map[string][]pricing.VariantChoice{}
	gone := map[string]bool{}
	for rows.Next() {
		var lineID string
		var v pricing.VariantChoice
		var price, delta *int64
		var live bool
		if err := rows.Scan(&lineID, &v.VariantGroupID, &v.GroupName, &v.VariantID, &v.Name, &v.PricingMode,
			&price, &delta, &live); err != nil {
			return nil, nil, err
		}
		v.PriceCents, v.DeltaCents = amountPtr(price), amountPtr(delta)
		byLine[lineID] = append(byLine[lineID], v)
		if !live {
			gone[lineID] = true
		}
	}
	return byLine, gone, rows.Err()
}

// checkLineAgainstMenu checks a line against the item's variant and add-on
// groups, read inside the add's transaction, and returns the chosen variants
// in the menu's group order. In order: anything the menu does not allow is a
// LineValidationError (422, every problem at once); then a chosen variant or
// add-on that is switched off or removed is a VariantUnavailableError or
// AddonUnavailableError (409); then a combination the price rule cannot price
// is ErrItemUnavailable. basePriceCents is the item's price.
func checkLineAgainstMenu(ctx context.Context, tx pgx.Tx, in CartLineInput, basePriceCents int64) ([]pricing.VariantChoice, error) {
	type menuVariant struct {
		choice    pricing.VariantChoice
		available bool
		deleted   bool
	}
	type menuGroup struct {
		id, name string
		required bool
		live     int // variants not removed
	}
	vRows, err := tx.Query(ctx, `
		SELECT vg.id, vg.name, vg.required, v.id, v.name, v.pricing_mode::text,
		       v.price_cents, v.delta_cents, v.is_available, v.deleted_at IS NOT NULL
		  FROM variant_group vg
		  JOIN variant v ON v.variant_group_id = vg.id
		 WHERE vg.menu_item_id = $1 AND vg.deleted_at IS NULL
		 ORDER BY vg.sort_order, vg.id, v.sort_order, v.id`, in.MenuItemID)
	if err != nil {
		return nil, fmt.Errorf("read variant groups: %w", err)
	}
	var groups []*menuGroup
	groupByID := map[string]*menuGroup{}
	variants := map[string]menuVariant{}
	for vRows.Next() {
		var g menuGroup
		var mv menuVariant
		var price, delta *int64
		if err := vRows.Scan(&g.id, &g.name, &g.required, &mv.choice.VariantID, &mv.choice.Name,
			&mv.choice.PricingMode, &price, &delta, &mv.available, &mv.deleted); err != nil {
			vRows.Close()
			return nil, err
		}
		mv.choice.VariantGroupID, mv.choice.GroupName = g.id, g.name
		mv.choice.PriceCents, mv.choice.DeltaCents = amountPtr(price), amountPtr(delta)
		gp, ok := groupByID[g.id]
		if !ok {
			gp = &g
			groupByID[g.id] = gp
			groups = append(groups, gp)
		}
		if !mv.deleted {
			gp.live++
		}
		variants[mv.choice.VariantID] = mv
	}
	if err := vRows.Err(); err != nil {
		vRows.Close()
		return nil, err
	}
	vRows.Close()

	type menuAddon struct {
		groupID   string
		available bool
		deleted   bool
	}
	type addonGroup struct {
		id, name             string
		minSelect, maxSelect int
	}
	aRows, err := tx.Query(ctx, `
		SELECT ag.id, ag.name, ag.min_select, ag.max_select, a.id, a.is_available, a.deleted_at IS NOT NULL
		  FROM addon_group ag
		  LEFT JOIN addon a ON a.addon_group_id = ag.id
		 WHERE ag.menu_item_id = $1 AND ag.deleted_at IS NULL
		 ORDER BY ag.sort_order, ag.id`, in.MenuItemID)
	if err != nil {
		return nil, fmt.Errorf("read add-on groups: %w", err)
	}
	var addonGroups []*addonGroup
	addonGroupByID := map[string]*addonGroup{}
	addons := map[string]menuAddon{}
	for aRows.Next() {
		var g addonGroup
		var addonID *string
		var available, deleted *bool
		if err := aRows.Scan(&g.id, &g.name, &g.minSelect, &g.maxSelect, &addonID, &available, &deleted); err != nil {
			aRows.Close()
			return nil, err
		}
		if _, ok := addonGroupByID[g.id]; !ok {
			gp := g
			addonGroupByID[g.id] = &gp
			addonGroups = append(addonGroups, &gp)
		}
		if addonID != nil {
			addons[*addonID] = menuAddon{groupID: g.id, available: *available, deleted: *deleted}
		}
	}
	if err := aRows.Err(); err != nil {
		aRows.Close()
		return nil, err
	}
	aRows.Close()

	// What the menu does not allow, every problem at once.
	var fields []httpx.FieldError
	onlyInvalidAddons := true
	problem := func(field, code, msg string, invalidAddon bool) {
		fields = append(fields, httpx.FieldError{Field: field, Code: code, Message: msg})
		if !invalidAddon {
			onlyInvalidAddons = false
		}
	}
	chosenInGroup := map[string]string{}
	seenVariant := map[string]bool{}
	for i, id := range in.VariantIDs {
		field := "variant_ids[" + strconv.Itoa(i) + "]"
		mv, ok := variants[id]
		switch {
		case seenVariant[id]:
			problem(field, "duplicate", "This variant is chosen twice.", false)
		case !ok:
			problem(field, "not_on_item", "This variant is not one of this item's.", false)
		case chosenInGroup[mv.choice.VariantGroupID] != "":
			problem(field, "one_per_group", "Choose one "+mv.choice.GroupName+", not two.", false)
		default:
			chosenInGroup[mv.choice.VariantGroupID] = id
		}
		seenVariant[id] = true
	}
	for _, g := range groups {
		if g.required && g.live > 0 && chosenInGroup[g.id] == "" {
			problem("variant_ids", "required_group_missing", "Choose a "+g.name+".", false)
		}
	}
	selectedInGroup := map[string]int{}
	seenAddon := map[string]bool{}
	for i, a := range in.Addons {
		field := "addons[" + strconv.Itoa(i) + "]"
		ma, ok := addons[a.AddonID]
		switch {
		case seenAddon[a.AddonID]:
			problem(field, "duplicate", "This add-on is chosen twice; set its quantity instead.", false)
		case !ok:
			problem(field, "not_on_item", "This add-on is not one of this item's.", true)
		default:
			selectedInGroup[ma.groupID]++
		}
		seenAddon[a.AddonID] = true
	}
	for _, g := range addonGroups {
		n := selectedInGroup[g.id]
		if n < g.minSelect {
			problem("addons", "min_select", fmt.Sprintf("Choose at least %d from %s.", g.minSelect, g.name), false)
		}
		if n > g.maxSelect {
			problem("addons", "max_select", fmt.Sprintf("Choose at most %d from %s.", g.maxSelect, g.name), false)
		}
	}
	if len(fields) > 0 {
		code := codeValidationFailed
		if onlyInvalidAddons {
			code = codeInvalidAddon
		}
		return nil, &LineValidationError{Code: code, Fields: fields}
	}

	// On the item, but not orderable now.
	for _, id := range in.VariantIDs {
		if mv := variants[id]; mv.deleted || !mv.available {
			return nil, &VariantUnavailableError{VariantID: id}
		}
	}
	for _, a := range in.Addons {
		if ma := addons[a.AddonID]; ma.deleted || !ma.available {
			return nil, &AddonUnavailableError{AddonID: a.AddonID}
		}
	}

	chosen := make([]pricing.VariantChoice, 0, len(in.VariantIDs))
	for _, g := range groups {
		if id := chosenInGroup[g.id]; id != "" {
			chosen = append(chosen, variants[id].choice)
		}
	}
	// A combination the price rule cannot price (two ABSOLUTE variants, or a
	// price below zero) is a menu the restaurant must fix, not a choice the
	// customer can: the item cannot be ordered this way.
	if _, err := pricing.VariantPart(money.Amount(basePriceCents), chosen); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrItemUnavailable, err)
	}
	return chosen, nil
}

// lineVariantTable names where a line's snapshotted variants live: on a quote
// line or an order line. The SQL for each is written out below, not built.
type lineVariantTable int

const (
	quoteLineVariants lineVariantTable = iota
	orderLineVariants
)

// insertLineVariant snapshots one chosen variant onto a quote or order line.
// id is the quote or order id; sortNo is the variant's place in the menu's
// group order.
func insertLineVariant(ctx context.Context, tx pgx.Tx, t lineVariantTable, id string, lineNo, sortNo int, v pricing.VariantChoice) error {
	q := `
		INSERT INTO quote_line_variant (quote_id, line_no, variant_id, variant_group_id, group_name,
		                                variant_name, pricing_mode, price_cents, delta_cents, sort_no)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	if t == orderLineVariants {
		q = `
		INSERT INTO order_line_variant (order_id, line_no, variant_id, variant_group_id, group_name,
		                                variant_name, pricing_mode, price_cents, delta_cents, sort_no)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	}
	_, err := tx.Exec(ctx, q, id, lineNo, v.VariantID, v.VariantGroupID, v.GroupName,
		v.Name, v.PricingMode, centsPtr(v.PriceCents), centsPtr(v.DeltaCents), sortNo)
	if err != nil {
		return fmt.Errorf("insert line variant: %w", err)
	}
	return nil
}

// Querier is what a read needs: a transaction or a pool.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// OrderLineVariants returns each order line's chosen variants, keyed by line
// number, in the contract's LineVariant shape, for the restaurant and admin
// order views (contract OrderLine.variants). A line with none has no key.
func OrderLineVariants(ctx context.Context, q Querier, orderID string) (map[int][]LineVariantDTO, error) {
	byLine, err := loadLineVariantSnapshots(ctx, q, orderLineVariants, orderID)
	if err != nil {
		return nil, err
	}
	out := make(map[int][]LineVariantDTO, len(byLine))
	for lineNo, vs := range byLine {
		out[lineNo] = lineVariantsToDTO(vs)
	}
	return out, nil
}

// loadLineVariantSnapshots reads the snapshotted variants of every line of a
// quote or an order, keyed by line number, in the menu's group order.
func loadLineVariantSnapshots(ctx context.Context, tx Querier, t lineVariantTable, id string) (map[int][]pricing.VariantChoice, error) {
	q := `
		SELECT line_no, variant_group_id, group_name, variant_id, variant_name, pricing_mode::text,
		       price_cents, delta_cents
		  FROM quote_line_variant WHERE quote_id = $1
		 ORDER BY line_no, sort_no`
	if t == orderLineVariants {
		q = `
		SELECT line_no, variant_group_id, group_name, variant_id, variant_name, pricing_mode::text,
		       price_cents, delta_cents
		  FROM order_line_variant WHERE order_id = $1
		 ORDER BY line_no, sort_no`
	}
	rows, err := tx.Query(ctx, q, id)
	if err != nil {
		return nil, fmt.Errorf("load line variants: %w", err)
	}
	defer rows.Close()
	out := map[int][]pricing.VariantChoice{}
	for rows.Next() {
		var lineNo int
		var v pricing.VariantChoice
		var price, delta *int64
		if err := rows.Scan(&lineNo, &v.VariantGroupID, &v.GroupName, &v.VariantID, &v.Name, &v.PricingMode,
			&price, &delta); err != nil {
			return nil, err
		}
		v.PriceCents, v.DeltaCents = amountPtr(price), amountPtr(delta)
		out[lineNo] = append(out[lineNo], v)
	}
	return out, rows.Err()
}
