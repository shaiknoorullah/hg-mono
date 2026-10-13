package orders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/money"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// CreateQuote resolves the cart, runs the pure pricing computation, and persists
// the quote, its lines, its add-ons and its tax lines in one transaction (P-09).
// The persisted quote carries input_hash and state_hash so createOrder can
// re-execute and detect any difference.
func (s *Store) CreateQuote(ctx context.Context, req QuoteRequest) (*Quote, error) {
	var out *Quote
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		// No new quotes while staff have paused new orders platform-wide
		// (https://github.com/shaiknoorullah/hg-mono/issues/244).
		if err := requireOrderingOpen(ctx, tx, false); err != nil {
			return err
		}
		rc, err := s.resolve(ctx, tx, req)
		if err != nil {
			return err
		}
		res, err := pricing.Compute(rc.inputs)
		if err != nil {
			return err
		}

		ci := canonicalInput{
			CartID: req.CartID, DeliveryAddressID: req.DeliveryAddressID,
			Fulfilment: req.Fulfilment, TipCents: req.TipCents, PromoCode: req.PromoCode,
		}
		for _, l := range res.Lines {
			cl := canonicalLine{MenuItemID: l.MenuItemID, VariantID: l.VariantID, Quantity: l.Quantity, SpecialRequest: l.SpecialRequest}
			if len(l.Variants) > 1 {
				for _, v := range l.Variants {
					cl.VariantIDs = append(cl.VariantIDs, v.VariantID)
				}
				sort.Strings(cl.VariantIDs)
			}
			for _, a := range l.Addons {
				cl.Addons = append(cl.Addons, canonicalAddon{AddonID: a.AddonID, Quantity: a.AddonQuantity})
			}
			ci.Lines = append(ci.Lines, cl)
		}
		inputHash := hashInput(ci)
		stateHash := hashState(rc.stateRows)

		ttl := rc.inputs.Config.QuoteTTLSeconds
		if ttl <= 0 {
			ttl = 600
		}
		now := time.Now().UTC()
		expiresAt := now.Add(time.Duration(ttl) * time.Second)

		q, err := s.persistQuote(ctx, tx, req, rc, res, inputHash, stateHash, expiresAt)
		if err != nil {
			return err
		}
		out = q
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// persistQuote inserts the quote header, lines, add-ons and tax lines. The
// deferred tax-total trigger checks I-11.1 at commit.
func (s *Store) persistQuote(ctx context.Context, tx pgx.Tx, req QuoteRequest, rc resolvedContext,
	res pricing.Result, inputHash, stateHash []byte, expiresAt time.Time) (*Quote, error) {

	routeSource := "FALLBACK"
	if rc.inputs.RouteMeters == 0 && req.Fulfilment == "DELIVERY" {
		routeSource = "FALLBACK"
	}

	roundingLog, _ := json.Marshal(res.RoundingLog)

	var discountTarget, discountFundedBy *string
	var discountReimbursable bool
	var promoCode *string
	if res.Discount != nil {
		discountTarget = &res.Discount.Target
		discountFundedBy = &res.Discount.FundedBy
		discountReimbursable = res.Discount.Reimbursable
		promoCode = res.Discount.Code
	} else {
		promoCode = req.PromoCode
	}

	var quoteID string
	var createdAt time.Time
	err := tx.QueryRow(ctx, `
		INSERT INTO quote (
			account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
			pricing_config_id, tax_jurisdiction_code,
			subtotal_cents, discount_items_cents, discount_delivery_cents, discount_service_cents,
			delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
			commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
			restaurant_funded_discount_cents, platform_funded_discount_cents,
			billable_km, route_meters, route_source,
			promo_code, discount_target, discount_funded_by, discount_reimbursable,
			input_hash, state_hash, rounding_log, expires_at
		) VALUES (
			$1,$2,$3,$4,$5,'CAD',
			$6,$7,
			$8,$9,$10,$11,
			$12,$13,$14,$15,$16,
			$17,$18,$19,$20,
			$21,$22,
			$23,$24,$25,
			$26,$27,$28,$29,
			$30,$31,$32,$33
		) RETURNING id, created_at`,
		req.AccountID, req.CartID, rc.restaurantID, req.DeliveryAddressID, req.Fulfilment,
		rc.pricingConfigID, rc.jurisdiction,
		res.SubtotalCents.Cents(), res.DiscountItemsCents.Cents(), res.DiscountDeliveryCents.Cents(), res.DiscountServiceCents.Cents(),
		res.DeliveryFeeCents.Cents(), res.ServiceFeeCents.Cents(), res.TaxTotalCents.Cents(), res.TipCents.Cents(), res.TotalCents.Cents(),
		res.CommissionCents.Cents(), res.RestaurantNetCents.Cents(), res.RiderEarningsCents.Cents(), res.PlatformGrossCents.Cents(),
		res.RestaurantFundedDiscountCents.Cents(), res.PlatformFundedDiscountCents.Cents(),
		rc.inputs.BillableKM, rc.inputs.RouteMeters, routeSource,
		promoCode, discountTarget, discountFundedBy, discountReimbursable,
		inputHash, stateHash, roundingLog, expiresAt,
	).Scan(&quoteID, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("insert quote: %w", err)
	}

	for _, l := range res.Lines {
		_, err := tx.Exec(ctx, `
			INSERT INTO quote_line (
				quote_id, line_no, menu_item_id, menu_item_version_id, menu_item_name,
				variant_id, variant_name, variant_pricing_mode, quantity,
				base_price_cents, variant_part_cents, addons_part_cents,
				line_unit_cents, line_total_cents, special_request, tax_category
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			quoteID, l.LineNo, l.MenuItemID, l.MenuItemVersionID, l.MenuItemName,
			l.VariantID, l.VariantName, l.VariantPricingMode, l.Quantity,
			l.BasePriceCents.Cents(), l.VariantPartCents.Cents(), l.AddonsPartCents.Cents(),
			l.LineUnitCents.Cents(), l.LineTotalCents.Cents(), l.SpecialRequest, string(l.TaxCategory))
		if err != nil {
			return nil, fmt.Errorf("insert quote_line: %w", err)
		}
		for i, v := range l.Variants {
			if err := insertLineVariant(ctx, tx, quoteLineVariants, quoteID, l.LineNo, i+1, v); err != nil {
				return nil, err
			}
		}
		for _, a := range l.Addons {
			_, err := tx.Exec(ctx, `
				INSERT INTO quote_line_addon (quote_id, line_no, addon_id, addon_name, addon_quantity, addon_price_cents)
				VALUES ($1,$2,$3,$4,$5,$6)`,
				quoteID, l.LineNo, a.AddonID, a.AddonName, a.AddonQuantity, a.PriceCents.Cents())
			if err != nil {
				return nil, fmt.Errorf("insert quote_line_addon: %w", err)
			}
		}
	}

	for _, tl := range res.TaxLines {
		_, err := tx.Exec(ctx, `
			INSERT INTO quote_tax_line (quote_id, seq, jurisdiction_code, tax_kind, statutory_label,
				rate, base_cents, amount_cents, rebate_applied, remittable_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			quoteID, tl.Seq, tl.JurisdictionCode, tl.TaxKind, tl.StatutoryLabel,
			tl.Rate.String(), tl.BaseCents.Cents(), tl.AmountCents.Cents(), tl.RebateApplied, tl.RemittableBy)
		if err != nil {
			return nil, fmt.Errorf("insert quote_tax_line: %w", err)
		}
	}

	return s.loadQuoteTx(ctx, tx, quoteID, req.AccountID)
}

// GetQuote reads a persisted quote owned by the account (P-07).
func (s *Store) GetQuote(ctx context.Context, accountID, quoteID string) (*Quote, error) {
	var out *Quote
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		q, err := s.loadQuoteTx(ctx, tx, quoteID, accountID)
		out = q
		return err
	})
	return out, err
}

