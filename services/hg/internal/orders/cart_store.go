package orders

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Cart is the customer's single cart (C-19), in the shape the handler renders to
// the Cart schema. Money here is indicative only.
type Cart struct {
	ID                      string
	RestaurantID            *string
	RestaurantName          *string
	DeliveryAddressID       *string
	Lines                   []CartLine
	ItemCount               int
	IndicativeSubtotalCents int64
	Currency                string
	IsQuotable              bool
	BlockingReasons         []string

	// tmpUnit carries per-line pre-addon unit prices between the line scan and
	// the addon pass; it is never serialised.
	tmpUnit []int64
}

// CartLine is one line with its current availability and price (C-19).
type CartLine struct {
	ID             string
	MenuItemID     string
	Name           string
	Variant        *SelectedVariant
	Addons         []SelectedAddon
	Quantity       int
	SpecialRequest *string
	UnitPriceCents int64
	LineTotalCents int64
	Currency       string
	IsAvailable    bool
	UnavailReason  *string
}

// SelectedVariant is the chosen variant on a cart line.
type SelectedVariant struct {
	VariantID   string
	Name        string
	PricingMode string
}

// SelectedAddon is a chosen add-on on a cart line.
type SelectedAddon struct {
	AddonID  string
	Name     string
	Quantity int
}

// CartLineInput is the validated addCartLine body (item ids + quantity only).
type CartLineInput struct {
	MenuItemID     string
	VariantID      *string
	Addons         []CartAddonInput
	Quantity       int
	SpecialRequest *string
}

// CartAddonInput is one chosen add-on in an add request.
type CartAddonInput struct {
	AddonID  string
	Quantity int
}

// GetCart reads the account's cart, or returns a zero-value empty cart when none
// exists (the contract returns an empty cart, not 404).
func (s *Store) GetCart(ctx context.Context, accountID string) (*Cart, error) {
	var out *Cart
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		c, err := s.loadCart(ctx, tx, accountID)
		out = c
		return err
	})
	return out, err
}

func (s *Store) loadCart(ctx context.Context, tx pgx.Tx, accountID string) (*Cart, error) {
	var c Cart
	var cartID, restaurantID, restaurantName string
	var addressID *string
	err := tx.QueryRow(ctx, `
		SELECT c.id, c.restaurant_id, r.display_name, c.delivery_address_id
		  FROM cart c JOIN restaurant r ON r.id = c.restaurant_id
		 WHERE c.account_id = $1 AND c.deleted_at IS NULL`, accountID).
		Scan(&cartID, &restaurantID, &restaurantName, &addressID)
	if errors.Is(err, pgx.ErrNoRows) {
		// No cart: return an empty one (id blank until first add).
		return &Cart{Currency: "CAD", IsQuotable: false}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load cart: %w", err)
	}
	c.ID = cartID
	c.RestaurantID = &restaurantID
	c.RestaurantName = &restaurantName
	c.DeliveryAddressID = addressID
	c.Currency = "CAD"

	rows, err := tx.Query(ctx, `
		SELECT cl.id, cl.menu_item_id, COALESCE(miv.name, ''), mi.price_cents, mi.availability_state::text,
		       cl.variant_id, v.name, v.pricing_mode::text, v.price_cents, v.delta_cents, v.is_available,
		       cl.quantity, cl.special_request
		  FROM cart_line cl
		  JOIN menu_item mi ON mi.id = cl.menu_item_id
		  LEFT JOIN menu_item_version miv ON miv.id = mi.live_version_id
		  LEFT JOIN variant v ON v.id = cl.variant_id
		 WHERE cl.cart_id = $1 ORDER BY cl.created_at`, cartID)
	if err != nil {
		return nil, fmt.Errorf("load cart lines: %w", err)
	}
	defer rows.Close()
	anyUnavailable := false
	for rows.Next() {
		var l CartLine
		var itemPrice int64
		var availability string
		var variantID, variantName, variantMode *string
		var variantPrice, variantDelta *int64
		var variantAvail *bool
		if err := rows.Scan(&l.ID, &l.MenuItemID, &l.Name, &itemPrice, &availability,
			&variantID, &variantName, &variantMode, &variantPrice, &variantDelta, &variantAvail,
			&l.Quantity, &l.SpecialRequest); err != nil {
			return nil, err
		}
		l.Currency = "CAD"
		unit := itemPrice
		if variantID != nil && variantMode != nil {
			l.Variant = &SelectedVariant{VariantID: *variantID, Name: derefStr(variantName), PricingMode: *variantMode}
			switch *variantMode {
			case "ABSOLUTE":
				if variantPrice != nil {
					unit = *variantPrice
				}
			case "DELTA":
				if variantDelta != nil {
					unit = itemPrice + *variantDelta
				}
			}
		}
		l.IsAvailable = availability == "AVAILABLE" && (variantAvail == nil || *variantAvail)
		if !l.IsAvailable {
			anyUnavailable = true
			reason := "OUT_OF_STOCK"
			if variantAvail != nil && !*variantAvail {
				reason = "VARIANT_UNAVAILABLE"
			}
			l.UnavailReason = &reason
		}
		c.Lines = append(c.Lines, l)
		c.tmpUnit = append(c.tmpUnit, unit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	// Add-ons per line, and the indicative unit/line totals.
	for i := range c.Lines {
		unit := c.tmpUnit[i]
		aRows, err := tx.Query(ctx, `
			SELECT a.id, a.name, cla.addon_quantity, a.price_cents, a.is_available
			  FROM cart_line_addon cla JOIN addon a ON a.id = cla.addon_id
			 WHERE cla.cart_line_id = $1 ORDER BY a.id`, c.Lines[i].ID)
		if err != nil {
			return nil, err
		}
		for aRows.Next() {
			var aid, aname string
			var aqty int
			var aprice int64
			var aavail bool
			if err := aRows.Scan(&aid, &aname, &aqty, &aprice, &aavail); err != nil {
				aRows.Close()
				return nil, err
			}
			c.Lines[i].Addons = append(c.Lines[i].Addons, SelectedAddon{AddonID: aid, Name: aname, Quantity: aqty})
			unit += aprice * int64(aqty)
			if !aavail {
				c.Lines[i].IsAvailable = false
				anyUnavailable = true
				r := "ADDON_UNAVAILABLE"
				c.Lines[i].UnavailReason = &r
			}
		}
		if err := aRows.Err(); err != nil {
			aRows.Close()
			return nil, err
		}
		aRows.Close()
		c.Lines[i].UnitPriceCents = unit
		c.Lines[i].LineTotalCents = unit * int64(c.Lines[i].Quantity)
		c.ItemCount += c.Lines[i].Quantity
		c.IndicativeSubtotalCents += c.Lines[i].LineTotalCents
	}
	c.tmpUnit = nil

	// Quotability + blocking reasons. Minimum-order is read from the restaurant.
	var minOrder int64
	var accepting bool
	var accountState string
	_ = tx.QueryRow(ctx, `SELECT minimum_order_cents, is_accepting_orders, account_state::text FROM restaurant WHERE id = $1`,
		restaurantID).Scan(&minOrder, &accepting, &accountState)

	c.IsQuotable = true
	if anyUnavailable {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "CART_HAS_UNAVAILABLE_ITEMS")
	}
	if accountState != "LIVE" || !accepting {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "RESTAURANT_CLOSED")
	}
	if c.IndicativeSubtotalCents < minOrder {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "BELOW_MINIMUM_ORDER")
	}
	if addressID == nil {
		c.IsQuotable = false
	}
	return &c, nil
}

