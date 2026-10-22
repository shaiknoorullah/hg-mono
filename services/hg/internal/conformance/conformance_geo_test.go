package conformance

// Address search (the location picker):
//
//	suggestAddresses  GET /v1/geo/autocomplete
//	getPlaceAddress   GET /v1/geo/places/{placeId}
//	reverseGeocode    GET /v1/geo/reverse
//
// The server is the real geo router over the deterministic fake provider, so the
// bytes validated are the bytes the dev stack serves with no Mapbox token. Every
// request is ValidateRequest-checked and every response, including the error
// ones (404 GEOCODE_NO_MATCH, 422, 429, 503 GEOCODER_UNAVAILABLE), is validated
// against contracts/openapi.yaml. No database is needed; like the other
// conformance tests it still waits for HG_TEST_POSTGRES_DSN, because every test
// here rewrites COVERAGE.md and a run without the DSN would shrink it.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/geo"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

const geoSessionToken = "7f2b8f2e-6e0d-4a43-9a0b-5d6a8f4f9a11"

// downableProvider is the fake until down is set, then a provider that is out.
type downableProvider struct {
	geo.Provider
	down bool
}

func (p *downableProvider) Suggest(ctx context.Context, r geo.SuggestRequest) ([]contract.AddressSuggestion, error) {
	if p.down {
		return nil, geo.ErrUnavailable
	}
	return p.Provider.Suggest(ctx, r)
}

// switchLimiter allows everything until refuse is set.
type switchLimiter struct{ refuse bool }

func (l *switchLimiter) Allow(context.Context, string, string, int64, time.Duration) (bool, time.Duration, error) {
	if l.refuse {
		return false, 30 * time.Second, nil
	}
	return true, 0, nil
}

func TestConformance_AddressSearch(t *testing.T) {
	if os.Getenv("HG_TEST_POSTGRES_DSN") == "" {
		t.Skip("HG_TEST_POSTGRES_DSN not set — conformance harness needs a Postgres server")
	}
	prov := &downableProvider{Provider: geo.NewFake()}
	lim := &switchLimiter{}
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: authMatrix()})
	geo.Routes(router, geo.NewHandler(prov, lim, nil))
	if err := router.Verify(); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	h := &Harness{Server: srv, Spec: LoadSpec(t), covered: map[string]bool{}}
	t.Cleanup(func() { writeCoverage(t, h) })

	const account = "a0000000-0000-4000-8000-000000000101"
	check := func(t *testing.T, rq Request, want int) {
		t.Helper()
		rq.Method = http.MethodGet
		rq.AccountID = account
		if rq.Roles == nil {
			rq.Roles = []string{roleCustomer}
		}
		if _, err := ValidateRequest(t, h.Spec, h.Build(t, rq)); err != nil {
			t.Errorf("CONFORMANCE FAIL (request): %v", err)
		}
		h.CheckResponse(t, rq, want)
	}
	suggestQuery := func(q string) string {
		return url.Values{"q": {q}, "session_token": {geoSessionToken}, "latitude": {"43.6532"}, "longitude": {"-79.3832"}}.Encode()
	}

	// Pick a real suggestion so the place id is one the fake minted.
	sugg, err := geo.NewFake().Suggest(context.Background(), geo.SuggestRequest{
		Query: "1250 danforth", Bias: geo.DefaultMapCenter, BiasFromClient: true,
	})
	if err != nil || len(sugg) == 0 {
		t.Fatalf("the fake has no 1250 Danforth: %v, %v", sugg, err)
	}
	placePath := "/v1/geo/places/" + sugg[0].PlaceId

	t.Run("suggestAddresses", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/autocomplete", Query: suggestQuery("danforth")}, http.StatusOK)
	})
	t.Run("suggestAddresses, no match", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/autocomplete", Query: suggestQuery("qqqqzzzz")}, http.StatusOK)
	})
	t.Run("suggestAddresses, restaurant owner without a point", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/autocomplete", Roles: []string{roleRestaurantOwner},
			Query: url.Values{"q": {"queen"}, "session_token": {geoSessionToken}}.Encode()}, http.StatusOK)
	})
	t.Run("suggestAddresses, one coordinate is a 422", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/autocomplete",
			Query: url.Values{"q": {"a"}, "session_token": {geoSessionToken}, "latitude": {"43.6"}}.Encode()}, http.StatusUnprocessableEntity)
	})
	t.Run("getPlaceAddress", func(t *testing.T) {
		check(t, Request{Path: placePath, Query: "session_token=" + geoSessionToken}, http.StatusOK)
	})
	t.Run("getPlaceAddress, an id the provider no longer knows", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/places/fake:9999", Query: "session_token=" + geoSessionToken}, http.StatusNotFound)
	})
	t.Run("reverseGeocode", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/reverse", Query: "latitude=43.6826&longitude=-79.3301"}, http.StatusOK)
	})
	t.Run("reverseGeocode, a pin in the lake", func(t *testing.T) {
		check(t, Request{Path: "/v1/geo/reverse", Query: "latitude=43.55&longitude=-79.38"}, http.StatusNotFound)
	})
	t.Run("GEOCODER_UNAVAILABLE", func(t *testing.T) {
		prov.down = true
		defer func() { prov.down = false }()
		check(t, Request{Path: "/v1/geo/autocomplete", Query: suggestQuery("danforth")}, http.StatusServiceUnavailable)
	})
	t.Run("RATE_LIMITED", func(t *testing.T) {
		lim.refuse = true
		defer func() { lim.refuse = false }()
		check(t, Request{Path: "/v1/geo/reverse", Query: "latitude=43.6826&longitude=-79.3301"}, http.StatusTooManyRequests)
	})
	t.Run("a rider may not search", func(t *testing.T) {
		_, resp := h.Do(t, Request{Method: http.MethodGet, Path: "/v1/geo/reverse", Query: "latitude=43.6&longitude=-79.3",
			AccountID: account, Roles: []string{"RIDER"}})
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})
}
