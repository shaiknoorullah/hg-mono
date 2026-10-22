package geo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// mapboxBaseURL is Mapbox's API host. The token travels in the query string,
// which is how Mapbox takes it; see get for why no error leaves this file with
// the URL in it.
const mapboxBaseURL = "https://api.mapbox.com"

// mapboxTimeout bounds one call to Mapbox. The route's own deadline is 5
// seconds (httpx.ClassRead), so a slow Mapbox answers 503 and the client
// falls back to the manual form instead of the request dying on the route's
// timeout.
const mapboxTimeout = 3 * time.Second

// maxMapboxBody caps what is read from Mapbox. A real answer for 5 results is
// a few KiB.
const maxMapboxBody = 1 << 20

// searchTypes are the Geocoding v6 feature types the picker offers, from most
// to least precise. Geocoding v6 has no points of interest, so the POI kind is
// never produced here. Regions and countries are left out: a province alone is
// not an address anyone can deliver to.
const searchTypes = "address,street,postcode,neighborhood,locality,place"

// MapboxProvider forwards address search to Mapbox Geocoding v6
// (https://docs.mapbox.com/api/search/geocoding/): forward geocoding with
// autocomplete for suggestions, and forward or reverse geocoding with
// permanent=true for the results that get saved, because Mapbox allows only a
// permanent result to be stored (docs/decisions/README.md, "Where map address
// search comes from").
type MapboxProvider struct {
	token  string
	base   string
	client *http.Client
}

// NewMapbox builds the Mapbox provider. token is the server-side secret
// (HG_MAPBOX_SECRET_TOKEN); it is sent to Mapbox only. client may be nil.
func NewMapbox(token string, client *http.Client) *MapboxProvider {
	if client == nil {
		client = &http.Client{Timeout: mapboxTimeout}
	}
	return &MapboxProvider{token: token, base: mapboxBaseURL, client: client}
}

// Name implements Provider.
func (m *MapboxProvider) Name() string { return "mapbox" }

