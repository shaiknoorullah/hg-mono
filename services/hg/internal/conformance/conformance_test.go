package conformance

import (
	"net/http"
	"testing"
)

// TestConformance_LiveResponses is the response-conformance oracle. For each
// reachable operation it issues a representative request against the REAL chi
// router (in-process httptest, production module constructors) and validates the
// live 2xx body against contracts/openapi.yaml with kin-openapi.
//
// Every subtest that fails is a PROVEN drift: the running server emitted a body
// the contract's schema (additionalProperties:false + required[] + enums)
// rejects. No hand-transcribed field list is involved — the loaded YAML is the
// only oracle.
//
// This is intentionally fail-CLOSED against the current (unfixed) backend: the
// known drifts (getCart restaurant:null, getRestaurantProfile flat halal_status,
// getRestaurantOrder flat money/no customer, …) MUST fail here. A green run
// means the backend conforms.
func TestConformance_LiveResponses(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// Each case is one live call whose 2xx body is validated against the
	// contract. want is the expected HTTP status (the state the fixture seeds).
	cases := []struct {
		name string
		rq   Request
		want int
	}{
		// ─── Catalogue & discovery (CUSTOMER-scoped in this backend) ────────
		{"listRestaurants", Request{Method: "GET", Path: "/v1/restaurants",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},
		{"getRestaurant", Request{Method: "GET", Path: "/v1/restaurants/" + fxRestaurantID,
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},
		{"getRestaurantMenu", Request{Method: "GET", Path: "/v1/restaurants/" + fxRestaurantID + "/menu",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},
		{"getOwnMenu", Request{Method: "GET", Path: "/v1/restaurant/menu",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},

		// ─── Cart (the halal-on-cart drift) ─────────────────────────────────
		// Non-empty cart bound to a restaurant → the RestaurantCard + halal seal
		// must be present. The backend emits restaurant:null (critical drift).
		{"getCart", Request{Method: "GET", Path: "/v1/cart",
			AccountID: fxNonEmptyCartAccountID, Roles: []string{roleCustomer}}, 200},

		// ─── Restaurant partner portal (the OrderRestaurantView + profile drift)
		{"getRestaurantProfile", Request{Method: "GET", Path: "/v1/restaurant/profile",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},
		{"getRestaurantHours", Request{Method: "GET", Path: "/v1/restaurant/hours",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},
		{"getRestaurantOnboardingStatus", Request{Method: "GET", Path: "/v1/restaurant/onboarding/status",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},
		{"listRestaurantDocuments", Request{Method: "GET", Path: "/v1/restaurant/documents",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},
		{"listRestaurantOrders", Request{Method: "GET", Path: "/v1/restaurant/orders",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},
		{"getRestaurantOrder", Request{Method: "GET", Path: "/v1/restaurant/orders/" + fxOrderID,
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager}}, 200},

		// ─── Rider self-service ─────────────────────────────────────────────
		{"getRiderMe", Request{Method: "GET", Path: "/v1/riders/me",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},
		{"getRiderOnboardingStatus", Request{Method: "GET", Path: "/v1/riders/me/onboarding/status",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},
		{"listRiderDocuments", Request{Method: "GET", Path: "/v1/riders/me/documents",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},
		{"getRiderDashboard", Request{Method: "GET", Path: "/v1/riders/me/dashboard",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// ─── Account & addresses ────────────────────────────────────────────
		{"listAddresses", Request{Method: "GET", Path: "/v1/addresses",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},
		{"listNotifications", Request{Method: "GET", Path: "/v1/notifications",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},

		// ─── Admin oversight ────────────────────────────────────────────────
		{"listOrdersAdmin", Request{Method: "GET", Path: "/v1/admin/orders",
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200},
		{"getOrderAdmin", Request{Method: "GET", Path: "/v1/admin/orders/" + fxOrderID,
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200},
		{"listMenuReviewQueue", Request{Method: "GET", Path: "/v1/admin/menu-reviews",
			Query:     "restaurant_id=" + fxRestaurantID,
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			h.CheckResponse(t, tc.rq, tc.want)
		})
	}
}

// TestConformance_CartHalalSeal is the semantic twin of the schema oracle for
// getCart. The contract types Cart.restaurant as oneOf[RestaurantCard, null], so
// an emitted restaurant:null is SCHEMA-legal even on a bound cart — the pure
// ValidateResponse oracle cannot catch it. But invariant #8 (a halal claim is
// re-asserted before checkout) requires a NON-empty cart, which is bound to
// exactly one restaurant, to carry a populated RestaurantCard with its halal
// seal. This test asserts that semantic on a live non-empty cart.
func TestConformance_CartHalalSeal(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)

	rq := Request{Method: "GET", Path: "/v1/cart",
		AccountID: fxNonEmptyCartAccountID, Roles: []string{roleCustomer}}
	_, resp := h.Do(t, rq)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getCart: status %d", resp.StatusCode)
	}
	d := dataObject(t, resp)

	lines, _ := d["lines"].([]any)
	if len(lines) == 0 {
		t.Skipf("fixture cart is empty — restaurant:null is legal; need a seeded non-empty cart to prove the halal drift")
	}
	rest, ok := d["restaurant"].(map[string]any)
	if !ok || rest == nil {
		t.Errorf("HALAL DRIFT (getCart): a non-empty cart bound to a restaurant emits restaurant=%v — "+
			"the RestaurantCard and its halal seal are absent on the checkout-gating cart (invariant #8)", d["restaurant"])
		return
	}
	if _, hasHalal := rest["halal"]; !hasHalal {
		t.Errorf("HALAL DRIFT (getCart): cart.restaurant is present but carries no `halal` HalalBadge")
	}
}

// TestConformance_Reachability documents operations that the contract declares
// but the current backend makes UNREACHABLE for the contract-declared role, so
// no contract 2xx body is ever emitted to response-validate. These are their
// own class of drift (an operation you cannot call is drift), surfaced here so
// they are not silently absent from the coverage report. The harness records
// the observed status; a conformant backend would let the contract role through
// (2xx or a domain 4xx), not deny with 403/405.
func TestConformance_Reachability(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)

	cases := []struct {
		op          string
		rq          Request
		observed    int
		explanation string
	}{
		{
			op: "getOrder",
			rq: Request{Method: "GET", Path: "/v1/orders/" + fxOrderID,
				AccountID: fxCustomerID, Roles: []string{roleCustomer}},
			explanation: "order.read is not granted to CUSTOMER in the auth matrix → 403 before any body",
		},
		{
			op: "getCustomerProfile",
			rq: Request{Method: "GET", Path: "/v1/me/profile",
				AccountID: fxCustomerID, Roles: []string{roleCustomer}},
			explanation: "GET /v1/me/profile is not registered (only PATCH) → 405, no handler",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.op, func(t *testing.T) {
			_, resp := h.Do(t, tc.rq)
			defer resp.Body.Close()
			t.Logf("REACHABILITY DRIFT: %s (%s %s) is unreachable for its contract role: HTTP %d — %s",
				tc.op, tc.rq.Method, tc.rq.Path, resp.StatusCode, tc.explanation)
			if resp.StatusCode < 400 {
				t.Logf("note: %s now returns %d — if this is a contract 2xx, add it to the response-validation table",
					tc.op, resp.StatusCode)
			}
		})
	}
}

// TestConformance_LiveRequests validates that contract-VALID request bodies are
// accepted by the handlers' input decoders — catching INPUT DTO drift where a
// handler renamed a field and then rejects the contract shape under
// DisallowUnknownFields. It runs ValidateRequest (the body is contract-valid by
// construction) and then issues the request; a 422/400 on a contract-valid body
// is proof the handler's input DTO drifted from the contract.
//
// These are the input-side twins of the response drifts (rejectOrder reason vs
// reason_code, delayOrder added_minutes vs delay_minutes, acceptOrder
// prep_eta_minutes, setMenuItemAvailability availability_state).
func TestConformance_LiveRequests(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	cases := []struct {
		name string
		rq   Request
		// A contract-valid body that a conformant handler must NOT reject with
		// 400/422 for an unknown/renamed field. The handler may still return a
		// domain error (409/404/…); what proves input drift is specifically a
		// 400/422 UNKNOWN_FIELD on a contract-valid field name.
	}{
		{"rejectOrder", Request{Method: "POST", Path: "/v1/restaurant/orders/" + fxOrderID + "/reject",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager},
			IdemKey: "conf-reject-000001",
			Body:    map[string]any{"reason_code": "ITEM_UNAVAILABLE", "note": "conformance probe note over twenty chars"}}},
		{"delayOrder", Request{Method: "POST", Path: "/v1/restaurant/orders/" + fxOrderID + "/delay",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager},
			IdemKey: "conf-delay-0000001",
			Body:    map[string]any{"added_minutes": 10, "reason_code": "HIGH_VOLUME"}}},
		{"acceptOrder", Request{Method: "POST", Path: "/v1/restaurant/orders/" + fxOrderID + "/accept",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager},
			IdemKey: "conf-accept-000001",
			Body:    map[string]any{"prep_eta_minutes": 20, "accepted_note": "conformance probe"}}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			// First prove the body is contract-valid (this also records the op).
			// Build (do not send) so the body is intact for ValidateRequest.
			req := h.Build(t, tc.rq)
			opID, verr := ValidateRequest(t, h.Spec, req)
			h.MarkCovered(opID)
			if verr != nil {
				t.Fatalf("test body is not contract-valid (fix the test, not the server): %v", verr)
			}

			// Now issue it and assert the handler did NOT reject the contract
			// field names with a 4xx UNKNOWN_FIELD/validation error.
			_, resp := h.Do(t, tc.rq)
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusUnprocessableEntity || resp.StatusCode == http.StatusBadRequest {
				env := mustJSONMap(t, resp)
				code := ""
				if e, ok := env["error"].(map[string]any); ok {
					code, _ = e["code"].(string)
				}
				t.Errorf("INPUT DRIFT: %s rejected a contract-valid body with %d %s — the handler's input DTO field names do not match the contract (%v)",
					tc.name, resp.StatusCode, code, env)
			}
		})
	}
}
