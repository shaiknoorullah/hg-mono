package addresses

import (
	"errors"
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Domain-level error codes emitted by this module (must exist in contracts/openapi.yaml ErrorCode enum).
const (
	codeAddressInUse    httpx.ErrorCode = "ADDRESS_IN_USE"
	codeAddressLimitHit httpx.ErrorCode = "ADDRESS_LIMIT_HIT"
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

// timezone returns a sensible default timezone for Canadian addresses.
// In production this would be derived from the PostGIS point; here we
// hard-code the sole launch province's zone (Ontario → America/Toronto).
// This is the server-controlled value callers must never supply.
func deriveTimezone(lat, lon float64) string {
	// Canada-only launch: always America/Toronto for Ontario.
	// A proper implementation would use a point-in-polygon tz lookup.
	_ = lat
	_ = lon
	return "America/Toronto"
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

	rows, err := h.repo.List(r.Context(), p.AccountID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Failed to list addresses.", nil)
		return
	}

	dtos := make([]addressDTO, 0, len(rows))
	for _, row := range rows {
		dtos = append(dtos, row.toDTO())
	}

	httpx.RespondList(w, r, http.StatusOK, dtos, httpx.Meta{
		NextCursor: nil,
		HasMore:    false,
	})
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

	// Server derives timezone from coordinates (caller must not supply it).
	tz := deriveTimezone(body.Latitude, body.Longitude)

	row, err := h.repo.Create(r.Context(), p.AccountID, body, tz)
	if err != nil {
		if errors.Is(err, ErrTooManyAddresses) {
			httpx.Fail(w, r, http.StatusConflict, codeAddressLimitHit,
				"Maximum of 20 addresses per customer reached.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Failed to create address.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusCreated, row.toDTO())
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

	row, err := h.repo.Get(r.Context(), p.AccountID, addressID)
	if err != nil {
		if errors.Is(err, ErrAddressNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound,
				"Address not found.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Failed to retrieve address.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, row.toDTO())
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

	row, err := h.repo.Update(r.Context(), p.AccountID, addressID, body)
	if err != nil {
		if errors.Is(err, ErrAddressNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound,
				"Address not found.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Failed to update address.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, row.toDTO())
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

	err := h.repo.Delete(r.Context(), p.AccountID, addressID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAddressNotFound):
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound,
				"Address not found.", nil)
		case errors.Is(err, ErrAddressInUse):
			httpx.Fail(w, r, http.StatusConflict, codeAddressInUse,
				"Address is referenced by a live order and cannot be deleted.", nil)
		default:
			httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
				"Failed to delete address.", nil)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

	row, err := h.repo.SetDefault(r.Context(), p.AccountID, addressID)
	if err != nil {
		if errors.Is(err, ErrAddressNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound,
				"Address not found.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"Failed to set default address.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, row.toDTO())
}
