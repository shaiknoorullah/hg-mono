package orders

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

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

	// Halal seal + card fields for the restaurant the cart is bound to (C-12).
	// Populated for a non-empty cart so the cart surface re-asserts the chosen
	// restaurant's halal claim before checkout.
	RestaurantSlug         string
	RestaurantLogoURL      *string
	RestaurantHeroURL      *string
	RestaurantRatingAvg    *float64
	RestaurantRatingCount  int32
	RestaurantPriceBand    *string
	HalalStatus            string
	HalalCertifyingBody    *string
	HalalExpiresOn         *string
	RestaurantIsAccepting  bool
	RestaurantAccountState string
	RestaurantMinOrder     *int64

	// tmpUnit carries per-line pre-addon unit prices between the line scan and
	// the addon pass; it is never serialised.
	tmpUnit []int64
}

// CartLine is one line with its current availability and price (C-19).
type CartLine struct {
	ID             string
	MenuItemID     string
	Name           string
	ImageURL       *string
	Variant        *SelectedVariant
	Addons         []SelectedAddon
	Quantity       int
	SpecialRequest *string
	UnitPriceCents int64
	LineTotalCents int64
	Currency       string
	IsAvailable    bool
	UnavailReason  *string
	// CurrentPriceCents surfaces C-19's PRICE_CHANGED signal: the item's live
	// price when it differs from the price the line was added at. It stays nil
	// until cart_line carries a per-line price snapshot to compare against —
	// there is no captured "added at" price column today, so a change is not yet
	// detectable. SCHEMA CHANGE REQUIRED: add cart_line.snapshot_unit_cents (a
	// migration) set on insert, then set this when the live unit price diverges.
	// Left null (contract-nullable) rather than inventing a comparison.
	CurrentPriceCents *int64
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
	var slug, accountState string
	var priceBand *string
	var ratingAvg *float64
	var ratingCount int32
	var certExpiresOn *time.Time
	var minOrder *int64
	var accepting bool
	var logoBucket, logoKey, coverBucket, coverKey *string
	var gate restaurantGate
	// The RestaurantCard on the cart re-asserts the chosen restaurant's halal seal
	// before checkout (C-12): join the certificate + issuing body so the badge
	// carries the certifying body name and expiry, exactly as the catalog card
	// does. The badge is the halal state as of now, from admin-verified data
	// (halal_certification_at, migration 00033), and the certificate that state
	// was computed from: the stored restaurant.halal_status can still say
	// CERTIFIED after the certificate lapsed
	// (https://github.com/shaiknoorullah/hg-mono/issues/252), and a missing
	// halal field renders no badge, never an optimistic one
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).
	// LEFT JOIN because there may be no certificate at all.
	// The logo/hero objects (READY only) are joined from stored_object so the
	// card carries their public URLs without a per-object lookup.
	err := tx.QueryRow(ctx, `
		SELECT c.id, c.restaurant_id, r.display_name, c.delivery_address_id,
		       r.slug, r.rating_avg, r.rating_count, r.price_band::text,
		       b.name AS certifying_body, cert.expires_on AS cert_expires_on,
		       r.is_accepting_orders, r.account_state::text, r.minimum_order_cents,
		       so_logo.bucket, so_logo.object_key, so_cover.bucket, so_cover.object_key,
		       r.deleted_at IS NULL, r.halal_status::text, hn.halal_status::text
		  FROM cart c
		  JOIN restaurant r ON r.id = c.restaurant_id
		  LEFT JOIN LATERAL halal_certification_at(r.id, now()) hn ON true
		  LEFT JOIN halal_certificate cert ON cert.id = hn.certificate_id
		  LEFT JOIN halal_issuing_body b ON b.id = cert.issuing_body_id
		  LEFT JOIN stored_object so_logo ON so_logo.id = r.logo_object_id AND so_logo.state = 'READY'
		  LEFT JOIN stored_object so_cover ON so_cover.id = r.cover_object_id AND so_cover.state = 'READY'
		 WHERE c.account_id = $1 AND c.deleted_at IS NULL`, accountID).
		Scan(&cartID, &restaurantID, &restaurantName, &addressID,
			&slug, &ratingAvg, &ratingCount, &priceBand,
			&c.HalalCertifyingBody, &certExpiresOn,
			&accepting, &accountState, &minOrder,
			&logoBucket, &logoKey, &coverBucket, &coverKey,
			&gate.Listed, &gate.StoredHalal, &gate.HalalNow)
	if errors.Is(err, pgx.ErrNoRows) {
		// No cart: return an empty one (id blank until first add).
		return &Cart{Currency: "CAD", IsQuotable: false}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load cart: %w", err)
	}
	// The contract documents delivery_address_id as "always the customer's currently
	// selected address" — i.e. their address-book default, not a value some client
	// call is expected to stamp onto the cart row. Nothing in this module ever writes
	// cart.delivery_address_id (there is no such endpoint), so falling back to it alone
	// would leave every cart permanently NO_ADDRESS even for a customer with a saved,
	// default address. Resolve the customer's current default (falling back to their
	// oldest saved address) each read instead, matching the documented "currently
	// selected, never addresses[0]" semantics without needing a schema or contract change.
	if addressID == nil {
		var resolvedID string
		aerr := tx.QueryRow(ctx, `
			SELECT id FROM address
			 WHERE account_id = $1 AND deleted_at IS NULL
			 ORDER BY is_default DESC, created_at ASC
			 LIMIT 1`, accountID).Scan(&resolvedID)
		if aerr == nil {
			addressID = &resolvedID
		} else if !errors.Is(aerr, pgx.ErrNoRows) {
			return nil, fmt.Errorf("resolve default address: %w", aerr)
		}
	}
	c.ID = cartID
	c.RestaurantID = &restaurantID
	c.RestaurantName = &restaurantName
	c.DeliveryAddressID = addressID
	c.Currency = "CAD"
	c.RestaurantSlug = slug
	c.RestaurantRatingCount = ratingCount
	c.RestaurantPriceBand = priceBand
	// rating_avg is null until there are at least 5 ratings (C-12); the client
	// renders "New" rather than a number invented from a single review.
	if ratingAvg != nil && ratingCount >= 5 {
		c.RestaurantRatingAvg = ratingAvg
	}
	// No answer is no badge: UNVERIFIED renders none.
	c.HalalStatus = "UNVERIFIED"
	if gate.HalalNow != nil {
		c.HalalStatus = *gate.HalalNow
	}
	if certExpiresOn != nil {
		s := certExpiresOn.Format("2006-01-02")
		c.HalalExpiresOn = &s
	}
	c.RestaurantIsAccepting = accepting
	c.RestaurantAccountState = accountState
	c.RestaurantMinOrder = minOrder
	c.RestaurantLogoURL = s.mediaURL(logoBucket, logoKey)
	c.RestaurantHeroURL = s.mediaURL(coverBucket, coverKey)

	rows, err := tx.Query(ctx, `
		SELECT cl.id, cl.menu_item_id, COALESCE(miv.name, ''), mi.price_cents, mi.availability_state::text,
		       cl.variant_id, v.name, v.pricing_mode::text, v.price_cents, v.delta_cents, v.is_available,
		       cl.quantity, cl.special_request,
		       so_img.bucket, so_img.object_key
		  FROM cart_line cl
		  JOIN menu_item mi ON mi.id = cl.menu_item_id
		  LEFT JOIN menu_item_version miv ON miv.id = mi.live_version_id
		  LEFT JOIN stored_object so_img ON so_img.id = miv.image_object_id AND so_img.state = 'READY'
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
		var imgBucket, imgKey *string
		if err := rows.Scan(&l.ID, &l.MenuItemID, &l.Name, &itemPrice, &availability,
			&variantID, &variantName, &variantMode, &variantPrice, &variantDelta, &variantAvail,
			&l.Quantity, &l.SpecialRequest,
			&imgBucket, &imgKey); err != nil {
			return nil, err
		}
		l.Currency = "CAD"
		l.ImageURL = s.mediaURL(imgBucket, imgKey)
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

	// Quotability + blocking reasons. Minimum-order, accepting-orders and the
	// restaurant gate were read alongside the restaurant card fields above.
	gate.AccountState = &accountState
	var minOrderCents int64
	if c.RestaurantMinOrder != nil {
		minOrderCents = *c.RestaurantMinOrder
	}

	c.IsQuotable = true
	if anyUnavailable {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "CART_HAS_UNAVAILABLE_ITEMS")
	}
	// A restaurant that cannot take orders blocks the cart without emptying it:
	// the halal display spec, rule 3
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/02-customer.md#c-12--halal-certification-display-and-verification--critical).
	// Unavailable outranks closed. https://github.com/shaiknoorullah/hg-mono/issues/292
	if !gate.orderable() {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "RESTAURANT_UNAVAILABLE")
	} else if !c.RestaurantIsAccepting {
		c.IsQuotable = false
		c.BlockingReasons = appendReason(c.BlockingReasons, "RESTAURANT_CLOSED")
	}
	if c.IndicativeSubtotalCents < minOrderCents {
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
		// we re-read it to avoid trusting a client-supplied restaurant. A client
		// that still knows an item id (an old cart, a cached menu) cannot add it
		// once the restaurant cannot take orders (orderable.go), and the
		// restaurant row stays locked until the line is written.
		// https://github.com/shaiknoorullah/hg-mono/issues/292
		// https://github.com/shaiknoorullah/hg-mono/issues/328
		var itemRestaurant, availability string
		err := tx.QueryRow(ctx, `
			SELECT restaurant_id, availability_state::text
			  FROM menu_item
			 WHERE id = $1 AND deleted_at IS NULL`,
			in.MenuItemID).Scan(&itemRestaurant, &availability)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrItemUnavailable
		}
		if err != nil {
			return err
		}
		if err := LockOrderableRestaurant(ctx, tx, itemRestaurant); err != nil {
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
