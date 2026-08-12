package catalog

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ListRestaurants implements listRestaurants (GET /v1/restaurants): the
// halal-gated browse list with the nine filters, PostGIS proximity and keyset
// paging. The halal predicate is a precondition for being listed, not a filter.
func (h *Handler) ListRestaurants(w http.ResponseWriter, r *http.Request) {
	f, ferr := parseListFilters(r)
	if ferr != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, ferr.Error(),
			[]httpx.FieldError{{Field: ferr.field, Code: "invalid", Message: ferr.Error()}})
		return
	}

	rows, err := h.repo.listVisible(r.Context(), f)
	if h.mapErr(w, r, err) {
		return
	}

	hasAddress := f.lat != nil && f.lng != nil
	limit := f.limit
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	var nextCursor *string
	hasMore := false
	if len(rows) > limit {
		hasMore = true
		last := rows[limit-1].id
		nextCursor = &last
		rows = rows[:limit]
	}

	cards := make([]RestaurantCard, 0, len(rows))
	now := h.now()
	for _, rr := range rows {
		// A listed restaurant is by predicate ACTIVE; its availability card is
		// computed from the current row. Trading-hours evaluation is a TODO
		// (requires the restaurant_hours join in the restaurant's timezone); a
		// listed restaurant is treated as within hours until that lands.
		verdict := deriveOpenState(availabilityRow{
			accountState:      "LIVE",
			isAcceptingOrders: true,
			lastHeartbeatAt:   &now,
		}, now, true, false)
		info := buildAvailabilityInfo(rr, verdict, hasAddress)
		cards = append(cards, toCard(rr, info, h.media))
	}

	httpx.RespondList(w, r, http.StatusOK, cards, httpx.Meta{
		NextCursor: nextCursor,
		HasMore:    hasMore,
	})
}

// GetRestaurant implements getRestaurant (GET /v1/restaurants/{restaurantId}):
// detail for a customer-visible restaurant, 404 otherwise (C-13).
func (h *Handler) GetRestaurant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	lat, lng, aerr := parsePoint(r)
	if aerr != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, aerr.Error(), nil)
		return
	}

	rr, err := h.repo.getVisible(r.Context(), id, lat, lng)
	if h.mapErr(w, r, err) {
		return
	}

	cr, err := h.repo.getCertification(r.Context(), id)
	if h.mapErr(w, r, err) {
		return
	}
	hours, err := h.repo.getHours(r.Context(), id)
	if h.mapErr(w, r, err) {
		return
	}

	now := h.now()
	verdict := deriveOpenState(availabilityRow{
		accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &now,
	}, now, true, false)
	info := buildAvailabilityInfo(rr, verdict, lat != nil && lng != nil)
	card := toCard(rr, info, h.media)

	viewable := h.presigner != nil && cr.documentID != nil
	detail := RestaurantDetail{
		RestaurantCard:  card,
		Description:     rr.description,
		Timezone:        rr.timezone,
		PublicPhoneE164: rr.publicPhone,
		Certification:   toCertificationPanel(cr, viewable),
		Hours:           toTradingIntervals(hours),
		Address: PublicAddress{
			Line1:      deref(rr.line1),
			Line2:      rr.line2,
			City:       deref(rr.city),
			Province:   deref(rr.province),
			PostalCode: deref(rr.postalCode),
		},
	}
	if rr.latitude != nil {
		detail.Address.Latitude = *rr.latitude
	}
	if rr.longitude != nil {
		detail.Address.Longitude = *rr.longitude
	}

	httpx.Respond(w, r, http.StatusOK, detail)
}

