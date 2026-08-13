package account

import (
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// uuidRe matches the canonical 8-4-4-4-12 hex UUID form. Path params and
// cursors that are not UUIDs must never reach the store — a non-UUID string
// cast against a uuid column raises a Postgres error that would surface as a
// bare 500. A malformed id is instead treated as "no such resource" (404) or,
// for a cursor, as an absent anchor.
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isUUID(s string) bool { return uuidRe.MatchString(s) }

// CodeEmailInUse is the contract ErrorCode raised when a profile email change
// collides with another account's email (account.email is UNIQUE). It is a
// member of the contract's ErrorCode enum.
const CodeEmailInUse httpx.ErrorCode = "EMAIL_IN_USE"

// emailRe is a deliberately permissive shape check for the contract's
// `format: email`. It rejects obvious garbage (no @, whitespace) without
// pretending to be a full RFC 5322 validator.
var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

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

// decodeStrict JSON-decodes the request body into dst, refusing unknown fields
// (additionalProperties:false from the contract) and trailing content. It
// returns false and writes 422 VALIDATION_FAILED on any error.
func decodeStrict(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body could not be parsed against the schema.",
			[]httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return false
	}
	if dec.More() {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body carried trailing content.", nil)
		return false
	}
	return true
}

// ─── Input DTOs ──────────────────────────────────────────────────────────────

// customerProfileUpdateInput mirrors CustomerProfileUpdateInput in the contract.
// Fields absent from this struct (phone_e164, account_id, price_cents, etc.)
// will cause DisallowUnknownFields to return 422. This is the intent.
type customerProfileUpdateInput struct {
	FirstName        *string `json:"first_name"`
	LastName         *string `json:"last_name"`
	Email            *string `json:"email"`
	AvatarObjectID   *string `json:"avatar_object_id"`
	MarketingConsent *bool   `json:"marketing_consent"`
}

// deviceRegistrationInput mirrors DeviceRegistrationInput in the contract.
type deviceRegistrationInput struct {
	ExpoPushToken string `json:"expo_push_token"`
	DeviceID      string `json:"device_id"`
	Platform      string `json:"platform"`
	RoleContext   string `json:"role_context"`
	AppVersion    string `json:"app_version"`
	OsVersion     string `json:"os_version"`
	Locale        string `json:"locale"`
}

// ─── Output DTOs ─────────────────────────────────────────────────────────────

// customerProfileResponse mirrors the CustomerProfile schema in the contract
// (contracts/openapi.yaml #/components/schemas/CustomerProfile, which is
// additionalProperties:false). The field set here is CLOSED against that schema:
//
//	required: account_id, first_name, phone_e164, email_verified, created_at
//	optional: last_name, email, avatar_url, default_address_id, marketing_consent_at
//
// No field outside that set may appear (no updated_at, no marketing_consent bool).
type customerProfileResponse struct {
	AccountID          string  `json:"account_id"`
	FirstName          string  `json:"first_name"`
	LastName           *string `json:"last_name"`
	Email              *string `json:"email"`
	EmailVerified      bool    `json:"email_verified"`
	PhoneE164          string  `json:"phone_e164"`
	AvatarURL          *string `json:"avatar_url"`
	DefaultAddressID   *string `json:"default_address_id"`
	MarketingConsentAt *string `json:"marketing_consent_at"`
	CreatedAt          string  `json:"created_at"`
}

// deviceResponse mirrors the Device schema in the contract.
type deviceResponse struct {
	DeviceID    string `json:"device_id"`
	Platform    string `json:"platform"`
	RoleContext string `json:"role_context"`
	PushEnabled bool   `json:"push_enabled"`
	LastSeenAt  string `json:"last_seen_at"`
}

// notificationResponse mirrors the Notification schema in the contract.
type notificationResponse struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	Priority  string  `json:"priority"`
	DeepLink  *string `json:"deep_link"`
	ReadAt    *string `json:"read_at"`
	CreatedAt string  `json:"created_at"`
}

