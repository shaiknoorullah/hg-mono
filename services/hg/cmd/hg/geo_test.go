package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// The fake geocoder serves only where there is no Mapbox token and the
// environment is not production; production without a token gets the provider
// that answers 503, whatever name the config carries.
func TestNewGeoProviderSelection(t *testing.T) {
	cases := []struct {
		name     string
		env      config.Environment
		geo      config.Geo
		wantName string
	}{
		{"local without a token gets the fake", config.EnvLocal, config.Geo{Provider: "fake"}, "fake"},
		{"staging without a token gets the fake", config.EnvStaging, config.Geo{Provider: "fake"}, "fake"},
		{"a token gets mapbox", config.EnvStaging, config.Geo{Provider: "mapbox", MapboxToken: "sk.not-a-real-token"}, "mapbox"},
		{"production with a token gets mapbox", config.EnvProduction, config.Geo{Provider: "mapbox", MapboxToken: "sk.not-a-real-token"}, "mapbox"},
		{"production without a token is unavailable", config.EnvProduction, config.Geo{Provider: "unavailable"}, "unavailable"},
		{"production never gets the fake", config.EnvProduction, config.Geo{Provider: "fake"}, "unavailable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := newGeoProvider(&config.Config{Env: tc.env, Geo: tc.geo}, quietLog())
			if p.Name() != tc.wantName {
				t.Errorf("provider = %q, want %q", p.Name(), tc.wantName)
			}
		})
	}
}

// The limiter reports the wait, and counts accounts and names apart.
func TestGeoLimiterCountsPerAccountAndName(t *testing.T) {
	l := geoLimiter{auth.NewMemoryRateLimiter()}
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if ok, _, err := l.Allow(ctx, "geo_place", "account:a", 2, time.Minute); !ok || err != nil {
			t.Fatalf("request %d: ok = %v, err = %v; want allowed", i+1, ok, err)
		}
	}
	ok, retry, err := l.Allow(ctx, "geo_place", "account:a", 2, time.Minute)
	if ok || err != nil || retry <= 0 || retry > time.Minute {
		t.Fatalf("third request: ok = %v, retry = %v, err = %v; want refused with a wait", ok, retry, err)
	}
	if ok, _, _ := l.Allow(ctx, "geo_place", "account:b", 2, time.Minute); !ok {
		t.Error("another account shares the first account's budget")
	}
	if ok, _, _ := l.Allow(ctx, "geo_reverse", "account:a", 2, time.Minute); !ok {
		t.Error("reverseGeocode shares getPlaceAddress's budget; the contract counts them apart")
	}
}
