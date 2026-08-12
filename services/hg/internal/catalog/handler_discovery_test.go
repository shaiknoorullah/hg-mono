package catalog

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// TestParseListFilters exercises the nine-filter validator: valid values parse,
// out-of-range or unknown enum values are rejected with the offending field.
func TestParseListFilters(t *testing.T) {
	t.Run("valid full set", func(t *testing.T) {
		r := httptest.NewRequest("GET",
			"/v1/restaurants?latitude=43.65&longitude=-79.38&max_distance_m=5000&min_rating=4.5&price_band=$,$$&dietary=VEGAN&sort=DISTANCE_ASC&limit=10", nil)
		f, err := parseListFilters(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if f.lat == nil || *f.lat != 43.65 {
			t.Errorf("latitude not parsed")
		}
		if f.maxDistanceM == nil || *f.maxDistanceM != 5000 {
			t.Errorf("max_distance_m not parsed")
		}
		if f.minRating == nil || *f.minRating != 4.5 {
			t.Errorf("min_rating not parsed")
		}
		if len(f.priceBands) != 2 || f.sort != "DISTANCE_ASC" {
			t.Errorf("price_band/sort not parsed: %+v", f)
		}
	})

	bad := []struct {
		name, query, field string
	}{
		{"lat alone", "?latitude=43.6", "latitude"},
		{"lat out of range", "?latitude=200&longitude=1", "latitude"},
		{"distance too small", "?max_distance_m=100", "max_distance_m"},
		{"rating not in enum", "?min_rating=4.2", "min_rating"},
		{"bad price band", "?price_band=CHEAP", "price_band"},
		{"bad sort", "?sort=NEAREST", "sort"},
		{"limit over 50", "?limit=100", "limit"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/v1/restaurants"+tc.query, nil)
			_, err := parseListFilters(r)
			if err == nil {
				t.Fatalf("expected a validation error for %q", tc.query)
			}
			if err.field != tc.field {
				t.Errorf("field = %q, want %q", err.field, tc.field)
			}
		})
	}
}

// TestRestaurantCardMarshalShape asserts the JSON of a card carries every
// required contract field and nests halal and availability correctly.
func TestRestaurantCardMarshalShape(t *testing.T) {
	avg := 4.8
	rr := restaurantRow{
		id: "a74bdb39-6440-4ffe-a9ba-d6c88a81e15e", slug: "karachi-kitchen",
		displayName: "Karachi Kitchen", ratingAvg: &avg, ratingCount: 412,
		priceBand: strptr("$$"), halalStatus: HalalCertified,
		certifyingBody: strptr("HMA Canada"), deliveryRadiusM: 8000, distanceM: ptrI32(1200),
		avgPrepMinutes: 20,
	}
	info := buildAvailabilityInfo(rr, openStateVerdict{state: OpenStateOpen}, true)
	card := toCard(rr, info, nilMedia{})

	b, err := json.Marshal(card)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, req := range []string{"id", "name", "halal", "availability"} {
		if _, ok := m[req]; !ok {
			t.Errorf("card JSON missing required field %q", req)
		}
	}
	halal, _ := m["halal"].(map[string]any)
	if halal["display_state"] != "CERTIFIED" {
		t.Errorf("halal.display_state = %v, want CERTIFIED", halal["display_state"])
	}
	avail, _ := m["availability"].(map[string]any)
	if avail["state"] != "OPEN" {
		t.Errorf("availability.state = %v, want OPEN", avail["state"])
	}
}

func strptr(s string) *string { return &s }
