package account

import (
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler serves the account self-service HTTP operations.
type Handler struct {
	repo *Repo
}

// NewHandler builds the account handler. repo may be nil during unit tests
// that do not reach the store layer.
func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

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

// UpdateCustomerProfile implements PATCH /v1/me/profile (C-03).
// x-roles: CUSTOMER only.
func (h *Handler) UpdateCustomerProfile(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p, httpx.RoleCustomer) {
		return
	}
	// TODO(account): implement — decode CustomerProfileUpdateInput with
	// DisallowUnknownFields, validate, update customer_profile scoped to p.AccountID.
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"updateCustomerProfile is not yet implemented.", nil)
}

// RegisterDevice implements POST /v1/devices (P-25).
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF.
func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleCustomer,
		httpx.RoleRider,
		httpx.RoleRestaurantOwner,
		httpx.RoleRestaurantManager,
		httpx.RoleRestaurantStaff,
	) {
		return
	}
	// TODO(account): implement — decode DeviceRegistrationInput with
	// DisallowUnknownFields, upsert on (account_id, device_id), revoke old
	// binding for the same token on a different account.
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"registerDevice is not yet implemented.", nil)
}

// UnregisterDevice implements DELETE /v1/devices/{deviceId} (P-25).
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF.
func (h *Handler) UnregisterDevice(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleCustomer,
		httpx.RoleRider,
		httpx.RoleRestaurantOwner,
		httpx.RoleRestaurantManager,
		httpx.RoleRestaurantStaff,
	) {
		return
	}
	// TODO(account): implement — set revoked_at WHERE account_id=$caller AND
	// device_id=$param; return 404 if not found (IDOR: never 403).
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"unregisterDevice is not yet implemented.", nil)
}

// ListNotifications implements GET /v1/notifications (P-24).
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF.
func (h *Handler) ListNotifications(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleCustomer,
		httpx.RoleRider,
		httpx.RoleRestaurantOwner,
		httpx.RoleRestaurantManager,
		httpx.RoleRestaurantStaff,
	) {
		return
	}
	// TODO(account): implement — keyset-paginate notification WHERE account_id=$caller,
	// optional unread_only filter; return {data:[], meta:{next_cursor, has_more}}.
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"listNotifications is not yet implemented.", nil)
}

// MarkNotificationRead implements POST /v1/notifications/{notificationId}/read (P-24).
// x-roles: CUSTOMER, RIDER, RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF.
func (h *Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	p, ok := requireAuth(w, r)
	if !ok {
		return
	}
	if !requireRole(w, r, p,
		httpx.RoleCustomer,
		httpx.RoleRider,
		httpx.RoleRestaurantOwner,
		httpx.RoleRestaurantManager,
		httpx.RoleRestaurantStaff,
	) {
		return
	}
	// TODO(account): implement — UPDATE notification SET read_at=now()
	// WHERE id=$param AND account_id=$caller; 404 if not found (IDOR: never 403).
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"markNotificationRead is not yet implemented.", nil)
}