// Suggest implements Provider: forward geocoding with autocomplete, which is a
// temporary result.
func (m *MapboxProvider) Suggest(ctx context.Context, req SuggestRequest) ([]contract.AddressSuggestion, error) {
	q := url.Values{}
	q.Set("q", req.Query)
	q.Set("country", "ca")
	q.Set("types", searchTypes)
	q.Set("limit", "5")
	q.Set("autocomplete", "true")
	q.Set("language", "en")
	q.Set("proximity", coord(req.Bias.Longitude)+","+coord(req.Bias.Latitude))
	feats, err := m.features(ctx, "/search/geocode/v6/forward", q)
	if errors.Is(err, ErrNoMatch) {
		return []contract.AddressSuggestion{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := make([]contract.AddressSuggestion, 0, len(feats))
	for _, f := range feats {
		s, ok := f.suggestion(req)
		if !ok {
			continue
		}
		out = append(out, s)
		if len(out) == 5 {
			break
		}
	}
	return out, nil
}

// Place implements Provider. It asks again, with permanent=true, for the
// feature the suggestion named, biased to the point the suggestion had.
func (m *MapboxProvider) Place(ctx context.Context, placeID string) (contract.GeocodedAddress, error) {
	ref, err := decodePlaceRef(placeID)
	if err != nil {
		return contract.GeocodedAddress{}, ErrNoMatch
	}
	q := url.Values{}
	q.Set("q", ref.Query)
	q.Set("country", "ca")
	q.Set("types", ref.FeatureType)
	q.Set("limit", "1")
	q.Set("autocomplete", "false")
	q.Set("permanent", "true")
	q.Set("language", "en")
	q.Set("proximity", coord(ref.Lng)+","+coord(ref.Lat))
	return m.first(ctx, "/search/geocode/v6/forward", q)
}

// Reverse implements Provider: the nearest address to the pin, permanent.
func (m *MapboxProvider) Reverse(ctx context.Context, p Point) (contract.GeocodedAddress, error) {
	q := url.Values{}
	q.Set("longitude", coord(p.Longitude))
	q.Set("latitude", coord(p.Latitude))
	q.Set("country", "ca")
	q.Set("types", "address")
	q.Set("limit", "1")
	q.Set("permanent", "true")
	q.Set("language", "en")
	return m.first(ctx, "/search/geocode/v6/reverse", q)
}

// first returns the first Canadian feature as an address, or ErrNoMatch.
func (m *MapboxProvider) first(ctx context.Context, path string, q url.Values) (contract.GeocodedAddress, error) {
	feats, err := m.features(ctx, path, q)
	if err != nil {
		return contract.GeocodedAddress{}, err
	}
	for _, f := range feats {
		if a, ok := f.address(); ok {
			return a, nil
		}
	}
	return contract.GeocodedAddress{}, ErrNoMatch
}

// features calls Mapbox and decodes the GeoJSON features. An empty answer is
// ErrNoMatch.
func (m *MapboxProvider) features(ctx context.Context, path string, q url.Values) ([]v6Feature, error) {
	body, err := m.get(ctx, path, q)
	if err != nil {
		return nil, err
	}
	var fc struct {
		Features []v6Feature `json:"features"`
	}
	if err := json.Unmarshal(body, &fc); err != nil {
		return nil, fmt.Errorf("%w: undecodable answer", ErrUnavailable)
	}
	if len(fc.Features) == 0 {
		return nil, ErrNoMatch
	}
	return fc.Features, nil
}

// get performs one GET. Every error it returns wraps ErrUnavailable or is
// ErrNoMatch, and none carries the request URL: Mapbox takes the token in the
// query string, and net/http puts the URL in its errors.
func (m *MapboxProvider) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	q.Set("access_token", m.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.base+path+"?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: build request", ErrUnavailable)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := m.client.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return nil, fmt.Errorf("%w: request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxMapboxBody))
		if err != nil {
			return nil, fmt.Errorf("%w: read answer: %v", ErrUnavailable, err)
		}
		return body, nil
	case resp.StatusCode == http.StatusNotFound, resp.StatusCode == http.StatusUnprocessableEntity:
		// 422: Mapbox cannot use this text (too many words, no usable
		// characters). It is a search with no result, not an outage.
		return nil, ErrNoMatch
	default:
		// 401 and 403 are our key being refused; 429 is Mapbox's own limit; 5xx
		// is Mapbox. All of them mean the picker cannot search right now.
		return nil, fmt.Errorf("%w: mapbox answered %d", ErrUnavailable, resp.StatusCode)
	}
}

// ── Geocoding v6 response ────────────────────────────────────────────────────

type v6Named struct {
	Name string `json:"name"`
}

type v6Region struct {
	RegionCode     string `json:"region_code"`
	RegionCodeFull string `json:"region_code_full"`
}

type v6Country struct {
	CountryCode string `json:"country_code"`
}

type v6Point struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type v6Context struct {
	Address      *v6Named   `json:"address"`
	Street       *v6Named   `json:"street"`
	Postcode     *v6Named   `json:"postcode"`
	Neighborhood *v6Named   `json:"neighborhood"`
	Locality     *v6Named   `json:"locality"`
	Place        *v6Named   `json:"place"`
	Region       *v6Region  `json:"region"`
	Country      *v6Country `json:"country"`
}

type v6Geometry struct {
	Coordinates []float64 `json:"coordinates"` // [longitude, latitude]
}

type v6Properties struct {
	FeatureType    string    `json:"feature_type"`
	Name           string    `json:"name"`
	FullAddress    string    `json:"full_address"`
	PlaceFormatted string    `json:"place_formatted"`
	Coordinates    v6Point   `json:"coordinates"`
	Context        v6Context `json:"context"`
}

type v6Feature struct {
	Geometry   v6Geometry   `json:"geometry"`
	Properties v6Properties `json:"properties"`
}

// kind maps Mapbox's feature_type to the contract's GeoResultKind. ok is false
// for a type the picker does not offer.
func (f v6Feature) kind() (contract.GeoResultKind, bool) {
	switch f.Properties.FeatureType {
	case "address":
		return contract.ADDRESS, true
	case "street":
		return contract.STREET, true
	case "postcode":
		return contract.POSTCODE, true
	case "neighborhood", "locality", "district":
		return contract.NEIGHBOURHOOD, true
	case "place":
		return contract.PLACE, true
	}
	return "", false
}

// point is the feature's own position. Mapbox gives it twice; the properties
// copy wins, the GeoJSON geometry is the fallback.
func (f v6Feature) point() (Point, bool) {
	c := f.Properties.Coordinates
	if c.Latitude != 0 || c.Longitude != 0 {
		return Point{Latitude: c.Latitude, Longitude: c.Longitude}, validPoint(c.Latitude, c.Longitude)
	}
	if g := f.Geometry.Coordinates; len(g) >= 2 {
		return Point{Latitude: g[1], Longitude: g[0]}, validPoint(g[1], g[0])
	}
	return Point{}, false
}

func validPoint(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat == 0 && lng == 0)
}

