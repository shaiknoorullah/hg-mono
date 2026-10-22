package geo_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/geo"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

const sessionToken = "00000000-0000-4000-8000-00000000a001"

// headerAuth is the test authenticator: X-Test-Account-ID and X-Test-Roles make
// the principal, and no header is an anonymous caller.
type headerAuth struct{}

func (headerAuth) Authenticate(_ context.Context, r *http.Request) (httpx.Principal, error) {
	id := r.Header.Get("X-Test-Account-ID")
	if id == "" {
		return httpx.AnonymousPrincipal(), nil
	}
	var roles []httpx.Role
	for _, name := range strings.Split(r.Header.Get("X-Test-Roles"), ",") {
		if name = strings.TrimSpace(name); name != "" {
			roles = append(roles, httpx.Role(name))
		}
	}
	return httpx.Principal{
		AccountID: id, SessionID: "00000000-0000-4000-8000-0000c0f0face", Roles: roles, AMR: []string{"pwd+totp"},
	}, nil
}

// stubProvider answers from fields and records what it was asked.
type stubProvider struct {
	mu          sync.Mutex
	suggestions []contract.AddressSuggestion
	address     contract.GeocodedAddress
	err         error

	suggestReq geo.SuggestRequest
	placeID    string
	reversePin geo.Point
	calls      int
}

func (s *stubProvider) Name() string { return "stub" }

func (s *stubProvider) Suggest(_ context.Context, req geo.SuggestRequest) ([]contract.AddressSuggestion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.suggestReq = req
	return s.suggestions, s.err
}

func (s *stubProvider) Place(_ context.Context, id string) (contract.GeocodedAddress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.placeID = id
	return s.address, s.err
}

func (s *stubProvider) Reverse(_ context.Context, p geo.Point) (contract.GeocodedAddress, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.reversePin = p
	return s.address, s.err
}

// countingLimiter allows `allowed` requests per name and subject, then refuses.
type countingLimiter struct {
	mu      sync.Mutex
	allowed int
	seen    map[string]int
	limits  map[string]int64
	err     error
}

func newLimiter(allowed int) *countingLimiter {
	return &countingLimiter{allowed: allowed, seen: map[string]int{}, limits: map[string]int64{}}
}

func (l *countingLimiter) Allow(_ context.Context, name, subject string, limit int64, window time.Duration) (bool, time.Duration, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.err != nil {
		return false, 0, l.err
	}
	if window != time.Minute {
		return false, 0, errors.New("window is not one minute")
	}
	key := name + "|" + subject
	l.seen[key]++
	l.limits[name] = limit
	if l.seen[key] > l.allowed {
		return false, 37 * time.Second, nil
	}
	return true, 0, nil
}

type rig struct {
	srv  *httptest.Server
	prov *stubProvider
	lim  *countingLimiter
	logs *bytes.Buffer
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{prov: &stubProvider{address: sampleAddress()}, lim: newLimiter(1000), logs: &bytes.Buffer{}}
	log := slog.New(slog.NewJSONHandler(r.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: headerAuth{}, Authorizer: auth.Matrix{}})
	geo.Routes(router, geo.NewHandler(r.prov, r.lim, log))
	if err := router.Verify(); err != nil {
		t.Fatal(err)
	}
	for _, route := range router.PublicRoutes() {
		if strings.Contains(route, "/v1/geo/") {
			t.Errorf("%s is public; address search needs a signed-in account", route)
		}
	}
	r.srv = httptest.NewServer(router)
	t.Cleanup(r.srv.Close)
	return r
}

func sampleAddress() contract.GeocodedAddress {
	line1, city, postal := "88 Harbour Street", "Toronto", "M5J 0C3"
	return contract.GeocodedAddress{
		Kind: contract.ADDRESS, Line1: &line1, City: &city, Province: contract.ON, PostalCode: &postal,
		Country: contract.GeocodedAddressCountryCA, Latitude: 43.6405, Longitude: -79.3806,
		Formatted: "88 Harbour Street, Toronto, Ontario M5J 0C3",
	}
}

