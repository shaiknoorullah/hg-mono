package auth

import (
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Routes registers the auth module's routes. Public operations are exactly those
// the contract marks x-roles:[PUBLIC]; everything else is guarded by a
// self-scoped action and deny-by-default.
func Routes(r *httpx.Router, h *Handler) {
	public := func(op string) httpx.Policy {
		return httpx.Policy{Public: true, Class: httpx.ClassAuth, OperationID: op}
	}
	publicIdem := func(op string) httpx.Policy {
		// registerRestaurant declares IdempotencyKeyRequired but is not MONEY
		// class; Idempotent extraction (stage 12) applies without the MONEY rule.
		return httpx.Policy{Public: true, Class: httpx.ClassAuth, Idempotent: true, OperationID: op}
	}
	revoke := func(op string) httpx.Policy {
		return httpx.Policy{Action: ActionSessionRevokeSelf, Class: httpx.ClassAuth, OperationID: op}
	}
	read := func(op string) httpx.Policy {
		return httpx.Policy{Action: ActionSessionReadSelf, Class: httpx.ClassRead, OperationID: op}
	}

	// Public (unauthenticated) operations.
	r.Post("/v1/auth/otp/request", public("requestOtp"), h.RequestOTP)
	r.Post("/v1/auth/otp/verify", public("verifyOtp"), h.VerifyOTP)
	r.Post("/v1/auth/register/restaurant", publicIdem("registerRestaurant"), h.RegisterRestaurant)
	r.Post("/v1/auth/email/verify", public("verifyEmail"), h.VerifyEmail)
	r.Post("/v1/auth/email/resend", public("resendEmailVerification"), h.ResendEmailVerification)
	r.Post("/v1/auth/login", public("login"), h.Login)
	r.Post("/v1/auth/refresh", public("refreshSession"), h.Refresh)
	r.Post("/v1/auth/password/forgot", public("requestPasswordReset"), h.RequestPasswordReset)
	r.Post("/v1/auth/password/reset", public("resetPassword"), h.ResetPassword)
	r.Post("/v1/auth/invite/totp", public("startInviteTotpEnrolment"), h.StartInviteTOTP)

	// Authenticated, self-scoped operations.
	r.Post("/v1/auth/logout", revoke("logout"), h.Logout)
	r.Post("/v1/auth/logout-all", revoke("logoutAll"), h.LogoutAll)
	r.Get("/v1/auth/sessions", read("listSessions"), h.ListSessions)
	r.Delete("/v1/auth/sessions/{sessionId}", revoke("revokeSession"), h.RevokeSession)
	r.Get("/v1/auth/me", read("getCurrentPrincipal"), h.Me)

	// Password change (P-03): all email/password roles.
	r.Post("/v1/auth/password/change",
		httpx.Policy{Action: ActionChangePassword, Class: httpx.ClassAuth, OperationID: "changePassword"},
		h.ChangePassword)

	// TOTP enrolment flow (P-01): enroll + verify for eligible roles;
	// disable for restaurant roles only.
	r.Post("/v1/auth/totp/enroll",
		httpx.Policy{Action: ActionEnrollTOTP, Class: httpx.ClassAuth, OperationID: "enrollTotp"},
		h.EnrollTOTP)
	r.Post("/v1/auth/totp/verify",
		httpx.Policy{Action: ActionVerifyTOTPEnrolment, Class: httpx.ClassAuth, OperationID: "verifyTotpEnrolment"},
		h.VerifyTOTPEnrolment)
	r.Post("/v1/auth/totp/disable",
		httpx.Policy{Action: ActionDisableTOTP, Class: httpx.ClassAuth, OperationID: "disableTotp"},
		h.DisableTOTP)
}

// PublicRouteAllowlist is the checked-in set of auth public routes (I-06.2).
// Making a route public is a visible diff in this reviewed list.
func PublicRouteAllowlist() []string {
	return []string{
		"POST /v1/auth/email/resend",
		"POST /v1/auth/email/verify",
		"POST /v1/auth/invite/totp",
		"POST /v1/auth/login",
		"POST /v1/auth/otp/request",
		"POST /v1/auth/otp/verify",
		"POST /v1/auth/password/forgot",
		"POST /v1/auth/password/reset",
		"POST /v1/auth/refresh",
		"POST /v1/auth/register/restaurant",
	}
}
