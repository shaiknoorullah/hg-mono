package geo

import (
	"context"
	"sort"
	"strconv"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// FakePlaceIDPrefix starts every place_id the FakeProvider mints. A real
// Mapbox id never starts with it, so a fake result is recognisable in a log or
// a trace at a glance.
const FakePlaceIDPrefix = "fake:"

// fakeReverseRadiusM is how far from a pin the fake looks for an address. It
// is wide on purpose: the catalogue is a few dozen points, and a dev who drops
// a pin in the middle of the map should usually get an address back. A pin in
// the lake or outside the GTA still gets 404 GEOCODE_NO_MATCH.
const fakeReverseRadiusM = 750

// fakePlace is one entry of the fake's catalogue.
type fakePlace struct {
	kind     contract.GeoResultKind
	name     string // set for POI and NEIGHBOURHOOD
	line1    string
	city     string
	province contract.Province
	postal   string
	lat, lng float64
}

// fakeCatalogue is the places the fake knows: every address the dev world gives
// a customer (internal/devworld: migrations/devworld/001_personas.sql,
// 020_customer_addresses.sql, scenario.go) and every restaurant it seeds
// (internal/devworld/catalogue*.go), so the address form can be driven end to
// end with no Mapbox token and the results agree with the delivery zones the
// seed data defines. A few coarser entries (street, postcode, neighbourhood,
// city, a point of interest) and one address outside Ontario exercise the
// other result kinds and the "province not served yet" warning.
//
// Order matters: it is the tie-break for equally good matches, and the number
// in a place_id.
var fakeCatalogue = []fakePlace{
	// The customer personas' saved addresses.
	{kind: contract.ADDRESS, line1: "1250 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4J 1N2", lat: 43.6825, lng: -79.3300},
	{kind: contract.ADDRESS, line1: "1260 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4J 1N3", lat: 43.6820, lng: -79.3305},
	{kind: contract.ADDRESS, line1: "155 Wellington Street West", city: "Toronto", province: contract.ON, postal: "M5V 3H1", lat: 43.6457, lng: -79.3866},
	{kind: contract.ADDRESS, line1: "14 Main Street East", city: "Huntsville", province: contract.ON, postal: "P1H 2C9", lat: 45.3269, lng: -79.2163},
	// The seeded restaurants.
	{kind: contract.ADDRESS, line1: "1240 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4J 1M6", lat: 43.6815, lng: -79.3310},
	{kind: contract.ADDRESS, line1: "1118 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4J 1M2", lat: 43.6790, lng: -79.3355},
	{kind: contract.ADDRESS, line1: "6 Port Union Road", city: "Toronto", province: contract.ON, postal: "M1C 2L1", lat: 43.7870, lng: -79.1380},
	{kind: contract.ADDRESS, line1: "790 Pape Avenue", city: "Toronto", province: contract.ON, postal: "M4K 3S7", lat: 43.6720, lng: -79.3480},
	{kind: contract.ADDRESS, line1: "1002 Gerrard Street East", city: "Toronto", province: contract.ON, postal: "M4M 1Z9", lat: 43.6700, lng: -79.3410},
	{kind: contract.ADDRESS, line1: "18 Thorncliffe Park Drive", city: "Toronto", province: contract.ON, postal: "M4H 1N7", lat: 43.7046, lng: -79.3466},
	{kind: contract.ADDRESS, line1: "1020 Queen Street East", city: "Toronto", province: contract.ON, postal: "M4M 1K1", lat: 43.6614, lng: -79.3365},
	{kind: contract.ADDRESS, line1: "1430 Gerrard Street East", city: "Toronto", province: contract.ON, postal: "M4L 1Z6", lat: 43.6725, lng: -79.3205},
	{kind: contract.ADDRESS, line1: "590 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4K 1R1", lat: 43.6781, lng: -79.3487},
	{kind: contract.ADDRESS, line1: "615 Dundas Street East", city: "Toronto", province: contract.ON, postal: "M5A 2B9", lat: 43.6603, lng: -79.3618},
	{kind: contract.ADDRESS, line1: "228 Spadina Avenue", city: "Toronto", province: contract.ON, postal: "M5T 2C2", lat: 43.6517, lng: -79.3978},
	{kind: contract.ADDRESS, line1: "345 Yonge Street", city: "Toronto", province: contract.ON, postal: "M5B 1S1", lat: 43.6578, lng: -79.3812},
	{kind: contract.ADDRESS, line1: "512 Church Street", city: "Toronto", province: contract.ON, postal: "M4Y 2C8", lat: 43.6655, lng: -79.3808},
	{kind: contract.ADDRESS, line1: "330 Broadview Avenue", city: "Toronto", province: contract.ON, postal: "M4M 2G9", lat: 43.6637, lng: -79.3520},
	{kind: contract.ADDRESS, line1: "88 Front Street East", city: "Toronto", province: contract.ON, postal: "M5E 1T4", lat: 43.6488, lng: -79.3720},
	{kind: contract.ADDRESS, line1: "1580 Danforth Avenue", city: "Toronto", province: contract.ON, postal: "M4C 1H7", lat: 43.6838, lng: -79.3225},
	{kind: contract.ADDRESS, line1: "1510 Gerrard Street East", city: "Toronto", province: contract.ON, postal: "M4L 2A4", lat: 43.6734, lng: -79.3172},
	{kind: contract.ADDRESS, line1: "845 Pape Avenue", city: "Toronto", province: contract.ON, postal: "M4K 3T5", lat: 43.6871, lng: -79.3460},
	// Other kinds, so the form's less precise paths can be driven.
	{kind: contract.ADDRESS, line1: "88 Harbour Street", city: "Toronto", province: contract.ON, postal: "M5J 0C3", lat: 43.6405, lng: -79.3806},
	{kind: contract.POI, name: "CN Tower", line1: "290 Bremner Boulevard", city: "Toronto", province: contract.ON, postal: "M5V 3L9", lat: 43.6426, lng: -79.3871},
	{kind: contract.STREET, line1: "Danforth Avenue", city: "Toronto", province: contract.ON, lat: 43.6798, lng: -79.3340},
	{kind: contract.POSTCODE, city: "Toronto", province: contract.ON, postal: "M4J 1M6", lat: 43.6815, lng: -79.3310},
	{kind: contract.NEIGHBOURHOOD, name: "East Danforth", city: "Toronto", province: contract.ON, lat: 43.6790, lng: -79.3400},
	{kind: contract.PLACE, city: "Toronto", province: contract.ON, lat: 43.6532, lng: -79.3832},
	{kind: contract.PLACE, city: "Mississauga", province: contract.ON, lat: 43.5890, lng: -79.6441},
	// Outside the launch province: suggested, and refused only at save time.
	{kind: contract.ADDRESS, line1: "1 Place Ville Marie", city: "Montreal", province: contract.QC, postal: "H3B 4S6", lat: 45.5017, lng: -73.5690},
}

var provinceNames = map[contract.Province]string{
	contract.AB: "Alberta", contract.BC: "British Columbia", contract.MB: "Manitoba",
	contract.NB: "New Brunswick", contract.NL: "Newfoundland and Labrador", contract.NS: "Nova Scotia",
	contract.NT: "Northwest Territories", contract.NU: "Nunavut", contract.ON: "Ontario",
	contract.PE: "Prince Edward Island", contract.QC: "Quebec", contract.SK: "Saskatchewan",
	contract.YT: "Yukon",
}

// title is the first line of the search row.
func (p fakePlace) title() string {
	switch p.kind {
	case contract.POI, contract.NEIGHBOURHOOD:
		return p.name
	case contract.ADDRESS, contract.STREET:
		return p.line1
	case contract.POSTCODE:
		return p.postal
	}
	return p.city
}

// regionLine is "Toronto, Ontario M5J 0C3": the part after the title.
func (p fakePlace) regionLine() string {
	s := provinceNames[p.province]
	if p.kind != contract.PLACE {
		s = p.city + ", " + s
	}
	if p.postal != "" && p.kind != contract.POSTCODE {
		s += " " + p.postal
	}
	return s
}

// formatted is the one-line display form.
func (p fakePlace) formatted() string {
	switch p.kind {
	case contract.POI:
		return p.line1 + ", " + p.regionLine()
	case contract.PLACE:
		return p.city + ", " + provinceNames[p.province]
	case contract.POSTCODE:
		return p.postal + ", " + p.city + ", " + provinceNames[p.province]
	}
	return p.title() + ", " + p.regionLine()
}

func (p fakePlace) point() Point { return Point{Latitude: p.lat, Longitude: p.lng} }

func (p fakePlace) address() contract.GeocodedAddress {
	a := contract.GeocodedAddress{
		Kind:      p.kind,
		Province:  p.province,
		Country:   contract.GeocodedAddressCountryCA,
		Latitude:  float32(p.lat),
		Longitude: float32(p.lng),
		Formatted: p.formatted(),
		City:      nonEmpty(p.city, 100),
	}
	if p.kind == contract.POI {
		a.Name = nonEmpty(p.name, 256)
	}
	if p.kind == contract.ADDRESS || p.kind == contract.STREET || p.kind == contract.POI {
		a.Line1 = nonEmpty(p.line1, 200)
	}
	a.PostalCode = nonEmpty(p.postal, 7)
	return a
}

func (p fakePlace) searchText() string {
	return strings.ToLower(p.title() + " " + p.line1 + " " + p.regionLine())
}

// FakeProvider answers from fakeCatalogue. It is deterministic: the same
// request gives the same answer, with no network and no clock. Use it only
// where there is no Mapbox token; internal/config refuses it in production.
type FakeProvider struct{}

// NewFake builds the fake provider.
func NewFake() *FakeProvider { return &FakeProvider{} }

// Name implements Provider.
func (*FakeProvider) Name() string { return "fake" }

// Suggest implements Provider. A place matches when every word of the query is
// found in its text; places whose title starts with the first word rank first,
// then the nearest to the bias point, then catalogue order.
func (*FakeProvider) Suggest(_ context.Context, req SuggestRequest) ([]contract.AddressSuggestion, error) {
	words := strings.Fields(strings.ToLower(req.Query))
	type hit struct {
		idx    int
		prefix bool
		dist   int32
	}
	var hits []hit
	for i, p := range fakeCatalogue {
		text := p.searchText()
		ok := len(words) > 0
		for _, w := range words {
			if !strings.Contains(text, w) {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		hits = append(hits, hit{
			idx:    i,
			prefix: strings.HasPrefix(strings.ToLower(p.title()), words[0]),
			dist:   distanceMetres(req.Bias, p.point()),
		})
	}
	sort.SliceStable(hits, func(a, b int) bool {
		if hits[a].prefix != hits[b].prefix {
			return hits[a].prefix
		}
		return hits[a].dist < hits[b].dist
	})
	out := make([]contract.AddressSuggestion, 0, 5)
	for _, h := range hits {
		p := fakeCatalogue[h.idx]
		s := contract.AddressSuggestion{
			PlaceId:  FakePlaceIDPrefix + strconv.Itoa(h.idx),
			Kind:     p.kind,
			Title:    p.title(),
			Subtitle: nonEmpty(p.regionLine(), 256),
		}
		if req.BiasFromClient {
			d := h.dist
			s.DistanceM = &d
		}
		out = append(out, s)
		if len(out) == 5 {
			break
		}
	}
	return out, nil
}

// Place implements Provider.
func (*FakeProvider) Place(_ context.Context, placeID string) (contract.GeocodedAddress, error) {
	rest, ok := strings.CutPrefix(placeID, FakePlaceIDPrefix)
	if !ok {
		return contract.GeocodedAddress{}, ErrNoMatch
	}
	i, err := strconv.Atoi(rest)
	if err != nil || i < 0 || i >= len(fakeCatalogue) || strconv.Itoa(i) != rest {
		return contract.GeocodedAddress{}, ErrNoMatch
	}
	return fakeCatalogue[i].address(), nil
}

// Reverse implements Provider: the nearest ADDRESS in the catalogue within
// fakeReverseRadiusM of the pin.
func (*FakeProvider) Reverse(_ context.Context, p Point) (contract.GeocodedAddress, error) {
	best, bestDist := -1, int32(fakeReverseRadiusM+1)
	for i, c := range fakeCatalogue {
		if c.kind != contract.ADDRESS {
			continue
		}
		if d := distanceMetres(p, c.point()); d < bestDist {
			best, bestDist = i, d
		}
	}
	if best < 0 {
		return contract.GeocodedAddress{}, ErrNoMatch
	}
	return fakeCatalogue[best].address(), nil
}
