package httpx

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"time"
)

// Middleware is the standard net/http decorator shape.
type Middleware func(http.Handler) http.Handler

// responseRecorder captures status and byte count for the access log without
// buffering the body.
type responseRecorder struct {
	http.ResponseWriter
	status  int
	written int64
}

func (rr *responseRecorder) WriteHeader(status int) {
	if rr.status == 0 {
		rr.status = status
		rr.ResponseWriter.WriteHeader(status)
	}
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	if rr.status == 0 {
		rr.status = http.StatusOK
	}
	n, err := rr.ResponseWriter.Write(b)
	rr.written += int64(n)
	return n, err
}

func (rr *responseRecorder) Unwrap() http.ResponseWriter { return rr.ResponseWriter }

// RequestID is stage 1 of the P-06 chain. It adopts a well-formed inbound
// X-Request-ID (so a request keeps one identity across Traefik and any future
// internal hop) and mints a fresh ULID otherwise. A client-supplied value that
// is not a ULID is discarded rather than trusted into the logs.
func RequestID() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := strings.TrimSpace(r.Header.Get("X-Request-ID"))
			if !validULID(id) {
				id = NewULID()
			}
			w.Header().Set("X-Request-ID", id)
			next.ServeHTTP(w, r.WithContext(withRequestID(r.Context(), id)))
		})
	}
}

// Recover is stage 2. A panic becomes a 500 with the stack in the log and never
// a dropped connection.
func Recover(log *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				log.ErrorContext(r.Context(), "panic recovered",
					slog.String("request_id", RequestIDFrom(r.Context())),
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Any("panic", rec),
					slog.String("stack", string(debug.Stack())))
				Fail(w, r, http.StatusInternalServerError, CodeInternalError,
					"The server failed to process this request.", nil)
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// AccessLog is stage 4: one structured line per request.
//
// It logs the *route pattern*, not the raw path, so identifiers do not become
// unbounded log cardinality, and it never logs the query string or any header
// that can carry a credential.
func AccessLog(log *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rr := &responseRecorder{ResponseWriter: w}
			next.ServeHTTP(rr, r)

			if rr.status == 0 {
				rr.status = http.StatusOK
			}
			attrs := []any{
				slog.String("request_id", RequestIDFrom(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rr.status),
				slog.Int64("bytes", rr.written),
				slog.Float64("duration_ms", float64(time.Since(start).Microseconds())/1000),
				slog.String("remote_ip", clientIP(r)),
			}
			if ri, ok := RouteFrom(r.Context()); ok {
				attrs = append(attrs,
					slog.String("route", ri.Pattern),
					slog.String("class", string(ri.Policy.Class)))
				if ri.Policy.OperationID != "" {
					attrs = append(attrs, slog.String("operation_id", ri.Policy.OperationID))
				}
			}
			if p := PrincipalFrom(r.Context()); !p.Anonymous {
				attrs = append(attrs, slog.String("account_id", p.AccountID))
			}

			level := slog.LevelInfo
			switch {
			case rr.status >= 500:
				level = slog.LevelError
			case rr.status >= 400:
				level = slog.LevelWarn
			}
			log.LogAttrs(r.Context(), level, "http request", toAttrs(attrs)...)
		})
	}
}

func toAttrs(vals []any) []slog.Attr {
	out := make([]slog.Attr, 0, len(vals))
	for _, v := range vals {
		if a, ok := v.(slog.Attr); ok {
			out = append(out, a)
		}
	}
	return out
}

func clientIP(r *http.Request) string {
	// TODO(P-06 stage 3): trust X-Forwarded-For only when the peer is Traefik's
	// IP. Until that allowlist is configured, report the direct peer, which
	// cannot be spoofed.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// CORS is stage 8: an exact-origin allowlist, credentials allowed, never a
// wildcard (I-06.5). A preflight from a disallowed origin gets no
// Access-Control-Allow-Origin header at all.
//
// Preflight is answered here, before the guard, because an OPTIONS request
// carries no credentials and matches no registered route.
func CORS(allowed []string) Middleware {
	allowSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowSet[strings.ToLower(strings.TrimSuffix(o, "/"))] = struct{}{}
	}
	const allowHeaders = "Authorization, Content-Type, Idempotency-Key, X-Request-ID, X-HG-Client, X-HG-CSRF"
	const exposeHeaders = "X-Request-ID, Idempotency-Replayed, Retry-After"

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.TrimSpace(r.Header.Get("Origin"))
			_, ok := allowSet[strings.ToLower(strings.TrimSuffix(origin, "/"))]

			if origin != "" && ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Expose-Headers", exposeHeaders)
				w.Header().Add("Vary", "Origin")
			}

			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				if !ok {
					// No CORS headers, and nothing routed. The browser blocks it.
					w.WriteHeader(http.StatusForbidden)
					return
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", allowHeaders)
				w.Header().Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Timeout is stage 5: a context deadline chosen by the route's RateClass.
func Timeout() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ri, ok := RouteFrom(r.Context())
			if !ok {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), ri.Policy.Class.Timeout())
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// BodyLimit is stage 6: Policy.MaxBody, defaulting by class.
func BodyLimit() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ri, ok := RouteFrom(r.Context())
			if !ok || r.Body == nil {
				next.ServeHTTP(w, r)
				return
			}
			limit := ri.Policy.maxBody()
			if n, err := strconv.ParseInt(r.Header.Get("Content-Length"), 10, 64); err == nil && n > limit {
				Fail(w, r, http.StatusRequestEntityTooLarge, CodePayloadTooLarge,
					"Request body exceeds the limit for this operation.", map[string]any{"max_bytes": limit})
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r)
		})
	}
}

