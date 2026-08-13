package restaurant

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	status, err := h.repo.GetOnboardingStatus(r.Context(), restaurantID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, status)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	profile, err := h.repo.GetProfile(r.Context(), restaurantID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Restaurant not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, profile)
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
	// province reaches a ::province cast in UpsertProfile; an unknown value would
	// 22P02 into a 500. Validate against the enum → 422.
	if body.Province != "" && !provinceSet[body.Province] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"province must be a valid Canadian province or territory code.",
			[]httpx.FieldError{{Field: "province", Code: "invalid", Message: "unknown province code"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	profile, err := h.repo.UpsertProfile(r.Context(), restaurantID, body)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, profile)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	hours, err := h.repo.GetHours(r.Context(), restaurantID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, hours)
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
	if fe := validateHours(body); fe != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"One or more trading-hours values are invalid.", fe)
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	hours, err := h.repo.SetHours(r.Context(), restaurantID, body)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, hours)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	docs, err := h.repo.ListDocuments(r.Context(), restaurantID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, docs)
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
	// doc_type reaches a ::restaurant_doc_type cast; validate it against the enum
	// so an unknown value is a clean 422 rather than a 22P02-induced 500.
	if !restaurantDocTypeSet[body.DocType] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"doc_type must be a valid restaurant document type.",
			[]httpx.FieldError{{Field: "doc_type", Code: "invalid", Message: "unknown document type"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	doc, err := h.repo.AttachDocument(r.Context(), restaurantID, body)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, doc)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	if err := h.repo.CheckDocumentPack(r.Context(), restaurantID); err != nil {
		if errors.Is(err, ErrIncompleteDocumentPack) {
			httpx.Fail(w, r, http.StatusUnprocessableEntity,
				httpx.ErrorCode("INCOMPLETE_DOCUMENT_PACK"),
				"All required document types must be present before submission.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, map[string]string{"status": "SUBMITTED"})
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	menu, err := h.repo.GetMenu(r.Context(), restaurantID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, menu)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	cat, err := h.repo.CreateCategory(r.Context(), restaurantID, body)
	if errors.Is(err, ErrCategoryNameTaken) {
		httpx.Fail(w, r, http.StatusConflict,
			httpx.ErrorCode("CATEGORY_NAME_TAKEN"),
			"A category with this name already exists.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, cat)
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
	// Enum + shape validation: unknown tags or a malformed category_id would
	// otherwise reach the ::dietary_tag[]/::allergen_tag[]/::uuid casts and 22P02
	// into a 500. Validate up front → 422.
	if fe := validateTags(body.DietaryTags, body.AllergenTags); fe != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"One or more tags are not recognised.", fe)
		return
	}
	if !isValidUUID(body.CategoryID) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"category_id must be a valid UUID.",
			[]httpx.FieldError{{Field: "category_id", Code: "invalid", Message: "malformed UUID"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	item, err := h.repo.CreateMenuItem(r.Context(), restaurantID, body)
	if errors.Is(err, ErrNotFound) {
		// Target category does not belong to this restaurant (or does not exist):
		// invisible → 404, never a 403 that would confirm a foreign category.
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Menu category not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, item)
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
	// Halal gate (R-17): HALAL_CERTIFIED is platform-derived, never restaurant-settable,
	// on update just as on create.
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
	if fe := validateTags(body.DietaryTags, body.AllergenTags); fe != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"One or more tags are not recognised.", fe)
		return
	}
	if body.CategoryID != nil && !isValidUUID(*body.CategoryID) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"category_id must be a valid UUID.",
			[]httpx.FieldError{{Field: "category_id", Code: "invalid", Message: "malformed UUID"}})
		return
	}
	if body.PriceCents != nil && (*body.PriceCents < 50 || *body.PriceCents > 50000) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity,
			httpx.ErrorCode("PRICE_OUT_OF_RANGE"),
			"price_cents must be between 50 and 50000.",
			[]httpx.FieldError{{Field: "price_cents", Code: "PRICE_OUT_OF_RANGE",
				Message: "must be between 50 (CAD 0.50) and 50000 (CAD 500.00)"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	itemID := chi.URLParam(r, "itemId")
	item, err := h.repo.UpdateMenuItem(r.Context(), restaurantID, itemID, body)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Menu item not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, item)
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
	itemID := chi.URLParam(r, "itemId")
	item, err := h.repo.SetMenuItemAvailability(r.Context(), restaurantID, itemID, body)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Menu item not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, item)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orders, hasMore, err := h.repo.ListOrders(r.Context(), restaurantID, 20, nil)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.RespondList(w, r, http.StatusOK, orders, httpx.Meta{HasMore: hasMore})
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orderID := chi.URLParam(r, "orderId")
	order, err := h.repo.GetOrder(r.Context(), restaurantID, orderID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Order not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, order)
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
	var body acceptInputDTO
	if r.Body != nil {
		if !decodeStrictOptional(w, r, &body) {
			return
		}
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orderID := chi.URLParam(r, "orderId")
	order, err := h.repo.AcceptOrder(r.Context(), restaurantID, orderID, p.AccountID, body.PromisedReadyMinutes)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Order not found.", nil)
		return
	}
	if errors.Is(err, ErrOfferExpired) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("OFFER_EXPIRED"),
			"The restaurant acceptance window has expired for this order.", nil)
		return
	}
	if errors.Is(err, ErrIllegalTransition) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("ILLEGAL_TRANSITION"),
			"The order cannot be accepted in its current state.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, order)
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
	// R-24: a structured reason is required and must be a known enum member.
	// Validating here keeps a hostile value out of the ::restaurant_reject_reason_code
	// cast, which would otherwise 22P02 into a bare 500.
	if !restaurantRejectReasonSet[body.Reason] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"reason must be a valid restaurant rejection reason code.",
			[]httpx.FieldError{{Field: "reason", Code: "invalid", Message: "unknown rejection reason code"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orderID := chi.URLParam(r, "orderId")
	order, err := h.repo.RejectOrder(r.Context(), restaurantID, orderID, p.AccountID, body.Reason, body.Note)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Order not found.", nil)
		return
	}
	if errors.Is(err, ErrIllegalTransition) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("ILLEGAL_TRANSITION"),
			"The order cannot be rejected in its current state.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, order)
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
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orderID := chi.URLParam(r, "orderId")
	order, err := h.repo.MarkOrderReady(r.Context(), restaurantID, orderID, p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Order not found.", nil)
		return
	}
	if errors.Is(err, ErrIllegalTransition) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("ILLEGAL_TRANSITION"),
			"The order cannot be marked ready in its current state.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, order)
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
	// R-26: delays are canned increments (5/10/15/20) with a structured reason.
	switch body.DelayMinutes {
	case 5, 10, 15, 20:
	default:
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"delay_minutes must be one of 5, 10, 15, 20.",
			[]httpx.FieldError{{Field: "delay_minutes", Code: "invalid", Message: "must be 5, 10, 15 or 20"}})
		return
	}
	if !delayReasonSet[body.Reason] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"reason must be a valid delay reason code.",
			[]httpx.FieldError{{Field: "reason", Code: "invalid", Message: "unknown delay reason code"}})
		return
	}
	restaurantID, ok := h.resolveRestaurant(w, r, p)
	if !ok {
		return
	}
	orderID := chi.URLParam(r, "orderId")
	order, err := h.repo.DelayOrder(r.Context(), restaurantID, orderID, p.AccountID, body.DelayMinutes, body.Reason)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "Order not found.", nil)
		return
	}
	if errors.Is(err, ErrDelayLimitReached) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("DELAY_LIMIT_REACHED"),
			"The maximum number of delays for this order has been reached.", nil)
		return
	}
	if errors.Is(err, ErrIllegalTransition) {
		httpx.Fail(w, r, http.StatusConflict, httpx.ErrorCode("ILLEGAL_TRANSITION"),
			"The order cannot be delayed in its current state.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, order)
}
