package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// Handler serves the auth operations. It is thin: parse, validate, call the
// service, render the contract shape.
type Handler struct {
	svc     *Service
	store   *Store
	deny    *session.DenySet
	secrets *Secrets
}

// NewHandler builds the auth handler.
func NewHandler(svc *Service, store *Store, deny *session.DenySet, secrets *Secrets) *Handler {
	return &Handler{svc: svc, store: store, deny: deny, secrets: secrets}
}

// ---- request bodies (contract inputs) --------------------------------------

type otpRequestInput struct {
	PhoneE164 string  `json:"phone_e164"`
	Purpose   string  `json:"purpose"`
	DeviceID  *string `json:"device_id"`
}

type otpVerifyInput struct {
	ChallengeID string  `json:"challenge_id"`
	Code        string  `json:"code"`
	DeviceID    *string `json:"device_id"`
}

type loginInput struct {
	Email    string  `json:"email"`
	Password string  `json:"password"`
	TOTPCode *string `json:"totp_code"`
}

type registerRestaurantInput struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	BusinessName string `json:"business_name"`
	TermsVersion string `json:"terms_version"`
}

type emailInput struct {
	Email string `json:"email"`
}

type tokenInput struct {
	Token string `json:"token"`
}

type resetPasswordInput struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

type refreshInput struct {
	RefreshToken string `json:"refresh_token"`
}

// decodeJSON reads a JSON body with unknown-field rejection (the contract sets
// additionalProperties:false everywhere).
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	// Reject trailing content.
	if dec.More() {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

// clientSurface reads and validates the X-HG-Client header.
func clientSurface(r *http.Request) (ClientSurface, bool) {
	c := ClientSurface(strings.TrimSpace(r.Header.Get("X-HG-Client")))
	return c, c.valid()
}

func clientIPPtr(r *http.Request) *string {
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		return nil
	}
	return &host
}

func userAgentPtr(r *http.Request) *string {
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	if ua == "" {
		return nil
	}
	if len(ua) > 512 {
		ua = ua[:512]
	}
	return &ua
}

// ---- OTP request (P-02) -----------------------------------------------------

// RequestOTP implements requestOtp. Always 200 with an identical body shape and
// no enumeration signal; fails closed (503) when Redis is unreachable.
func (h *Handler) RequestOTP(w http.ResponseWriter, r *http.Request) {
	client, ok := clientSurface(r)
	if !ok {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid X-HG-Client header is required.", nil)
		return
	}
	var in otpRequestInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if !ValidPhoneE164(in.PhoneE164) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeInvalidPhone,
			"The phone number is not a valid E.164 number.",
			[]httpx.FieldError{{Field: "phone_e164", Code: "format", Message: "must be E.164, e.g. +14165550123"}})
		return
	}
	if !OtpPurpose(in.Purpose).valid() {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The purpose is invalid.",
			[]httpx.FieldError{{Field: "purpose", Code: "enum", Message: "must be SIGN_IN, PHONE_CHANGE or STEP_UP"}})
		return
	}

	challenge, err := h.svc.RequestOTP(r.Context(), in.PhoneE164, in.Purpose, string(client), in.DeviceID, clientIPPtr(r))
	switch {
	case errors.Is(err, ErrLimiterUnavailable):
		httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeRateLimiterUnavailable,
			"Verification is temporarily unavailable. Please try again shortly.", nil)
		return
	case errors.Is(err, ErrRateLimited):
		w.Header().Set("Retry-After", "60")
		httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
			"Too many verification requests. Please wait before trying again.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, challenge)
}

// ---- OTP verify (P-02) ------------------------------------------------------

// VerifyOTP implements verifyOtp. Consumes the challenge, finds-or-creates the
// account, and issues a session.
func (h *Handler) VerifyOTP(w http.ResponseWriter, r *http.Request) {
	client, ok := clientSurface(r)
	if !ok {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid X-HG-Client header is required.", nil)
		return
	}
	var in otpVerifyInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if in.ChallengeID == "" || !otpCode.MatchString(in.Code) {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A challenge_id and a 6-digit code are required.", nil)
		return
	}

	issued, err := h.svc.VerifyOTP(r.Context(), in.ChallengeID, in.Code, client, in.DeviceID, userAgentPtr(r), clientIPPtr(r))
	switch {
	case errors.Is(err, errOTPInvalidOrExpired):
		httpx.Fail(w, r, http.StatusBadRequest, CodeOTPInvalidOrExpired,
			"This code is invalid or has expired. Request a new one.", nil)
		return
	case errors.Is(err, ErrLimiterUnavailable):
		httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeRateLimiterUnavailable,
			"Verification is temporarily unavailable. Please try again shortly.", nil)
		return
	case err != nil:
		var inc *otpIncorrectError
		if errors.As(err, &inc) {
			httpx.Fail(w, r, http.StatusBadRequest, CodeOTPIncorrect,
				"That code is incorrect.",
				map[string]any{"attempts_remaining": inc.remaining})
			return
		}
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.writeSessionGrant(w, r, issued, http.StatusOK)
}

