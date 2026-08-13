package restaurant

import (
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler serves the restaurant-partner HTTP operations (R-01 … R-26).
// It resolves the caller's restaurant from the authenticated principal's
// account_role grant (P-07); it never reads a restaurant_id from the body
// or a path segment controlled by the client.
type Handler struct {
	repo   *Repo
	scopeR ScopeResolver
}

// ScopeResolver answers "which restaurant does this principal act for?"
// by reading account_role from the database (P-07).
type ScopeResolver interface {
	RestaurantForPrincipal(ctx http.RoundTripper) (string, bool)
}

// NewHandler builds the restaurant handler. repo and scope may be nil during
// tests that do not reach the store layer.
func NewHandler(repo *Repo, scope ScopeResolver) *Handler {
	return &Handler{repo: repo, scopeR: scope}
}

// ─── Authentication / authorization helpers ───────────────────────────────────

// requireAuth returns (Principal, true) for an authenticated caller, or writes
// 401 AUTHENTICATION_REQUIRED and returns (_, false).
func requireAuth(w http.ResponseWriter, r *http.Request) (httpx.Principal, bool) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required for this operation.", nil)
		return p, false
	}
	return p, true
}

// requireRole writes 403 FORBIDDEN if the principal does not hold any of the
// required roles. Returns true when the check passes.
func requireRole(w http.ResponseWriter, r *http.Request, p httpx.Principal, roles ...httpx.Role) bool {
	for _, need := range roles {
		if p.HasRole(need) {
			return true
		}
	}
	httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden,
		"You do not have permission to perform this action.", nil)
	return false
}

// resolveRestaurant looks up the restaurant this principal is scoped to.
// Returns ("", false) and writes 404 when no grant is found.
func (h *Handler) resolveRestaurant(w http.ResponseWriter, r *http.Request, p httpx.Principal) (string, bool) {
	if h.repo == nil {
		// nil repo → not implemented; handled by the individual op stubs
		return "", false
	}
	restaurantID, ok := h.repo.RestaurantForAccount(r.Context(), p.AccountID)
	if !ok {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound,
			"No such resource.", nil)
		return "", false
	}
	return restaurantID, true
}

// notImplemented is the placeholder body for unimplemented operations. Every
// handler calls this until the real implementation lands, causing tests to fail
// at runtime rather than compile time.
func notImplemented(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented,
		httpx.ErrorCode("NOT_IMPLEMENTED"),
		"This operation is not yet implemented.", nil)
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

// GetRestaurantOnboardingStatus implements GET /v1/restaurant/onboarding/status
// (R-04). x-roles: OWNER, MANAGER, STAFF.
func (h *Handler) GetRestaurantOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// ─── Profile ──────────────────────────────────────────────────────────────────

