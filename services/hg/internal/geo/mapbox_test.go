package geo

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// secretToken is a made-up token: the tests prove it reaches Mapbox and nothing
// else.
const secretToken = "fixture-mapbox-token-for-tests"

// The Mapbox answers in testdata/ are written by hand from the documented
// Geocoding v6 response shape (https://docs.mapbox.com/api/search/geocoding/).
// No test calls the network.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// mapboxStub serves answers and records the last request.
type mapboxStub struct {
	srv    *httptest.Server
	status int
	body   []byte
	last   *http.Request
	calls  int
}

func newStub(t *testing.T, status int, body []byte) (*MapboxProvider, *mapboxStub) {
	t.Helper()
	st := &mapboxStub{status: status, body: body}
	st.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st.calls++
		st.last = r.Clone(context.Background())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(st.status)
		_, _ = w.Write(st.body)
	}))
	t.Cleanup(st.srv.Close)
	p := NewMapbox(secretToken, st.srv.Client())
	p.base = st.srv.URL
	return p, st
}

func (s *mapboxStub) query() url.Values { return s.last.URL.Query() }

func str(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// near compares a contract coordinate (float32) with the float64 the fixture
// holds, within the precision a float32 keeps at this magnitude.
func near(got float32, want float64) bool {
	d := float64(got) - want
	return d < 1e-5 && d > -1e-5
}

var bias = Point{Latitude: 43.6532, Longitude: -79.3832}

func TestSuggestAsksMapboxForTemporaryCanadianAutocomplete(t *testing.T) {
	p, st := newStub(t, 200, fixture(t, "mapbox_forward_autocomplete.json"))
	_, err := p.Suggest(context.Background(), SuggestRequest{
		Query: "88 harbour", Bias: bias, BiasFromClient: true, SessionToken: "00000000-0000-4000-8000-00000000a001",
	})
	if err != nil {
		t.Fatal(err)
	}
	if st.last.URL.Path != "/search/geocode/v6/forward" {
		t.Errorf("path = %q", st.last.URL.Path)
	}
	q := st.query()
	want := map[string]string{
		"q": "88 harbour", "country": "ca", "limit": "5", "autocomplete": "true",
		"proximity": "-79.383200,43.653200", "access_token": secretToken,
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("query %s = %q, want %q", k, q.Get(k), v)
		}
	}
	if q.Get("permanent") != "" {
		t.Errorf("a suggestion asked for permanent=%q; suggestions are temporary and stay uncached", q.Get("permanent"))
	}
	if q.Has("session_token") {
		t.Error("the client's session token was forwarded; Geocoding v6 has no sessions")
	}
	if !strings.Contains(q.Get("types"), "address") || strings.Contains(q.Get("types"), "country") {
		t.Errorf("types = %q", q.Get("types"))
	}
}

func TestSuggestMapsFeaturesAndDropsWhatTheContractForbids(t *testing.T) {
	p, _ := newStub(t, 200, fixture(t, "mapbox_forward_autocomplete.json"))
	got, err := p.Suggest(context.Background(), SuggestRequest{Query: "harbour", Bias: bias, BiasFromClient: true})
	if err != nil {
		t.Fatal(err)
	}
	// Five features came back: an address, a street, a Buffalo address (not
	// Canadian), Montreal, and a bare region (not offered). Three remain.
	if len(got) != 3 {
		t.Fatalf("got %d suggestions, want 3: %+v", len(got), got)
	}
	rows := []struct {
		kind            contract.GeoResultKind
		title, subtitle string
	}{
		{contract.ADDRESS, "88 Harbour Street", "Toronto, Ontario M5J 0C3"},
		{contract.STREET, "Danforth Avenue", "Toronto, Ontario"},
		{contract.PLACE, "Montréal", "Québec"},
	}
	for i, w := range rows {
		g := got[i]
		if g.Kind != w.kind || g.Title != w.title || str(g.Subtitle) != w.subtitle {
			t.Errorf("row %d = %s %q %q, want %s %q %q", i, g.Kind, g.Title, str(g.Subtitle), w.kind, w.title, w.subtitle)
		}
		if g.DistanceM == nil {
			t.Errorf("row %d: no distance although the request sent a point", i)
		}
		if g.PlaceId == "" || len(g.PlaceId) > 512 || !placeIDPattern.MatchString(g.PlaceId) {
			t.Errorf("row %d: place_id %q breaks the contract's PlaceId rules", i, g.PlaceId)
		}
	}
	// 88 Harbour Street is about 1.5 km from the bias point (downtown Toronto).
	if d := *got[0].DistanceM; d < 1000 || d > 2500 {
		t.Errorf("distance = %d m, want about 1.5 km", d)
	}
}

func TestSuggestReportsNoDistanceWhenTheClientSentNoPoint(t *testing.T) {
	p, _ := newStub(t, 200, fixture(t, "mapbox_forward_autocomplete.json"))
	got, err := p.Suggest(context.Background(), SuggestRequest{Query: "harbour", Bias: bias, BiasFromClient: false})
	if err != nil || len(got) == 0 {
		t.Fatalf("got %v, %v", got, err)
	}
	for _, s := range got {
		if s.DistanceM != nil {
			t.Errorf("%q has distance_m %d, want null when the request sent no location", s.Title, *s.DistanceM)
		}
	}
}

