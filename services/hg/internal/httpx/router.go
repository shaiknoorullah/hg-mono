package httpx

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
)

// Router is the only way to register an HTTP route in this service.
//
// It wraps chi but does not expose it. Handle *requires* a Policy, Verify fails
// the boot on an incoherent one (I-06.1), and ServeHTTP resolves the policy
// **before** the middleware chain runs, so the guard can deny anything that has
// no registered policy — including a handler someone attached to the mux by
// another path.
type Router struct {
	mux    *chi.Mux
	log    *slog.Logger
	env    string
	global []Middleware

	mu     sync.RWMutex
	routes map[routeKey]Policy
	built  http.Handler
}

type routeKey struct {
	method  string
	pattern string
}

// Options configures a Router.
type Options struct {
	Logger *slog.Logger
	// Env is the HG_ENV value. LocalOnly routes may be registered only when it
	// is "local".
	Env string
	// CORSOrigins is the exact-origin allowlist; a wildcard is rejected in config.
	CORSOrigins []string
	// Authenticator resolves credentials to a Principal (stage 10).
	Authenticator Authenticator
	// Authorizer answers the role→action question (stage 11).
	Authorizer Authorizer
}

// NewRouter builds a Router with the P-06 chain installed in order.
func NewRouter(opts Options) *Router {
	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	auth := opts.Authenticator
	if auth == nil {
		auth = AnonymousAuthenticator{}
	}
	az := opts.Authorizer
	if az == nil {
		az = DenyAllAuthorizer{}
	}

	rt := &Router{
		mux:    chi.NewMux(),
		log:    log,
		env:    opts.Env,
		routes: map[routeKey]Policy{},
	}
	// The chain, in the P-06 order. Stages 3, 7, 9, 13, 14 and 16 are not built
	// yet and are listed as TODOs in doc.go; the ones present are in position so
	// that inserting the rest does not reorder anything.
	rt.global = []Middleware{
		RequestID(),            // 1
		Recover(log),           // 2
		AccessLog(log),         // 4
		Timeout(),              // 5
		BodyLimit(),            // 6
		CORS(opts.CORSOrigins), // 8
		Authenticate(auth),     // 10
		Guard(az),              // 11
		IdempotencyKey(),       // 12
	}

	rt.mux.NotFound(func(w http.ResponseWriter, r *http.Request) {
		Fail(w, r, http.StatusNotFound, CodeNotFound, "No such resource.", nil)
	})
	rt.mux.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		Fail(w, r, http.StatusMethodNotAllowed, CodeMethodNotAllowed,
			"That method is not allowed on this resource.", nil)
	})
	return rt
}

// Handle registers a route. There is no overload without a Policy, and none
// will be added: G-4 is a property of the registration API, not of a review.
//
// It panics on a duplicate registration or on a LocalOnly route outside local —
// both are programmer errors that must never reach a running server.
func (rt *Router) Handle(method, pattern string, p Policy, h http.HandlerFunc) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	method = strings.ToUpper(method)
	key := routeKey{method: method, pattern: pattern}
	if _, dup := rt.routes[key]; dup {
		panic(fmt.Sprintf("httpx: duplicate route registration %s %s", method, pattern))
	}
	if p.LocalOnly && rt.env != "local" {
		panic(fmt.Sprintf("httpx: %s %s is LocalOnly but HG_ENV=%q", method, pattern, rt.env))
	}
	rt.routes[key] = p
	rt.built = nil
	rt.mux.Method(method, pattern, h)
}

// Get, Post, Put, Patch and Delete are thin conveniences over Handle. Each still
// takes a Policy.
func (rt *Router) Get(pattern string, p Policy, h http.HandlerFunc) {
	rt.Handle(http.MethodGet, pattern, p, h)
}

// Post registers a POST route.
func (rt *Router) Post(pattern string, p Policy, h http.HandlerFunc) {
	rt.Handle(http.MethodPost, pattern, p, h)
}

// Put registers a PUT route.
func (rt *Router) Put(pattern string, p Policy, h http.HandlerFunc) {
	rt.Handle(http.MethodPut, pattern, p, h)
}

// Patch registers a PATCH route.
func (rt *Router) Patch(pattern string, p Policy, h http.HandlerFunc) {
	rt.Handle(http.MethodPatch, pattern, p, h)
}

