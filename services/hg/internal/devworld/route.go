package devworld

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Seeded door and the nearby customer pin from migrations/devworld.
// The pickup leg ends on the door so an arrival is inside the dispatch geofence.
var (
	restaurantPoint = routePoint{Lat: 43.6815, Lng: -79.3310}
	customerPoint   = routePoint{Lat: 43.6825, Lng: -79.3300}
	shortStart      = routePoint{Lat: 43.6842, Lng: -79.3310}
	longStart       = routePoint{Lat: 43.6815, Lng: -79.3460}
	longBend        = routePoint{Lat: 43.6760, Lng: -79.3390}
)

type routePoint struct {
	Lat float64
	Lng float64
}

// stepWait is the gap between position posts. The rider app posts about every
// 5 seconds. max skips the wait so a local run can finish without watching.
func stepWait(speed string) time.Duration {
	switch speed {
	case "max":
		return 0
	case "4x":
		return 1250 * time.Millisecond
	default:
		return 5 * time.Second
	}
}

// pickupLeg is the path from a point near the restaurant to its door.
// A directions response is used only when a token is set. Any failure, including
// an empty token, falls back to straight segments so the default needs no network.
func pickupLeg(ctx context.Context, kind, token string, client *http.Client) ([]routePoint, string) {
	straight := straightPickup(kind)
	token = strings.TrimSpace(token)
	if token == "" || client == nil {
		return straight, "straight"
	}
	via := []routePoint{approachStart(kind), restaurantPoint}
	if kind == "long" {
		via = []routePoint{longStart, longBend, restaurantPoint}
	}
	got, err := mapboxLine(ctx, client, token, via)
	if err != nil || len(got) < 2 {
		return straight, "straight"
	}
	got[len(got)-1] = restaurantPoint
	return got, "mapbox"
}

func mapToken() string {
	if v := strings.TrimSpace(os.Getenv("MAPBOX_TOKEN")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("HG_MAPBOX_TOKEN"))
}

func approachStart(kind string) routePoint {
	if kind == "long" {
		return longStart
	}
	return shortStart
}

func straightPickup(kind string) []routePoint {
	if kind == "long" {
		return joinLegs(interpolate(longStart, longBend, 6), interpolate(longBend, restaurantPoint, 6))
	}
	return interpolate(shortStart, restaurantPoint, 6)
}

func joinLegs(a, b []routePoint) []routePoint {
	if len(b) == 0 {
		return a
	}
	if len(a) == 0 {
		return b
	}
	return append(a, b[1:]...)
}

// interpolate returns n points including both ends. n below 2 yields the two ends.
func interpolate(a, b routePoint, n int) []routePoint {
	if n < 2 {
		n = 2
	}
	out := make([]routePoint, n)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(n-1)
		out[i] = routePoint{
			Lat: a.Lat + (b.Lat-a.Lat)*t,
			Lng: a.Lng + (b.Lng-a.Lng)*t,
		}
	}
	out[0] = a
	out[n-1] = b
	return out
}

func headingDeg(a, b routePoint) float64 {
	deg := math.Atan2(b.Lng-a.Lng, b.Lat-a.Lat) * 180 / math.Pi
	if deg < 0 {
		deg += 360
	}
	return deg
}

func mapboxLine(ctx context.Context, client *http.Client, token string, via []routePoint) ([]routePoint, error) {
	parts := make([]string, len(via))
	for i, p := range via {
		parts[i] = fmt.Sprintf("%.6f,%.6f", p.Lng, p.Lat)
	}
	q := url.Values{}
	q.Set("geometries", "geojson")
	q.Set("overview", "full")
	q.Set("access_token", token)
	endpoint := "https://api.mapbox.com/directions/v5/mapbox/driving/" + strings.Join(parts, ";") + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("directions http %d", res.StatusCode)
	}
	var body struct {
		Routes []struct {
			Geometry struct {
				Coordinates [][]float64 `json:"coordinates"`
			} `json:"geometry"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		return nil, err
	}
	if len(body.Routes) == 0 {
		return nil, fmt.Errorf("directions returned no route")
	}
	coords := body.Routes[0].Geometry.Coordinates
	limit := 8
	if len(via) > 2 {
		limit = 16
	}
	return sampleCoords(coords, limit), nil
}

func sampleCoords(coords [][]float64, limit int) []routePoint {
	var raw []routePoint
	for _, c := range coords {
		if len(c) < 2 {
			continue
		}
		raw = append(raw, routePoint{Lng: c[0], Lat: c[1]})
	}
	if len(raw) == 0 || limit < 2 || len(raw) <= limit {
		return raw
	}
	out := make([]routePoint, limit)
	for i := 0; i < limit; i++ {
		idx := int(math.Round(float64(i) * float64(len(raw)-1) / float64(limit-1)))
		out[i] = raw[idx]
	}
	out[0] = raw[0]
	out[limit-1] = raw[len(raw)-1]
	return out
}