func TestSuggestWithNoMatchIsAnEmptyListNotAnError(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   []byte
	}{
		"no features":         {200, fixture(t, "mapbox_empty.json")},
		"unusable text (422)": {422, []byte(`{"message":"Query too long"}`)},
	} {
		t.Run(name, func(t *testing.T) {
			p, _ := newStub(t, tc.status, tc.body)
			got, err := p.Suggest(context.Background(), SuggestRequest{Query: "zzzz", Bias: bias})
			if err != nil || got == nil || len(got) != 0 {
				t.Fatalf("got %#v, %v; want an empty non-nil slice and no error", got, err)
			}
		})
	}
}

func TestPlaceResolvesASuggestionWithPermanentGeocoding(t *testing.T) {
	p, st := newStub(t, 200, fixture(t, "mapbox_forward_autocomplete.json"))
	sugg, err := p.Suggest(context.Background(), SuggestRequest{Query: "88 harbour", Bias: bias})
	if err != nil {
		t.Fatal(err)
	}

	st.body = fixture(t, "mapbox_forward_permanent_address.json")
	got, err := p.Place(context.Background(), sugg[0].PlaceId)
	if err != nil {
		t.Fatal(err)
	}
	q := st.query()
	for k, v := range map[string]string{
		"q": "88 Harbour Street, Toronto, Ontario M5J 0C3", "permanent": "true", "country": "ca",
		"types": "address", "limit": "1", "autocomplete": "false", "access_token": secretToken,
	} {
		if q.Get(k) != v {
			t.Errorf("query %s = %q, want %q", k, q.Get(k), v)
		}
	}
	if q.Get("proximity") != "-79.380600,43.640500" {
		t.Errorf("proximity = %q, want the suggestion's own point", q.Get("proximity"))
	}

	want := contract.GeocodedAddress{
		Kind: contract.ADDRESS, Province: contract.ON, Country: contract.GeocodedAddressCountryCA,
		Latitude: 43.6405, Longitude: -79.3806, Formatted: "88 Harbour Street, Toronto, Ontario M5J 0C3",
	}
	if got.Kind != want.Kind || got.Province != want.Province || got.Country != want.Country ||
		!near(got.Latitude, 43.6405) || !near(got.Longitude, -79.3806) || got.Formatted != want.Formatted {
		t.Errorf("got %+v, want %+v", got, want)
	}
	if str(got.Line1) != "88 Harbour Street" || str(got.City) != "Toronto" || str(got.PostalCode) != "M5J 0C3" || got.Name != nil {
		t.Errorf("line1 %q city %q postal %q name %v", str(got.Line1), str(got.City), str(got.PostalCode), got.Name)
	}
}

