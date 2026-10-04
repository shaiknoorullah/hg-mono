package auth

import (
	"errors"
	"net/http"
	"regexp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// totpDigits validates a 6-digit TOTP code.
var totpDigits = regexp.MustCompile(`^[0-9]{6}$`)

// ---- changePassword (P-03) --------------------------------------------------

// changePasswordInput is the wire shape for POST /v1/auth/password/change.
// additionalProperties:false is enforced by decodeJSON (DisallowUnknownFields).
type changePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword implements POST /v1/auth/password/change.
// Roles: RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF, SUPPORT_AGENT,
//
//	ADMIN, SUPER_ADMIN.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}

	var in changePasswordInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if in.CurrentPassword == "" || in.NewPassword == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"current_password and new_password are required.", nil)
		return
	}
	if len(in.NewPassword) < 12 || len(in.NewPassword) > 256 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"new_password must be between 12 and 256 characters.",
			[]httpx.FieldError{{Field: "new_password", Code: "length", Message: "12–256 characters"}})
		return
	}

	// The re-issued session must honour the caller's actual client surface so the
	// refresh token is delivered the right way (cookie for web, body for native).
	client, _ := clientSurface(r)
	issued, err := h.svc.ChangePassword(r.Context(), p, in.CurrentPassword, in.NewPassword, client)
	switch {
	case errors.Is(err, errInvalidCredentials):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeInvalidCredentials,
			"The current password is incorrect.", nil)
		return
	case errors.Is(err, errBreachedPassword):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeBreachedPassword,
			"This password has appeared in a data breach. Choose another.", nil)
		return
	case errors.Is(err, errWeakPassword):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"new_password must be at least 12 characters.", nil)
		return
	case errors.Is(err, ErrPasswordHashBusy):
		h.failHashBusy(w, r, err, "changePassword")
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.writeSessionGrant(w, r, issued, http.StatusOK)
}

// ---- enrollTotp (P-01) ------------------------------------------------------

// EnrollTOTP implements POST /v1/auth/totp/enroll.
// No request body. Returns TotpEnrolment with provisioning_uri + 10 recovery_codes.
func (h *Handler) EnrollTOTP(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}

	// The body should be empty or {}; enforce additionalProperties:false.
	var dummy struct{}
	if err := decodeJSON(r, &dummy); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body must be empty or {}.", nil)
		return
	}

	enrolment, err := h.svc.EnrollTOTP(r.Context(), p.AccountID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, enrolment)
}

// ---- verifyTotpEnrolment (P-01) ---------------------------------------------

// verifyTotpInput is the wire shape for POST /v1/auth/totp/verify.
type verifyTotpInput struct {
	TOTPCode string `json:"totp_code"`
}

// VerifyTOTPEnrolment implements POST /v1/auth/totp/verify.
func (h *Handler) VerifyTOTPEnrolment(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}

	var in verifyTotpInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if !totpDigits.MatchString(in.TOTPCode) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"totp_code must be a 6-digit number.",
			[]httpx.FieldError{{Field: "totp_code", Code: "format", Message: "must be 6 digits"}})
		return
	}

	err := h.svc.VerifyTOTPEnrolment(r.Context(), p.AccountID, in.TOTPCode)
	switch {
	case errors.Is(err, errTOTPNotEnrolled):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"TOTP enrolment has not been started. Call /v1/auth/totp/enroll first.", nil)
		return
	case errors.Is(err, errTOTPInvalidCode):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeInvalidCredentials,
			"The TOTP code is incorrect.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- disableTotp (P-01) -----------------------------------------------------

// disableTotpInput is the wire shape for POST /v1/auth/totp/disable.
type disableTotpInput struct {
	TOTPCode string `json:"totp_code"`
}

// DisableTOTP implements POST /v1/auth/totp/disable.
// Roles: RESTAURANT_OWNER, RESTAURANT_MANAGER only.
func (h *Handler) DisableTOTP(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}

	var in disableTotpInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if !totpDigits.MatchString(in.TOTPCode) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"totp_code must be a 6-digit number.",
			[]httpx.FieldError{{Field: "totp_code", Code: "format", Message: "must be 6 digits"}})
		return
	}

	err := h.svc.DisableTOTP(r.Context(), p.AccountID, in.TOTPCode)
	switch {
	case errors.Is(err, errTOTPMandatory):
		httpx.Fail(w, r, http.StatusForbidden, CodeMFARequired,
			"TOTP is mandatory for your role and cannot be disabled.", nil)
		return
	case errors.Is(err, errTOTPNotEnrolled):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"TOTP is not enabled on this account.", nil)
		return
	case errors.Is(err, errTOTPInvalidCode):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeInvalidCredentials,
			"The TOTP code is incorrect.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
