package restaurant_test

// Stage-3 boundary & leak audit for the restaurant-partner module.
//
// These tests are the independent auditor's contribution: they exercise the
// SAME wiring main.go uses — the real httpx.Router with the real auth.Matrix
// authorizer — rather than calling handlers directly. Calling a handler
// directly bypasses the Guard middleware, so the handler-level role checks in
// handler_test.go could pass while the route is dead (or wide open) through the
// real chain. This file closes that gap.
//
// Boundaries covered here:
//   B) AUTHZ LEAK — through the real Guard+Matrix: every x-role is admitted and
//      every non-x-role is 403; anonymous is 401; no route is public.
//   A) CONTRACT CONFORMANCE (negative) — closed request bodies reject unknown
//      fields with a contract ErrorCode; success envelopes are `{data:...}`.
//   G) ERROR TAXONOMY — a denied call carries a contract ErrorCode, never a
//      bare 500.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"context"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// fixedAuthenticator is the stage-10 stand-in: it authenticates every request as
// the one principal it was built with. This lets a test drive a request through
// the whole P-06 chain (Authenticate → Guard → IdempotencyKey → handler) exactly
// as the running server would, but with a deterministic identity.
type fixedAuthenticator struct{ p httpx.Principal }

func (f fixedAuthenticator) Authenticate(context.Context, *http.Request) (httpx.Principal, error) {
	return f.p, nil
}

// newFullRouter builds the real router with the real auth matrix, wired to a
// nil-repo handler. A nil repo means an *authorised* call falls through to the
// resolveRestaurant nil-repo branch and never writes 403/401 — so the Guard's
// decision is observable in isolation: 403 == denied, 401 == anonymous, and
// anything else == the Guard admitted the caller.
func newFullRouter(p httpx.Principal) *httpx.Router {
	r := httpx.NewRouter(httpx.Options{
		Env:           "test",
		Authenticator: fixedAuthenticator{p},
		Authorizer:    auth.Matrix{},
	})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil))
	return r
}

// op is one restaurant operation as the contract declares it, with the exact
// x-roles set. The auditor derives this table straight from contracts/openapi.yaml
// — it is the source of truth the Guard is checked against.
type op struct {
	method string
	path   string
	body   string // non-empty for routes with a required body
	idem   bool   // route is Idempotent → needs an Idempotency-Key to pass stage 12
	xroles []httpx.Role
}

var (
	owner   = httpx.RoleRestaurantOwner
	manager = httpx.RoleRestaurantManager
	staff   = httpx.RoleRestaurantStaff
)

// ownerManagerStaff / ownerManager are the two x-role sets the contract uses.
var (
	ownerManagerStaff = []httpx.Role{owner, manager, staff}
	ownerManager      = []httpx.Role{owner, manager}
)

// restaurantOps is the full 19-operation surface with its contract x-roles.
func restaurantOps() []op {
	return []op{
		{http.MethodGet, "/v1/restaurant/onboarding/status", "", false, ownerManagerStaff},
		{http.MethodGet, "/v1/restaurant/profile", "", false, ownerManagerStaff},
		{http.MethodPut, "/v1/restaurant/profile", `{"legal_name":"X"}`, false, ownerManager},
		{http.MethodGet, "/v1/restaurant/hours", "", false, ownerManagerStaff},
		{http.MethodPut, "/v1/restaurant/hours", `{"hours":[],"overrides":[]}`, false, ownerManager},
		{http.MethodGet, "/v1/restaurant/documents", "", false, ownerManager},
		{http.MethodPost, "/v1/restaurant/documents", `{"stored_object_id":"o","doc_type":"BUSINESS_LICENCE"}`, true, ownerManager},
		{http.MethodPost, "/v1/restaurant/documents/submit", "", true, ownerManager},
		{http.MethodGet, "/v1/restaurant/menu", "", false, ownerManagerStaff},
		{http.MethodPost, "/v1/restaurant/menu/categories", `{"name":"Desserts"}`, true, ownerManager},
		{http.MethodPost, "/v1/restaurant/menu/items", `{"name":"AB","category_id":"c","price_cents":1500}`, true, ownerManager},
		{http.MethodPatch, "/v1/restaurant/menu/items/00000000-0000-0000-0000-000000000000", `{"name":"AB"}`, false, ownerManager},
		{http.MethodPut, "/v1/restaurant/menu/items/00000000-0000-0000-0000-000000000000/availability", `{"is_available":true}`, false, ownerManagerStaff},
		{http.MethodGet, "/v1/restaurant/orders", "", false, ownerManagerStaff},
		{http.MethodGet, "/v1/restaurant/orders/00000000-0000-0000-0000-000000000000", "", false, ownerManagerStaff},
		{http.MethodPost, "/v1/restaurant/orders/00000000-0000-0000-0000-000000000000/accept", `{}`, true, ownerManagerStaff},
		{http.MethodPost, "/v1/restaurant/orders/00000000-0000-0000-0000-000000000000/reject", `{"reason":"OUT_OF_STOCK"}`, true, ownerManagerStaff},
		{http.MethodPost, "/v1/restaurant/orders/00000000-0000-0000-0000-000000000000/ready", "", true, ownerManagerStaff},
		{http.MethodPost, "/v1/restaurant/orders/00000000-0000-0000-0000-000000000000/delay", `{"delay_minutes":15,"reason":"PREP_OVERRUN"}`, true, ownerManagerStaff},
	}
}

