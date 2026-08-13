package orders

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// map.go turns the store's domain types into the contract wire DTOs. It is the
// one place the customer projection is assembled, so a field that must never
// reach a customer (the internal commission/rider/platform split) has no path
// here by construction (P-07).

func quoteToDTO(q *Quote) quoteDTO {
	d := quoteDTO{
		ID: q.ID, CartID: q.CartID, RestaurantID: q.RestaurantID,
		DeliveryAddressID: q.DeliveryAddressID, Fulfilment: q.Fulfilment, Currency: q.Currency,
		SubtotalCents: q.SubtotalCents, DiscountItemsCents: q.DiscountItemsCents,
		DiscountDeliveryCents: q.DiscountDeliveryCents, DiscountServiceCents: q.DiscountServiceCents,
		DeliveryFeeCents: q.DeliveryFeeCents, ServiceFeeCents: q.ServiceFeeCents,
		TaxTotalCents: q.TaxTotalCents, TipCents: q.TipCents, TotalCents: q.TotalCents,
		BillableKM: q.BillableKM, RouteMeters: q.RouteMeters, RouteSource: q.RouteSource,
		ExpiresAt: httpx.Timestamp(q.ExpiresAt), CreatedAt: httpx.Timestamp(q.CreatedAt),
		Lines: []quoteLineDTO{}, TaxLines: []quoteTaxLineDTO{},
	}
	for _, l := range q.Lines {
		ld := quoteLineDTO{
			LineNo: l.LineNo, MenuItemID: l.MenuItemID, MenuItemName: l.MenuItemName,
			VariantID: l.VariantID, VariantName: l.VariantName, VariantPricingMode: l.VariantPricingMode,
			Quantity: l.Quantity, BasePriceCents: l.BasePriceCents, VariantPartCents: l.VariantPartCents,
			AddonsPartCents: l.AddonsPartCents, LineUnitCents: l.LineUnitCents, LineTotalCents: l.LineTotalCents,
			SpecialRequest: l.SpecialRequest, TaxCategory: l.TaxCategory, Addons: []quoteLineAddonDTO{},
		}
		for _, a := range l.Addons {
			ld.Addons = append(ld.Addons, quoteLineAddonDTO{
				AddonID: a.AddonID, AddonName: a.AddonName, AddonQuantity: a.AddonQuantity, AddonPriceCents: a.PriceCents,
			})
		}
		d.Lines = append(d.Lines, ld)
	}
	for _, tl := range q.TaxLines {
		d.TaxLines = append(d.TaxLines, taxLineToDTO(tl))
	}
	if q.Discount != nil {
		d.Discount = &quoteDiscountDTO{
			Code: q.Discount.Code, AmountCents: q.Discount.AmountCents.Cents(),
			Target: q.Discount.Target, FundedBy: q.Discount.FundedBy, Reimbursable: q.Discount.Reimbursable,
		}
	}
	return d
}

func taxLineToDTO(tl QuoteTaxLine) quoteTaxLineDTO {
	return quoteTaxLineDTO{
		JurisdictionCode: tl.JurisdictionCode, TaxKind: tl.TaxKind, StatutoryLabel: tl.StatutoryLabel,
		Rate: tl.Rate.String(), BaseCents: tl.BaseCents, AmountCents: tl.AmountCents,
		RebateApplied: tl.RebateApplied, RemittableBy: tl.RemittableBy,
	}
}