// GetRestaurantProfile implements GET /v1/restaurant/profile.
// x-roles: OWNER, MANAGER, STAFF.
func (h *Handler) GetRestaurantProfile(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// SubmitRestaurantProfile implements PUT /v1/restaurant/profile.
// x-roles: OWNER, MANAGER only.
// G-3: any inbound price / server-controlled field is 422 UNKNOWN_FIELD.
func (h *Handler) SubmitRestaurantProfile(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body profileInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// ─── Hours ────────────────────────────────────────────────────────────────────

// GetRestaurantHours implements GET /v1/restaurant/hours.
// x-roles: OWNER, MANAGER, STAFF.
func (h *Handler) GetRestaurantHours(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// SetRestaurantHours implements PUT /v1/restaurant/hours.
// x-roles: OWNER, MANAGER only.
func (h *Handler) SetRestaurantHours(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body hoursInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// ─── Documents ────────────────────────────────────────────────────────────────

// ListRestaurantDocuments implements GET /v1/restaurant/documents.
// x-roles: OWNER, MANAGER only.
func (h *Handler) ListRestaurantDocuments(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// AttachRestaurantDocument implements POST /v1/restaurant/documents.
// x-roles: OWNER, MANAGER only.
func (h *Handler) AttachRestaurantDocument(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body documentInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// SubmitRestaurantDocuments implements POST /v1/restaurant/documents/submit.
// x-roles: OWNER, MANAGER only.
func (h *Handler) SubmitRestaurantDocuments(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

// GetOwnMenu implements GET /v1/restaurant/menu.
// x-roles: OWNER, MANAGER, STAFF.
func (h *Handler) GetOwnMenu(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// CreateMenuCategory implements POST /v1/restaurant/menu/categories.
// x-roles: OWNER, MANAGER only.
func (h *Handler) CreateMenuCategory(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body categoryInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// CreateMenuItem implements POST /v1/restaurant/menu/items.
// x-roles: OWNER, MANAGER only.
// Halal gate (R-17): HALAL_CERTIFIED tag is not restaurant-settable → 403 FIELD_NOT_WRITABLE.
// Price range: 50–50000 cents.
func (h *Handler) CreateMenuItem(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body menuItemInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	// Halal gate: the restaurant may not assert HALAL_CERTIFIED.
	for _, tag := range body.DietaryTags {
		if tag == "HALAL_CERTIFIED" {
			httpx.Fail(w, r, http.StatusForbidden,
				httpx.ErrorCode("FIELD_NOT_WRITABLE"),
				"HALAL_CERTIFIED is derived from the restaurant's certificate and is not restaurant-settable.",
				[]httpx.FieldError{{Field: "dietary_tags", Code: "FIELD_NOT_WRITABLE",
					Message: "HALAL_CERTIFIED is not restaurant-settable"}})
			return
		}
	}
	// Price range validation.
	if body.PriceCents < 50 || body.PriceCents > 50000 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity,
			httpx.ErrorCode("PRICE_OUT_OF_RANGE"),
			"price_cents must be between 50 and 50000.",
			[]httpx.FieldError{{Field: "price_cents", Code: "PRICE_OUT_OF_RANGE",
				Message: "must be between 50 (CAD 0.50) and 50000 (CAD 500.00)"}})
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// UpdateMenuItem implements PATCH /v1/restaurant/menu/items/{itemId}.
// x-roles: OWNER, MANAGER only.
func (h *Handler) UpdateMenuItem(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager) {
		return
	}
	var body menuItemUpdateDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	_ = restaurantID
	notImplemented(w, r)
}

// SetMenuItemAvailability implements PUT /v1/restaurant/menu/items/{itemId}/availability.
// x-roles: OWNER, MANAGER, STAFF (STAFF can flip availability).
func (h *Handler) SetMenuItemAvailability(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	var body availabilityInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	_ = restaurantID
	notImplemented(w, r)
}

// ─── Orders ───────────────────────────────────────────────────────────────────

// ListRestaurantOrders implements GET /v1/restaurant/orders.
// x-roles: OWNER, MANAGER, STAFF.
func (h *Handler) ListRestaurantOrders(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// GetRestaurantOrder implements GET /v1/restaurant/orders/{orderId}.
// x-roles: OWNER, MANAGER, STAFF.
// P-07: SQL WHERE enforces ownership; another restaurant's order returns 404.
func (h *Handler) GetRestaurantOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// AcceptOrder implements POST /v1/restaurant/orders/{orderId}/accept.
// x-roles: OWNER, MANAGER, STAFF. MONEY class → Idempotency-Key required.
// T6: RESTAURANT_PENDING → PREPARING.
func (h *Handler) AcceptOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if r.Body != nil {
		var body acceptInputDTO
		if !decodeStrictOptional(w, r, &body) {
			return
		}
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// RejectOrder implements POST /v1/restaurant/orders/{orderId}/reject.
// x-roles: OWNER, MANAGER, STAFF. MONEY class → Idempotency-Key required.
// T7: RESTAURANT_PENDING → REJECTED.
func (h *Handler) RejectOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	var body rejectInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// MarkOrderReady implements POST /v1/restaurant/orders/{orderId}/ready.
// x-roles: OWNER, MANAGER, STAFF.
// T10: PREPARING → READY_FOR_PICKUP.
func (h *Handler) MarkOrderReady(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}

// DelayOrder implements POST /v1/restaurant/orders/{orderId}/delay.
// x-roles: OWNER, MANAGER, STAFF.
// R-26: max 3 delays and +45 minutes cumulative.
func (h *Handler) DelayOrder(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleRestaurantOwner, httpx.RoleRestaurantManager, httpx.RoleRestaurantStaff) {
		return
	}
	var body delayInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	if _, ok := h.resolveRestaurant(w, r, p); !ok {
		return
	}
	notImplemented(w, r)
}