// ---- login (P-03) -----------------------------------------------------------

// Login implements login. Argon2id verification, status check, TOTP where
// enrolled, Postgres-backed lockout.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	client, ok := clientSurface(r)
	if !ok {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid X-HG-Client header is required.", nil)
		return
	}
	var in loginInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if in.Email == "" || in.Password == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"Email and password are required.", nil)
		return
	}

	issued, err := h.svc.Login(r.Context(), in.Email, in.Password, in.TOTPCode, client, userAgentPtr(r), clientIPPtr(r))
	switch {
	case errors.Is(err, errInvalidCredentials):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeInvalidCredentials,
			"Those credentials are not valid.", nil)
		return
	case errors.Is(err, errEmailNotVerified):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeInvalidCredentials,
			"Those credentials are not valid.",
			map[string]any{"email_verification_required": true})
		return
	case errors.Is(err, errAccountLocked):
		w.Header().Set("Retry-After", "900")
		httpx.Fail(w, r, http.StatusTooManyRequests, CodeAccountTempLocked,
			"This account is temporarily locked after too many failed attempts.", nil)
		return
	case errors.Is(err, errMFARequired):
		httpx.Fail(w, r, http.StatusForbidden, CodeMFARequired,
			"A verification code is required to sign in.", nil)
		return
	case errors.Is(err, errAccountNotActive):
		httpx.Fail(w, r, http.StatusForbidden, CodeAccountNotActive,
			"This account is not active.", nil)
		return
	case errors.Is(err, ErrLimiterUnavailable):
		httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeRateLimiterUnavailable,
			"Sign-in is temporarily unavailable. Please try again shortly.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.writeSessionGrant(w, r, issued, http.StatusOK)
}

// ---- register restaurant (R-01) --------------------------------------------

// RegisterRestaurant implements registerRestaurant. No session is issued; a
// verification email is enqueued.
func (h *Handler) RegisterRestaurant(w http.ResponseWriter, r *http.Request) {
	var in registerRestaurantInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is invalid.", nil)
		return
	}
	if !validEmail(in.Email) || len(in.BusinessName) < 2 || len(in.BusinessName) > 120 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"Email and business_name are required and must be valid.", nil)
		return
	}
	if len(in.Password) < 12 || len(in.Password) > 256 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"Password must be between 12 and 256 characters.",
			[]httpx.FieldError{{Field: "password", Code: "length", Message: "12–256 characters"}})
		return
	}
	if in.TermsVersion != h.secrets.CurrentTermsVersion {
		httpx.Fail(w, r, http.StatusConflict, CodeTermsVersionStale,
			"The terms version is out of date.",
			map[string]any{"current": h.secrets.CurrentTermsVersion})
		return
	}

	reg, err := h.svc.RegisterRestaurant(r.Context(), in.Email, in.Password, in.BusinessName)
	switch {
	case errors.Is(err, ErrEmailInUse):
		httpx.Fail(w, r, http.StatusConflict, CodeEmailAlreadyRegistered,
			"An account with this email already exists.", nil)
		return
	case errors.Is(err, errBreachedPassword):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeBreachedPassword,
			"This password has appeared in a data breach. Choose another.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, wireRestaurantRegistration{
		RestaurantID:    reg.RestaurantID,
		Email:           in.Email,
		OnboardingState: reg.OnboardingState,
	})
}

// ---- email verification (R-02) ---------------------------------------------