// loadQuoteTx reads a quote header + lines + tax lines inside tx, enforcing
// ownership. It returns ErrQuoteNotFound when the row is absent or not owned.
func (s *Store) loadQuoteTx(ctx context.Context, tx pgx.Tx, quoteID, accountID string) (*Quote, error) {
	var q Quote
	var discountTarget, discountFundedBy *string
	err := tx.QueryRow(ctx, `
		SELECT id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment::text, currency::text,
		       subtotal_cents, discount_items_cents, discount_delivery_cents, discount_service_cents,
		       delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
		       commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
		       restaurant_funded_discount_cents, platform_funded_discount_cents,
		       billable_km, route_meters, route_source::text, promo_code,
		       discount_target::text, discount_funded_by::text, discount_reimbursable,
		       pricing_config_id, tax_jurisdiction_code, input_hash, state_hash, expires_at, created_at
		  FROM quote WHERE id = $1 AND account_id = $2`, quoteID, accountID).Scan(
		&q.ID, &q.AccountID, &q.CartID, &q.RestaurantID, &q.DeliveryAddressID, &q.Fulfilment, &q.Currency,
		&q.SubtotalCents, &q.DiscountItemsCents, &q.DiscountDeliveryCents, &q.DiscountServiceCents,
		&q.DeliveryFeeCents, &q.ServiceFeeCents, &q.TaxTotalCents, &q.TipCents, &q.TotalCents,
		&q.CommissionCents, &q.RestaurantNetCents, &q.RiderEarningsCents, &q.PlatformGrossCents,
		&q.RestaurantFundedDiscountCents, &q.PlatformFundedDiscountCents,
		&q.BillableKM, &q.RouteMeters, &q.RouteSource, &q.PromoCode,
		&discountTarget, &discountFundedBy, new(bool),
		&q.PricingConfigID, &q.TaxJurisdictionCode, &q.InputHash, &q.StateHash, &q.ExpiresAt, &q.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuoteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load quote: %w", err)
	}

	if q.PromoCode != nil && discountTarget != nil && discountFundedBy != nil {
		q.Discount = &pricing.Discount{
			Code: q.PromoCode, AmountCents: money.Amount(q.DiscountItemsCents + q.DiscountDeliveryCents + q.DiscountServiceCents),
			Target: *discountTarget, FundedBy: *discountFundedBy,
		}
	}

	lineRows, err := tx.Query(ctx, `
		SELECT line_no, menu_item_id, menu_item_version_id, menu_item_name,
		       variant_id, variant_name, variant_pricing_mode::text, quantity,
		       base_price_cents, variant_part_cents, addons_part_cents,
		       line_unit_cents, line_total_cents, special_request, tax_category::text
		  FROM quote_line WHERE quote_id = $1 ORDER BY line_no`, quoteID)
	if err != nil {
		return nil, fmt.Errorf("load quote_line: %w", err)
	}
	defer lineRows.Close()
	for lineRows.Next() {
		var l QuoteLine
		if err := lineRows.Scan(&l.LineNo, &l.MenuItemID, &l.MenuItemVersionID, &l.MenuItemName,
			&l.VariantID, &l.VariantName, &l.VariantPricingMode, &l.Quantity,
			&l.BasePriceCents, &l.VariantPartCents, &l.AddonsPartCents,
			&l.LineUnitCents, &l.LineTotalCents, &l.SpecialRequest, &l.TaxCategory); err != nil {
			return nil, err
		}
		q.Lines = append(q.Lines, l)
	}
	if err := lineRows.Err(); err != nil {
		return nil, err
	}
	lineRows.Close()

	variants, err := loadLineVariantSnapshots(ctx, tx, quoteLineVariants, quoteID)
	if err != nil {
		return nil, err
	}
	for i := range q.Lines {
		q.Lines[i].Variants = variants[q.Lines[i].LineNo]
		aRows, err := tx.Query(ctx, `
			SELECT addon_id, addon_name, addon_quantity, addon_price_cents
			  FROM quote_line_addon WHERE quote_id = $1 AND line_no = $2 ORDER BY addon_id`,
			quoteID, q.Lines[i].LineNo)
		if err != nil {
			return nil, err
		}
		for aRows.Next() {
			var a QuoteLineAddon
			if err := aRows.Scan(&a.AddonID, &a.AddonName, &a.AddonQuantity, &a.PriceCents); err != nil {
				aRows.Close()
				return nil, err
			}
			q.Lines[i].Addons = append(q.Lines[i].Addons, a)
		}
		if err := aRows.Err(); err != nil {
			aRows.Close()
			return nil, err
		}
		aRows.Close()
	}

	taxRows, err := tx.Query(ctx, `
		SELECT seq, jurisdiction_code, tax_kind::text, statutory_label, rate::text,
		       base_cents, amount_cents, rebate_applied, remittable_by::text
		  FROM quote_tax_line WHERE quote_id = $1 ORDER BY seq`, quoteID)
	if err != nil {
		return nil, fmt.Errorf("load quote_tax_line: %w", err)
	}
	defer taxRows.Close()
	for taxRows.Next() {
		var tl QuoteTaxLine
		var rateStr string
		if err := taxRows.Scan(&tl.Seq, &tl.JurisdictionCode, &tl.TaxKind, &tl.StatutoryLabel, &rateStr,
			&tl.BaseCents, &tl.AmountCents, &tl.RebateApplied, &tl.RemittableBy); err != nil {
			return nil, err
		}
		tl.Rate, _ = money.RateFromDecimalString(rateStr)
		q.TaxLines = append(q.TaxLines, tl)
	}
	if err := taxRows.Err(); err != nil {
		return nil, err
	}

	return &q, nil
}
