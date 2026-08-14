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
	// A non-empty cart is bound to exactly one restaurant, so re-assert that
	// restaurant's halal seal on the cart surface (C-12/C-19). An empty cart (no
	// RestaurantID) leaves restaurant null, which the contract permits.
	if c.RestaurantID != nil {
		d.Restaurant = cartRestaurantCard(c)
	}
	for _, l := range c.Lines {
		ld := cartLineDTO{
			ID: l.ID, MenuItemID: l.MenuItemID, Name: l.Name, ImageURL: l.ImageURL, Quantity: l.Quantity,
			SpecialRequest: l.SpecialRequest, UnitPriceCents: l.UnitPriceCents,
			LineTotalCents: l.LineTotalCents, Currency: l.Currency, Addons: []selectedAddonDTO{},
			Availability: cartAvailabilityDTO{IsAvailable: l.IsAvailable, Reason: l.UnavailReason, CurrentPriceCents: l.CurrentPriceCents},
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

// halalBadge builds the contract HalalBadge (C-12) from the parts loaded on the
// cart/order — display_state is always present, the certifying body name and
// expiry are free text/date when known. It never emits a flat string; the object
// is the product's single claim (invariant #8).
func halalBadge(displayState string, certifyingBody, expiresOn *string) halalBadgeDTO {
	b := halalBadgeDTO{DisplayState: displayState}
	if certifyingBody != nil {
		b.CertifyingBodyName = certifyingBody
	}
	if expiresOn != nil {
		b.ExpiresOn = expiresOn
	}
	return b
}

// cartRestaurantCard renders the RestaurantCard for a bound cart, including the
// halal seal. logo/hero are null until a media resolver lands (same convention
// as the catalog card); the halal badge is the load-bearing field here.
func cartRestaurantCard(c *Cart) *restaurantCardDTO {
	card := &restaurantCardDTO{
		ID:           derefStr(c.RestaurantID),
		Name:         derefStr(c.RestaurantName),
		Slug:         c.RestaurantSlug,
		Cuisines:     []string{},
		RatingAvg:    c.RestaurantRatingAvg,
		RatingCount:  c.RestaurantRatingCount,
		PriceBand:    c.RestaurantPriceBand,
		Halal:        halalBadge(c.HalalStatus, c.HalalCertifyingBody, c.HalalExpiresOn),
		Availability: cartRestaurantAvailability(c),
	}
	return card
}

// cartRestaurantAvailability derives the minimal C-14 serviceability verdict the
// cart can compute from what it loaded: OPEN when the restaurant is LIVE and
// accepting, otherwise PAUSED/CLOSED. distance_m is null (the cart holds no
// address-relative geodesic distance; the full verdict is the catalog engine's).
func cartRestaurantAvailability(c *Cart) restaurantAvailabilityInfoDTO {
	state := "OPEN"
	if c.RestaurantAccountState != "LIVE" {
		state = "CLOSED_HOURS"
	} else if !c.RestaurantIsAccepting {
		state = "PAUSED"
	}
	return restaurantAvailabilityInfoDTO{
		State:             state,
		MinimumOrderCents: c.RestaurantMinOrder,
	}
}

// addressToDTO renders the customer's delivery address (contract Address).
func addressToDTO(a *OrderAddress) *addressDTO {
	return &addressDTO{
		ID: a.ID, Label: a.Label, Line1: a.Line1, Line2: a.Line2, Unit: a.Unit,
		Buzzer: a.Buzzer, City: a.City, Province: a.Province, PostalCode: a.PostalCode,
		Country: a.Country, Latitude: a.Latitude, Longitude: a.Longitude,
		Timezone: a.Timezone, DeliveryNotes: a.DeliveryNotes, IsDefault: a.IsDefault,
	}
}

func orderViewToDTO(v *OrderView) orderCustomerViewDTO {
	ref := orderRestaurantRefDTO{ID: v.RestaurantID, Name: v.RestaurantName, LogoImageURL: v.RestaurantLogoURL}
	// The customer order view surfaces the restaurant's halal state (C-12): when
	// the display_state is known, carry the HalalBadge object; never a flat string.
	if v.HalalStatus != "" {
		b := halalBadge(v.HalalStatus, v.HalalCertifyingBody, v.HalalExpiresOn)
		ref.Halal = &b
	}
	d := orderCustomerViewDTO{
		ID: v.ID, Code: v.Code, State: v.State, StateSince: httpx.Timestamp(v.StateSince),
		DeadlineAt: tsPtr(v.DeadlineAt), QuoteID: v.QuoteID,
		Restaurant:           ref,
		DeliveryInstructions: v.DeliveryInstructions, SpecialInstructions: v.SpecialInstructions,
		DispatchState: v.DispatchState,
		CancelReason:  v.CancelReason, RejectReason: v.RejectReason, CanCancel: v.CanCancel,
		PlacedAt: httpx.Timestamp(v.PlacedAt), AcceptedAt: tsPtr(v.AcceptedAt), ReadyAt: tsPtr(v.ReadyAt),
		PickedUpAt: tsPtr(v.PickedUpAt), DeliveredAt: tsPtr(v.DeliveredAt), CompletedAt: tsPtr(v.CompletedAt),
		Lines: []orderLineDTO{},
	}
	if v.DeliveryAddress != nil {
		d.DeliveryAddress = addressToDTO(v.DeliveryAddress)
	}
	if v.Rider != nil {
		d.Rider = &riderPublicProfileDTO{
			FirstName: v.Rider.FirstName, LastInitial: v.Rider.LastInitial,
			PhotoURL: v.Rider.PhotoURL, VehicleType: v.Rider.VehicleType, RatingAvg: v.Rider.RatingAvg,
		}
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