// AddCartLine adds (or increments) a line. Enforces one-restaurant-per-cart
// server-side (C-16): adding from a different restaurant returns
// ErrDifferentRestaurant unless replace=true, which atomically clears then adds.
func (s *Store) AddCartLine(ctx context.Context, accountID, restaurantID string, in CartLineInput, replace bool) (*Cart, error) {
	var out *Cart
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		// The menu item's restaurant is authoritative; the caller passes it but
		// we re-read it to avoid trusting a client-supplied restaurant.
		var itemRestaurant, availability string
		err := tx.QueryRow(ctx, `SELECT restaurant_id, availability_state::text FROM menu_item WHERE id = $1 AND deleted_at IS NULL`,
			in.MenuItemID).Scan(&itemRestaurant, &availability)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrItemUnavailable
		}
		if err != nil {
			return err
		}
		if availability != "AVAILABLE" {
			return ErrItemUnavailable
		}

		// Existing open cart, if any.
		var cartID, cartRestaurant string
		err = tx.QueryRow(ctx, `SELECT id, restaurant_id FROM cart WHERE account_id = $1 AND deleted_at IS NULL`,
			accountID).Scan(&cartID, &cartRestaurant)
		hasCart := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		if hasCart && cartRestaurant != itemRestaurant {
			if !replace {
				return ErrDifferentRestaurant
			}
			// Atomic clear + add: soft-delete the old cart, drop through to create.
			if _, err := tx.Exec(ctx, `UPDATE cart SET deleted_at = now() WHERE id = $1`, cartID); err != nil {
				return err
			}
			hasCart = false
		}

		if !hasCart {
			err = tx.QueryRow(ctx, `
				INSERT INTO cart (account_id, restaurant_id, fulfilment, currency)
				VALUES ($1, $2, 'DELIVERY', 'CAD') RETURNING id`, accountID, itemRestaurant).Scan(&cartID)
			if err != nil {
				return fmt.Errorf("create cart: %w", err)
			}
		}

		// Line identity is (menu_item_id, variant_id, sorted(addons), special_request):
		// an identical add increments quantity, any difference is a new line.
		fp := lineFingerprint(in)
		existingID, existingQty, found, err := s.findMatchingLine(ctx, tx, cartID, in, fp)
		if err != nil {
			return err
		}
		if found {
			newQty := existingQty + in.Quantity
			if newQty > 20 {
				newQty = 20
			}
			if _, err := tx.Exec(ctx, `UPDATE cart_line SET quantity = $1, updated_at = now() WHERE id = $2`, newQty, existingID); err != nil {
				return err
			}
		} else {
			var lineID string
			err = tx.QueryRow(ctx, `
				INSERT INTO cart_line (cart_id, menu_item_id, variant_id, quantity, special_request)
				VALUES ($1,$2,$3,$4,$5) RETURNING id`,
				cartID, in.MenuItemID, in.VariantID, in.Quantity, in.SpecialRequest).Scan(&lineID)
			if err != nil {
				return fmt.Errorf("insert cart_line: %w", err)
			}
			for _, a := range in.Addons {
				qty := a.Quantity
				if qty <= 0 {
					qty = 1
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO cart_line_addon (cart_line_id, addon_id, addon_quantity)
					VALUES ($1,$2,$3)`, lineID, a.AddonID, qty); err != nil {
					return fmt.Errorf("insert cart_line_addon: %w", err)
				}
			}
		}

		c, err := s.loadCart(ctx, tx, accountID)
		out = c
		return err
	})
	return out, err
}

// UpdateCartLineQuantity sets a line's quantity (1..20). quantity 0 is rejected
// at the handler; removal is DELETE.
func (s *Store) UpdateCartLineQuantity(ctx context.Context, accountID, lineID string, quantity int) (*Cart, error) {
	var out *Cart
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE cart_line SET quantity = $1, updated_at = now()
			 WHERE id = $2 AND cart_id IN (SELECT id FROM cart WHERE account_id = $3 AND deleted_at IS NULL)`,
			quantity, lineID, accountID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrCartNotFound
		}
		c, err := s.loadCart(ctx, tx, accountID)
		out = c
		return err
	})
	return out, err
}

