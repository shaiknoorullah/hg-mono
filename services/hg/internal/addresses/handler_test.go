package addresses_test

// Unit tests for the addresses handler.
// No database — the handler is constructed with a nil repo.
// These tests exercise:
//   - Route policy invariants (deny-by-default, no public routes, G-4).
//   - Authz: CUSTOMER allowed; RIDER, RESTAURANT_OWNER, anon denied (403/401).
//   - Input validation: DisallowUnknownFields → 422, price/amount fields → 422,
//     server-controlled fields (country, timezone) → 422.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── helpers ──────────────────────────────────────────────────────────────────

func withPrincipal(r *http.Request, p httpx.Principal) *http.Request {
	return r.WithContext(httpx.WithPrincipalForTest(r.Context(), p))
}

func customerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-cust",
		Roles:     []httpx.Role{httpx.RoleCustomer},
	}
}

func riderPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-rider",
		Roles:     []httpx.Role{httpx.RoleRider},
	}
}

func ownerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-owner",
		Roles:     []httpx.Role{httpx.RoleRestaurantOwner},
	}
}

func anonPrincipal() httpx.Principal { return httpx.AnonymousPrincipal() }

func jsonBody(s string) *bytes.Buffer { return bytes.NewBufferString(s) }

// ─── Route policy invariants ──────────────────────────────────────────────────

// TestRoutesVerify asserts every addresses route carries a coherent Policy and
// none is public (G-4 / I-06.1).
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	addresses.Routes(r, addresses.NewHandler(nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("addresses routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("addresses routes must never be public, found: %v", pub)
	}
}

// ─── Auth: listAddresses ──────────────────────────────────────────────────────

// TestListAddresses_UnauthenticatedGets401 ensures unauthenticated callers
// receive 401 AUTHENTICATION_REQUIRED (deny by default).
func TestListAddresses_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rec.Code)
	}
}

// TestListAddresses_RiderGets403 ensures a RIDER principal is denied 403.
func TestListAddresses_RiderGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, riderPrincipal("acct-rider"))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}

// TestListAddresses_RestaurantOwnerGets403 ensures RESTAURANT_OWNER is denied.
func TestListAddresses_RestaurantOwnerGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, ownerPrincipal("acct-owner"))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}

// ─── createAddress — G-3 invariant (no price/amount fields inbound) ──────────

// TestCreateAddress_RejectsPriceField ensures a body with price_cents → 422.
func TestCreateAddress_RejectsPriceField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"price_cents":1000}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXX")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 for price_cents in body (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_RejectsAmountCentsField ensures amount_cents → 422.
func TestCreateAddress_RejectsAmountCentsField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"amount_cents":999}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXY")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 for amount_cents in body (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_RejectsUnknownField ensures unknown fields → 422
// (additionalProperties:false enforced by DisallowUnknownFields).
func TestCreateAddress_RejectsUnknownField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"unicorn_field":"bad"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXZ")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 for unknown field in body (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_RejectsCountryField verifies `country` (server-controlled)
// in the body causes 422.
func TestCreateAddress_RejectsCountryField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"country":"CA"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXA")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 for country in body (server-controlled, body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_RejectsTimezoneField verifies `timezone` (server-derived)
// in the body causes 422.
func TestCreateAddress_RejectsTimezoneField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328,"timezone":"America/Toronto"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXB")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 for timezone in body (server-derived, body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_UnauthenticatedGets401 ensures unauthenticated POST → 401.
func TestCreateAddress_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXC")
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestCreateAddress_RiderGets403 ensures RIDER → 403 on createAddress.
func TestCreateAddress_RiderGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"line1":"123 Main St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.682,"longitude":-79.328}`
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXD")
	req = withPrincipal(req, riderPrincipal("acct-rider"))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── updateAddress — input validation ────────────────────────────────────────

// TestUpdateAddress_RejectsUnknownField ensures PATCH /v1/addresses/{id} enforces
// DisallowUnknownFields.
func TestUpdateAddress_RejectsUnknownField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"mystery_field":true}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/00000000-0000-0000-0000-000000000001", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateAddress_RejectsPriceField ensures PATCH also rejects price fields.
func TestUpdateAddress_RejectsPriceField(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"label":"Home","price_cents":500}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/00000000-0000-0000-0000-000000000001", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestUpdateAddress_UnauthenticatedGets401 ensures unauthenticated PATCH → 401.
func TestUpdateAddress_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	body := `{"label":"Home"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/00000000-0000-0000-0000-000000000001", jsonBody(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Auth checks on resource-level operations ─────────────────────────────────

// TestGetAddress_UnauthenticatedGets401 ensures unauthenticated GET → 401.
func TestGetAddress_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/00000000-0000-0000-0000-000000000001", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rec.Code)
	}
}

// TestGetAddress_RiderGets403 ensures RIDER → 403 on GET address.
func TestGetAddress_RiderGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/00000000-0000-0000-0000-000000000001", nil)
	req = withPrincipal(req, riderPrincipal("acct-rider"))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}

// TestDeleteAddress_UnauthenticatedGets401 ensures unauthenticated DELETE → 401.
func TestDeleteAddress_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/00000000-0000-0000-0000-000000000001", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.DeleteAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rec.Code)
	}
}

// TestDeleteAddress_RiderGets403 ensures RIDER → 403 on deleteAddress.
func TestDeleteAddress_RiderGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/00000000-0000-0000-0000-000000000001", nil)
	req = withPrincipal(req, riderPrincipal("acct-rider"))
	rec := httptest.NewRecorder()
	h.DeleteAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}

// TestSetDefaultAddress_UnauthenticatedGets401 ensures unauthenticated POST → 401.
func TestSetDefaultAddress_UnauthenticatedGets401(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/00000000-0000-0000-0000-000000000001/default", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status=%d, want 401", rec.Code)
	}
}

// TestSetDefaultAddress_RiderGets403 ensures RIDER → 403.
func TestSetDefaultAddress_RiderGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/00000000-0000-0000-0000-000000000001/default", nil)
	req = withPrincipal(req, riderPrincipal("acct-rider"))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}

// TestSetDefaultAddress_RestaurantOwnerGets403 ensures RESTAURANT_OWNER → 403.
func TestSetDefaultAddress_RestaurantOwnerGets403(t *testing.T) {
	h := addresses.NewHandler(nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses/00000000-0000-0000-0000-000000000001/default", nil)
	req = withPrincipal(req, ownerPrincipal("acct-owner"))
	rec := httptest.NewRecorder()
	h.SetDefaultAddress(rec, req, "00000000-0000-0000-0000-000000000001")
	if rec.Code != http.StatusForbidden {
		t.Errorf("status=%d, want 403", rec.Code)
	}
}