// Authenticate is stage 10. It never rejects for being anonymous; it rejects
// only a malformed or revoked credential.
func Authenticate(a Authenticator) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, err := a.Authenticate(r.Context(), r)
			if err != nil {
				Fail(w, r, http.StatusUnauthorized, CodeAuthenticationRequired,
					"The credential presented is malformed or has been revoked.", nil)
				return
			}
			next.ServeHTTP(w, r.WithContext(withPrincipal(r.Context(), p)))
		})
	}
}

// Guard is stage 11 and the load-bearing half of G-4: **deny by default**.
//
// The decision table, in order:
//
//  1. No route resolved     → 404 NOT_FOUND. The handler is never entered and
//     existence is not leaked (the 404-vs-403 rule).
//  2. Route resolved but no registered Policy → 500. This is unreachable through
//     Router.Handle and means someone bypassed the registry; it fails closed and
//     loudly rather than serving an unguarded handler.
//  3. Policy.Public          → pass. This is the *only* way through unauthenticated.
//  4. Anonymous principal    → 401 AUTHENTICATION_REQUIRED.
//  5. Role lacks the action  → 403 FORBIDDEN, naming the required action.
//  6. Otherwise              → pass.
//
// Note what is *not* here: no allowlist of "obviously public" prefixes, no
// "skip auth for GET", no environment check. A route is public because its
// registration says so, and for no other reason.
func Guard(az Authorizer) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ri, ok := RouteFrom(r.Context())
			if !ok {
				if methodMismatch(r.Context()) {
					Fail(w, r, http.StatusMethodNotAllowed, CodeMethodNotAllowed,
						"That method is not allowed on this resource.", nil)
					return
				}
				Fail(w, r, http.StatusNotFound, CodeNotFound,
					"No such resource.", nil)
				return
			}
			if ri.Policy.Action == "" && !ri.Policy.Public {
				// Defence in depth: Router.Verify already refuses to boot on
				// this, so reaching here means the mux was written to directly.
				slog.ErrorContext(r.Context(), "route reached the guard without a policy — denied",
					slog.String("request_id", RequestIDFrom(r.Context())),
					slog.String("route", ri.Pattern),
					slog.String("method", ri.Method))
				Fail(w, r, http.StatusInternalServerError, CodeInternalError,
					"This route is not registered with an authorization policy.", nil)
				return
			}
			if ri.Policy.Public {
				next.ServeHTTP(w, r)
				return
			}

			p := PrincipalFrom(r.Context())
			if p.Anonymous {
				Fail(w, r, http.StatusUnauthorized, CodeAuthenticationRequired,
					"Authentication is required for this operation.", nil)
				return
			}
			if !az.RoleHasAction(p.Roles, ri.Policy.Action) {
				Fail(w, r, http.StatusForbidden, CodeForbidden,
					"You do not have permission to perform this action.",
					map[string]any{"required": string(ri.Policy.Action)})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// IdempotencyKey is stage 12, extraction half only.
//
// For a route registered Idempotent (which is every MONEY-class route, enforced
// at boot), it requires a client-generated UUID/ULID of 16–128 characters and
// puts it in the context. The claim/replay transaction against
// idempotency_record is deliberately *not* here: P-37 requires the record to
// commit in the same transaction as the business effect, so it belongs in the
// store, not in a middleware that has no transaction.
//
// TODO(orders/payments siblings): implement the claim/replay per P-37 and call
// it from the handler's transaction; then extend this to emit the
// Idempotency-Replayed header.
func IdempotencyKey() Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ri, ok := RouteFrom(r.Context())
			if !ok || !ri.Policy.Idempotent {
				next.ServeHTTP(w, r)
				return
			}
			key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
			if key == "" {
				Fail(w, r, http.StatusBadRequest, CodeIdempotencyKeyRequired,
					"This operation requires an Idempotency-Key header.", nil)
				return
			}
			if len(key) < 8 || len(key) > 128 {
				Fail(w, r, http.StatusBadRequest, CodeIdempotencyKeyRequired,
					"Idempotency-Key must be between 8 and 128 characters.",
					[]FieldError{{Field: "Idempotency-Key", Code: "length", Message: "must be 8–128 characters"}})
				return
			}
			next.ServeHTTP(w, r.WithContext(withIdempotencyKey(r.Context(), key)))
		})
	}
}

type idempotencyKeyCtx struct{}

func withIdempotencyKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, idempotencyKeyCtx{}, key)
}

// IdempotencyKeyFrom returns the validated Idempotency-Key for this request, if
// the route required one.
func IdempotencyKeyFrom(ctx context.Context) (string, bool) {
	k, ok := ctx.Value(idempotencyKeyCtx{}).(string)
	return k, ok
}
