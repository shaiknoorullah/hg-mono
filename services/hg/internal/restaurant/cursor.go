package restaurant

// Keyset cursor encoding for listRestaurantStaff (G-6: keyset, never OFFSET).
// Mirrors admin's cursor.go exactly; kept local because the two packages must
// not import each other's unexported helpers.

import (
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

const staffCursorSep = "\x1f"

func encodeStaffCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + staffCursorSep + id))
}

// decodeStaffCursor reads ?cursor= as (time, id). ok is false only for a
// malformed value; an absent cursor returns (nil, nil, true).
func decodeStaffCursor(r *http.Request) (*time.Time, *string, bool) {
	raw := r.URL.Query().Get("cursor")
	if raw == "" {
		return nil, nil, true
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, nil, false
	}
	parts := strings.SplitN(string(b), staffCursorSep, 2)
	if len(parts) != 2 {
		return nil, nil, false
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, nil, false
	}
	return &t, &parts[1], true
}

// tsPtr converts a nullable time.Time into a nullable contract Timestamp string.
func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := httpx.Timestamp(*t)
	return &s
}

// ptrString returns a pointer to s.
func ptrString(s string) *string { return &s }
