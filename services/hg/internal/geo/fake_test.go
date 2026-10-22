package geo_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/devworld"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/geo"
)

var downtown = geo.Point{Latitude: 43.6532, Longitude: -79.3832}

func suggest(t *testing.T, q string, fromClient bool) []contract.AddressSuggestion {
	t.Helper()
	got, err := geo.NewFake().Suggest(context.Background(), geo.SuggestRequest{
		Query: q, Bias: downtown, BiasFromClient: fromClient, SessionToken: "7f2b8f2e-6e0d-4a43-9a0b-5d6a8f4f9a11",
	})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// The dev harness and the e2e drive the address form with no token, so the
// fake must know every address the dev world gives a customer and every
// restaurant it seeds. A new seeded restaurant that the fake lacks fails here.
func TestFakeKnowsEveryDevworldAddress(t *testing.T) {
	var lines []string
	for _, r := range devworld.AllRestaurants() {
		if r.Line1 != "" {
			lines = append(lines, r.Line1)
		}
	}
	// The customer personas' saved addresses (migrations/devworld/001_personas.sql,
	// 020_customer_addresses.sql) and the address the scenarios create (scenario.go).
	lines = append(lines, "1250 Danforth Avenue", "1260 Danforth Avenue", "155 Wellington Street West", "14 Main Street East")

	for _, line1 := range lines {
		got := suggest(t, line1, true)
		if len(got) == 0 || got[0].Title != line1 || got[0].Kind != contract.ADDRESS {
			t.Errorf("searching %q: got %+v, want the address first", line1, got)
			continue
		}
		addr, err := geo.NewFake().Place(context.Background(), got[0].PlaceId)
		if err != nil {
			t.Errorf("place %q: %v", line1, err)
			continue
		}
		if addr.Line1 == nil || *addr.Line1 != line1 || addr.Province != contract.ON || addr.PostalCode == nil {
			t.Errorf("place %q = %+v", line1, addr)
		}
	}
}

// The devworld restaurants' points and postcodes match the fake's, so a
// delivery-zone check on a picked address agrees with the seed data.
func TestFakeAgreesWithTheSeededRestaurantPoints(t *testing.T) {
	for _, r := range devworld.AllRestaurants() {
		if r.Line1 == "" {
			continue
		}
		got := suggest(t, r.Line1, false)
		addr, err := geo.NewFake().Place(context.Background(), got[0].PlaceId)
		if err != nil {
			t.Fatal(err)
		}
		if addr.Latitude != r.Lat || addr.Longitude != r.Lng || *addr.PostalCode != r.PostalCode {
			t.Errorf("%s: fake has %v,%v %s; devworld has %v,%v %s",
				r.Line1, addr.Latitude, addr.Longitude, *addr.PostalCode, r.Lat, r.Lng, r.PostalCode)
		}
	}
}

func TestFakeSuggestRulesFromTheContract(t *testing.T) {
	got := suggest(t, "danforth", true)
	if len(got) != 5 {
		t.Fatalf("got %d suggestions, want the cap of 5", len(got))
	}
	for _, s := range got {
		if !strings.HasPrefix(s.PlaceId, geo.FakePlaceIDPrefix) {
			t.Errorf("place_id %q is not marked as fake", s.PlaceId)
		}
		if s.DistanceM == nil {
			t.Errorf("%q: no distance although a point was sent", s.Title)
		}
		if s.Subtitle == nil || !strings.Contains(*s.Subtitle, "Ontario") {
			t.Errorf("%q: subtitle = %v", s.Title, s.Subtitle)
		}
	}
	for _, s := range suggest(t, "danforth", false) {
		if s.DistanceM != nil {
			t.Errorf("%q: distance_m set although the request sent no location", s.Title)
		}
	}
	if got := suggest(t, "zzzz nothing matches this", true); got == nil || len(got) != 0 {
		t.Errorf("no match = %#v, want an empty list", got)
	}
	// The same request gives the same answer.
	a, b := suggest(t, "gerrard", true), suggest(t, "gerrard", true)
	if len(a) == 0 || len(a) != len(b) {
		t.Fatalf("lengths %d, %d", len(a), len(b))
	}
	for i := range a {
		if a[i].PlaceId != b[i].PlaceId {
			t.Errorf("row %d differs between identical requests", i)
		}
	}
}

func TestFakeSuggestsEveryKindAndAProvinceWeDoNotServe(t *testing.T) {
	kinds := map[contract.GeoResultKind]bool{}
	for _, q := range []string{"harbour", "cn tower", "danforth avenue", "m4j", "east danforth", "toronto", "mississauga"} {
		for _, s := range suggest(t, q, true) {
			kinds[s.Kind] = true
		}
	}
	for _, k := range []contract.GeoResultKind{
		contract.ADDRESS, contract.STREET, contract.POSTCODE, contract.NEIGHBOURHOOD, contract.PLACE, contract.POI,
	} {
		if !kinds[k] {
			t.Errorf("the fake never suggests kind %s", k)
		}
	}
	mtl := suggest(t, "place ville marie", true)
	if len(mtl) != 1 {
		t.Fatalf("got %+v", mtl)
	}
	addr, err := geo.NewFake().Place(context.Background(), mtl[0].PlaceId)
	if err != nil || addr.Province != contract.QC {
		t.Errorf("Montreal = %+v, %v; want a QC address so the client can warn first", addr, err)
	}
}

func TestFakePlaceFillsOnlyWhatTheKindKnows(t *testing.T) {
	check := func(q string, kind contract.GeoResultKind, line1, postal bool, name string) {
		t.Helper()
		var id string
		for _, s := range suggest(t, q, true) {
			if s.Kind == kind {
				id = s.PlaceId
				break
			}
		}
		if id == "" {
			t.Fatalf("no %s suggestion for %q", kind, q)
		}
		a, err := geo.NewFake().Place(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if (a.Line1 != nil) != line1 || (a.PostalCode != nil) != postal || a.City == nil || a.Formatted == "" || a.Country != contract.GeocodedAddressCountryCA {
			t.Errorf("%s %q: %+v", kind, q, a)
		}
		if (name == "") != (a.Name == nil) || (a.Name != nil && *a.Name != name) {
			t.Errorf("%s %q: name = %v, want %q", kind, q, a.Name, name)
		}
	}
	check("1250 danforth", contract.ADDRESS, true, true, "")
	check("cn tower", contract.POI, true, true, "CN Tower")
	check("danforth avenue", contract.STREET, true, false, "")
	check("m4j 1m6", contract.POSTCODE, false, true, "")
	check("east danforth", contract.NEIGHBOURHOOD, false, false, "")
	check("mississauga", contract.PLACE, false, false, "")
}

func TestFakePlaceRefusesIdsItDidNotMint(t *testing.T) {
	for _, id := range []string{"", "fake:", "fake:-1", "fake:999", "fake:01", "fake:x", "abc", "ZmFrZTox"} {
		if _, err := geo.NewFake().Place(context.Background(), id); !errors.Is(err, geo.ErrNoMatch) {
			t.Errorf("Place(%q) = %v, want ErrNoMatch", id, err)
		}
	}
	if _, err := geo.NewFake().Place(context.Background(), geo.FakePlaceIDPrefix+strconv.Itoa(0)); err != nil {
		t.Errorf("fake:0 = %v", err)
	}
}

func TestFakeReverse(t *testing.T) {
	f := geo.NewFake()
	// A pin a few metres from the dev world's Home address.
	a, err := f.Reverse(context.Background(), geo.Point{Latitude: 43.68251, Longitude: -79.33001})
	if err != nil || a.Line1 == nil || *a.Line1 != "1250 Danforth Avenue" || a.Kind != contract.ADDRESS {
		t.Fatalf("got %+v, %v", a, err)
	}
	for name, p := range map[string]geo.Point{
		"in Lake Ontario": {Latitude: 43.55, Longitude: -79.38},
		"in Buffalo":      {Latitude: 42.8864, Longitude: -78.8784},
		"at 0,0":          {},
	} {
		if _, err := f.Reverse(context.Background(), p); !errors.Is(err, geo.ErrNoMatch) {
			t.Errorf("%s: err = %v, want ErrNoMatch", name, err)
		}
	}
}

func TestFakeNeverClaimsToBeMapbox(t *testing.T) {
	if got := geo.NewFake().Name(); got != "fake" {
		t.Errorf("Name = %q; logs rely on provider=fake to tell a fake from the real thing", got)
	}
}

// With no token in production the provider is never available: every call is
// ErrUnavailable, which the handler turns into 503 GEOCODER_UNAVAILABLE.
func TestUnavailableProviderAlwaysFails(t *testing.T) {
	p := geo.NewUnavailable()
	ctx := context.Background()
	if _, err := p.Suggest(ctx, geo.SuggestRequest{Query: "danforth", Bias: downtown}); !errors.Is(err, geo.ErrUnavailable) {
		t.Errorf("Suggest = %v, want ErrUnavailable", err)
	}
	if _, err := p.Place(ctx, "fake:1"); !errors.Is(err, geo.ErrUnavailable) {
		t.Errorf("Place = %v, want ErrUnavailable", err)
	}
	if _, err := p.Reverse(ctx, downtown); !errors.Is(err, geo.ErrUnavailable) {
		t.Errorf("Reverse = %v, want ErrUnavailable", err)
	}
	if p.Name() != "unavailable" {
		t.Errorf("Name = %q", p.Name())
	}
}
