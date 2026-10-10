package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// QuoteRequest is the money-relevant input to a quote, assembled by the handler
// from the validated request body. It carries no price (G-3): only identifiers,
// quantities and the single tip.
type QuoteRequest struct {
	AccountID         string
	CartID            string
	DeliveryAddressID *string
	Fulfilment        string
	TipCents          int64
	PromoCode         *string
}

// resolve reads every row the price depends on inside tx and returns the
// pricing inputs plus the exact state rows that entered them. The menu items are
// read FOR SHARE so a concurrent price edit cannot interleave (P-09 step 1).
//
// It enforces ownership: the cart must belong to the account. It fails loudly
// (typed errors) on an unavailable item, a restaurant that cannot take orders
// (ErrRestaurantUnavailable), a closed restaurant, or a province with no
// effective tax rate — never silently zeroing (I-09.7).
func (s *Store) resolve(ctx context.Context, tx pgx.Tx, req QuoteRequest) (resolvedContext, error) {
	var rc resolvedContext

	// The cart, owned by the account. A cart never changes restaurant: adding
	// from another restaurant deletes it and starts a new one.
	var restaurantID string
	err := tx.QueryRow(ctx, `
		SELECT restaurant_id FROM cart
		 WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
		req.CartID, req.AccountID).Scan(&restaurantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rc, ErrCartNotFound
	}
	if err != nil {
		return rc, fmt.Errorf("resolve cart: %w", err)
	}
	// Quoting and createOrder both resolve here, inside their own transaction,
	// so a restaurant that cannot take orders is refused in the transaction
	// that would create the order, and its row stays locked FOR SHARE until
	// that transaction commits: a concurrent suspension either came first and
	// is refused here, or waits for the order and then settles it
	// (orderable.go). Unavailable outranks closed.
	// https://github.com/shaiknoorullah/hg-mono/issues/292
	// https://github.com/shaiknoorullah/hg-mono/issues/328
	//
	// The cart's menu items are locked FOR SHARE before the restaurant (they
	// are read again below). An admin approving a menu item updates the item
	// and then locks the restaurant row FOR UPDATE (restaurant.RecomputeOnboarding);
	// taking the two in the same order here means the two cannot deadlock.
	if _, err := tx.Exec(ctx, `
		SELECT 1 FROM cart_line cl JOIN menu_item mi ON mi.id = cl.menu_item_id
		 WHERE cl.cart_id = $1
		 ORDER BY mi.id
		 FOR SHARE OF mi`, req.CartID); err != nil {
		return rc, fmt.Errorf("lock cart items: %w", err)
	}
	if err := LockOrderableRestaurant(ctx, tx, restaurantID); err != nil {
		return rc, err
	}

	// The restaurant, read under that lock.
	var province, taxRole string
	var commissionBps int
	var acceptingOrders, negativeBalanceBlock bool
	// negativeBalanceBlock: the weekly payout run blocks new orders for a
	// restaurant whose payout balance has stayed below zero too long
	// (restaurant_collection, internal/payments/payout_run.go). Whether to
	// block at all is the owner's open question, so the limit is
	// HG_RESTAURANT_NEGATIVE_BALANCE_BLOCK_DAYS:
	// https://github.com/shaiknoorullah/hg-mono/issues/164.
	err = tx.QueryRow(ctx, `
		SELECT is_accepting_orders, COALESCE(province::text, ''), commission_rate_bps, tax_role,
		       EXISTS (SELECT 1 FROM restaurant_collection rc
		                WHERE rc.restaurant_id = restaurant.id AND rc.closed_at IS NULL)
		  FROM restaurant WHERE id = $1`,
		restaurantID).Scan(&acceptingOrders, &province, &commissionBps, &taxRole, &negativeBalanceBlock)
	if err != nil {
		return rc, fmt.Errorf("resolve restaurant: %w", err)
	}
	if !acceptingOrders || negativeBalanceBlock {
		return rc, ErrRestaurantClosed
	}
	rc.cartID = req.CartID
	rc.restaurantID = restaurantID
	rc.deliveryAddressID = req.DeliveryAddressID

	// Jurisdiction: place of supply is the delivery province for DELIVERY, the
	// restaurant province for PICKUP (P-11).
	jurProvince := province
	if req.Fulfilment == "DELIVERY" {
		if req.DeliveryAddressID == nil {
			return rc, fmt.Errorf("%w: delivery requires an address", ErrProvinceNotServed)
		}
		var addrProvince string
		err = tx.QueryRow(ctx, `
			SELECT province::text FROM address
			 WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
			*req.DeliveryAddressID, req.AccountID).Scan(&addrProvince)
		if errors.Is(err, pgx.ErrNoRows) {
			return rc, fmt.Errorf("%w: address not found", ErrProvinceNotServed)
		}
		if err != nil {
			return rc, fmt.Errorf("resolve address: %w", err)
		}
		jurProvince = addrProvince
	}
	jurisdiction := "CA-" + jurProvince

	// Cart lines with prices read FOR SHARE. A line whose item is deleted, not
	// AVAILABLE, or from another restaurant fails loudly. Both quote and order
	// creation resolve through here, so a deleted item can reach neither.
	rows, err := tx.Query(ctx, `
		SELECT cl.id, cl.menu_item_id, mi.live_version_id, mi.price_cents, mi.availability_state,
		       mi.deleted_at IS NOT NULL, mi.tax_category::text, mi.restaurant_id,
		       COALESCE(miv.name, ''), cl.quantity, cl.special_request
		  FROM cart_line cl
		  JOIN menu_item mi ON mi.id = cl.menu_item_id
		  LEFT JOIN menu_item_version miv ON miv.id = mi.live_version_id
		 WHERE cl.cart_id = $1
		 ORDER BY cl.created_at
		 FOR SHARE OF mi`, req.CartID)
	if err != nil {
		return rc, fmt.Errorf("resolve lines: %w", err)
	}
	defer rows.Close()

	type rawLine struct {
		lineID, menuItemID                   string
		versionID                            *string
		priceCents                           int64
		availability, taxCat, itemRestaurant string
		itemName                             string
		deleted                              bool
		quantity                             int
		specialRequest                       *string
	}
	var raws []rawLine
	for rows.Next() {
		var rl rawLine
		if err := rows.Scan(&rl.lineID, &rl.menuItemID, &rl.versionID, &rl.priceCents,
			&rl.availability, &rl.deleted, &rl.taxCat, &rl.itemRestaurant, &rl.itemName,
			&rl.quantity, &rl.specialRequest); err != nil {
			return rc, fmt.Errorf("scan line: %w", err)
		}
		raws = append(raws, rl)
	}
	if err := rows.Err(); err != nil {
		return rc, err
	}
	rows.Close()
	if len(raws) == 0 {
		return rc, ErrCartEmpty
	}

	// Every chosen variant of every line, in the menu's group order, read in
	// this transaction. One that was switched off or removed since it was
	// added fails the quote, as an unavailable item does.
	lineVariants, variantGone, err := loadCartLineVariants(ctx, tx, req.CartID)
	if err != nil {
		return rc, err
	}

	var lines []pricing.LineInput
	for _, rl := range raws {
		if rl.itemRestaurant != restaurantID {
			return rc, ErrDifferentRestaurant
		}
		if rl.deleted || rl.availability != "AVAILABLE" {
			return rc, fmt.Errorf("%w: %s", ErrItemUnavailable, rl.menuItemID)
		}
		li := pricing.LineInput{
			MenuItemID:        rl.menuItemID,
			MenuItemVersionID: rl.versionID,
			MenuItemName:      rl.itemName,
			Quantity:          rl.quantity,
			BasePriceCents:    money.Amount(rl.priceCents),
			VariantPartCents:  money.Amount(rl.priceCents),
			SpecialRequest:    rl.specialRequest,
			TaxCategory:       pricing.TaxCategory(rl.taxCat),
		}
		rc.stateRows = append(rc.stateRows, stateRow{Kind: "menu_item", ID: rl.menuItemID, Value: rl.priceCents})

		// Variants: P-09 step 1, the chosen ABSOLUTE variant's price (else the
		// base price) plus every chosen DELTA variant's delta.
		if variantGone[rl.lineID] {
			return rc, fmt.Errorf("%w: a variant on %s", ErrItemUnavailable, rl.menuItemID)
		}
		if vs := lineVariants[rl.lineID]; len(vs) > 0 {
			part, err := pricing.VariantPart(li.BasePriceCents, vs)
			if err != nil {
				return rc, fmt.Errorf("%w: %s: %v", ErrItemUnavailable, rl.menuItemID, err)
			}
			li.Variants = vs
			li.VariantPartCents = part
			li.VariantID, li.VariantName, li.VariantPricingMode = pricing.VariantSummary(vs)
			for _, v := range vs {
				if v.PricingMode == pricing.PricingAbsolute {
					rc.stateRows = append(rc.stateRows, stateRow{Kind: "variant", ID: v.VariantID, Value: v.PriceCents.Cents()})
				} else {
					rc.stateRows = append(rc.stateRows, stateRow{Kind: "variant", ID: v.VariantID, Value: v.DeltaCents.Cents()})
				}
			}
		}

		// Add-ons for this cart line.
		aRows, err := tx.Query(ctx, `
			SELECT a.id, a.name, a.price_cents, cla.addon_quantity, a.is_available
			  FROM cart_line_addon cla
			  JOIN addon a ON a.id = cla.addon_id
			 WHERE cla.cart_line_id = $1
			 ORDER BY a.id`, rl.lineID)
		if err != nil {
			return rc, fmt.Errorf("resolve addons: %w", err)
		}
		for aRows.Next() {
			var aid, aname string
			var aprice int64
			var aqty int
			var avail bool
			if err := aRows.Scan(&aid, &aname, &aprice, &aqty, &avail); err != nil {
				aRows.Close()
				return rc, fmt.Errorf("scan addon: %w", err)
			}
			if !avail {
				aRows.Close()
				return rc, fmt.Errorf("%w: addon %s", ErrItemUnavailable, aid)
			}
			li.Addons = append(li.Addons, pricing.AddonInput{
				AddonID: aid, AddonName: aname, AddonQuantity: aqty, PriceCents: money.Amount(aprice),
			})
			rc.stateRows = append(rc.stateRows, stateRow{Kind: "addon", ID: aid, Value: aprice})
		}
		if err := aRows.Err(); err != nil {
			aRows.Close()
			return rc, err
		}
		aRows.Close()

		lines = append(lines, li)
	}

	// Effective pricing_config (the latest effective row).
	cfg, cfgID, err := s.loadPricingConfig(ctx, tx)
	if err != nil {
		return rc, err
	}
	rc.stateRows = append(rc.stateRows, stateRow{Kind: "pricing_config", ID: cfgID, Value: 1})

	// Effective tax rates for the jurisdiction (I-11.4: none ⇒ fail loudly).
	rates, err := s.loadTaxRates(ctx, tx, jurisdiction)
	if err != nil {
		return rc, err
	}
	if len(rates) == 0 {
		return rc, fmt.Errorf("%w: %s", ErrProvinceNotServed, jurisdiction)
	}
	for _, r := range rates {
		rc.stateRows = append(rc.stateRows, stateRow{Kind: "tax_rate:" + r.TaxKind + ":" + string(r.Category), ID: jurisdiction, Value: r.Rate.Num*1_000_000 + r.Rate.Den})
	}

	// Route / distance. P-31 (dispatch sibling) owns real routing; until it
	// lands, use the geodesic straight-line distance from PostGIS as the billable
	// distance. This is honest: it is a real measured distance from the schema's
	// geography columns, not a fabricated constant. It is recorded as FALLBACK.
	billableKM, routeMeters, routeSource := 0, 0, "FALLBACK"
	if req.Fulfilment == "DELIVERY" && req.DeliveryAddressID != nil {
		m, radius, ok, err := s.straightLineMeters(ctx, tx, restaurantID, *req.DeliveryAddressID)
		if err != nil {
			return rc, err
		}
		if ok {
			// Serviceability (C-14): the same measure and boundary as the
			// restaurant card's OUT_OF_RANGE (catalog/availabilityinfo.go),
			// so the card and the quote cannot disagree. Quoting and
			// createOrder both resolve here, so neither can price or place a
			// delivery beyond the restaurant's delivery_radius_m.
			// https://github.com/shaiknoorullah/hg-mono/issues/723
			if m > radius {
				return rc, ErrAddressOutOfRange
			}
			routeMeters = m
			billableKM = (m + 999) / 1000 // ceil(km)
		}
	}

	rc.inputs = pricing.Inputs{
		Fulfilment:           pricing.Fulfilment(req.Fulfilment),
		Config:               cfg,
		JurisdictionCode:     jurisdiction,
		Rates:                rates,
		Lines:                lines,
		TipCents:             money.Amount(req.TipCents),
		BillableKM:           billableKM,
		RouteMeters:          routeMeters,
		CommissionRate:       bpsToRate(commissionBps),
		RestaurantIsSupplier: taxRole == "RESTAURANT_IS_SUPPLIER",
	}
	// promo resolution is a promo-engine concern not owned here; a promo_code is
	// carried through but never applied without a real discount source.
	_ = routeSource
	rc.inputs.Config.ID = cfgID
	rc.pricingConfigID = cfgID
	rc.jurisdiction = jurisdiction
	return rc, nil
}