func TestPlaceForACoarserKindLeavesTheMissingFieldsNull(t *testing.T) {
	p, st := newStub(t, 200, fixture(t, "mapbox_forward_postcode.json"))
	id := encodePlaceRef(placeRef{Query: "M4J 1M6, Toronto, Ontario", FeatureType: "postcode", Lat: 43.6815, Lng: -79.3310})
	got, err := p.Place(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if st.query().Get("types") != "postcode" {
		t.Errorf("types = %q, want the suggestion's own type", st.query().Get("types"))
	}
	if got.Kind != contract.POSTCODE || got.Line1 != nil || str(got.PostalCode) != "M4J 1M6" || str(got.City) != "Toronto" {
		t.Errorf("got %+v", got)
	}
	if got.Formatted != "M4J 1M6, Toronto, Ontario" {
		t.Errorf("formatted = %q", got.Formatted)
	}
}

func TestPlaceRefusesWhatItDidNotMint(t *testing.T) {
	p, st := newStub(t, 200, fixture(t, "mapbox_forward_permanent_address.json"))
	for _, id := range []string{"fake:3", "!!!", "e30", "bm90LWpzb24"} {
		if _, err := p.Place(context.Background(), id); !errors.Is(err, ErrNoMatch) {
			t.Errorf("Place(%q) = %v, want ErrNoMatch", id, err)
		}
	}
	if st.calls != 0 {
		t.Errorf("Mapbox was called %d times for ids we did not mint", st.calls)
	}
}

func TestPlaceThatResolvesOutsideCanadaIsNoMatch(t *testing.T) {
	p, _ := newStub(t, 200, fixture(t, "mapbox_reverse_us.json"))
	id := encodePlaceRef(placeRef{Query: "1 Main Street, Buffalo", FeatureType: "address", Lat: 42.88, Lng: -78.87})
	if _, err := p.Place(context.Background(), id); !errors.Is(err, ErrNoMatch) {
		t.Fatalf("err = %v, want ErrNoMatch", err)
	}
}

func TestReverseAsksForAPermanentCanadianAddress(t *testing.T) {
	p, st := newStub(t, 200, fixture(t, "mapbox_reverse_address.json"))
	got, err := p.Reverse(context.Background(), Point{Latitude: 43.68149, Longitude: -79.33101})
	if err != nil {
		t.Fatal(err)
	}
	if st.last.URL.Path != "/search/geocode/v6/reverse" {
		t.Errorf("path = %q", st.last.URL.Path)
	}
	for k, v := range map[string]string{
		"latitude": "43.681490", "longitude": "-79.331010", "permanent": "true",
		"country": "ca", "types": "address", "limit": "1", "access_token": secretToken,
	} {
		if st.query().Get(k) != v {
			t.Errorf("query %s = %q, want %q", k, st.query().Get(k), v)
		}
	}
	if str(got.Line1) != "1240 Danforth Avenue" || !near(got.Latitude, 43.6815) || !near(got.Longitude, -79.3310) ||
		str(got.PostalCode) != "M4J 1M6" || got.Formatted != "1240 Danforth Avenue, Toronto, Ontario M4J 1M6" {
		t.Errorf("got %+v", got)
	}
}

func TestReverseWithNothingNearbyIsNoMatch(t *testing.T) {
	for name, body := range map[string][]byte{
		"empty":     fixture(t, "mapbox_empty.json"),
		"in the US": fixture(t, "mapbox_reverse_us.json"),
	} {
		t.Run(name, func(t *testing.T) {
			p, _ := newStub(t, 200, body)
			if _, err := p.Reverse(context.Background(), Point{Latitude: 43.6, Longitude: -79.4}); !errors.Is(err, ErrNoMatch) {
				t.Fatalf("err = %v, want ErrNoMatch", err)
			}
		})
	}
}

func TestProviderFailuresAreUnavailableAndNeverLeakTheToken(t *testing.T) {
	for _, status := range []int{401, 403, 429, 500, 502, 503} {
		p, _ := newStub(t, status, []byte(`{"message":"nope"}`))
		_, err := p.Reverse(context.Background(), Point{Latitude: 43.6, Longitude: -79.4})
		if !errors.Is(err, ErrUnavailable) {
			t.Errorf("status %d: err = %v, want ErrUnavailable", status, err)
		}
		if err != nil && strings.Contains(err.Error(), secretToken) {
			t.Errorf("status %d: the error carries the token: %v", status, err)
		}
	}

	p, _ := newStub(t, 200, []byte(`not json`))
	if _, err := p.Reverse(context.Background(), Point{Latitude: 43.6, Longitude: -79.4}); !errors.Is(err, ErrUnavailable) {
		t.Errorf("garbage body: err = %v, want ErrUnavailable", err)
	}
}

func TestTimeoutAndUnreachableAreUnavailableWithoutTheTokenInTheError(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	t.Cleanup(slow.Close)
	p := NewMapbox(secretToken, &http.Client{Timeout: 50 * time.Millisecond})
	p.base = slow.URL
	_, err := p.Suggest(context.Background(), SuggestRequest{Query: "x", Bias: bias})
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("timeout: err = %v, want ErrUnavailable", err)
	}
	if strings.Contains(err.Error(), secretToken) || strings.Contains(err.Error(), slow.URL) {
		t.Errorf("the error carries the request URL or token: %v", err)
	}

	gone := httptest.NewServer(http.NotFoundHandler())
	base := gone.URL
	gone.Close()
	p = NewMapbox(secretToken, &http.Client{Timeout: time.Second})
	p.base = base
	_, err = p.Reverse(context.Background(), Point{Latitude: 43.6, Longitude: -79.4})
	if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), secretToken) {
		t.Errorf("unreachable: err = %v, want ErrUnavailable without the token", err)
	}
}

func TestPlaceIDStaysInsideTheContractForLongAndNonASCIIText(t *testing.T) {
	long := strings.Repeat("Rue de l'Église-Saint-Étienne, Québec ", 20)
	id := encodePlaceRef(placeRef{Query: long, FeatureType: "address", Lat: 46.8, Lng: -71.2})
	if len(id) > 512 || !placeIDPattern.MatchString(id) {
		t.Fatalf("place id of %d characters breaks the contract: %q", len(id), id)
	}
	ref, err := decodePlaceRef(id)
	if err != nil || !strings.HasPrefix(long, ref.Query) || ref.Query == "" {
		t.Fatalf("round trip: %+v, %v", ref, err)
	}
}

func TestNormalisePostalCode(t *testing.T) {
	cases := map[string]string{
		"m5j0c3": "M5J 0C3", " M5J  0C3 ": "M5J 0C3", "M5J 0C3": "M5J 0C3",
		"14202": "", "D5J 0C3": "", "M5J 0C": "", "": "", "M5J0C3X": "",
	}
	for in, want := range cases {
		got := normalisePostalCode(in)
		if (want == "") != (got == nil) || (got != nil && *got != want) {
			t.Errorf("normalisePostalCode(%q) = %v, want %q", in, str(got), want)
		}
	}
}
