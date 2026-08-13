package addresses

import (
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler serves the customer delivery-address HTTP operations.
// All methods are stubs — they panic with "not implemented" after
// the auth checks, so tests that test auth pass, and all behaviour
// tests (happy path, domain invariants, IDOR) fail for the right reason.
type Handler struct {
	repo *Repo
}

// NewHandler builds the address handler. repo may be nil during unit tests
// that do not reach the store layer.
func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

// requireAuth returns (Principal, true) for an authenticated caller, or writes
// 401 and returns (_, false).
func requireAuth(w http.ResponseWriter, r *http.Request) (httpx.Principal, bool) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required for this operation.", nil)
		return p, false
	}
	return p, true
}

// requireRole writes 403 if the principal does not hold any of the required roles.
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

// notImplemented writes 501 to signal the handler is a stub.
func notImplemented(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"Not implemented.", nil)
}

// ListAddresses implements GET /v1/addresses (x-roles: CUSTOMER).
func (h *Handler) ListAddresses(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	notImplemented(w, r)
}

// CreateAddress implements POST /v1/addresses (x-roles: CUSTOMER).
// DisallowUnknownFields is checked first; price/server fields in body → 422.
func (h *Handler) CreateAddress(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	var body addressInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	notImplemented(w, r)
}

// GetAddress implements GET /v1/addresses/{addressId} (x-roles: CUSTOMER).
func (h *Handler) GetAddress(w http.ResponseWriter, r *http.Request, addressID string) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	notImplemented(w, r)
}

// UpdateAddress implements PATCH /v1/addresses/{addressId} (x-roles: CUSTOMER).
func (h *Handler) UpdateAddress(w http.ResponseWriter, r *http.Request, addressID string) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	var body addressUpdateInputDTO
	if !decodeStrict(w, r, &body) {
		return
	}
	notImplemented(w, r)
}

// DeleteAddress implements DELETE /v1/addresses/{addressId} (x-roles: CUSTOMER).
func (h *Handler) DeleteAddress(w http.ResponseWriter, r *http.Request, addressID string) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	notImplemented(w, r)
}

// SetDefaultAddress implements POST /v1/addresses/{addressId}/default (x-roles: CUSTOMER).
func (h *Handler) SetDefaultAddress(w http.ResponseWriter, r *http.Request, addressID string) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	notImplemented(w, r)
}
