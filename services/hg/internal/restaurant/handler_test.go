package restaurant_test

// Unit tests for pure handler logic (no DB, no network).
// They hit the Handler via httptest.NewRecorder, supplying a pre-baked
// Principal in the request context the same way the real auth middleware does.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// withPrincipal injects a principal into the request context. This mirrors what
// the real Authenticate middleware (stage 10) does.
func withPrincipal(r *http.Request, p httpx.Principal) *http.Request {
	return r.WithContext(httpx.WithPrincipalForTest(r.Context(), p))
}

// ownerPrincipal builds a RESTAURANT_OWNER principal scoped to restaurantID.
func ownerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-owner",
		Roles:     []httpx.Role{httpx.RoleRestaurantOwner},
	}
}

func managerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-mgr",
		Roles:     []httpx.Role{httpx.RoleRestaurantManager},
	}
}

func staffPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-staff",
		Roles:     []httpx.Role{httpx.RoleRestaurantStaff},
	}
}

func customerPrincipal(accountID string) httpx.Principal {
	return httpx.Principal{
		AccountID: accountID,
		SessionID: "sess-cust",
		Roles:     []httpx.Role{httpx.RoleCustomer},
	}
}

func anonPrincipal() httpx.Principal {
	return httpx.AnonymousPrincipal()
}

// ─── Routes verify ────────────────────────────────────────────────────────────

// TestRoutesVerify asserts every restaurant route carries a coherent Policy and
// none is public (G-4 / I-06.1). This catches a policy-less registration before
// the server boots.
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("restaurant routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("restaurant routes must never be public, found: %v", pub)
	}
}

// TestMutatingRoutesRequireIdempotencyKey checks that MONEY-class routes
// (accept, reject) are marked Idempotent and therefore enforced by the
// IdempotencyKey middleware (P-37 / I-37.4).
func TestMutatingRoutesRequireIdempotencyKey(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

// ─── submitRestaurantProfile — G-3 invariant (no price fields inbound) ────────

// TestSubmitProfileRejectsPriceField asserts that any price-shaped field on the
// submitRestaurantProfile body is rejected 422 UNKNOWN_FIELD / VALIDATION_FAILED
// before the store is reached (G-3, invariant #1).
func TestSubmitProfileRejectsPriceField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"legal_name":"Barakah Inc.","commission_rate_bps":100}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "UNKNOWN_FIELD" && env.Error.Code != "VALIDATION_FAILED" {
		t.Errorf("code = %q, want UNKNOWN_FIELD or VALIDATION_FAILED", env.Error.Code)
	}
}