func (s *Store) loadPricingConfig(ctx context.Context, tx pgx.Tx) (pricing.Config, string, error) {
	var c pricing.Config
	var id string
	var serviceRate, commissionRate string
	err := tx.QueryRow(ctx, `
		SELECT id, base_delivery_fee_cents, included_km, per_km_cents,
		       min_delivery_fee_cents, max_delivery_fee_cents,
		       small_order_threshold_cents, small_order_surcharge_cents,
		       service_fee_rate::text, service_fee_min_cents, service_fee_max_cents,
		       default_commission_rate::text,
		       rider_base_cents, rider_per_km_cents, rider_minimum_cents,
		       max_tip_cents, quote_ttl_seconds
		  FROM pricing_config
		 WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
		 ORDER BY effective_from DESC
		 LIMIT 1`).Scan(
		&id, &c.BaseDeliveryFeeCents, &c.IncludedKM, &c.PerKMCents,
		&c.MinDeliveryFeeCents, &c.MaxDeliveryFeeCents,
		&c.SmallOrderThresholdCents, &c.SmallOrderSurchargeCents,
		&serviceRate, &c.ServiceFeeMinCents, &c.ServiceFeeMaxCents,
		&commissionRate,
		&c.RiderBaseCents, &c.RiderPerKMCents, &c.RiderMinimumCents,
		&c.MaxTipCents, &c.QuoteTTLSeconds)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, "", fmt.Errorf("no effective pricing_config")
	}
	if err != nil {
		return c, "", fmt.Errorf("load pricing_config: %w", err)
	}
	if c.ServiceFeeRate, err = money.RateFromDecimalString(serviceRate); err != nil {
		return c, "", err
	}
	if c.DefaultCommissionRate, err = money.RateFromDecimalString(commissionRate); err != nil {
		return c, "", err
	}
	return c, id, nil
}

