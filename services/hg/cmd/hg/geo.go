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

// newGeoProvider picks the address-search provider. config.Load has already
// refused production without a Mapbox token and refused the fake there; the
// check here is the same rule once more, so a change to the config rules
// cannot put the fake in front of customers without this failing too.
func newGeoProvider(cfg *config.Config, log *slog.Logger) (geo.Provider, error) {
	if cfg.Geo.Configured() {
		log.Info("geo provider: mapbox")
		return geo.NewMapbox(cfg.Geo.MapboxToken, nil), nil
	}
	if cfg.Env == config.EnvProduction {
		return nil, errors.New("geo: no Mapbox token in production (HG_MAPBOX_SECRET_TOKEN); the fake geocoder is not allowed there")
	}
	log.Warn("geo provider: FAKE geocoder (HG_MAPBOX_SECRET_TOKEN unset) - address search answers from a built-in Toronto catalogue, never real places")
	return geo.NewFake(), nil
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
