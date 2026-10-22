package geo

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Error codes this module emits. Both are members of the contract's ErrorCode
// enum.
const (
	codeNoMatch      httpx.ErrorCode = "GEOCODE_NO_MATCH"
	codeGeocoderDown httpx.ErrorCode = "GEOCODER_UNAVAILABLE"
)

// Limits from the contract: suggestAddresses is rate class GEO_SUGGEST (60
// requests per account per minute); getPlaceAddress and reverseGeocode are rate
// class GEO (30 per account per minute), each counted on its own. The contract's
// burst allowance is not modelled: the shared limiter is a fixed window.
const (
	suggestLimitPerMin = 60
	lookupLimitPerMin  = 30
	geoWindow          = time.Minute
)

// Input limits from the contract.
const (
	maxQueryChars   = 256
	maxPlaceIDChars = 512
)

// DefaultMapCenter is downtown Toronto: the contract's default_map_center from
// getPublicConfig (internal/system), used to rank suggestions when the client
// sends no point.
var DefaultMapCenter = Point{Latitude: 43.6532, Longitude: -79.3832}

// placeIDPattern is the contract's PlaceId pattern.
var placeIDPattern = regexp.MustCompile(`^[A-Za-z0-9._~:=-]+$`)

// Limiter counts requests in a fixed window. It reports whether the request is
// within limit and, when it is not, how long until the window ends. The
// implementation in cmd/hg counts in Redis and falls back to each replica's
// memory while Redis is down, so a flush or an outage never lifts the cap on a
// paid provider; the counters are disposable (internal/auth/ratelimit.go).
type Limiter interface {
	Allow(ctx context.Context, name, subject string, limit int64, window time.Duration) (allowed bool, retryAfter time.Duration, err error)
}

// Handler serves the three address-search operations.
type Handler struct {
	provider Provider
	limiter  Limiter
	log      *slog.Logger
}

// NewHandler builds the handler. limiter may be nil (tests), which counts
// nothing. log may be nil.
func NewHandler(provider Provider, limiter Limiter, log *slog.Logger) *Handler {
	if log == nil {
		log = slog.Default()
	}
	return &Handler{provider: provider, limiter: limiter, log: log}
}

// SuggestAddresses implements suggestAddresses (GET /v1/geo/autocomplete).
func (h *Handler) SuggestAddresses(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "geo_suggest", suggestLimitPerMin) {
		return
	}
	q := r.URL.Query()
	var fe []httpx.FieldError

	text := strings.TrimSpace(q.Get("q"))
	switch n := utf8.RuneCountInString(text); {
	case n == 0:
		fe = append(fe, httpx.FieldError{Field: "q", Code: "required", Message: "Type at least one character to search."})
	case n > maxQueryChars:
		fe = append(fe, httpx.FieldError{Field: "q", Code: "too_long", Message: "The search text is longer than 256 characters."})
	}
	token, tokenErr := sessionToken(q)
	if tokenErr != nil {
		fe = append(fe, *tokenErr)
	}
	bias, fromClient, biasErrs := optionalPoint(q)
	fe = append(fe, biasErrs...)
	if len(fe) > 0 {
		invalid(w, r, fe)
		return
	}
	if !fromClient {
		bias = DefaultMapCenter
	}

	start := time.Now()
	out, err := h.provider.Suggest(r.Context(), SuggestRequest{
		Query: text, Bias: bias, BiasFromClient: fromClient, SessionToken: token,
	})
	if err != nil && !errors.Is(err, ErrNoMatch) {
		h.unavailable(w, r, "suggestAddresses", err, start)
		return
	}
	if out == nil {
		out = []contract.AddressSuggestion{}
	}
	if len(out) > 5 {
		out = out[:5]
	}
	h.done(r, "suggestAddresses", len(out), start, slog.Int("query_chars", utf8.RuneCountInString(text)))
	respond(w, r, out)
}

// GetPlaceAddress implements getPlaceAddress (GET /v1/geo/places/{placeId}).
func (h *Handler) GetPlaceAddress(w http.ResponseWriter, r *http.Request, placeID string) {
	if !h.allow(w, r, "geo_place", lookupLimitPerMin) {
		return
	}
	var fe []httpx.FieldError
	if n := utf8.RuneCountInString(placeID); n == 0 || n > maxPlaceIDChars || !placeIDPattern.MatchString(placeID) {
		fe = append(fe, httpx.FieldError{Field: "placeId", Code: "invalid", Message: "The place id is not one a suggestion returned."})
	}
	if _, tokenErr := sessionToken(r.URL.Query()); tokenErr != nil {
		fe = append(fe, *tokenErr)
	}
	if len(fe) > 0 {
		invalid(w, r, fe)
		return
	}

	start := time.Now()
	addr, err := h.provider.Place(r.Context(), placeID)
	h.answerAddress(w, r, "getPlaceAddress", addr, err, start)
}

// ReverseGeocode implements reverseGeocode (GET /v1/geo/reverse).
func (h *Handler) ReverseGeocode(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, "geo_reverse", lookupLimitPerMin) {
		return
	}
	p, present, fe := optionalPoint(r.URL.Query())
	if !present && len(fe) == 0 {
		fe = append(fe,
			httpx.FieldError{Field: "latitude", Code: "required", Message: "latitude is required."},
			httpx.FieldError{Field: "longitude", Code: "required", Message: "longitude is required."})
	}
	if len(fe) > 0 {
		invalid(w, r, fe)
		return
	}

	start := time.Now()
	addr, err := h.provider.Reverse(r.Context(), p)
	h.answerAddress(w, r, "reverseGeocode", addr, err, start)
}