// get issues a signed-in GET as a customer unless roles say otherwise.
func (r *rig) get(t *testing.T, path string, roles ...string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, r.srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) == 0 {
		roles = []string{"CUSTOMER"}
	}
	if roles[0] != "-" {
		req.Header.Set("X-Test-Account-ID", "a0000000-0000-4000-8000-000000000101")
		req.Header.Set("X-Test-Roles", strings.Join(roles, ","))
	}
	resp, err := r.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(resp.Body)
	return resp, buf.Bytes()
}

type errBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"details"`
	} `json:"error"`
}

func decodeErr(t *testing.T, body []byte) errBody {
	t.Helper()
	var e errBody
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatalf("not an error envelope: %s", body)
	}
	return e
}

func (e errBody) fields() []string {
	var f []string
	for _, d := range e.Error.Details {
		f = append(f, d.Field)
	}
	sort.Strings(f)
	return f
}

// validationCase is a request that must be refused with 422 VALIDATION_FAILED,
// naming exactly these fields (sorted).
type validationCase struct {
	name   string
	path   string
	fields []string
}

func (r *rig) expectValidation(t *testing.T, cases []validationCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := r.get(t, tc.path)
			e := decodeErr(t, body)
			if resp.StatusCode != http.StatusUnprocessableEntity || e.Error.Code != "VALIDATION_FAILED" ||
				strings.Join(e.fields(), ",") != strings.Join(tc.fields, ",") {
				t.Errorf("%d %s, want 422 VALIDATION_FAILED on %v", resp.StatusCode, body, tc.fields)
			}
		})
	}
}

func suggestPath(extra string) string {
	return "/v1/geo/autocomplete?session_token=" + sessionToken + extra
}

// ── who may call ─────────────────────────────────────────────────────────────

func TestOnlyCustomersAndRestaurantOwnersAndManagersMaySearch(t *testing.T) {
	r := newRig(t)
	paths := map[string]string{
		"suggestAddresses": suggestPath("&q=harbour"),
		"getPlaceAddress":  "/v1/geo/places/fake:1?session_token=" + sessionToken,
		"reverseGeocode":   "/v1/geo/reverse?latitude=43.65&longitude=-79.38",
	}
	for op, path := range paths {
		t.Run(op, func(t *testing.T) {
			resp, body := r.get(t, path, "-")
			if resp.StatusCode != http.StatusUnauthorized || decodeErr(t, body).Error.Code != "AUTHENTICATION_REQUIRED" {
				t.Errorf("anonymous: %d %s, want 401 AUTHENTICATION_REQUIRED", resp.StatusCode, body)
			}
			for _, role := range []string{"RIDER", "RESTAURANT_STAFF", "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN"} {
				if resp, body := r.get(t, path, role); resp.StatusCode != http.StatusForbidden {
					t.Errorf("%s: %d %s, want 403", role, resp.StatusCode, body)
				}
			}
			for _, role := range []string{"CUSTOMER", "RESTAURANT_OWNER", "RESTAURANT_MANAGER"} {
				if resp, body := r.get(t, path, role); resp.StatusCode != http.StatusOK {
					t.Errorf("%s: %d %s, want 200", role, resp.StatusCode, body)
				}
			}
		})
	}
	if r.prov.calls != 3*3 {
		t.Errorf("provider was called %d times; refused callers must never reach it (want 9, one per allowed role and route)", r.prov.calls)
	}
}

// ── suggestAddresses ─────────────────────────────────────────────────────────

func TestSuggestValidation(t *testing.T) {
	r := newRig(t)
	long := strings.Repeat("a", 257)
	cases := []validationCase{
		{"no q", suggestPath(""), []string{"q"}},
		{"blank q", suggestPath("&q=%20%20"), []string{"q"}},
		{"q over 256 characters", suggestPath("&q=" + long), []string{"q"}},
		{"no session token", "/v1/geo/autocomplete?q=harbour", []string{"session_token"}},
		{"session token not UUID", "/v1/geo/autocomplete?q=harbour&session_token=abc", []string{"session_token"}},
		{"latitude without longitude", suggestPath("&q=h&latitude=43.6"), []string{"longitude"}},
		{"longitude without latitude", suggestPath("&q=h&longitude=-79.3"), []string{"latitude"}},
		{"latitude out of range", suggestPath("&q=h&latitude=91&longitude=-79"), []string{"latitude"}},
		{"longitude out of range", suggestPath("&q=h&latitude=43&longitude=-181"), []string{"longitude"}},
		{"latitude not a number", suggestPath("&q=h&latitude=north&longitude=-79"), []string{"latitude"}},
		{"NaN", suggestPath("&q=h&latitude=NaN&longitude=-79"), []string{"latitude"}},
		{"Inf", suggestPath("&q=h&latitude=43&longitude=Inf"), []string{"longitude"}},
		{"several at once", "/v1/geo/autocomplete?latitude=43", []string{"longitude", "q", "session_token"}},
	}
	r.expectValidation(t, cases)
	if r.prov.calls != 0 {
		t.Errorf("provider called %d times for invalid requests", r.prov.calls)
	}
}

func TestSuggestForwardsTheTrimmedQueryAndTheClientsPoint(t *testing.T) {
	r := newRig(t)
	line := "88 Harbour Street"
	r.prov.suggestions = []contract.AddressSuggestion{{PlaceId: "fake:1", Kind: contract.ADDRESS, Title: line}}

	resp, body := r.get(t, suggestPath("&q=%20%2088%20harbour%20&latitude=43.7&longitude=-79.4"), "RESTAURANT_OWNER")
	if resp.StatusCode != 200 {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
	req := r.prov.suggestReq
	if req.Query != "88 harbour" || req.Bias != (geo.Point{Latitude: 43.7, Longitude: -79.4}) || !req.BiasFromClient || req.SessionToken != sessionToken {
		t.Errorf("provider got %+v", req)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q; suggestions are temporary results that may not be cached", resp.Header.Get("Cache-Control"))
	}
	var out struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil || len(out.Data) != 1 || out.Data[0]["title"] != line {
		t.Errorf("body = %s (%v)", body, err)
	}
}

func TestSuggestWithoutAPointRanksTowardsTheDefaultMapCentre(t *testing.T) {
	r := newRig(t)
	if resp, body := r.get(t, suggestPath("&q=harbour")); resp.StatusCode != 200 {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
	if r.prov.suggestReq.Bias != geo.DefaultMapCenter || r.prov.suggestReq.BiasFromClient {
		t.Errorf("provider got %+v, want the default map centre and BiasFromClient=false (distance_m stays null)", r.prov.suggestReq)
	}
}

func TestSuggestNoMatchIsAnEmptyListNotAnError(t *testing.T) {
	r := newRig(t) // the stub returns nil suggestions
	resp, body := r.get(t, suggestPath("&q=nothing"))
	if resp.StatusCode != 200 || !strings.Contains(strings.ReplaceAll(string(body), " ", ""), `"data":[]`) {
		t.Errorf("%d %s, want 200 with \"data\":[]", resp.StatusCode, body)
	}
}

func TestSuggestNeverReturnsMoreThanFive(t *testing.T) {
	r := newRig(t)
	for i := 0; i < 8; i++ {
		r.prov.suggestions = append(r.prov.suggestions, contract.AddressSuggestion{PlaceId: "fake:1", Kind: contract.ADDRESS, Title: "x"})
	}
	_, body := r.get(t, suggestPath("&q=x"))
	var out struct {
		Data []any `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil || len(out.Data) != 5 {
		t.Errorf("got %d suggestions (%v), want 5", len(out.Data), err)
	}
}

