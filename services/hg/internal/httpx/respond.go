package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// envelope is G-6 made into a type. There is exactly one 2xx shape and exactly
// one non-2xx shape, and they are disjoint: a body carrying "error" can never
// ship with a 2xx status because Fail sets both together.
//
// Data has NO omitempty: the 2xx response schemas declare `required: [data]`
// even where the payload is nullable (e.g. getActiveOrder, getCurrentOffer,
// takeNext*), so a `data:null` result must serialise as `{"data":null}`, never
// as `{}`. omitempty would drop the required field and produce a body the
// contract rejects.
type envelope struct {
	Data any   `json:"data"`
	Meta *Meta `json:"meta,omitempty"`
}

// Meta is the keyset pagination envelope. There is no page, no offset and no
// total_pages anywhere in the contract.
type Meta struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
	Total      *int64  `json:"total,omitempty"`
}

type errEnvelope struct {
	Error errBody `json:"error"`
}

type errBody struct {
	Code      ErrorCode `json:"code"`
	Message   string    `json:"message"`
	Details   any       `json:"details,omitempty"`
	RequestID string    `json:"request_id"`
}

// Respond writes a 2xx {"data": …} body. data must not be a bare array or a bare
// scalar at the top level — I-36.3 — which the envelope enforces structurally.
func Respond(w http.ResponseWriter, r *http.Request, status int, data any) {
	writeJSON(w, r, status, envelope{Data: data})
}

// RespondList writes a 2xx {"data": …, "meta": …} body for a paginated collection.
func RespondList(w http.ResponseWriter, r *http.Request, status int, data any, meta Meta) {
	writeJSON(w, r, status, envelope{Data: data, Meta: &meta})
}

// Fail writes the single error envelope. The status and the body always agree.
func Fail(w http.ResponseWriter, r *http.Request, status int, code ErrorCode, message string, details any) {
	rid := RequestIDFrom(r.Context())
	writeJSON(w, r, status, errEnvelope{Error: errBody{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: rid,
	}})
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	if rid := RequestIDFrom(r.Context()); rid != "" {
		w.Header().Set("X-Request-ID", rid)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	buf, err := json.Marshal(body)
	if err != nil {
		// Marshalling our own response failed: the handler returned something
		// unserialisable. Say so honestly rather than emitting a broken body.
		slog.ErrorContext(r.Context(), "response marshal failed",
			slog.String("request_id", RequestIDFrom(r.Context())),
			slog.String("error", err.Error()))
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Response could not be serialised","request_id":"` +
			RequestIDFrom(r.Context()) + `"}}`))
		return
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(buf)
	}
}

// Timestamp renders a time as the contract's Timestamp scalar: RFC3339 with
// milliseconds, UTC, Z-suffixed (G-9). Every API timestamp goes through here.
func Timestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

type requestIDKey struct{}

func withRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestIDFrom returns the ULID correlating this request with the access log,
// the audit trail and the X-Request-ID response header.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}
