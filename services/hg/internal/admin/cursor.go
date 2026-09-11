package admin

import (
	"encoding/base64"
	"net/http"
	"strings"
	"time"
)

// Keyset cursor encoding (G-6: keyset, never OFFSET). The cursor is an opaque
// base64 of "sortValue\x1fid"; callers never construct or parse it by hand.

const cursorSep = "\x1f"

// encodeCursor builds an opaque cursor from a string sort value and an id.
func encodeCursor(sortValue, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(sortValue + cursorSep + id))
}

// encodeTimeCursor builds a cursor from a timestamp and an id.
func encodeTimeCursor(t time.Time, id string) string {
	return encodeCursor(t.UTC().Format(time.RFC3339Nano), id)
}

// decodeCursor reads ?cursor= as (sortValue, id). ok is false only for a
// malformed value; an absent cursor returns (nil, nil, true).
func decodeCursor(r *http.Request) (*string, *string, bool) {
	raw := r.URL.Query().Get("cursor")
	if raw == "" {
		return nil, nil, true
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, nil, false
	}
	parts := strings.SplitN(string(b), cursorSep, 2)
	if len(parts) != 2 {
		return nil, nil, false
	}
	return &parts[0], &parts[1], true
}

// decodeTimeCursor reads ?cursor= as (time, id).
func decodeTimeCursor(r *http.Request) (*time.Time, *string, bool) {
	sv, id, ok := decodeCursor(r)
	if !ok {
		return nil, nil, false
	}
	if sv == nil {
		return nil, nil, true
	}
	t, err := time.Parse(time.RFC3339Nano, *sv)
	if err != nil {
		return nil, nil, false
	}
	return &t, id, true
}

// splitCSV splits a form-style array query value (style: form, explode: false).
func splitCSV(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}