// GetRestaurantMenu implements getRestaurantMenu: the customer-facing menu.
func (h *Handler) GetRestaurantMenu(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	cats, byCat, err := h.repo.getCustomerMenu(r.Context(), id)
	if h.mapErr(w, r, err) {
		return
	}

	// Collect item ids across all categories for one options round-trip.
	var itemIDs []string
	for _, items := range byCat {
		for _, it := range items {
			itemIDs = append(itemIDs, it.id)
		}
	}
	vGroups, variants, aGroups, addons, err := h.repo.getItemOptions(r.Context(), itemIDs)
	if h.mapErr(w, r, err) {
		return
	}

	out := Menu{RestaurantID: id, Categories: []MenuCategoryWithItems{}}
	for _, c := range cats {
		cat := MenuCategoryWithItems{
			ID:          c.id,
			Name:        c.name,
			Description: c.description,
			SortOrder:   c.sortOrder,
			IsActive:    c.isActive,
			Items:       []MenuItem{},
		}
		for _, it := range byCat[c.id] {
			cat.Items = append(cat.Items,
				toMenuItem(it, vGroups[it.id], variants, aGroups[it.id], addons, h.media))
		}
		count := int32(len(cat.Items))
		cat.ItemCount = &count
		out.Categories = append(out.Categories, cat)
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// GetRestaurantCertification implements getRestaurantCertification (C-12).
func (h *Handler) GetRestaurantCertification(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	cr, err := h.repo.getCertification(r.Context(), id)
	if h.mapErr(w, r, err) {
		return
	}
	viewable := h.presigner != nil && cr.documentID != nil
	httpx.Respond(w, r, http.StatusOK, toCertificationPanel(cr, viewable))
}

// deref returns the pointed-to string, or "" for a nil pointer. Used where the
// contract requires a non-nullable string field but the column is nullable at
// the schema level (a visible restaurant always has these set by I-30.2).
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// filterError names a bad query parameter for a VALIDATION_FAILED response.
type filterError struct {
	field string
	msg   string
}

func (e *filterError) Error() string { return e.msg }

func newFilterError(field, msg string) *filterError { return &filterError{field: field, msg: msg} }

// parsePoint reads latitude/longitude from the query, validating ranges. Both or
// neither must be present.
func parsePoint(r *http.Request) (lat, lng *float64, err *filterError) {
	q := r.URL.Query()
	latStr, lngStr := q.Get("latitude"), q.Get("longitude")
	if latStr == "" && lngStr == "" {
		return nil, nil, nil
	}
	if latStr == "" || lngStr == "" {
		return nil, nil, newFilterError("latitude", "latitude and longitude must be supplied together")
	}
	la, e1 := strconv.ParseFloat(latStr, 64)
	lo, e2 := strconv.ParseFloat(lngStr, 64)
	if e1 != nil || la < -90 || la > 90 {
		return nil, nil, newFilterError("latitude", "latitude must be a number between -90 and 90")
	}
	if e2 != nil || lo < -180 || lo > 180 {
		return nil, nil, newFilterError("longitude", "longitude must be a number between -180 and 180")
	}
	return &la, &lo, nil
}

// parseListFilters parses and validates the nine discovery filters.
func parseListFilters(r *http.Request) (listFilters, *filterError) {
	q := r.URL.Query()
	var f listFilters

	lat, lng, perr := parsePoint(r)
	if perr != nil {
		return f, perr
	}
	f.lat, f.lng = lat, lng

	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			return f, newFilterError("limit", "limit must be between 1 and 50")
		}
		f.limit = n
	}
	f.cursor = q.Get("cursor")

	if v := q.Get("max_distance_m"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 500 || n > 20000 {
			return f, newFilterError("max_distance_m", "max_distance_m must be between 500 and 20000")
		}
		d := int32(n)
		f.maxDistanceM = &d
	}

	if v := q.Get("min_rating"); v != "" {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil || (n != 3.5 && n != 4.0 && n != 4.5) {
			return f, newFilterError("min_rating", "min_rating must be one of 3.5, 4.0, 4.5")
		}
		f.minRating = &n
	}

	if v := q.Get("open_now"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return f, newFilterError("open_now", "open_now must be a boolean")
		}
		f.openNow = &b
	}

	if v := q.Get("cuisine_ids"); v != "" {
		f.cuisineIDs = splitCSV(v)
		if len(f.cuisineIDs) > 10 {
			return f, newFilterError("cuisine_ids", "at most 10 cuisine ids")
		}
	}
	if v := q.Get("price_band"); v != "" {
		f.priceBands = splitCSV(v)
		for _, b := range f.priceBands {
			if b != "$" && b != "$$" && b != "$$$" && b != "$$$$" {
				return f, newFilterError("price_band", "price_band members must be one of $, $$, $$$, $$$$")
			}
		}
	}
	if v := q.Get("dietary"); v != "" {
		f.dietary = splitCSV(v)
		if len(f.dietary) > 6 {
			return f, newFilterError("dietary", "at most 6 dietary tags")
		}
	}

	if v := q.Get("sort"); v != "" {
		switch v {
		case "RECOMMENDED", "RATING_DESC", "ETA_ASC", "DISTANCE_ASC":
			f.sort = v
		default:
			return f, newFilterError("sort", "sort must be one of RECOMMENDED, RATING_DESC, ETA_ASC, DISTANCE_ASC")
		}
	}
	return f, nil
}

// splitCSV splits a form-style comma list, trimming blanks.
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