// RemoveCartLine deletes a line.
func (s *Store) RemoveCartLine(ctx context.Context, accountID, lineID string) (*Cart, error) {
	var out *Cart
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			DELETE FROM cart_line
			 WHERE id = $1 AND cart_id IN (SELECT id FROM cart WHERE account_id = $2 AND deleted_at IS NULL)`,
			lineID, accountID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrCartNotFound
		}
		c, err := s.loadCart(ctx, tx, accountID)
		out = c
		return err
	})
	return out, err
}

// ClearCart soft-deletes the account's open cart.
func (s *Store) ClearCart(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE cart SET deleted_at = now() WHERE account_id = $1 AND deleted_at IS NULL`, accountID)
	return err
}

// lineFingerprint builds the identity string for a candidate line.
func lineFingerprint(in CartLineInput) string {
	var b strings.Builder
	b.WriteString(in.MenuItemID)
	b.WriteString("|")
	if in.VariantID != nil {
		b.WriteString(*in.VariantID)
	}
	b.WriteString("|")
	addons := append([]CartAddonInput(nil), in.Addons...)
	sort.Slice(addons, func(i, j int) bool { return addons[i].AddonID < addons[j].AddonID })
	for _, a := range addons {
		fmt.Fprintf(&b, "%s:%d,", a.AddonID, a.Quantity)
	}
	b.WriteString("|")
	if in.SpecialRequest != nil {
		b.WriteString(*in.SpecialRequest)
	}
	return b.String()
}

// findMatchingLine looks for an existing line with the same identity fingerprint.
func (s *Store) findMatchingLine(ctx context.Context, tx pgx.Tx, cartID string, in CartLineInput, fp string) (string, int, bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT cl.id, cl.variant_id, cl.quantity, cl.special_request
		  FROM cart_line cl WHERE cl.cart_id = $1 AND cl.menu_item_id = $2`, cartID, in.MenuItemID)
	if err != nil {
		return "", 0, false, err
	}
	defer rows.Close()
	type cand struct {
		id             string
		variantID      *string
		qty            int
		specialRequest *string
	}
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.id, &c.variantID, &c.qty, &c.specialRequest); err != nil {
			return "", 0, false, err
		}
		cands = append(cands, c)
	}
	if err := rows.Err(); err != nil {
		return "", 0, false, err
	}
	rows.Close()
	for _, c := range cands {
		lineIn := CartLineInput{MenuItemID: in.MenuItemID, VariantID: c.variantID, SpecialRequest: c.specialRequest}
		addonRows, err := tx.Query(ctx, `SELECT addon_id, addon_quantity FROM cart_line_addon WHERE cart_line_id = $1`, c.id)
		if err != nil {
			return "", 0, false, err
		}
		for addonRows.Next() {
			var aid string
			var aq int
			if err := addonRows.Scan(&aid, &aq); err != nil {
				addonRows.Close()
				return "", 0, false, err
			}
			lineIn.Addons = append(lineIn.Addons, CartAddonInput{AddonID: aid, Quantity: aq})
		}
		if err := addonRows.Err(); err != nil {
			addonRows.Close()
			return "", 0, false, err
		}
		addonRows.Close()
		if lineFingerprint(lineIn) == fp {
			return c.id, c.qty, true, nil
		}
	}
	return "", 0, false, nil
}

func appendReason(reasons []string, r string) []string {
	for _, x := range reasons {
		if x == r {
			return reasons
		}
	}
	return append(reasons, r)
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