// VerifyEmail implements verifyEmail. Consumes the token and issues a session.
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var in tokenInput
	if err := decodeJSON(r, &in); err != nil || len(in.Token) < 32 || len(in.Token) > 128 {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid token is required.", nil)
		return
	}
	client, _ := clientSurface(r)
	if !client.valid() {
		client = ClientRestaurantWeb
	}
	issued, err := h.svc.VerifyEmail(r.Context(), in.Token, client, userAgentPtr(r), clientIPPtr(r))
	switch {
	case errors.Is(err, errTokenExpired):
		httpx.Fail(w, r, http.StatusGone, CodeVerifyTokenExpired,
			"This verification link has expired.", nil)
		return
	case errors.Is(err, errTokenUsed):
		httpx.Fail(w, r, http.StatusGone, CodeVerifyTokenUsed,
			"This verification link has already been used.", nil)
		return
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, r, http.StatusGone, CodeVerifyTokenExpired,
			"This verification link is not valid.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.writeSessionGrant(w, r, issued, http.StatusOK)
}

// ---- resend email verification / forgot password (acknowledgement) ---------

// ResendEmailVerification implements resendEmailVerification. Identical response
// whether or not the account exists (no enumeration).
func (h *Handler) ResendEmailVerification(w http.ResponseWriter, r *http.Request) {
	var in emailInput
	if err := decodeJSON(r, &in); err != nil || !validEmail(in.Email) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"A valid email is required.", nil)
		return
	}
	if err := h.svc.ResendEmailVerification(r.Context(), in.Email); errors.Is(err, ErrRateLimited) {
		w.Header().Set("Retry-After", "60")
		httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
			"Please wait before requesting another email.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusAccepted, wireAcknowledgement{Acknowledged: true})
}

// RequestPasswordReset implements requestPasswordReset. Always 200, identical
// whether or not the account exists.
func (h *Handler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var in emailInput
	if err := decodeJSON(r, &in); err != nil || !validEmail(in.Email) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"A valid email is required.", nil)
		return
	}
	_ = h.svc.RequestPasswordReset(r.Context(), in.Email)
	httpx.Respond(w, r, http.StatusOK, wireAcknowledgement{Acknowledged: true})
}

// ResetPassword implements resetPassword. Sets the password and revokes every
// session in the account's family, then 204.
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var in resetPasswordInput
	if err := decodeJSON(r, &in); err != nil || len(in.Token) < 32 || len(in.Token) > 128 {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed,
			"A valid token is required.", nil)
		return
	}
	if len(in.NewPassword) < 12 || len(in.NewPassword) > 256 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"Password must be between 12 and 256 characters.", nil)
		return
	}
	err := h.svc.ResetPassword(r.Context(), in.Token, in.NewPassword)
	switch {
	case errors.Is(err, errTokenExpired), errors.Is(err, errTokenUsed), errors.Is(err, ErrNotFound):
		httpx.Fail(w, r, http.StatusBadRequest, CodeTokenConsumed,
			"This reset link is not valid.", nil)
		return
	case errors.Is(err, errBreachedPassword):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeBreachedPassword,
			"This password has appeared in a data breach. Choose another.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- refresh (P-04) ---------------------------------------------------------

// Refresh implements refreshSession. Rotating with reuse detection.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	token := h.refreshTokenFrom(r)
	if token == "" {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"A refresh token is required.", nil)
		return
	}
	client, ok := clientSurface(r)
	if !ok {
		client = ClientWeb
	}
	issued, err := h.svc.Refresh(r.Context(), token, client, userAgentPtr(r), clientIPPtr(r))
	switch {
	case errors.Is(err, errRefreshReuse):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeRefreshReuseDetected,
			"This session has been revoked for security. Please sign in again.", nil)
		return
	case errors.Is(err, errSessionRevoked):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeSessionRevoked,
			"This session has been revoked. Please sign in again.", nil)
		return
	case errors.Is(err, errSessionExpired):
		httpx.Fail(w, r, http.StatusUnauthorized, CodeSessionExpired,
			"This session has expired. Please sign in again.", nil)
		return
	case errors.Is(err, ErrNotFound), errors.Is(err, session.ErrTokenInvalid):
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"The refresh token is not valid.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.writeSessionGrant(w, r, issued, http.StatusOK)
}

// ---- logout / logout-all / revoke (P-04) -----------------------------------

// Logout implements logout. Idempotent: revoking an already-revoked own session
// still returns 204.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}
	if err := h.store.RevokeSessionForAccount(r.Context(), p.AccountID, p.SessionID, "logout"); err != nil && !errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.deny.AddSession(p.SessionID)
	w.WriteHeader(http.StatusNoContent)
}

