package devworld

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Phone sign-in is limited to five code requests per number per 15 minutes
// (auth: rl:otp:phone). Scenarios sign amina, nour and rider-sim in on every
// run, so a few scenarios in a row would be refused. A phone persona's access
// token is therefore kept in the user's cache directory, one file per API,
// client surface and number, and reused while the API still accepts it. Only
// for an API on this machine (AllowAPI); a token for any other API is never
// written or read.

func sessionCachePath(base, surface, phone string) string {
	if AllowAPI(base) != nil {
		return ""
	}
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(strings.TrimRight(base, "/") + "|" + surface + "|" + phone))
	return filepath.Join(dir, "hg-devworld", "session-"+hex.EncodeToString(sum[:8]))
}

// reuseSession loads a cached token for phone and keeps it when the API still
// answers getMe with it.
func (c *apiClient) reuseSession(ctx context.Context, phone string) bool {
	path := sessionCachePath(c.base, c.surface, phone)
	if path == "" {
		return false
	}
	raw, err := os.ReadFile(path)
	token := strings.TrimSpace(string(raw))
	if err != nil || token == "" {
		return false
	}
	c.token = token
	if status, _, err := c.call(ctx, http.MethodGet, "/v1/auth/me", nil, false); err != nil || status != http.StatusOK {
		c.token = ""
		_ = os.Remove(path)
		return false
	}
	return true
}

func (c *apiClient) saveSession(phone string) {
	path := sessionCachePath(c.base, c.surface, phone)
	if path == "" || c.token == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return
	}
	_ = os.WriteFile(path, []byte(c.token), 0o600)
}
