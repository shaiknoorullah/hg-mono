package main

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/geo"
)

// newGeoProvider picks the address-search provider. With a token it is Mapbox.
// Without one it is the fake outside production, and in production the
// "unavailable" provider: the API still boots and the three geo routes answer
// 503 GEOCODER_UNAVAILABLE until HG_MAPBOX_SECRET_TOKEN is set. Production
// never gets the fake: config.Load refuses HG_GEO_PROVIDER=fake there, and this
// function ignores the configured name and returns "unavailable" for any
// production run without a token.
func newGeoProvider(cfg *config.Config, log *slog.Logger) geo.Provider {
	if cfg.Geo.Configured() {
		log.Info("geo provider: mapbox")
		return geo.NewMapbox(cfg.Geo.MapboxToken, nil)
	}
	if cfg.Env == config.EnvProduction {
		log.Error("geo provider: address search is unavailable until HG_MAPBOX_SECRET_TOKEN is set; " +
			"the geo routes answer 503 GEOCODER_UNAVAILABLE")
		return geo.NewUnavailable()
	}
	log.Warn("geo provider: FAKE geocoder (HG_MAPBOX_SECRET_TOKEN unset) - address search answers from a built-in Toronto catalogue, never real places")
	return geo.NewFake()
}

// geoLimiter implements geo.Limiter over auth's Redis fixed-window limiter. A
// flush of Redis grants one fresh window and costs nothing else. While Redis
// cannot answer, each replica counts in its own memory (auth.FallBackLocally),
// so the cap on a paid provider keeps holding instead of vanishing with Redis.
type geoLimiter struct{ rl *auth.RateLimiter }

func (l geoLimiter) Allow(ctx context.Context, name, subject string, limit int64, window time.Duration) (bool, time.Duration, error) {
	err := l.rl.Allow(ctx, auth.Limit{
		Name: name, Subject: subject, Max: limit, Window: window, OnUnavailable: auth.FallBackLocally,
	})
	var limited *auth.RateLimitedError
	switch {
	case err == nil:
		return true, 0, nil
	case errors.As(err, &limited):
		return false, limited.RetryAfter, nil
	default:
		return false, 0, err
	}
}