// LogoutAll implements logoutAll. Revokes every session in the account.
func (h *Handler) LogoutAll(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}
	if err := h.store.RevokeAllForAccount(r.Context(), p.AccountID, "logout_all"); err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.deny.AddAccount(p.AccountID)
	w.WriteHeader(http.StatusNoContent)
}

// RevokeSession implements revokeSession. Ownership pushed into SQL: another
// account's session is invisible (404), never forbidden.
func (h *Handler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}
	sessionID := chiURLParam(r, "sessionId")
	err := h.store.RevokeSessionForAccount(r.Context(), p.AccountID, sessionID, "revoked_by_user")
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such session.", nil)
		return
	case err != nil:
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	h.deny.AddSession(sessionID)
	w.WriteHeader(http.StatusNoContent)
}

// ListSessions implements listSessions.
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}
	rows, err := h.store.ListLiveSessions(r.Context(), p.AccountID, 50)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	out := make([]wireSessionSummary, 0, len(rows))
	for _, s := range rows {
		out = append(out, wireSessionSummary{
			ID:         s.ID,
			Client:     s.Client,
			DeviceID:   s.DeviceID,
			IPCity:     s.IPCity,
			IssuedAt:   httpx.Timestamp(s.IssuedAt),
			LastUsedAt: httpx.Timestamp(s.LastUsedAt),
			IsCurrent:  s.ID == p.SessionID,
		})
	}
	httpx.RespondList(w, r, http.StatusOK, out, httpx.Meta{NextCursor: nil, HasMore: false})
}

// Me implements getCurrentPrincipal.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired,
			"Authentication is required.", nil)
		return
	}
	amr := ""
	if len(p.AMR) > 0 {
		amr = p.AMR[0]
	}
	principal, err := h.svc.principalFor(r.Context(), p.AccountID, p.SessionID, amr)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
			"The server failed to process this request.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, principal)
}

// ---- shared rendering -------------------------------------------------------

// writeSessionGrant renders a SessionGrant and, for web surfaces, sets the hg_rt
// refresh cookie (HttpOnly; Secure; SameSite=Lax; Path=/v1/auth) plus the
// hg_csrf double-submit cookie (P-04 transport).
func (h *Handler) writeSessionGrant(w http.ResponseWriter, r *http.Request, issued *issuedSession, status int) {
	if issued.client.isWeb() {
		idle, _ := refreshTTL(nil) // conservative Max-Age; the token's own expiry is authoritative
		http.SetCookie(w, &http.Cookie{
			Name:     "hg_rt",
			Value:    issued.refreshToken,
			Path:     "/v1/auth",
			HttpOnly: true,
			Secure:   h.secrets.RefreshCookieSecure,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   int(idle / time.Second),
		})
		// hg_csrf is readable by JS (not HttpOnly) for the double-submit check.
		if csrf, _, err := NewOpaqueToken(); err == nil {
			http.SetCookie(w, &http.Cookie{
				Name:     "hg_csrf",
				Value:    csrf,
				Path:     "/v1/auth",
				HttpOnly: false,
				Secure:   h.secrets.RefreshCookieSecure,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   int(idle / time.Second),
			})
		}
	}
	httpx.Respond(w, r, status, issued.grant)
}

// refreshTokenFrom reads the refresh token from the body (native) or the hg_rt
// cookie (web). Web callers must also present the X-HG-CSRF double-submit header
// matching the hg_csrf cookie (P-04 CSRF).
func (h *Handler) refreshTokenFrom(r *http.Request) string {
	// Native: body.
	if r.Body != nil {
		var in refreshInput
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<12))
		if len(body) > 0 {
			_ = json.Unmarshal(body, &in)
			if strings.HasPrefix(in.RefreshToken, "hgrt_") {
				return in.RefreshToken
			}
		}
	}
	// Web: hg_rt cookie, gated by the CSRF double-submit.
	if c, err := r.Cookie("hg_rt"); err == nil && c.Value != "" {
		csrfHeader := strings.TrimSpace(r.Header.Get("X-HG-CSRF"))
		csrfCookie, cerr := r.Cookie("hg_csrf")
		if csrfHeader == "" || cerr != nil || csrfCookie.Value == "" || csrfHeader != csrfCookie.Value {
			return ""
		}
		return c.Value
	}
	return ""
}

func validEmail(s string) bool {
	if len(s) < 3 || len(s) > 254 {
		return false
	}
	at := strings.IndexByte(s, '@')
	return at > 0 && at < len(s)-1 && !strings.ContainsAny(s, " \t\r\n")
}