// ── getPlaceAddress ──────────────────────────────────────────────────────────

func TestGetPlaceAddressReturnsExactlyTheContractShape(t *testing.T) {
	r := newRig(t)
	line1 := "6 Port Union Road"
	r.prov.address = contract.GeocodedAddress{
		Kind: contract.STREET, Line1: &line1, Province: contract.ON, Country: contract.GeocodedAddressCountryCA,
		Latitude: 43.78, Longitude: -79.13, Formatted: line1 + ", Toronto, Ontario",
	}
	resp, body := r.get(t, "/v1/geo/places/fake:7?session_token="+sessionToken, "RESTAURANT_MANAGER")
	if resp.StatusCode != 200 {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
	if r.prov.placeID != "fake:7" {
		t.Errorf("provider got place id %q", r.prov.placeID)
	}
	var out struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(out.Data))
	for k := range out.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	want := "city,country,formatted,kind,latitude,line1,longitude,name,postal_code,province"
	if strings.Join(keys, ",") != want {
		t.Errorf("keys = %v, want %s", keys, want)
	}
	for _, k := range []string{"city", "name", "postal_code"} {
		if string(out.Data[k]) != "null" {
			t.Errorf("%s = %s, want null (a field the provider does not know is null, never guessed)", k, out.Data[k])
		}
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("Cache-Control = %q", resp.Header.Get("Cache-Control"))
	}
}