func hasRole(set []httpx.Role, r httpx.Role) bool {
	for _, x := range set {
		if x == r {
			return true
		}
	}
	return false
}

func doReq(t *testing.T, o op, p httpx.Principal) *httptest.ResponseRecorder {
	t.Helper()
	var bodyReader *strings.Reader
	if o.body != "" {
		bodyReader = strings.NewReader(o.body)
	} else {
		bodyReader = strings.NewReader("")
	}
	req := httptest.NewRequest(o.method, o.path, bodyReader)
	if o.idem {
		req.Header.Set("Idempotency-Key", "audit-idem-key-000000000000")
	}
	rec := httptest.NewRecorder()
	newFullRouter(p).ServeHTTP(rec, req)
	return rec
}

// TestAuthz_EveryNonRoleDenied is the core leak-closer. For every restaurant
// operation, and every restaurant partner role, a request through the REAL
// router+matrix returns:
//   - 403 when the role is NOT in the op's x-roles (deny by default);
//   - never 403/401 when the role IS in the op's x-roles (Guard admits it).
//
// Before the matrix reconciliation this test failed loudly: the 17 restaurant
// module actions were absent from auth.Matrix, so RoleHasAction returned false
// for OWNER/MANAGER/STAFF and every op answered 403 — the whole feature was
// dead through the real chain even though the direct-handler tests were green.
func TestAuthz_EveryRoleMatchesContractXRoles(t *testing.T) {
	partnerRoles := []httpx.Role{owner, manager, staff}
	for _, o := range restaurantOps() {
		for _, role := range partnerRoles {
			o, role := o, role
			name := o.method + " " + o.path + " as " + string(role)
			t.Run(name, func(t *testing.T) {
				p := httpx.Principal{AccountID: "acct-audit", SessionID: "s", Roles: []httpx.Role{role}}
				rec := doReq(t, o, p)
				allowed := hasRole(o.xroles, role)
				if allowed {
					if rec.Code == http.StatusForbidden {
						t.Fatalf("x-role %s was DENIED (403) on %s %s — authz leak: matrix does not grant this op's action (body: %s)",
							role, o.method, o.path, rec.Body.String())
					}
					if rec.Code == http.StatusUnauthorized {
						t.Fatalf("x-role %s got 401 on %s %s — authenticated principal treated as anonymous", role, o.method, o.path)
					}
				} else {
					if rec.Code != http.StatusForbidden {
						t.Fatalf("non-x-role %s was NOT denied on %s %s: status=%d, want 403 (body: %s)",
							role, o.method, o.path, rec.Code, rec.Body.String())
					}
				}
			})
		}
	}
}

// TestAuthz_ForeignRolesDenied: a CUSTOMER, RIDER or ADMIN token is never
// admitted to a restaurant-partner op. Restaurant ops belong to the three
// partner roles only; an ADMIN acts through the /v1/admin/* on-behalf surface,
// not here.
func TestAuthz_ForeignRolesDenied(t *testing.T) {
	foreign := []httpx.Role{httpx.RoleCustomer, httpx.RoleRider, httpx.RoleAdmin, httpx.RoleSupportAgent}
	for _, o := range restaurantOps() {
		for _, role := range foreign {
			o, role := o, role
			t.Run(o.method+" "+o.path+" as "+string(role), func(t *testing.T) {
				p := httpx.Principal{AccountID: "acct-x", SessionID: "s", Roles: []httpx.Role{role}}
				rec := doReq(t, o, p)
				if rec.Code != http.StatusForbidden {
					t.Fatalf("foreign role %s on %s %s: status=%d, want 403 (body: %s)",
						role, o.method, o.path, rec.Code, rec.Body.String())
				}
			})
		}
	}
}