// answerAddress writes the result of Place or Reverse.
func (h *Handler) answerAddress(w http.ResponseWriter, r *http.Request, op string, addr contract.GeocodedAddress, err error, start time.Time) {
	switch {
	case errors.Is(err, ErrNoMatch):
		h.done(r, op, 0, start)
		httpx.Fail(w, r, http.StatusNotFound, codeNoMatch,
			"No Canadian address was found for this place. Search again, move the pin, or type the address.", nil)
	case err != nil:
		h.unavailable(w, r, op, err, start)
	default:
		h.done(r, op, 1, start)
		respond(w, r, addr)
	}
}

// allow counts the request against the account's budget for name and answers
// 429 when it is spent. It returns false when it has answered.
func (h *Handler) allow(w http.ResponseWriter, r *http.Request, name string, limit int64) bool {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required for this operation.", nil)
		return false
	}
	if h.limiter == nil {
		return true
	}
	ok, retry, err := h.limiter.Allow(r.Context(), name, "account:"+p.AccountID, limit, geoWindow)
	if err != nil {
		// The limiter in cmd/hg falls back to local counting and does not
		// return an error; a custom one that does must not lock customers out
		// of entering an address.
		h.log.Warn("geo rate limiter unavailable; allowing the request",
			slog.String("limit", name), slog.String("error", err.Error()))
		return true
	}
	if ok {
		return true
	}
	secs := int(math.Ceil(retry.Seconds()))
	if secs < 1 {
		secs = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(secs))
	w.Header().Set("RateLimit-Limit", strconv.FormatInt(limit, 10))
	w.Header().Set("RateLimit-Remaining", "0")
	w.Header().Set("RateLimit-Reset", strconv.Itoa(secs))
	httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
		"Too many address searches. Wait a moment, or type the address.", nil)
	return false
}

// unavailable answers 503 GEOCODER_UNAVAILABLE and logs why, without the
// address, the query or the token.
func (h *Handler) unavailable(w http.ResponseWriter, r *http.Request, op string, err error, start time.Time) {
	h.log.WarnContext(r.Context(), "geocoder unavailable",
		slog.String("op", op), slog.String("provider", h.provider.Name()),
		slog.Int64("ms", time.Since(start).Milliseconds()), slog.String("error", err.Error()))
	httpx.Fail(w, r, http.StatusServiceUnavailable, codeGeocoderDown,
		"Address search is not available right now. Enter the address by hand or use the map pin.", nil)
}

// done logs one served call: the operation, the provider (so a fake is always
// visible), how many results and how long. Never the query or an address.
func (h *Handler) done(r *http.Request, op string, results int, start time.Time, extra ...slog.Attr) {
	attrs := append([]slog.Attr{
		slog.String("op", op), slog.String("provider", h.provider.Name()),
		slog.Int("results", results), slog.Int64("ms", time.Since(start).Milliseconds()),
	}, extra...)
	h.log.LogAttrs(r.Context(), slog.LevelInfo, "geo request", attrs...)
}

// respond writes a 200 {"data": …}. Results are never cacheable: suggestions
// are temporary provider results that may not be stored, and the others belong
// to the signed-in caller's search.
func respond(w http.ResponseWriter, r *http.Request, data any) {
	w.Header().Set("Cache-Control", "no-store")
	httpx.Respond(w, r, http.StatusOK, data)
}

func invalid(w http.ResponseWriter, r *http.Request, fe []httpx.FieldError) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
		"The request failed validation.", fe)
}

// sessionToken reads the required session_token query parameter, a UUID.
func sessionToken(q url.Values) (string, *httpx.FieldError) {
	raw := strings.TrimSpace(q.Get("session_token"))
	if raw == "" {
		return "", &httpx.FieldError{Field: "session_token", Code: "required", Message: "session_token is required."}
	}
	if _, err := uuid.Parse(raw); err != nil {
		return "", &httpx.FieldError{Field: "session_token", Code: "invalid", Message: "session_token must be a UUID."}
	}
	return raw, nil
}

// optionalPoint reads latitude and longitude. They come together or not at
// all: present is true when both are valid, and one alone or a bad value is a
// field error.
func optionalPoint(q url.Values) (p Point, present bool, fe []httpx.FieldError) {
	rawLat, rawLng := strings.TrimSpace(q.Get("latitude")), strings.TrimSpace(q.Get("longitude"))
	if rawLat == "" && rawLng == "" {
		return Point{}, false, nil
	}
	lat, latOK := parseCoord(rawLat, 90)
	lng, lngOK := parseCoord(rawLng, 180)
	if rawLat == "" {
		fe = append(fe, httpx.FieldError{Field: "latitude", Code: "required", Message: "Send latitude together with longitude."})
	} else if !latOK {
		fe = append(fe, httpx.FieldError{Field: "latitude", Code: "invalid", Message: "latitude must be a number from -90 to 90."})
	}
	if rawLng == "" {
		fe = append(fe, httpx.FieldError{Field: "longitude", Code: "required", Message: "Send longitude together with latitude."})
	} else if !lngOK {
		fe = append(fe, httpx.FieldError{Field: "longitude", Code: "invalid", Message: "longitude must be a number from -180 to 180."})
	}
	if len(fe) > 0 {
		return Point{}, false, fe
	}
	return Point{Latitude: lat, Longitude: lng}, true, nil
}

// parseCoord parses a finite number within ±limit.
func parseCoord(s string, limit float64) (float64, bool) {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < -limit || v > limit {
		return 0, false
	}
	return v, true
}