func cartToDTO(c *Cart) cartDTO {
	d := cartDTO{
		ID: c.ID, DeliveryAddressID: c.DeliveryAddressID,
		ItemCount: c.ItemCount, IndicativeSubtotalCents: c.IndicativeSubtotalCents,
		Currency: c.Currency, IsQuotable: c.IsQuotable, BlockingReasons: c.BlockingReasons,
		Lines: []cartLineDTO{},
	}
	if c.Currency == "" {
		d.Currency = "CAD"
	}
	for _, l := range c.Lines {
		ld := cartLineDTO{
			ID: l.ID, MenuItemID: l.MenuItemID, Name: l.Name, Quantity: l.Quantity,
			SpecialRequest: l.SpecialRequest, UnitPriceCents: l.UnitPriceCents,
			LineTotalCents: l.LineTotalCents, Currency: l.Currency, Addons: []selectedAddonDTO{},
			Availability: cartAvailabilityDTO{IsAvailable: l.IsAvailable, Reason: l.UnavailReason},
		}
		if l.Variant != nil {
			ld.Variant = &selectedVariantDTO{VariantID: l.Variant.VariantID, Name: l.Variant.Name, PricingMode: l.Variant.PricingMode}
		}
		for _, a := range l.Addons {
			ld.Addons = append(ld.Addons, selectedAddonDTO{AddonID: a.AddonID, Name: a.Name, Quantity: a.Quantity})
		}
		d.Lines = append(d.Lines, ld)
	}
	return d
}

func orderViewToDTO(v *OrderView) orderCustomerViewDTO {
	d := orderCustomerViewDTO{
		ID: v.ID, Code: v.Code, State: v.State, StateSince: httpx.Timestamp(v.StateSince),
		DeadlineAt: tsPtr(v.DeadlineAt), QuoteID: v.QuoteID,
		Restaurant:           orderRestaurantRefDTO{ID: v.RestaurantID, Name: v.RestaurantName, LogoImageURL: v.RestaurantLogoURL},
		DeliveryInstructions: v.DeliveryInstructions, SpecialInstructions: v.SpecialInstructions,
		CancelReason: v.CancelReason, RejectReason: v.RejectReason, CanCancel: v.CanCancel,
		PlacedAt: httpx.Timestamp(v.PlacedAt), AcceptedAt: tsPtr(v.AcceptedAt), ReadyAt: tsPtr(v.ReadyAt),
		PickedUpAt: tsPtr(v.PickedUpAt), DeliveredAt: tsPtr(v.DeliveredAt), CompletedAt: tsPtr(v.CompletedAt),
		Lines: []orderLineDTO{},
	}
	if d.DeliveryInstructions == nil {
		d.DeliveryInstructions = []string{}
	}
	money := orderMoneyDTO{
		SubtotalCents: v.SubtotalCents, DiscountCents: v.DiscountCents, DeliveryFeeCents: v.DeliveryFeeCents,
		ServiceFeeCents: v.ServiceFeeCents, TaxTotalCents: v.TaxTotalCents, TipCents: v.TipCents,
		TotalCents: v.TotalCents, Currency: v.Currency, TaxLines: []quoteTaxLineDTO{},
	}
	for _, tl := range v.TaxLines {
		money.TaxLines = append(money.TaxLines, taxLineToDTO(tl))
	}
	d.Money = money
	for _, l := range v.Lines {
		ld := orderLineDTO{
			LineNo: l.LineNo, MenuItemID: l.MenuItemID, Name: l.Name, VariantName: l.VariantName,
			Quantity: l.Quantity, SpecialRequest: l.SpecialRequest, UnitPriceCents: l.UnitPriceCents,
			LineTotalCents: l.LineTotalCents, Currency: l.Currency, Addons: []quoteLineAddonDTO{},
		}
		for _, a := range l.Addons {
			ld.Addons = append(ld.Addons, quoteLineAddonDTO{
				AddonID: a.AddonID, AddonName: a.AddonName, AddonQuantity: a.AddonQuantity, AddonPriceCents: a.PriceCents,
			})
		}
		d.Lines = append(d.Lines, ld)
	}
	return d
}

func orderSummaryToDTO(o OrderSummary) orderSummaryDTO {
	d := orderSummaryDTO{
		ID: o.ID, Code: o.Code, State: o.State,
		Restaurant: orderRestaurantRefDTO{ID: o.RestaurantID, Name: o.RestaurantName, LogoImageURL: o.RestaurantLogo},
		ItemCount:  o.ItemCount, FirstItemNames: o.FirstItemNames, TotalCents: o.TotalCents,
		Currency: o.Currency, PlacedAt: httpx.Timestamp(o.PlacedAt), DeadlineAt: tsPtr(o.DeadlineAt),
	}
	if d.FirstItemNames == nil {
		d.FirstItemNames = []string{}
	}
	return d
}