func (f v6Feature) canadian() bool {
	c := f.Properties.Context.Country
	return c != nil && strings.EqualFold(c.CountryCode, "CA")
}

// province reads the ISO 3166-2:CA code ("ON") from the region context, which
// Mapbox gives as region_code and, in full, as "CA-ON".
func (f v6Feature) province() (contract.Province, bool) {
	r := f.Properties.Context.Region
	if r == nil {
		return "", false
	}
	code := strings.ToUpper(strings.TrimSpace(r.RegionCode))
	if code == "" {
		code = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(r.RegionCodeFull)), "CA-")
	}
	p := contract.Province(code)
	if !p.Valid() {
		return "", false
	}
	return p, true
}

// city is the city or town: the place the feature is in, or the feature itself
// when it is the place.
func (f v6Feature) city() *string {
	c := f.Properties.Context
	switch {
	case f.Properties.FeatureType == "place":
		return nonEmpty(f.Properties.Name, 100)
	case c.Place != nil:
		return nonEmpty(c.Place.Name, 100)
	case c.Locality != nil:
		return nonEmpty(c.Locality.Name, 100)
	}
	return nil
}

// line1 is the street number and street for an address, the street alone for a
// street, and nil for everything coarser.
func (f v6Feature) line1(kind contract.GeoResultKind) *string {
	switch kind {
	case contract.ADDRESS:
		if a := f.Properties.Context.Address; a != nil && strings.TrimSpace(a.Name) != "" {
			return nonEmpty(a.Name, 200)
		}
		return nonEmpty(f.Properties.Name, 200)
	case contract.STREET:
		return nonEmpty(f.Properties.Name, 200)
	}
	return nil
}

func (f v6Feature) postalCode(kind contract.GeoResultKind) *string {
	switch {
	case kind == contract.POSTCODE:
		return normalisePostalCode(f.Properties.Name)
	case f.Properties.Context.Postcode != nil:
		return normalisePostalCode(f.Properties.Context.Postcode.Name)
	}
	return nil
}

// formatted is the one-line display form, without the trailing ", Canada"
// (every result is Canadian, so the client does not need it).
func (f v6Feature) formatted() string {
	p := f.Properties
	s := strings.TrimSpace(p.FullAddress)
	if s == "" {
		s = strings.TrimSpace(p.Name)
		if pf := strings.TrimSpace(p.PlaceFormatted); pf != "" {
			s += ", " + pf
		}
	}
	return clip(strings.TrimSuffix(s, ", Canada"), 512)
}

// address maps a feature to the contract's GeocodedAddress. ok is false for a
// result the contract must never return: not in Canada, no province, no point,
// or a kind the picker does not offer.
func (f v6Feature) address() (contract.GeocodedAddress, bool) {
	kind, ok := f.kind()
	if !ok || !f.canadian() {
		return contract.GeocodedAddress{}, false
	}
	prov, ok := f.province()
	if !ok {
		return contract.GeocodedAddress{}, false
	}
	pt, ok := f.point()
	if !ok {
		return contract.GeocodedAddress{}, false
	}
	formatted := f.formatted()
	if formatted == "" {
		return contract.GeocodedAddress{}, false
	}
	return contract.GeocodedAddress{
		Kind:       kind,
		Name:       nil, // Geocoding v6 has no points of interest
		Line1:      f.line1(kind),
		City:       f.city(),
		Province:   prov,
		PostalCode: f.postalCode(kind),
		Country:    contract.GeocodedAddressCountryCA,
		Latitude:   pt.Latitude,
		Longitude:  pt.Longitude,
		Formatted:  formatted,
	}, true
}