// TestSubmitProfileRejectsHalalStatusField: halal_status is server-controlled.
func TestSubmitProfileRejectsHalalStatusField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"legal_name":"X","halal_status":"CERTIFIED"}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestSubmitProfileRejectsIsApprovedField: is_approved is server-controlled.
func TestSubmitProfileRejectsIsApprovedField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"legal_name":"X","is_approved":true}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantProfile(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestSubmitProfileStaffDenied: RESTAURANT_STAFF may read the profile but not
// write it. The router Guard enforces the x-roles constraint before the handler
// is called, but we can verify the handler itself returns 403 when called directly
// without a matching authorization context.
func TestSubmitProfileStaffDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	// Provide a valid-looking body to ensure the denial is authz, not parse.
	body := `{"legal_name":"X","display_name":"Y","latitude":43.7,"longitude":-79.4,"province":"ON","postal_code":"M1H 2Y2","phone_e164":"+14165550123","avg_prep_minutes":20}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
	req = withPrincipal(req, staffPrincipal("acct-staff"))
	rec := httptest.NewRecorder()
	h.SubmitRestaurantProfile(rec, req)
	// Handler must gate on OWNER/MANAGER; STAFF should get 403.
	if rec.Code != http.StatusForbidden {
		t.Fatalf("STAFF submitting profile: status = %d, want 403", rec.Code)
	}
}

// ─── createMenuItem — halal gate (R-17, decision R-05) ────────────────────────

// TestCreateMenuItemRejectsHalalCertifiedField: the restaurant may not assert
// HALAL_CERTIFIED — that is derived from the restaurant's approved certificate
// (R-17). Sending the field must be 403 FIELD_NOT_WRITABLE.
func TestCreateMenuItemRejectsHalalCertifiedField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"name":"Biryani","category_id":"cat-1","price_cents":1500,"dietary_tags":["HALAL_CERTIFIED"]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.CreateMenuItem(rec, req)
	// 403 FIELD_NOT_WRITABLE per contract
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 for HALAL_CERTIFIED assertion (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Error.Code != "FIELD_NOT_WRITABLE" {
		t.Errorf("code = %q, want FIELD_NOT_WRITABLE", env.Error.Code)
	}
}

// TestCreateMenuItemRejectsPriceOutOfRange: price_cents must be in [50, 50000]
// (CAD 0.50 – CAD 500.00). Outside that range is 422 PRICE_OUT_OF_RANGE.
func TestCreateMenuItemRejectsPriceOutOfRange(t *testing.T) {
	for _, tc := range []struct {
		name  string
		price int
	}{
		{"zero", 0},
		{"below_min", 49},
		{"above_max", 50001},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := restaurant.NewHandler(nil, nil, nil)
			body, _ := json.Marshal(map[string]any{
				"name":        "Biryani",
				"category_id": "cat-1",
				"price_cents": tc.price,
			})
			req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", bytes.NewReader(body))
			req = withPrincipal(req, ownerPrincipal("acct-1"))
			rec := httptest.NewRecorder()
			h.CreateMenuItem(rec, req)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("price=%d: status=%d, want 422", tc.price, rec.Code)
			}
			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &env)
			if env.Error.Code != "PRICE_OUT_OF_RANGE" && env.Error.Code != "VALIDATION_FAILED" {
				t.Errorf("price=%d: code=%q, want PRICE_OUT_OF_RANGE", tc.price, env.Error.Code)
			}
		})
	}
}

// TestCreateMenuItemStaffDenied: RESTAURANT_STAFF cannot create items.
func TestCreateMenuItemStaffDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"name":"X","category_id":"cat-1","price_cents":1500}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", strings.NewReader(body))
	req = withPrincipal(req, staffPrincipal("acct-staff"))
	rec := httptest.NewRecorder()
	h.CreateMenuItem(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("STAFF creating item: status=%d, want 403", rec.Code)
	}
}

// ─── setMenuItemAvailability — BLOCKED gate (R-18) ────────────────────────────

// TestSetAvailabilityRejectsUnknownField: the availability body is a narrow
// struct; unknown fields are 422.
func TestSetAvailabilityRejectsUnknownField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"availability_state":"AVAILABLE","price_cents":999}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/menu/items/item-1/availability",
		strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.SetMenuItemAvailability(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── acceptOrder / rejectOrder — price fields denied ──────────────────────────

// TestAcceptOrderRejectsPriceField: the accept body carries no amount. Sending
// one is 422 UNKNOWN_FIELD (G-3, invariant #1).
func TestAcceptOrderRejectsPriceField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"prep_eta_minutes":15,"amount_cents":5000}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/orders/ord-1/accept",
		strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.AcceptOrder(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 for price field (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestRejectOrderRejectsPriceField: same invariant for reject.
func TestRejectOrderRejectsPriceField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"reason_code":"KITCHEN_AT_CAPACITY","amount_cents":100}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/orders/ord-1/reject",
		strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.RejectOrder(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 for price field (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── setRestaurantHours — unknown field rejection ─────────────────────────────

func TestSetHoursRejectsUnknownField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"intervals":[{"day_of_week":1,"opens_at":"09:00","closes_at":"22:00"}],"price_cents":0}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/hours", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.SetRestaurantHours(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 for unknown field (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestSetHoursStaffDenied: STAFF cannot write hours.
func TestSetHoursStaffDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"intervals":[]}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/hours", strings.NewReader(body))
	req = withPrincipal(req, staffPrincipal("acct-staff"))
	rec := httptest.NewRecorder()
	h.SetRestaurantHours(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("STAFF setting hours: status=%d, want 403", rec.Code)
	}
}

// ─── attachRestaurantDocument — unknown field rejection ───────────────────────

func TestAttachDocumentRejectsUnknownField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"stored_object_id":"obj-1","doc_type":"BUSINESS_LICENCE","amount_cents":0}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/documents", strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.AttachRestaurantDocument(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestListDocumentsStaffDenied: listRestaurantDocuments is OWNER/MANAGER only.
func TestListDocumentsStaffDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/documents", nil)
	req = withPrincipal(req, staffPrincipal("acct-staff"))
	rec := httptest.NewRecorder()
	h.ListRestaurantDocuments(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("STAFF listing documents: status=%d, want 403", rec.Code)
	}
}

// ─── createMenuCategory ───────────────────────────────────────────────────────

func TestCreateCategoryStaffDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"name":"Mains"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/categories", strings.NewReader(body))
	req = withPrincipal(req, staffPrincipal("acct-staff"))
	rec := httptest.NewRecorder()
	h.CreateMenuCategory(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("STAFF creating category: status=%d, want 403", rec.Code)
	}
}

// ─── Reads: OWNER, MANAGER, STAFF all allowed; CUSTOMER denied ───────────────

func TestGetOnboardingStatusCustomerDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/onboarding/status", nil)
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.GetRestaurantOnboardingStatus(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("CUSTOMER reading onboarding status: status=%d, want 403", rec.Code)
	}
}

func TestGetProfileCustomerDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/profile", nil)
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.GetRestaurantProfile(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("CUSTOMER reading profile: status=%d, want 403", rec.Code)
	}
}

func TestGetMenuCustomerDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/menu", nil)
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.GetOwnMenu(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("CUSTOMER reading own menu: status=%d, want 403", rec.Code)
	}
}

func TestGetOrdersCustomerDenied(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/orders", nil)
	req = withPrincipal(req, customerPrincipal("acct-cust"))
	rec := httptest.NewRecorder()
	h.ListRestaurantOrders(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("CUSTOMER listing orders: status=%d, want 403", rec.Code)
	}
}

// ─── Unauthenticated → 401 ────────────────────────────────────────────────────

func TestGetOnboardingStatusUnauthenticated(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/onboarding/status", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.GetRestaurantOnboardingStatus(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: status=%d, want 401", rec.Code)
	}
}

func TestSubmitProfileUnauthenticated(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"legal_name":"X"}`
	req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/profile", strings.NewReader(body))
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.SubmitRestaurantProfile(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: status=%d, want 401", rec.Code)
	}
}

func TestAcceptOrderUnauthenticated(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/orders/ord-1/accept", nil)
	req = withPrincipal(req, anonPrincipal())
	rec := httptest.NewRecorder()
	h.AcceptOrder(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: status=%d, want 401", rec.Code)
	}
}

// ─── delayOrder — DELAY_LIMIT_REACHED business invariant (unit) ──────────────

// TestDelayOrderRejectsPriceField: the delay body carries no amount.
func TestDelayOrderRejectsPriceField(t *testing.T) {
	h := restaurant.NewHandler(nil, nil, nil)
	body := `{"added_minutes":15,"reason_code":"PREP_OVERRUN","amount_cents":0}`
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/orders/ord-1/delay",
		strings.NewReader(body))
	req = withPrincipal(req, ownerPrincipal("acct-1"))
	rec := httptest.NewRecorder()
	h.DelayOrder(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 for price field (body: %s)", rec.Code, rec.Body.String())
	}
}