// Delete registers a DELETE route.
func (rt *Router) Delete(pattern string, p Policy, h http.HandlerFunc) {
	rt.Handle(http.MethodDelete, pattern, p, h)
}

// Verify walks every registered route and reports every policy defect at once.
//
// I-06.1: the process must call this at boot and exit non-zero on an error. A
// route registered without an Action and without Public is a boot failure, not
// a runtime surprise — which is acceptance criterion 1 of P-06.
func (rt *Router) Verify() error {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	if len(rt.routes) == 0 {
		return errors.New("httpx: no routes registered")
	}
	var problems []string
	for k, p := range rt.routes {
		if err := p.validate(k.method, k.pattern); err != nil {
			problems = append(problems, err.Error())
		}
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		return fmt.Errorf("httpx: %d route policy problem(s):\n  - %s",
			len(problems), strings.Join(problems, "\n  - "))
	}
	return nil
}

// PublicRoutes returns the sorted "METHOD pattern" list of routes registered as
// public.
//
// I-06.2 requires this set to equal a checked-in allowlist exactly, so that
// making a route public is a visible diff in a reviewed file rather than a
// one-word change inside a registration call.
func (rt *Router) PublicRoutes() []string {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	var out []string
	for k, p := range rt.routes {
		if p.Public {
			out = append(out, k.method+" "+k.pattern)
		}
	}
	sort.Strings(out)
	return out
}

// Routes returns every registered route as "METHOD pattern", sorted.
func (rt *Router) Routes() []string {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	out := make([]string, 0, len(rt.routes))
	for k := range rt.routes {
		out = append(out, k.method+" "+k.pattern)
	}
	sort.Strings(out)
	return out
}

// ServeHTTP resolves the route's policy first, attaches it to the context, and
// only then runs the chain.
//
// The ordering matters: the guard must be able to distinguish "no route" from
// "route with a policy" from "route without a policy", and chi only knows the
// matched pattern after routing. chi's Mux.Find performs exactly that lookup
// without executing the handler.
func (rt *Router) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rt.mu.RLock()
	h := rt.built
	rt.mu.RUnlock()
	if h == nil {
		h = rt.build()
	}
	h.ServeHTTP(w, r)
}

func (rt *Router) build() http.Handler {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.built != nil {
		return rt.built
	}
	var h http.Handler = rt.mux
	for i := len(rt.global) - 1; i >= 0; i-- {
		h = rt.global[i](h)
	}
	rt.built = rt.resolve(h)
	return rt.built
}

// resolve is the pre-chain stage that turns a request into a RouteInfo.
func (rt *Router) resolve(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "" {
			path = "/"
		}
		rctx := chi.NewRouteContext()
		pattern := rt.mux.Find(rctx, r.Method, path)

		if pattern != "" {
			rt.mu.RLock()
			p, ok := rt.routes[routeKey{method: strings.ToUpper(r.Method), pattern: pattern}]
			rt.mu.RUnlock()
			if ok {
				r = r.WithContext(withRoute(r.Context(), RouteInfo{
					Method: strings.ToUpper(r.Method), Pattern: pattern, Policy: p,
				}))
			} else {
				// A pattern matched in the mux that this Router never
				// registered. Hand the guard an empty policy so it fails closed.
				r = r.WithContext(withRoute(r.Context(), RouteInfo{
					Method: strings.ToUpper(r.Method), Pattern: pattern,
				}))
			}
		} else if rt.pathExistsForAnotherMethod(path, r.Method) {
			// The path is registered, just not for this method. Answering 404
			// here would be wrong in a different way: the resource plainly
			// exists, and 405 is the accurate answer. The 404-vs-403 rule is
			// about hiding *subjects a principal has no relationship to*, not
			// about hiding the shape of the API surface.
			r = r.WithContext(withMethodMismatch(r.Context()))
		}
		next.ServeHTTP(w, r)
	})
}

// probeMethods is the set tried when no route matched, to distinguish "no such
// path" from "wrong method for this path".
var probeMethods = []string{
	http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
	http.MethodPatch, http.MethodDelete, http.MethodOptions,
}

func (rt *Router) pathExistsForAnotherMethod(path, method string) bool {
	for _, m := range probeMethods {
		if m == method {
			continue
		}
		if rt.mux.Find(chi.NewRouteContext(), m, path) != "" {
			return true
		}
	}
	return false
}
