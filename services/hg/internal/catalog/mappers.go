package catalog

import (
	"context"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ratingFloor is the C-12/RestaurantCard rule: rating_avg is null until there are
// at least this many ratings, so the client renders "New" rather than a number
// invented from a single review.
const ratingFloor = 5

// toHalalBadge builds the HalalBadge for a card from a restaurant row.
func toHalalBadge(rr restaurantRow) HalalBadge {
	b := HalalBadge{DisplayState: rr.halalStatus}
	if rr.certifyingBody != nil {
		b.CertifyingBodyName = rr.certifyingBody
	}
	if rr.certExpiresOn != nil {
		s := rr.certExpiresOn.Format("2006-01-02")
		b.ExpiresOn = &s
	}
	return b
}

// toCard maps a restaurant row to a RestaurantCard. The availability object is
// layered by the handler because it depends on the query address and the clock.
func toCard(rr restaurantRow, avail RestaurantAvailabilityInfo, media MediaResolver) RestaurantCard {
	c := RestaurantCard{
		ID:           rr.id,
		Name:         rr.displayName,
		Slug:         rr.slug,
		HeroImageURL: media.URLForKey(deref(rr.coverObjectBucket), deref(rr.coverObjectKey)),
		LogoImageURL: media.URLForKey(deref(rr.logoObjectBucket), deref(rr.logoObjectKey)),
		Cuisines:     nonNilStrings(rr.cuisines),
		RatingCount:  rr.ratingCount,
		PriceBand:    rr.priceBand,
		Halal:        toHalalBadge(rr),
		Availability: avail,
	}
	if rr.ratingAvg != nil && rr.ratingCount >= ratingFloor {
		c.RatingAvg = rr.ratingAvg
	}
	return c
}

// MediaResolver turns a stored media object into the public URL a client GETs
// directly (hg-media is public-read; KYC/POD stay private). The list and menu
// projections join stored_object and pass the (bucket, object_key) to URLForKey,
// so a page of cards costs no extra round-trips (no N+1); single-item callers
// with a context use PublicURL, which does one lookup. A missing image resolves
// to null, which the contract renders as a neutral placeholder — never a
// bundled photo. *Resolver (media.go) is the real implementation.
type MediaResolver interface {
	// URLForKey builds a public URL from an already-fetched (bucket, object_key);
	// no I/O. nil for a private bucket, an empty key, or an unconfigured base.
	URLForKey(bucket, objectKey string) *string
	// PublicURL resolves a single stored-object id to its public URL with one
	// lookup; nil when missing, not READY, or private.
	PublicURL(ctx context.Context, objectID string) *string
}

// nilMedia renders every image as null. A missing image is a neutral placeholder
// per the contract, so this is a correct — if minimal — resolver, used when no
// real resolver is wired (minimal wiring, tests).
type nilMedia struct{}

// URLForKey always returns nil.
func (nilMedia) URLForKey(string, string) *string { return nil }

// PublicURL always returns nil.
func (nilMedia) PublicURL(context.Context, string) *string { return nil }

// toCertificationPanel maps a certification row to the C-12 panel.
func toCertificationPanel(cr certificationRow, viewable bool) CertificationPanel {
	p := CertificationPanel{
		DisplayState:        cr.halalStatus,
		CertifyingBodyName:  cr.certifyingBody,
		CertificateNumber:   cr.certificateNumber,
		Scope:               cr.scope,
		CertificateViewable: viewable,
	}
	var verifiedOn string
	if cr.issuedOn != nil {
		s := cr.issuedOn.Format("2006-01-02")
		p.IssuedOn = &s
	}
	if cr.expiresOn != nil {
		s := cr.expiresOn.Format("2006-01-02")
		p.ExpiresOn = &s
	}
	if cr.verifiedAt != nil {
		s := httpx.Timestamp(*cr.verifiedAt)
		p.VerifiedAt = &s
		verifiedOn = cr.verifiedAt.Format("2 January 2006")
	}
	p.Disclaimer = certificationDisclaimer(verifiedOn)
	return p
}

// toMenuItem maps a menu item row plus its option groups to the customer
// MenuItem projection. Empty option lists are emitted as [] not null so the
// client renders "no options" rather than crashing on a nil.
func toMenuItem(it menuItemRow, vGroups []variantGroupRow, variants map[string][]variantRow,
	aGroups []addonGroupRow, addons map[string][]addonRow, media MediaResolver) MenuItem {
	m := MenuItem{
		ID:                it.id,
		Name:              it.name,
		Description:       it.description,
		ImageURL:          media.URLForKey(deref(it.imageObjectBucket), deref(it.imageObjectKey)),
		PriceCents:        it.priceCents,
		Currency:          it.currency,
		AvailabilityState: it.availabilityState,
		IngredientsText:   it.ingredientsText,
		TaxCategory:       it.taxCategory,
		PrepMinutes:       it.prepMinutes,
		DietaryTags:       nonNilStrings(it.dietaryTags),
		AllergenTags:      nonNilStrings(it.allergenTags),
		VariantGroups:     []VariantGroup{},
		AddonGroups:       []AddonGroup{},
	}
	if it.outOfStockUntil != nil {
		s := httpx.Timestamp(*it.outOfStockUntil)
		m.OutOfStockUntil = &s
	}
	for _, g := range vGroups {
		vg := VariantGroup{ID: g.id, Name: g.name, Required: g.required, Variants: []Variant{}}
		for _, v := range variants[g.id] {
			vg.Variants = append(vg.Variants, Variant{
				ID:          v.id,
				Name:        v.name,
				PricingMode: v.pricingMode,
				PriceCents:  v.priceCents,
				DeltaCents:  v.deltaCents,
				IsDefault:   v.isDefault,
				IsAvailable: v.isAvailable,
			})
		}
		m.VariantGroups = append(m.VariantGroups, vg)
	}
	for _, g := range aGroups {
		ag := AddonGroup{ID: g.id, Name: g.name, MinSelect: g.minSelect, MaxSelect: g.maxSelect, Addons: []Addon{}}
		for _, a := range addons[g.id] {
			ag.Addons = append(ag.Addons, Addon{
				ID: a.id, Name: a.name, PriceCents: a.priceCents, IsAvailable: a.isAvailable,
			})
		}
		m.AddonGroups = append(m.AddonGroups, ag)
	}
	return m
}

// nonNilStrings returns an empty slice for a nil source so the JSON is [] not null.
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// toTradingIntervals maps hours rows to the contract's TradingInterval list.
func toTradingIntervals(rows []hoursRow) []TradingInterval {
	out := make([]TradingInterval, 0, len(rows))
	for _, h := range rows {
		out = append(out, TradingInterval{
			DayOfWeek:       h.dayOfWeek,
			OpensAt:         h.opensAt,
			ClosesAt:        h.closesAt,
			CrossesMidnight: h.crossesMidnight,
		})
	}
	return out
}
