// Package geo serves the address search behind the location picker:
// suggestAddresses (GET /v1/geo/autocomplete), getPlaceAddress
// (GET /v1/geo/places/{placeId}) and reverseGeocode (GET /v1/geo/reverse).
//
// The server forwards each call to Mapbox with a secret token that never
// reaches a client (docs/decisions/README.md, "Where map address search comes
// from"). The Provider interface is the seam: MapboxProvider is the real one;
// FakeProvider is a deterministic stand-in for local, dev and test runs that
// have no token, and the API refuses to start in production without one
// (internal/config).
//
// Suggestions are temporary Mapbox results, which Mapbox's terms do not allow
// to be stored or cached, so nothing here is cached, not even in Redis. The
// address a user saves comes from getPlaceAddress or reverseGeocode, which ask
// Mapbox for a permanent result.
//
// Contract: contracts/openapi.yaml, tag "geo".
package geo