// valid platform values (device_platform enum from migrations/00002_enums.sql)
var validPlatforms = map[string]bool{
	"ios": true, "android": true, "web": true,
}

// validRoleContexts is the closed set of Role enum values the contract permits
// for DeviceRegistrationInput.role_context ($ref Role). This value is echoed
// back on the Device response, so an out-of-enum value would be a wire leak;
// reject it at the boundary instead.
var validRoleContexts = map[string]bool{
	"CUSTOMER": true, "RIDER": true,
	"RESTAURANT_OWNER": true, "RESTAURANT_MANAGER": true, "RESTAURANT_STAFF": true,
	"SUPPORT_AGENT": true, "ADMIN": true, "SUPER_ADMIN": true,
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

	var in customerProfileUpdateInput
	if !decodeStrict(w, r, &in) {
		return
	}

	// Validate: first_name has minLength=1 / maxLength=50 when provided.
	if in.FirstName != nil {
		if strings.TrimSpace(*in.FirstName) == "" {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"first_name must not be empty.",
				[]httpx.FieldError{{Field: "first_name", Code: "min_length", Message: "first_name must have at least 1 character"}})
			return
		}
		if len([]rune(*in.FirstName)) > 50 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"first_name is too long.",
				[]httpx.FieldError{{Field: "first_name", Code: "max_length", Message: "first_name must have at most 50 characters"}})
			return
		}
	}
	// last_name: minLength=1 / maxLength=50 when provided (contract schema).
	if in.LastName != nil {
		if strings.TrimSpace(*in.LastName) == "" {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"last_name must not be empty.",
				[]httpx.FieldError{{Field: "last_name", Code: "min_length", Message: "last_name must have at least 1 character"}})
			return
		}
		if len([]rune(*in.LastName)) > 50 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"last_name is too long.",
				[]httpx.FieldError{{Field: "last_name", Code: "max_length", Message: "last_name must have at most 50 characters"}})
			return
		}
	}
	// email: format:email / maxLength=254 when provided. Changing email resets
	// email_verified to false (handled in the store); a duplicate is EMAIL_IN_USE.
	if in.Email != nil {
		e := strings.TrimSpace(*in.Email)
		if e == "" || len(e) > 254 || !emailRe.MatchString(e) {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"email is not a valid address.",
				[]httpx.FieldError{{Field: "email", Code: "format", Message: "email must be a valid address of at most 254 characters"}})
			return
		}
		*in.Email = e
	}

	if h.repo == nil {
		httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
			"updateCustomerProfile is not yet connected to a store.", nil)
		return
	}

	profile, err := h.repo.UpdateCustomerProfile(r.Context(), p.AccountID, in)
	if err != nil {
		if isNotFound(err) {
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such resource.", nil)
			return
		}
		if isEmailInUse(err) {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeEmailInUse,
				"That email address is already in use.",
				[]httpx.FieldError{{Field: "email", Code: "conflict", Message: "email already registered to another account"}})
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, profile)
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

	var in deviceRegistrationInput
	if !decodeStrict(w, r, &in) {
		return
	}

	// Validate required fields.
	if in.ExpoPushToken == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"expo_push_token is required.",
			[]httpx.FieldError{{Field: "expo_push_token", Code: "required", Message: "expo_push_token must not be empty"}})
		return
	}
	if in.DeviceID == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"device_id is required.",
			[]httpx.FieldError{{Field: "device_id", Code: "required", Message: "device_id must not be empty"}})
		return
	}

	// Length caps from the contract (expo_push_token maxLength 256,
	// device_id maxLength 128). An oversize value must not reach the store.
	if len(in.ExpoPushToken) > 256 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"expo_push_token is too long.",
			[]httpx.FieldError{{Field: "expo_push_token", Code: "max_length", Message: "expo_push_token must have at most 256 characters"}})
		return
	}
	if len(in.DeviceID) > 128 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"device_id is too long.",
			[]httpx.FieldError{{Field: "device_id", Code: "max_length", Message: "device_id must have at most 128 characters"}})
		return
	}

	// Validate platform enum.
	if !validPlatforms[in.Platform] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"platform must be one of: ios, android, web.",
			[]httpx.FieldError{{Field: "platform", Code: "invalid", Message: "platform must be one of: ios, android, web"}})
		return
	}

	// Validate role_context (required Role enum). It is echoed on the response,
	// so a bad value cannot be silently defaulted — reject it as 422.
	if in.RoleContext == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"role_context is required.",
			[]httpx.FieldError{{Field: "role_context", Code: "required", Message: "role_context must not be empty"}})
		return
	}
	if !validRoleContexts[in.RoleContext] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"role_context must be a valid Role.",
			[]httpx.FieldError{{Field: "role_context", Code: "invalid", Message: "role_context must be a valid Role"}})
		return
	}

	if h.repo == nil {
		httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
			"registerDevice is not yet connected to a store.", nil)
		return
	}

	device, err := h.repo.UpsertDevice(r.Context(), p.AccountID, in)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, device)
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

	deviceID := chi.URLParam(r, "deviceId")

	if h.repo == nil {
		httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
			"unregisterDevice is not yet connected to a store.", nil)
		return
	}

	err := h.repo.RevokeDevice(r.Context(), p.AccountID, deviceID)
	if err != nil {
		if isNotFound(err) {
			// IDOR: return 404, never 403, even when the device exists for another account.
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such resource.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

	q := r.URL.Query()

	// Parse ?limit= (default 20, range 1..100). The contract is explicit:
	// "A non-numeric value is a 422, never a silent NaN"; likewise an out-of-
	// range value is rejected rather than silently clamped. This is pure input
	// validation, done before the store guard so it holds regardless of wiring.
	limit := 20
	if ls := q.Get("limit"); ls != "" {
		n, err := strconv.Atoi(ls)
		if err != nil || n < 1 || n > 100 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"limit must be an integer between 1 and 100.",
				[]httpx.FieldError{{Field: "limit", Code: "range", Message: "limit must be an integer between 1 and 100"}})
			return
		}
		limit = n
	}

	// Parse ?cursor= (opaque keyset token = last-seen notification id). It is a
	// UUID; a malformed cursor must not reach the store (a bad uuid cast is a
	// 500) — it is rejected as VALIDATION_FAILED.
	cursor := q.Get("cursor")
	if cursor != "" && !isUUID(cursor) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"cursor is not a valid keyset token.",
			[]httpx.FieldError{{Field: "cursor", Code: "invalid", Message: "cursor must be an opaque keyset token from meta.next_cursor"}})
		return
	}

	// Parse ?unread_only=true (a boolean; only the literal "true" enables it,
	// matching the contract default of false for any other value).
	unreadOnly := q.Get("unread_only") == "true"

	if h.repo == nil {
		httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
			"listNotifications is not yet connected to a store.", nil)
		return
	}

	items, nextCursor, err := h.repo.ListNotifications(r.Context(), p.AccountID, limit, cursor, unreadOnly)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	hasMore := nextCursor != ""
	var nextCursorPtr *string
	if hasMore {
		nextCursorPtr = &nextCursor
	}

	httpx.RespondList(w, r, http.StatusOK, items, httpx.Meta{
		HasMore:    hasMore,
		NextCursor: nextCursorPtr,
	})
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

	notificationID := chi.URLParam(r, "notificationId")

	// A malformed (non-UUID) id can never match a row; casting it against the
	// uuid column would raise a 500. It is indistinguishable from a
	// non-existent resource, so it is a 404 (IDOR: never 500, never a 403 leak).
	if !isUUID(notificationID) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such resource.", nil)
		return
	}

	if h.repo == nil {
		httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
			"markNotificationRead is not yet connected to a store.", nil)
		return
	}

	err := h.repo.MarkNotificationRead(r.Context(), p.AccountID, notificationID)
	if err != nil {
		if isNotFound(err) {
			// IDOR: return 404, never 403.
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such resource.", nil)
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
