package catalog

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// searchEnvelope is the {data, meta} shape for the search operation, whose meta
// is a SearchMeta rather than the standard keyset PageMeta that httpx.RespondList
// emits.
type searchEnvelope struct {
	Data any        `json:"data"`
	Meta SearchMeta `json:"meta"`
}

// writeEnvelope writes the search operation's {data: SearchResults, meta:
// SearchMeta} body, matching G-6's single 2xx shape. It mirrors httpx.writeJSON's
// headers so the request-id and content-type contract holds.
func writeEnvelope(w http.ResponseWriter, r *http.Request, status int, data any, meta SearchMeta) {
	if rid := httpx.RequestIDFrom(r.Context()); rid != "" {
		w.Header().Set("X-Request-ID", rid)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	buf, err := json.Marshal(searchEnvelope{Data: data, Meta: meta})
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Response could not be serialised.", nil)
		return
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(buf)
	}
}

// Search implements search (GET /v1/search): two independently paginated groups,
// restaurants and dishes, both halal-gated. q is optional (absent means browse);
// present it must be 1–128 chars after trimming.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 128 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"q must be 1 to 128 characters.", nil)
		return
	}

	lat, lng, perr := parsePoint(r)
	if perr != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, perr.Error(), nil)
		return
	}

	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
				"limit must be between 1 and 50.", nil)
			return
		}
		limit = n
	}
	rCursor := r.URL.Query().Get("restaurants_cursor")
	dCursor := r.URL.Query().Get("dishes_cursor")

	rRows, err := h.repo.searchRestaurants(r.Context(), q, lat, lng, rCursor, limit)
	if h.mapErr(w, r, err) {
		return
	}
	dRows, err := h.repo.searchDishes(r.Context(), q, lat, lng, dCursor, limit)
	if h.mapErr(w, r, err) {
		return
	}

	hasAddress := lat != nil && lng != nil
	now := h.now()

	rNext, rHasMore, rRows := paginate(rRows, limit, func(rr restaurantRow) string { return rr.id })
	dNext, dHasMore, dRows := paginate(dRows, limit, func(d dishSearchRow) string { return d.menuItemID })

	results := SearchResults{Restaurants: []RestaurantCard{}, Dishes: []DishResult{}}
	for _, rr := range rRows {
		results.Restaurants = append(results.Restaurants, h.cardFor(rr, hasAddress, now))
	}
	for _, d := range dRows {
		results.Dishes = append(results.Dishes, DishResult{
			MenuItemID:  d.menuItemID,
			Name:        d.name,
			Description: d.description,
			PriceCents:  d.priceCents,
			Currency:    d.currency,
			Restaurant:  h.cardFor(d.restaurant, hasAddress, now),
		})
	}

	meta := SearchMeta{
		Restaurants: pageMeta{NextCursor: rNext, HasMore: rHasMore},
		Dishes:      pageMeta{NextCursor: dNext, HasMore: dHasMore},
	}
	// The search operation's `meta` is a SearchMeta, not the standard keyset
	// PageMeta, so the {data, meta} envelope is written explicitly.
	writeEnvelope(w, r, http.StatusOK, results, meta)
}

// cardFor builds a RestaurantCard from a row given address context and the
// clock. The open state comes from the row's hours in its timezone, its toggle,
// pause and heartbeat (openhours.go); opens_at carries the next opening when it
// is outside its hours and closes_at the end of the hours it is inside.
func (h *Handler) cardFor(rr restaurantRow, hasAddress bool, now time.Time) RestaurantCard {
	hv := evaluateHours(rr.weeklyHours, rr.hoursOverrides, rr.timezone, now)
	verdict := cardOpenState(rr.trading, rr.collectionBlock, hv, now)
	info := buildAvailabilityInfo(rr, verdict, hasAddress)
	if hv.Within && verdict.state == OpenStateOpen && hv.ClosesAt != nil {
		s := httpx.Timestamp(*hv.ClosesAt)
		info.ClosesAt = &s
	}
	if !hv.Within && hv.OpensAt != nil {
		s := httpx.Timestamp(*hv.OpensAt)
		info.OpensAt = &s
	}
	return toCard(rr, info, h.media)
}

// GetHomeFeed implements getHomeFeed (GET /v1/feed): fixed ordered sections; a
// section that would be empty is omitted entirely.
func (h *Handler) GetHomeFeed(w http.ResponseWriter, r *http.Request) {
	lat, lng, perr := parsePoint(r)
	if perr != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, perr.Error(), nil)
		return
	}
	hasAddress := lat != nil && lng != nil
	now := h.now()

	// restaurants_near_you: the visible restaurants closest to the point, or the
	// top-rated visible restaurants when no point is supplied.
	near, err := h.repo.listVisible(r.Context(), listFilters{
		lat: lat, lng: lng, sort: "DISTANCE_ASC", limit: 10,
	})
	if h.mapErr(w, r, err) {
		return
	}

	sections := []FeedSection{}
	if len(near) > 0 {
		cards := make([]RestaurantCard, 0, len(near))
		for _, rr := range near {
			cards = append(cards, h.cardFor(rr, hasAddress, now))
		}
		sections = append(sections, FeedSection{
			Key:         "restaurants_near_you",
			Title:       "Restaurants near you",
			Restaurants: cards,
		})
	}
	// TODO(scope): order_again, trending_in_your_area, your_favourite_restaurants,
	// popular_items, you_might_like require order history and favourites owned by
	// the orders and accounts modules. Omitted rather than faked with a placeholder
	// section — an empty section must never be rendered as a shell (C-09).

	httpx.Respond(w, r, http.StatusOK, sections)
}

// CreateCertificateViewUrl implements createCertificateViewUrl (POST
// /v1/restaurants/{restaurantId}/certificate-url): a 300 s presigned GET for the
// halal certificate document. Never served from a public URL (C-12/P-28).
func (h *Handler) CreateCertificateViewUrl(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	if h.presigner == nil {
		// No presigner wired: the certificate cannot be viewed. This is a 404
		// rather than a 500 because from the customer's perspective there is no
		// viewable certificate at this resource.
		h.failNotFound(w, r)
		return
	}
	ref, err := h.repo.getCertificateObject(r.Context(), id)
	if h.mapErr(w, r, err) {
		return
	}
	url, expiresAt, err := h.presigner.PresignGet(r.Context(), ref.bucket, ref.objectKey, 300*time.Second)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Could not mint a certificate view URL.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, PresignedDownload{
		URL:       url,
		ExpiresAt: httpx.Timestamp(expiresAt),
	})
}

// paginate takes a slice of one-more-than-limit rows and returns the next cursor,
// has_more, and the trimmed page. keyOf extracts the cursor key from the last row.
func paginate[T any](rows []T, limit int, keyOf func(T) string) (*string, bool, []T) {
	if limit <= 0 {
		limit = 20
	}
	if len(rows) > limit {
		last := keyOf(rows[limit-1])
		return &last, true, rows[:limit]
	}
	return nil, false, rows
}
