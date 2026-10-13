package auth

import (
	"context"
	"regexp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Auth-owned error codes. Each MUST exist in the contract's ErrorCode enum
// (contracts/openapi.yaml) — contract first, then code.
const (
	CodeOTPInvalidOrExpired    httpx.ErrorCode = "OTP_INVALID_OR_EXPIRED"
	CodeOTPIncorrect           httpx.ErrorCode = "OTP_INCORRECT"
	CodeInvalidPhone           httpx.ErrorCode = "INVALID_PHONE"
	CodeInvalidCredentials     httpx.ErrorCode = "INVALID_CREDENTIALS"
	CodeEmailNotVerified       httpx.ErrorCode = "EMAIL_NOT_VERIFIED"
	CodeEmailAlreadyRegistered httpx.ErrorCode = "EMAIL_ALREADY_REGISTERED"
	CodeTermsVersionStale      httpx.ErrorCode = "TERMS_VERSION_STALE"
	CodeBreachedPassword       httpx.ErrorCode = "BREACHED_PASSWORD"
	CodeAccountTempLocked      httpx.ErrorCode = "ACCOUNT_TEMPORARILY_LOCKED"
	CodeAccountLocked          httpx.ErrorCode = "ACCOUNT_LOCKED"
	CodeSessionRevoked         httpx.ErrorCode = "SESSION_REVOKED"
	CodeSessionExpired         httpx.ErrorCode = "SESSION_EXPIRED"
	CodeRefreshReuseDetected   httpx.ErrorCode = "REFRESH_REUSE_DETECTED"
	CodeTokenConsumed          httpx.ErrorCode = "TOKEN_CONSUMED"
	codeStepNotAvailable       httpx.ErrorCode = "STEP_NOT_AVAILABLE"
	CodeVerifyTokenExpired     httpx.ErrorCode = "VERIFICATION_TOKEN_EXPIRED"
	CodeVerifyTokenUsed        httpx.ErrorCode = "VERIFICATION_TOKEN_USED"
	CodeMFARequired            httpx.ErrorCode = "MFA_REQUIRED"
	CodeAccountSuspended       httpx.ErrorCode = "ACCOUNT_SUSPENDED"
	CodeAccountNotActive       httpx.ErrorCode = "ACCOUNT_NOT_ACTIVE"
	CodeAccountBanned          httpx.ErrorCode = "ACCOUNT_BANNED"
)

// e164 is the E.164 shape from the account_phone_e164_shape CHECK constraint. No
// country prefix is ever inferred; the client sends the full number (I-02.5).
var e164 = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// ValidPhoneE164 reports whether s is a syntactically valid E.164 number.
func ValidPhoneE164(s string) bool { return e164.MatchString(s) }

// otpCode is the 6-digit code shape.
var otpCode = regexp.MustCompile(`^[0-9]{6}$`)

// SMSSender delivers an OTP over SMS. O-03 (which provider) is unresolved, so no
// concrete implementation is wired at boot: the module accepts any SMSSender and
// the default is a LogSMSSender that records the send without a provider. This
// is the honest state — the interface and the call site are real; only the
// provider is pending.
type SMSSender interface {
	// SendOTP delivers code to phone. It must not return the code in any error.
	SendOTP(ctx context.Context, phone, code string) error
}

// OtpPurpose mirrors the otp_purpose enum / OtpRequestInput.purpose.
type OtpPurpose string

const (
	PurposeSignIn      OtpPurpose = "SIGN_IN"
	PurposePhoneChange OtpPurpose = "PHONE_CHANGE"
	PurposeStepUp      OtpPurpose = "STEP_UP"
)

func (p OtpPurpose) valid() bool {
	switch p {
	case PurposeSignIn, PurposePhoneChange, PurposeStepUp:
		return true
	}
	return false
}

// ClientSurface mirrors the client_surface enum. It selects the role granted on
// first OTP sign-up and the token transport, and is never trusted for
// authorization.
type ClientSurface string

const (
	ClientCustomerApp   ClientSurface = "customer-app"
	ClientRiderApp      ClientSurface = "rider-app"
	ClientRestaurantWeb ClientSurface = "restaurant-web"
	ClientAdminWeb      ClientSurface = "admin-web"
	ClientWeb           ClientSurface = "web"
)

func (c ClientSurface) valid() bool {
	switch c {
	case ClientCustomerApp, ClientRiderApp, ClientRestaurantWeb, ClientAdminWeb, ClientWeb:
		return true
	}
	return false
}

// isWeb reports whether the surface receives its refresh token as a cookie
// rather than in the response body (P-04 transport).
func (c ClientSurface) isWeb() bool {
	switch c {
	case ClientRestaurantWeb, ClientAdminWeb, ClientWeb:
		return true
	}
	return false
}

// signupRole is the role granted on first OTP sign-up for this surface. The
// rider app grants RIDER; everything else grants CUSTOMER (P-02).
func (c ClientSurface) signupRole() string {
	if c == ClientRiderApp {
		return "RIDER"
	}
	return "CUSTOMER"
}