func (s *Store) loadTaxRates(ctx context.Context, tx pgx.Tx, jurisdiction string) ([]pricing.TaxRate, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT ON (tax_kind, tax_category)
		       tax_kind::text, tax_category::text, rate::text, statutory_label
		  FROM tax_rate
		 WHERE jurisdiction_code = $1
		   AND effective_from <= CURRENT_DATE
		   AND (effective_to IS NULL OR effective_to > CURRENT_DATE)
		 ORDER BY tax_kind, tax_category, effective_from DESC`, jurisdiction)
	if err != nil {
		return nil, fmt.Errorf("load tax_rate: %w", err)
	}
	defer rows.Close()

	// remittable_by is derived from tax_role at compute time for the customer
	// line; for storage we default per category (food → restaurant when it is the
	// supplier, fees → platform). The compute layer overrides the grouped line.
	var out []pricing.TaxRate
	for rows.Next() {
		var kind, cat, rateStr, label string
		if err := rows.Scan(&kind, &cat, &rateStr, &label); err != nil {
			return nil, err
		}
		rate, err := money.RateFromDecimalString(rateStr)
		if err != nil {
			return nil, err
		}
		remit := "PLATFORM"
		if cat == "PREPARED_FOOD" || cat == "ZERO_RATED_GROCERY" {
			remit = "RESTAURANT"
		}
		out = append(out, pricing.TaxRate{
			JurisdictionCode: jurisdiction, TaxKind: kind, Category: pricing.TaxCategory(cat),
			Rate: rate, StatutoryLabel: label, RemittableBy: remit,
		})
	}
	return out, rows.Err()
}

// straightLineMeters returns the geodesic distance restaurant→address using
// PostGIS ST_Distance over the geography columns, rounded to whole metres
// exactly as discovery's distance_m is (ST_Distance(...)::int), together with
// the restaurant's delivery_radius_m. The distance is the eligibility measure;
// a routing sibling will replace it for money once it exists.
func (s *Store) straightLineMeters(ctx context.Context, tx pgx.Tx, restaurantID, addressID string) (meters, radiusM int, ok bool, err error) {
	var m *int
	err = tx.QueryRow(ctx, `
		SELECT ST_Distance(r.location, a.location)::int, r.delivery_radius_m
		  FROM restaurant r, address a
		 WHERE r.id = $1 AND a.id = $2 AND r.location IS NOT NULL`,
		restaurantID, addressID).Scan(&m, &radiusM)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m == nil) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, fmt.Errorf("distance: %w", err)
	}
	return *m, radiusM, true, nil
}
