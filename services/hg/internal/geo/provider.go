package geo

import (
	"context"
	"errors"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// Errors a Provider returns. Anything else is an unexpected failure and the
// handler treats it like ErrUnavailable: address entry must stay possible by
// hand, so the client falls back to the manual form on a 503.
var (
	// ErrNoMatch means the provider found nothing: no result for the place id,
	// no Canadian address near the pin. The handler answers 404 GEOCODE_NO_MATCH.
	ErrNoMatch = errors.New("geo: no match")
	// ErrUnavailable means the provider timed out, refused our key or failed.
	// The handler answers 503 GEOCODER_UNAVAILABLE.
	ErrUnavailable = errors.New("geo: provider unavailable")
)

// Point is a WGS84 position.
type Point struct {
	Latitude  float64
	Longitude float64
}

// SuggestRequest is one search-as-you-type call.
type SuggestRequest struct {
	// Query is the trimmed text the user typed, 1 to 256 characters.
	Query string
	// Bias ranks results towards this point. Always set: the handler falls
	// back to the platform's default map centre.
	Bias Point
	// BiasFromClient is true when the client sent the point, so distance_m is
	// reported; false when the handler chose the bias itself, so distance_m is
	// null ("null when the request sent no location").
	BiasFromClient bool
	// SessionToken is the client's search session. Mapbox Geocoding has no
	// sessions, so it is not forwarded; it is validated and kept for a provider
	// that bills per session.
	SessionToken string
}

// Provider turns text and pins into Canadian addresses. Implementations must
// return only Canadian results (country "CA") and must be safe for concurrent
// use.
type Provider interface {
	// Name is "mapbox" or "fake". It is logged with every call.
	Name() string
	// Suggest returns up to 5 suggestions, best first, with no coordinates.
	// No match is an empty slice, not an error.
	Suggest(ctx context.Context, req SuggestRequest) ([]contract.AddressSuggestion, error)
	// Place resolves a place_id a Suggest call returned. ErrNoMatch when the
	// id is not recognised or resolves outside Canada.
	Place(ctx context.Context, placeID string) (contract.GeocodedAddress, error)
	// Reverse returns the nearest Canadian address to the pin, or ErrNoMatch.
	Reverse(ctx context.Context, p Point) (contract.GeocodedAddress, error)
}
