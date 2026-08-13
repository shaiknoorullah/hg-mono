package restaurant

// testhelpers.go exposes internal helpers for the _test package.
// It is compiled into every build (not only test builds) but only exports
// functions that unit / integration tests need to inject context values that
// are normally set by middleware.

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// WithChiParamForTest injects a chi URL parameter into the request context,
// mirroring what chi does after routing. Tests that call handlers directly
// need this because chi.URLParam reads from the context, and a bare
// httptest.NewRequest has no chi context.
func WithChiParamForTest(r *http.Request, key, val string) *http.Request {
	rctx := chi.RouteContext(r.Context())
	if rctx == nil {
		rctx = chi.NewRouteContext()
	}
	rctx.URLParams.Add(key, val)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}
