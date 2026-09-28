package catalog

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The home feed (docs/spec/02-customer.md "Home feed"), against a real migrated database.
//
// Sections are asserted by the restaurants each test created. Other packages'
// tests may be writing restaurants to the same database concurrently, so a test
// never assumes it owns the whole feed — only that its own rows land where the
// rules say, and nowhere else.

// downtown is the request point: Toronto, King and Bay.
var downtown = [2]float64{43.6532, -79.3832}

// near returns a point roughly `metres` north of downtown.
func near(metres float64) (lat, lng float64) {
	return downtown[0] + metres/111_000.0, downtown[1]
}

type feedResponse struct {
	Data []FeedSection `json:"data"`
}

func getFeed(t *testing.T, h *Handler, accountID string, point *[2]float64) []FeedSection {
	t.Helper()
	target := "/v1/feed"
	if point != nil {
		target += fmt.Sprintf("?latitude=%f&longitude=%f", point[0], point[1])
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req = req.WithContext(httpx.WithPrincipalForTest(req.Context(), httpx.Principal{
		AccountID: accountID, Roles: []httpx.Role{"CUSTOMER"},
	}))
	rec := httptest.NewRecorder()
	h.GetHomeFeed(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d: %s", target, rec.Code, rec.Body.String())
	}
	var body feedResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Data == nil {
		// The contract's data is an array. A null here is a contract violation,
		// not an empty feed.
		t.Fatalf("GET %s returned data: null, want an array: %s", target, rec.Body.String())
	}
	return body.Data
}

func section(sections []FeedSection, key string) []string {
	for _, s := range sections {
		if s.Key == key {
			ids := make([]string, 0, len(s.Restaurants))
			for _, c := range s.Restaurants {
				ids = append(ids, c.ID)
			}
			return ids
		}
	}
	return nil
}

// only keeps the ids in got that are in mine, preserving got's order.
func only(got, mine []string) []string {
	out := []string{}
	for _, id := range got {
		if slices.Contains(mine, id) {
			out = append(out, id)
		}
	}
	return out
}

func everySectionIDs(sections []FeedSection) []string {
	var all []string
	for _, s := range sections {
		for _, c := range s.Restaurants {
			all = append(all, c.ID)
		}
	}
	return all
}

func newFeedHandler(t *testing.T) (*Handler, *feedWorld) {
	pool := requirePool(t)
	return NewHandler(NewRepo(pool), nil, nil, nil), newFeedWorld(t, pool)
}

func TestFeed_NearYouIsRadiusGatedAndHalalGated(t *testing.T) {
	h, w := newFeedHandler(t)
	la, lo := near(1_000)
	inside := w.restaurant(restaurantOpts{name: "Inside", lat: la, lng: lo, certified: true})
	fa, fo := near(40_000) // outside the configured radius
	outside := w.restaurant(restaurantOpts{name: "Outside", lat: fa, lng: fo, certified: true})
	unverified := w.restaurant(restaurantOpts{name: "Unverified", lat: la, lng: lo})

	feed := getFeed(t, h, w.account("cust"), &downtown)
	nearIDs := section(feed, "restaurants_near_you")

	if !slices.Contains(nearIDs, inside) {
		t.Errorf("a certified restaurant 1 km away is missing from restaurants_near_you")
	}
	if slices.Contains(everySectionIDs(feed), outside) {
		t.Errorf("a restaurant 40 km away appears in the feed; every section is radius-gated")
	}
	// The spec's acceptance criterion 2, and "a missing halal field renders no badge"
	// (AGENTS.md "Non-negotiable invariants"): an uncertified restaurant is in NO section.
	if slices.Contains(everySectionIDs(feed), unverified) {
		t.Errorf("an UNVERIFIED restaurant appears in the feed")
	}
}

func TestFeed_NearYouRespectsRailSize(t *testing.T) {
	h, w := newFeedHandler(t)
	cfg, err := h.repo.currentDiscoveryConfig(t.Context())
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	// One more than the rail holds. listVisible fetches limit+1 to detect a next
	// page, and the old feed returned all of them — one card over the rail.
	for i := range cfg.railSize + 1 {
		la, lo := near(float64(200 + i*50))
		w.restaurant(restaurantOpts{name: fmt.Sprintf("Rail %d", i), lat: la, lng: lo, certified: true})
	}
	got := section(getFeed(t, h, w.account("cust"), &downtown), "restaurants_near_you")
	if len(got) != cfg.railSize {
		t.Errorf("restaurants_near_you has %d cards, want exactly rail_size %d", len(got), cfg.railSize)
	}
}

func TestFeed_OrderAgainIsThisCustomersDistinctRecentRestaurants(t *testing.T) {
	h, w := newFeedHandler(t)
	la, lo := near(800)
	older := w.restaurant(restaurantOpts{name: "Older", lat: la, lng: lo, certified: true})
	newer := w.restaurant(restaurantOpts{name: "Newer", lat: la, lng: lo, certified: true})
	someoneElses := w.restaurant(restaurantOpts{name: "Someone else's", lat: la, lng: lo, certified: true})
	lapsed := w.restaurant(restaurantOpts{name: "Now uncertified", lat: la, lng: lo})

	cust, other := w.account("cust"), w.account("other")
	w.deliveredOrder(cust, older, 5)
	w.deliveredOrder(cust, newer, 1)
	w.deliveredOrder(cust, older, 10) // a repeat: must not duplicate
	w.deliveredOrder(cust, lapsed, 2) // ordered from, but no longer visible
	w.deliveredOrder(other, someoneElses, 1)

	mine := []string{older, newer, someoneElses, lapsed}
	got := only(section(getFeed(t, h, cust, &downtown), "order_again"), mine)
	if want := []string{newer, older}; !slices.Equal(got, want) {
		t.Errorf("order_again = %v, want %v (distinct, most recent first, this customer only, visible only)", got, want)
	}
}

func TestFeed_TrendingNeedsTheMinimumOrdersInsideTheWindow(t *testing.T) {
	h, w := newFeedHandler(t)
	cfg, err := h.repo.currentDiscoveryConfig(t.Context())
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	la, lo := near(1_200)
	hot := w.restaurant(restaurantOpts{name: "Hot", lat: la, lng: lo, certified: true})
	justShort := w.restaurant(restaurantOpts{name: "Just short", lat: la, lng: lo, certified: true})
	stale := w.restaurant(restaurantOpts{name: "Stale", lat: la, lng: lo, certified: true})

	buyer := w.account("buyers")
	for range cfg.trendingMinOrders {
		w.deliveredOrder(buyer, hot, 1)
	}
	for range cfg.trendingMinOrders - 1 {
		w.deliveredOrder(buyer, justShort, 1)
	}
	for range cfg.trendingMinOrders + 5 {
		w.deliveredOrder(buyer, stale, cfg.trendingWindowDays+3) // outside the window
	}

	got := only(section(getFeed(t, h, w.account("viewer"), &downtown), "trending_in_your_area"),
		[]string{hot, justShort, stale})
	if want := []string{hot}; !slices.Equal(got, want) {
		t.Errorf("trending_in_your_area = %v, want %v (min %d orders within %d days)",
			got, want, cfg.trendingMinOrders, cfg.trendingWindowDays)
	}
}

func TestFeed_YouMightLikeSharesACuisineAndSkipsOrderAgain(t *testing.T) {
	h, w := newFeedHandler(t)
	la, lo := near(900)
	usual := w.restaurant(restaurantOpts{name: "Usual", lat: la, lng: lo, certified: true, cuisines: []string{"Pakistani"}})
	sameCuisine := w.restaurant(restaurantOpts{name: "Same cuisine", lat: la, lng: lo, certified: true, cuisines: []string{"Pakistani"}})
	unrelated := w.restaurant(restaurantOpts{name: "Unrelated", lat: la, lng: lo, certified: true, cuisines: []string{"Somali"}})

	cust := w.account("cust")
	w.deliveredOrder(cust, usual, 3)

	feed := getFeed(t, h, cust, &downtown)
	got := only(section(feed, "you_might_like"), []string{usual, sameCuisine, unrelated})
	if want := []string{sameCuisine}; !slices.Equal(got, want) {
		t.Errorf("you_might_like = %v, want %v", got, want)
	}
	if !slices.Contains(section(feed, "order_again"), usual) {
		t.Errorf("precondition: the usual restaurant should be in order_again")
	}
}

func TestFeed_SectionsKeepTheirFixedOrder(t *testing.T) {
	h, w := newFeedHandler(t)
	cfg, err := h.repo.currentDiscoveryConfig(t.Context())
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	la, lo := near(700)
	usual := w.restaurant(restaurantOpts{name: "Usual", lat: la, lng: lo, certified: true, cuisines: []string{"Turkish"}})
	w.restaurant(restaurantOpts{name: "Alike", lat: la, lng: lo, certified: true, cuisines: []string{"Turkish"}})
	cust := w.account("cust")
	for range cfg.trendingMinOrders {
		w.deliveredOrder(cust, usual, 1)
	}

	var keys []string
	for _, s := range getFeed(t, h, cust, &downtown) {
		keys = append(keys, s.Key)
	}
	want := []string{"order_again", "restaurants_near_you", "trending_in_your_area", "you_might_like"}
	if !slices.Equal(keys, want) {
		t.Errorf("section order = %v, want %v", keys, want)
	}
}

func TestFeed_NothingDeliversHereMeansAnEmptyFeed(t *testing.T) {
	h, w := newFeedHandler(t)
	la, lo := near(800)
	usual := w.restaurant(restaurantOpts{name: "Downtown only", lat: la, lng: lo, certified: true})
	cust := w.account("cust")
	w.deliveredOrder(cust, usual, 1)

	// The spec's acceptance criterion 1: with no restaurant within the radius, EVERY section is absent —
	// including the personal ones. A restaurant you ordered from downtown cannot
	// deliver to you 200 km north.
	remote := [2]float64{45.4, -79.38}
	if got := getFeed(t, h, cust, &remote); len(got) != 0 {
		t.Errorf("feed at a point with nothing in range = %d sections, want 0: %+v", len(got), got)
	}
}

func TestFeed_NoPointMeansNoLocationSections(t *testing.T) {
	h, w := newFeedHandler(t)
	la, lo := near(800)
	w.restaurant(restaurantOpts{name: "Somewhere", lat: la, lng: lo, certified: true})

	// Without a point, deliverability is unknown, so nothing is labelled "near
	// you". The spec's rule 5 makes the client send its saved address's point or show
	// the address prompt; there is no geographic fallback.
	if got := getFeed(t, h, w.account("cust"), nil); len(got) != 0 {
		t.Errorf("feed with no point = %d sections, want 0: %+v", len(got), got)
	}
}