// suggestion maps a feature to a row in the search list, with a place_id that
// carries what getPlaceAddress needs to ask Mapbox for the permanent result.
func (f v6Feature) suggestion(req SuggestRequest) (contract.AddressSuggestion, bool) {
	kind, ok := f.kind()
	if !ok || !f.canadian() {
		return contract.AddressSuggestion{}, false
	}
	if _, ok := f.province(); !ok {
		return contract.AddressSuggestion{}, false
	}
	pt, ok := f.point()
	if !ok {
		return contract.AddressSuggestion{}, false
	}
	title := clip(strings.TrimSpace(f.Properties.Name), 256)
	if title == "" {
		return contract.AddressSuggestion{}, false
	}
	query := strings.TrimSuffix(strings.TrimSpace(f.Properties.FullAddress), ", Canada")
	if query == "" {
		query = f.formatted()
	}
	s := contract.AddressSuggestion{
		PlaceId:  encodePlaceRef(placeRef{Query: query, FeatureType: f.Properties.FeatureType, Lat: pt.Latitude, Lng: pt.Longitude}),
		Kind:     kind,
		Title:    title,
		Subtitle: nonEmpty(strings.TrimSuffix(strings.TrimSpace(f.Properties.PlaceFormatted), ", Canada"), 256),
	}
	if req.BiasFromClient {
		d := distanceMetres(req.Bias, pt)
		s.DistanceM = &d
	}
	return s, true
}

// ── place_id ─────────────────────────────────────────────────────────────────

// placeRef is what a Mapbox place_id carries: enough to ask Mapbox again for
// the one feature the user picked. The id is unsigned on purpose. A forged one
// only asks Mapbox for an address, which suggestAddresses already lets any
// signed-in caller do, under the same rate limit.
type placeRef struct {
	Query       string  `json:"q"`
	FeatureType string  `json:"f"`
	Lat         float64 `json:"y"`
	Lng         float64 `json:"x"`
}

// maxRefQueryBytes keeps the encoded id well inside the contract's 512
// characters.
const maxRefQueryBytes = 150

func encodePlaceRef(r placeRef) string {
	r.Query = truncateBytes(r.Query, maxRefQueryBytes)
	r.Lat = round6(r.Lat)
	r.Lng = round6(r.Lng)
	b, _ := json.Marshal(r) // a struct of strings and floats cannot fail
	return base64.RawURLEncoding.EncodeToString(b)
}

var featureTypes = map[string]bool{
	"address": true, "street": true, "postcode": true,
	"neighborhood": true, "locality": true, "district": true, "place": true,
}

func decodePlaceRef(id string) (placeRef, error) {
	var r placeRef
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return r, errors.New("not a place id")
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return r, errors.New("not a place id")
	}
	if strings.TrimSpace(r.Query) == "" || !featureTypes[r.FeatureType] || !validPoint(r.Lat, r.Lng) {
		return r, errors.New("not a place id")
	}
	return r, nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func coord(v float64) string { return strconv.FormatFloat(v, 'f', 6, 64) }

func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }

func nonEmpty(s string, max int) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	s = clip(s, max)
	return &s
}

// clip shortens s to at most max characters.
func clip(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

// truncateBytes shortens s to at most n bytes without cutting a character.
func truncateBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// postalPattern is the contract's PostalCode pattern.
var postalPattern = regexp.MustCompile(`^[A-CEGHJ-NPR-TVXY][0-9][A-CEGHJ-NPR-TV-Z] [0-9][A-CEGHJ-NPR-TV-Z][0-9]$`)

// normalisePostalCode uppercases a postal code and puts the single space in the
// middle. It returns nil for anything that is not a Canadian postal code, so a
// partial or foreign code is never sent as one.
func normalisePostalCode(s string) *string {
	s = strings.ToUpper(strings.Join(strings.Fields(s), ""))
	if len(s) != 6 {
		return nil
	}
	s = s[:3] + " " + s[3:]
	if !postalPattern.MatchString(s) {
		return nil
	}
	return &s
}

// distanceMetres is the great-circle distance, rounded to whole metres.
func distanceMetres(a, b Point) int32 {
	const earthRadius = 6371008.8
	rad := math.Pi / 180
	dLat := (b.Latitude - a.Latitude) * rad
	dLng := (b.Longitude - a.Longitude) * rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(a.Latitude*rad)*math.Cos(b.Latitude*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	d := 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(h)))
	if d > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(math.Round(d))
}