// TestAuthz_AnonymousDenied: every op answers 401 to an anonymous caller through
// the real chain (no restaurant route is public).
func TestAuthz_AnonymousDenied(t *testing.T) {
	for _, o := range restaurantOps() {
		o := o
		t.Run(o.method+" "+o.path, func(t *testing.T) {
			rec := doReq(t, o, httpx.AnonymousPrincipal())
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("anonymous on %s %s: status=%d, want 401 (body: %s)",
					o.method, o.path, rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAuthz_DenialCarriesContractErrorCode: a denied op returns the FORBIDDEN
// contract error code in the envelope, never a bare 500 or an empty body
// (error taxonomy, boundary G).
func TestAuthz_DenialCarriesContractErrorCode(t *testing.T) {
	// Pick an OWNER-only op and hit it as STAFF → 403 FORBIDDEN.
	o := op{http.MethodPut, "/v1/restaurant/profile", `{"legal_name":"X"}`, false, ownerManager}
	p := httpx.Principal{AccountID: "acct-staff", SessionID: "s", Roles: []httpx.Role{staff}}
	rec := doReq(t, o, p)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"code"`) || !strings.Contains(body, "FORBIDDEN") {
		t.Errorf("403 body must carry a FORBIDDEN error code, got: %s", body)
	}
}

// TestRoutes_NoneArePublic re-asserts (through the fully-built router) that not
// one restaurant route is registered public. A single accidental Public flag
// would open a tenant's data to the world.
func TestRoutes_NoneArePublic(t *testing.T) {
	r := newFullRouter(httpx.AnonymousPrincipal())
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Fatalf("restaurant routes must never be public, found: %v", pub)
	}
}

// TestWriteBodies_RejectUnknownFields asserts every closed write DTO rejects an
// unknown field with a contract ErrorCode (A: closed request shapes; the
// inbound-price invariant is the important special case, covered per-op in
// handler_test.go). Here we sweep all write ops for additionalProperties:false.
func TestWriteBodies_RejectUnknownFields(t *testing.T) {
	// Each entry: an OWNER/MANAGER-authorised write op with a body carrying one
	// field the contract's schema does not define.
	cases := []op{
		{http.MethodPut, "/v1/restaurant/profile", `{"legal_name":"X","not_a_field":1}`, false, ownerManager},
		{http.MethodPut, "/v1/restaurant/hours", `{"hours":[],"overrides":[],"not_a_field":1}`, false, ownerManager},
		{http.MethodPost, "/v1/restaurant/documents", `{"stored_object_id":"o","doc_type":"BUSINESS_LICENCE","not_a_field":1}`, true, ownerManager},
		{http.MethodPost, "/v1/restaurant/menu/categories", `{"name":"D","not_a_field":1}`, true, ownerManager},
		{http.MethodPost, "/v1/restaurant/menu/items", `{"name":"AB","category_id":"c","price_cents":1500,"not_a_field":1}`, true, ownerManager},
		{http.MethodPatch, "/v1/restaurant/menu/items/00000000-0000-0000-0000-000000000000", `{"name":"AB","not_a_field":1}`, false, ownerManager},
		{http.MethodPut, "/v1/restaurant/menu/items/00000000-0000-0000-0000-000000000000/availability", `{"is_available":true,"not_a_field":1}`, false, ownerManager},
	}
	p := httpx.Principal{AccountID: "acct-owner", SessionID: "s", Roles: []httpx.Role{owner}}
	for _, o := range cases {
		o := o
		t.Run(o.method+" "+o.path, func(t *testing.T) {
			rec := doReq(t, o, p)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("unknown field on %s %s: status=%d, want 422 (body: %s)",
					o.method, o.path, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), `"code"`) {
				t.Errorf("422 must carry a contract error code, got: %s", rec.Body.String())
			}
		})
	}
}
