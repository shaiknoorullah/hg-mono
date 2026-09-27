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

// cardFor builds a RestaurantCard from a row given address context and the clock.
func (h *Handler) cardFor(rr restaurantRow, hasAddress bool, now time.Time) RestaurantCard {
	verdict := deriveOpenState(availabilityRow{
		accountState: "LIVE", isAcceptingOrders: true, lastHeartbeatAt: &now,
	}, now, true, false)
	info := buildAvailabilityInfo(rr, verdict, hasAddress)
	return toCard(rr, info, h.media)
}

// GetHomeFeed implements getHomeFeed (GET /v1/feed) — C-09.
//
// Four of the six contracted sections, in the contract's fixed order, each
// omitted entirely when empty (never an empty shell):
//
//	order_again · restaurants_near_you · trending_in_your_area · you_might_like
//
// The other two are omitted because they cannot honestly be built yet:
//
//   - your_favourite_restaurants: there is no favourites table and no endpoint
//     to favourite a restaurant, so there is nothing to read.
//   - popular_items: C-09 never defines it, and the contract types every
//     section as RestaurantCard[] while the name promises items. Defining it is
//     a product decision, possibly a contract change, not a query.
//
// Without a point, deliverability is unknown, so no section is returned. C-09
// rule 5 has the client send its saved address's coordinates or show the
// address prompt; there is no geographic fallback. (The old handler labelled
// arbitrary restaurants "near you" here, in id order.)
func (h *Handler) GetHomeFeed(w http.ResponseWriter, r *http.Request) {
	lat, lng, perr := parsePoint(r)
	if perr != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, perr.Error(), nil)
		return
	}
	sections := []FeedSection{}
	if lat == nil || lng == nil {
		httpx.Respond(w, r, http.StatusOK, sections)
		return
	}

	ctx := r.Context()
	cfg, err := h.repo.currentDiscoveryConfig(ctx)
	if h.mapErr(w, r, err) {
		return
	}
	pt := point{lat: *lat, lng: *lng}
	now := h.now()
	add := func(key, title string, rows []restaurantRow) {
		if len(rows) == 0 {
			return
		}
		cards := make([]RestaurantCard, 0, len(rows))
		for _, rr := range rows {
			cards = append(cards, h.cardFor(rr, true, now))
		}
		sections = append(sections, FeedSection{Key: key, Title: title, Restaurants: cards})
	}

	// Personal sections need an account. The route is CUSTOMER-only, so one is
	// always present; the guard keeps an empty id from reaching a uuid column.
	accountID := httpx.PrincipalFrom(ctx).AccountID

	var orderAgain []restaurantRow
	if accountID != "" {
		if orderAgain, err = h.repo.feedOrderAgain(ctx, accountID, pt, cfg); h.mapErr(w, r, err) {
			return
		}
	}
	add("order_again", "Order again", orderAgain)

	near, err := h.repo.feedNearYou(ctx, pt, cfg)
	if h.mapErr(w, r, err) {
		return
	}
	add("restaurants_near_you", "Restaurants near you", near)

	trending, err := h.repo.feedTrending(ctx, pt, cfg)
	if h.mapErr(w, r, err) {
		return
	}
	add("trending_in_your_area", "Trending in your area", trending)

	if accountID != "" {
		shown := make([]string, 0, len(orderAgain))
		for _, rr := range orderAgain {
			shown = append(shown, rr.id)
		}
		mightLike, err := h.repo.feedYouMightLike(ctx, accountID, pt, cfg, shown)
		if h.mapErr(w, r, err) {
			return
		}
		add("you_might_like", "You might like", mightLike)
	}

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
