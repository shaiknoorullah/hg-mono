package system

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// getPublicConfig reports the platform-wide pause on new orders as it stands
// (https://github.com/shaiknoorullah/hg-mono/issues/244), and never claims
// ordering is open when it could not read the switch.
func TestPublicConfigReportsTheOrderingPause(t *testing.T) {
	since := time.Date(2026, 10, 4, 17, 30, 0, 0, time.UTC)
	cfg := &config.Config{Env: config.EnvLocal}

	get := func(h *Handler) (int, map[string]any) {
		t.Helper()
		rec := httptest.NewRecorder()
		h.PublicConfig(rec, httptest.NewRequest(http.MethodGet, "/v1/config/public", nil))
		var env struct {
			Data map[string]any `json:"data"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		ordering, _ := env.Data["ordering"].(map[string]any)
		return rec.Code, ordering
	}

	paused := NewHandler(cfg, nil, since, nil).WithOrderingStatus(
		func(context.Context) (bool, *time.Time, error) { return true, &since, nil })
	if status, ordering := get(paused); status != http.StatusOK ||
		ordering["paused"] != true || ordering["paused_since"] != "2026-10-04T17:30:00.000Z" {
		t.Errorf("paused: %d %v, want 200 with paused since 2026-10-04T17:30:00.000Z", status, ordering)
	}

	open := NewHandler(cfg, nil, since, nil).WithOrderingStatus(
		func(context.Context) (bool, *time.Time, error) { return false, nil, nil })
	if status, ordering := get(open); status != http.StatusOK ||
		ordering["paused"] != false || ordering["paused_since"] != nil {
		t.Errorf("open: %d %v, want 200 with paused false and paused_since null", status, ordering)
	}

	broken := NewHandler(cfg, nil, since, nil).WithOrderingStatus(
		func(context.Context) (bool, *time.Time, error) { return false, nil, errors.New("database down") })
	if status, _ := get(broken); status != http.StatusInternalServerError {
		t.Errorf("unreadable switch: %d, want 500, never a guess", status)
	}
	if status, _ := get(NewHandler(cfg, nil, since, nil)); status != http.StatusInternalServerError {
		t.Errorf("no reader wired: %d, want 500, never a guess", status)
	}
}