func TestGetPlaceAddressValidation(t *testing.T) {
	r := newRig(t)
	cases := []validationCase{
		{"no session token", "/v1/geo/places/fake:1", []string{"session_token"}},
		{"session token not UUID", "/v1/geo/places/fake:1?session_token=nope", []string{"session_token"}},
		{"id with a bad character", "/v1/geo/places/bad*id?session_token=" + sessionToken, []string{"placeId"}},
		{"id over 512 characters", "/v1/geo/places/" + strings.Repeat("a", 513) + "?session_token=" + sessionToken, []string{"placeId"}},
	}
	r.expectValidation(t, cases)
	if r.prov.calls != 0 {
		t.Errorf("provider called %d times for invalid requests", r.prov.calls)
	}
}

func TestGetPlaceAddressNoMatchIs404(t *testing.T) {
	r := newRig(t)
	r.prov.err = geo.ErrNoMatch
	resp, body := r.get(t, "/v1/geo/places/gone?session_token="+sessionToken)
	if resp.StatusCode != http.StatusNotFound || decodeErr(t, body).Error.Code != "GEOCODE_NO_MATCH" {
		t.Errorf("%d %s, want 404 GEOCODE_NO_MATCH", resp.StatusCode, body)
	}
}

// ── reverseGeocode ───────────────────────────────────────────────────────────

