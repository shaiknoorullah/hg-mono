package auth

import (
	"fmt"
	"net/url"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TOTP-related Action constants. These must be added to the matrix when the
// feature is implemented. Declared here so the test file compiles; the matrix
// entries and the handlers are NOT yet added (RED stage).
const (
	// ActionChangePassword guards POST /v1/auth/password/change.
	// x-roles: RESTAURANT_OWNER, RESTAURANT_MANAGER, RESTAURANT_STAFF,
	//          SUPPORT_AGENT, ADMIN, SUPER_ADMIN
	ActionChangePassword httpx.Action = "auth.password_change"

	// ActionEnrollTOTP guards POST /v1/auth/totp/enroll.
	// x-roles: RESTAURANT_OWNER, RESTAURANT_MANAGER, SUPPORT_AGENT, ADMIN, SUPER_ADMIN
	ActionEnrollTOTP httpx.Action = "auth.totp_enroll"

	// ActionVerifyTOTPEnrolment guards POST /v1/auth/totp/verify.
	// x-roles: RESTAURANT_OWNER, RESTAURANT_MANAGER, SUPPORT_AGENT, ADMIN, SUPER_ADMIN
	ActionVerifyTOTPEnrolment httpx.Action = "auth.totp_verify_enrolment"

	// ActionDisableTOTP guards POST /v1/auth/totp/disable.
	// x-roles: RESTAURANT_OWNER, RESTAURANT_MANAGER ONLY
	// (SUPPORT_AGENT, ADMIN, SUPER_ADMIN are denied — TOTP is mandatory for them)
	ActionDisableTOTP httpx.Action = "auth.totp_disable"
)

// TOTPCodeFromURI derives the current RFC-6238 TOTP code from an otpauth://
// provisioning URI. Used by tests to generate a valid code after enrolment.
func TOTPCodeFromURI(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("totpCodeFromURI: parse uri: %w", err)
	}
	secret := u.Query().Get("secret")
	if secret == "" {
		return "", fmt.Errorf("totpCodeFromURI: no secret in uri")
	}
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		return "", fmt.Errorf("totpCodeFromURI: generate: %w", err)
	}
	return code, nil
}