func TestReverseGeocode(t *testing.T) {
	r := newRig(t)
	resp, body := r.get(t, "/v1/geo/reverse?latitude=43.6815&longitude=-79.331")
	if resp.StatusCode != 200 {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
	if r.prov.reversePin != (geo.Point{Latitude: 43.6815, Longitude: -79.331}) {
		t.Errorf("provider got %+v", r.prov.reversePin)
	}

	r.prov.err = geo.ErrNoMatch
	resp, body = r.get(t, "/v1/geo/reverse?latitude=43.5&longitude=-79.4")
	if resp.StatusCode != http.StatusNotFound || decodeErr(t, body).Error.Code != "GEOCODE_NO_MATCH" {
		t.Errorf("no match: %d %s, want 404 GEOCODE_NO_MATCH", resp.StatusCode, body)
	}
}

func TestReverseGeocodeValidation(t *testing.T) {
	r := newRig(t)
	cases := []validationCase{
		{"nothing", "/v1/geo/reverse", []string{"latitude", "longitude"}},
		{"latitude only", "/v1/geo/reverse?latitude=43.6", []string{"longitude"}},
		{"longitude only", "/v1/geo/reverse?longitude=-79.3", []string{"latitude"}},
		{"latitude too big", "/v1/geo/reverse?latitude=90.5&longitude=-79", []string{"latitude"}},
		{"longitude too small", "/v1/geo/reverse?latitude=43&longitude=-180.5", []string{"longitude"}},
		{"not numbers", "/v1/geo/reverse?latitude=a&longitude=b", []string{"latitude", "longitude"}},
	}
	r.expectValidation(t, cases)
	if r.prov.calls != 0 {
		t.Errorf("provider called %d times for invalid requests", r.prov.calls)
	}
}

// ── provider down ────────────────────────────────────────────────────────────

func TestProviderFailureIs503WithoutTheProvidersWords(t *testing.T) {
	r := newRig(t)
	r.prov.err = errors.New("geo: provider unavailable: mapbox answered 403 for token fixture-leak")
	for _, path := range []string{
		suggestPath("&q=harbour"),
		"/v1/geo/places/fake:1?session_token=" + sessionToken,
		"/v1/geo/reverse?latitude=43.6&longitude=-79.4",
	} {
		resp, body := r.get(t, path)
		if resp.StatusCode != http.StatusServiceUnavailable || decodeErr(t, body).Error.Code != "GEOCODER_UNAVAILABLE" {
			t.Errorf("%s: %d %s, want 503 GEOCODER_UNAVAILABLE", path, resp.StatusCode, body)
		}
		if strings.Contains(string(body), "fixture-leak") || strings.Contains(string(body), "mapbox") {
			t.Errorf("%s: the provider's error reached the client: %s", path, body)
		}
	}
}

// ── rate limits ──────────────────────────────────────────────────────────────

func TestRateLimitsAreCountedPerAccountAndPerOperation(t *testing.T) {
	r := newRig(t)
	r.get(t, suggestPath("&q=a"))
	r.get(t, "/v1/geo/places/fake:1?session_token="+sessionToken)
	r.get(t, "/v1/geo/reverse?latitude=43.6&longitude=-79.4")

	want := map[string]int64{"geo_suggest": 60, "geo_place": 30, "geo_reverse": 30}
	for name, limit := range want {
		if r.lim.limits[name] != limit {
			t.Errorf("%s limit = %d, want %d per minute (the contract's GEO_SUGGEST and GEO classes)", name, r.lim.limits[name], limit)
		}
		if r.lim.seen[name+"|account:a0000000-0000-4000-8000-000000000101"] != 1 {
			t.Errorf("%s was not counted against the account: %v", name, r.lim.seen)
		}
	}
}

func TestOverTheLimitIs429WithRetryAfterAndNeverReachesTheProvider(t *testing.T) {
	r := newRig(t)
	r.lim.allowed = 1
	if resp, body := r.get(t, suggestPath("&q=a")); resp.StatusCode != 200 {
		t.Fatalf("first request: %d %s", resp.StatusCode, body)
	}
	calls := r.prov.calls
	resp, body := r.get(t, suggestPath("&q=a"))
	e := decodeErr(t, body)
	if resp.StatusCode != http.StatusTooManyRequests || e.Error.Code != "RATE_LIMITED" {
		t.Fatalf("%d %s, want 429 RATE_LIMITED", resp.StatusCode, body)
	}
	if resp.Header.Get("Retry-After") != "37" || resp.Header.Get("RateLimit-Remaining") != "0" || resp.Header.Get("RateLimit-Limit") != "60" {
		t.Errorf("headers = %v", resp.Header)
	}
	if r.prov.calls != calls {
		t.Error("a rate-limited request still reached the provider")
	}
	// Another operation has its own budget.
	if resp, body := r.get(t, "/v1/geo/reverse?latitude=43.6&longitude=-79.4"); resp.StatusCode != 200 {
		t.Errorf("reverseGeocode shares suggestAddresses's budget: %d %s", resp.StatusCode, body)
	}
}

func TestALimiterThatCannotAnswerDoesNotLockCustomersOut(t *testing.T) {
	r := newRig(t)
	r.lim.err = errors.New("redis down")
	if resp, body := r.get(t, suggestPath("&q=a")); resp.StatusCode != 200 {
		t.Errorf("%d %s, want the request let through", resp.StatusCode, body)
	}
}

// ── logging ──────────────────────────────────────────────────────────────────

func TestLogsNameTheProviderButNeverTheQueryOrAnAddress(t *testing.T) {
	r := newRig(t)
	r.prov.suggestions = []contract.AddressSuggestion{{PlaceId: "fake:1", Kind: contract.ADDRESS, Title: "88 Harbour Street"}}
	q := url.QueryEscape("zebracrossing lane 4417")
	r.get(t, suggestPath("&q="+q))
	r.get(t, "/v1/geo/places/fake:1?session_token="+sessionToken)
	r.get(t, "/v1/geo/reverse?latitude=43.6405&longitude=-79.3806")
	r.prov.err = errors.New("boom")
	r.get(t, "/v1/geo/reverse?latitude=43.6405&longitude=-79.3806")

	logs := r.logs.String()
	if !strings.Contains(logs, `"provider":"stub"`) || !strings.Contains(logs, `"op":"suggestAddresses"`) {
		t.Errorf("logs do not name the provider and operation:\n%s", logs)
	}
	for _, secret := range []string{"zebracrossing", "4417", "Harbour", "88 Harbour", "43.6405", "-79.3806", sessionToken} {
		if strings.Contains(logs, secret) {
			t.Errorf("logs contain %q:\n%s", secret, logs)
		}
	}
}
