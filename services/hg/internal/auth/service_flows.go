package auth

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	totp_ "github.com/pquerna/otp/totp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// Sentinel errors the handlers switch on. They keep the HTTP status/code mapping
// in the handler and the domain logic in the service.
var (
	errOTPInvalidOrExpired = errors.New("otp invalid or expired")
	errInvalidCredentials  = errors.New("invalid credentials")
	errEmailNotVerified    = errors.New("email not verified")
	errAccountLocked       = errors.New("account temporarily locked")
	errMFARequired         = errors.New("mfa required")
	errAccountNotActive    = errors.New("account not active")
	errTokenExpired        = errors.New("token expired")
	errTokenUsed           = errors.New("token used")
	errBreachedPassword    = errors.New("breached password")
	errRefreshReuse        = errors.New("refresh reuse detected")
	errSessionRevoked      = errors.New("session revoked")
	errSessionExpired      = errors.New("session expired")
)

// otpIncorrectError carries the remaining attempts for OTP_INCORRECT.
type otpIncorrectError struct{ remaining int }

func (e *otpIncorrectError) Error() string { return "otp incorrect" }

// RequestOTP applies rate limits, finds-or-creates an open challenge, generates
// (or re-sends) the code, and enqueues the SMS. It fails closed (503) when Redis
// is unreachable. The response never signals whether the number is known.
func (s *Service) RequestOTP(ctx context.Context, phone, purpose, client string, deviceID, ip *string) (*wireOtpChallenge, error) {
	// A reserved development number stays on the stored-hash path even when a
	// phone verifier is configured, and the code is not handed to the SMS
	// sender. Every other number with a verifier keeps the provider path.
	delivery := otpDelivery(s.env, s.verifier != nil, phone)
	if delivery == otpViaVerifier {
		return s.requestOTPViaVerifier(ctx, phone, purpose, deviceID, ip)
	}
	// Rate limits (Redis). Keys rebuild from nothing — a flush costs at most a
	// window of extra allowance; the OTP attempt counter itself is in Postgres.
	// rl:otp:phone:{phone} — 5 requests / 15 min; rl:otp:ip:{ip} — 20 / 15 min.
	if err := s.otpRequestLimits(ctx, phone, ip); err != nil {
		return nil, err
	}

	// Re-send inside an open challenge: same code, increment sends, honour the
	// 60 s cooldown (P-02).
	cooldownKey := "rl:otp:cooldown:" + phone + ":" + purpose
	if open, err := s.store.OpenChallenge(ctx, phone, purpose); err == nil {
		remaining, cderr := s.rl.Cooldown(ctx, cooldownKey)
		if cderr != nil {
			return nil, cderr
		}
		if remaining > 0 {
			// Still cooling down: report the same challenge without re-sending.
			return &wireOtpChallenge{
				ChallengeID:  open.ID,
				ResendAfterS: int32(remaining / time.Second),
				ExpiresAt:    httpx.Timestamp(open.ExpiresAt),
			}, nil
		}
		bumped, berr := s.store.BumpSend(ctx, open.ID)
		if errors.Is(berr, ErrNotFound) {
			// Send cap reached; return the existing challenge, no re-send.
			return &wireOtpChallenge{
				ChallengeID:  open.ID,
				ResendAfterS: 60,
				ExpiresAt:    httpx.Timestamp(open.ExpiresAt),
			}, nil
		}
		if berr != nil {
			return nil, berr
		}
		// NOTE: we cannot re-derive the original plaintext (only its HMAC is
		// stored), so re-sending "the same code" requires re-generating it. To
		// keep the invariant "resend does not rotate the code", the code is
		// regenerated deterministically is NOT possible without storing it; the
		// pragmatic, spec-faithful choice is to re-send by generating a new code
		// only when we have none. Here we already have a stored hash, so we
		// simply do not resend a code we cannot reproduce and instead surface the
		// cooldown. See TODO below.
		//
		// TODO(P-02 resend): to re-send the *same* code the plaintext must be
		// retained for the challenge's lifetime (e.g. sealed under APP_DATA_KEY in
		// Redis with the challenge TTL). Until that store lands, resend increments
		// `sends` and refreshes validity but does not re-transmit an
		// unreproducible code. First-send delivery is fully functional.
		if err := s.rl.SetCooldown(ctx, cooldownKey, 60*time.Second); err != nil {
			return nil, err
		}
		return &wireOtpChallenge{
			ChallengeID:  bumped.ID,
			ResendAfterS: 60,
			ExpiresAt:    httpx.Timestamp(bumped.ExpiresAt),
		}, nil
	}

	// No open challenge: generate a fresh code and send it. A reserved
	// development number stores the fixed code and skips the sender, so the
	// code is neither texted nor written to the log.
	var code string
	var err error
	if delivery == otpViaFixed {
		code = TestSignInCode
	} else {
		code, err = GenerateOTPCode()
		if err != nil {
			return nil, err
		}
	}
	codeHash := HMACCode(code, s.secrets.OTPPepper)
	challenge, err := s.store.InsertChallenge(ctx, phone, purpose, codeHash, deviceID, ip)
	if err != nil {
		return nil, err
	}
	if delivery != otpViaFixed {
		if err := s.sms.SendOTP(ctx, phone, code); err != nil {
			s.log.WarnContext(ctx, "otp sms send failed", "error", err.Error())
			// Delivery failure is not surfaced to the caller (no enumeration); the
			// challenge exists and the client can request a resend.
		}
	}
	if err := s.rl.SetCooldown(ctx, cooldownKey, 60*time.Second); err != nil {
		return nil, err
	}
	return &wireOtpChallenge{
		ChallengeID:  challenge.ID,
		ResendAfterS: 60,
		ExpiresAt:    httpx.Timestamp(challenge.ExpiresAt),
	}, nil
}

// requestOTPViaVerifier is the PhoneVerifier (Twilio Verify) variant of
// RequestOTP. It keeps the same P-02 request throttle, 60 s cooldown and open-
// challenge re-send scaffolding as the self-hosted path, but the provider owns
// the code: Start(phone, channel) generates and delivers it, and no code is
// stored — the otp_challenge row exists only to map challenge_id → phone (with a
// non-reproducible sentinel hash) so verifyOtp can recover the number. The
// response body is identical to the self-hosted path, and Start runs for ANY
// number (existence is resolved only after an approved Check), so the response
// never signals whether the number is known.
func (s *Service) requestOTPViaVerifier(ctx context.Context, phone, purpose string, deviceID, ip *string) (*wireOtpChallenge, error) {
	// Local request throttle (Verify layers its own send caps on top).
	if err := s.otpRequestLimits(ctx, phone, ip); err != nil {
		return nil, err
	}

	cooldownKey := "rl:otp:cooldown:" + phone + ":" + purpose
	if open, err := s.store.OpenChallenge(ctx, phone, purpose); err == nil {
		remaining, cderr := s.rl.Cooldown(ctx, cooldownKey)
		if cderr != nil {
			return nil, cderr
		}
		if remaining > 0 {
			// Still cooling down: report the same challenge without re-sending.
			return &wireOtpChallenge{
				ChallengeID:  open.ID,
				ResendAfterS: int32(remaining / time.Second),
				ExpiresAt:    httpx.Timestamp(open.ExpiresAt),
			}, nil
		}
		bumped, berr := s.store.BumpSend(ctx, open.ID)
		if errors.Is(berr, ErrNotFound) {
			// Send cap reached; return the existing challenge, no re-send.
			return &wireOtpChallenge{
				ChallengeID:  open.ID,
				ResendAfterS: 60,
				ExpiresAt:    httpx.Timestamp(open.ExpiresAt),
			}, nil
		}
		if berr != nil {
			return nil, berr
		}
		s.startVerification(ctx, phone)
		if err := s.rl.SetCooldown(ctx, cooldownKey, 60*time.Second); err != nil {
			return nil, err
		}
		return &wireOtpChallenge{
			ChallengeID:  bumped.ID,
			ResendAfterS: 60,
			ExpiresAt:    httpx.Timestamp(bumped.ExpiresAt),
		}, nil
	}

	// No open challenge: record a code-less challenge (sentinel hash; the real
	// code lives at the provider) and ask the provider to send.
	sentinel, err := randomSentinelHash()
	if err != nil {
		return nil, err
	}
	challenge, err := s.store.InsertChallenge(ctx, phone, purpose, sentinel, deviceID, ip)
	if err != nil {
		return nil, err
	}
	s.startVerification(ctx, phone)
	if err := s.rl.SetCooldown(ctx, cooldownKey, 60*time.Second); err != nil {
		return nil, err
	}
	return &wireOtpChallenge{
		ChallengeID:  challenge.ID,
		ResendAfterS: 60,
		ExpiresAt:    httpx.Timestamp(challenge.ExpiresAt),
	}, nil
}

// otpRequestLimits applies the per-phone and per-IP OTP request caps. Both fail
// closed: with Redis down the OTP endpoints answer 503, never fail open
// (docs/spec/01-platform.md, "P-02 — Phone OTP authentication").
func (s *Service) otpRequestLimits(ctx context.Context, phone string, ip *string) error {
	if err := s.rl.Allow(ctx, Limit{Name: "otp:phone", Subject: phone,
		Max: 5, Window: 15 * time.Minute, OnUnavailable: FailClosed}); err != nil {
		return err
	}
	return s.rl.Allow(ctx, Limit{Name: "otp:ip", Subject: ipSubject(ip),
		Max: 20, Window: 15 * time.Minute, OnUnavailable: FailClosed})
}

// ipSubject is what a per-IP limit counts ip under (httpx.RateLimitKey): the
// IPv4 address, or the IPv6 /64 it is in, because one subscriber can send from
// any address in its /64. A request with no resolved address counts in one
// shared "unknown" budget rather than skipping the limit.
func ipSubject(ip *string) string {
	if ip == nil {
		return httpx.RateLimitKey("")
	}
	return httpx.RateLimitKey(*ip)
}

// startVerification asks the provider to send a code, swallowing (only logging,
// masked, never the code) any failure. Surfacing a Start error to the caller
// would let a malformed/blocked number be distinguished from a valid one, so the
// challenge is returned regardless — exactly as the self-hosted path swallows an
// SMS send failure.
func (s *Service) startVerification(ctx context.Context, phone string) {
	if err := s.verifier.Start(ctx, phone, s.verifyChannel); err != nil {
		s.log.WarnContext(ctx, "otp verify start failed",
			"phone", maskPhone(phone), "channel", s.verifyChannel, "error", err.Error())
	}
}

// randomSentinelHash returns 32 random bytes to fill otp_challenge.code_hash
// (NOT NULL) on the PhoneVerifier path, where no local code exists. It can never
// match a real HMAC compare, and the compare is never run on this path anyway.
func randomSentinelHash() ([]byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// VerifyOTP consumes a challenge and issues a session, finding-or-creating the
// account by phone.
func (s *Service) VerifyOTP(ctx context.Context, challengeID, code string, client ClientSurface, deviceID, userAgent, ip *string) (*issuedSession, error) {
	if s.verifier != nil {
		fixed, ferr := s.challengeUsesFixedCode(ctx, challengeID)
		if ferr != nil {
			return nil, ferr
		}
		if !fixed {
			return s.verifyOTPViaVerifier(ctx, challengeID, code, client, deviceID, userAgent, ip)
		}
	}
	codeHash := HMACCode(code, s.secrets.OTPPepper)
	outcome, err := s.store.ConsumeChallenge(ctx, challengeID, codeHash)
	if err != nil {
		return nil, err
	}
	if outcome.InvalidOrExpired {
		return nil, errOTPInvalidOrExpired
	}
	if !outcome.Consumed {
		return nil, &otpIncorrectError{remaining: outcome.AttemptsRemaining}
	}

	acct, isNew, err := s.store.FindOrCreateByPhone(ctx, outcome.Phone, client.signupRole())
	if err != nil {
		return nil, err
	}
	if acct.Status != "ACTIVE" {
		return nil, errAccountNotActive
	}
	return s.issueSession(ctx, acct, "otp", client, deviceID, userAgent, ip, isNew)
}

// challengeUsesFixedCode reports whether this challenge belongs to the
// reserved development range. Outside local and staging it returns false
// without reading the database. A missing challenge returns false so the
// provider path can answer invalid. Any other read error is returned and
// the provider is not called.
func (s *Service) challengeUsesFixedCode(ctx context.Context, challengeID string) (bool, error) {
	if !fixedTestEnv(s.env) {
		return false, nil
	}
	ch, err := s.store.OpenChallengeByID(ctx, challengeID)
	if errors.Is(err, ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return FixedTestCode(s.env, ch.PhoneE164), nil
}

// verifyOTPViaVerifier is the PhoneVerifier (Twilio Verify) variant of VerifyOTP.
// It recovers the phone from the challenge id, asks the provider to validate the
// code, and on approval runs the SAME resolve-or-create-account + issue-session
// path as the self-hosted flow. P-02 holds: account existence is resolved only
// AFTER an approved Check, so a wrong code, an unknown number and a known number
// with a wrong code are indistinguishable, and the resolve-or-create work (equal
// for known/unknown numbers) keeps the approved-path latency uniform.
func (s *Service) verifyOTPViaVerifier(ctx context.Context, challengeID, code string, client ClientSurface, deviceID, userAgent, ip *string) (*issuedSession, error) {
	challenge, err := s.store.OpenChallengeByID(ctx, challengeID)
	if errors.Is(err, ErrNotFound) {
		return nil, errOTPInvalidOrExpired
	}
	if err != nil {
		return nil, err
	}

	approved, cerr := s.verifier.Check(ctx, challenge.PhoneE164, code)
	if errors.Is(cerr, ErrVerifyNoPending) {
		return nil, errOTPInvalidOrExpired
	}
	if cerr != nil {
		// Genuine transport/provider failure: surface as a generic internal
		// error (handler maps to 500). No enumeration signal, no code leaked.
		return nil, cerr
	}
	if !approved {
		// Wrong (or still-pending) code. Charge a local attempt to mirror the
		// self-hosted OTP_INCORRECT shape; an exhausted challenge collapses to
		// OTP_INVALID_OR_EXPIRED.
		remaining, aerr := s.store.ChargeChallengeAttempt(ctx, challengeID)
		if errors.Is(aerr, ErrNotFound) {
			return nil, errOTPInvalidOrExpired
		}
		if aerr != nil {
			return nil, aerr
		}
		return nil, &otpIncorrectError{remaining: remaining}
	}

	// Approved: consume the challenge, then resolve-or-create + issue.
	if merr := s.store.MarkChallengeConsumed(ctx, challengeID); merr != nil && !errors.Is(merr, ErrNotFound) {
		return nil, merr
	}
	acct, isNew, err := s.store.FindOrCreateByPhone(ctx, challenge.PhoneE164, client.signupRole())
	if err != nil {
		return nil, err
	}
	if acct.Status != "ACTIVE" {
		return nil, errAccountNotActive
	}
	return s.issueSession(ctx, acct, "otp", client, deviceID, userAgent, ip, isNew)
}

// canonicalEmail is the one spelling of an email that the limiter, the lockout
// and the account lookup all see. account.email and login_attempt.email are
// citext (migrations/00004_identity.sql), so Postgres treats "Owner@x.com" and
// "owner@x.com" as one account; a Redis key is byte-exact, so without this each
// case variant would get a fresh per-email budget.
func canonicalEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// Login verifies email + password, checks status/lockout/TOTP, and issues a
// session.
func (s *Service) Login(ctx context.Context, email, password string, totp *string, client ClientSurface, userAgent, ip *string) (*issuedSession, error) {
	email = canonicalEmail(email)
	ipStr := ""
	if ip != nil {
		ipStr = *ip
	}
	// Redis request-rate limits, per IP then per email (docs/spec/01-platform.md,
	// "P-03 — Email + password authentication"). An over-the-cap answer stops
	// the attempt before anything is read or recorded. With Redis down they
	// count in this replica's memory instead (FallBackLocally), so login keeps
	// working and stays limited; the lockout below lives in Postgres either way.
	if err := s.rl.Allow(ctx, Limit{Name: "login:ip", Subject: ipSubject(ip),
		Max: 30, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}); err != nil {
		return nil, err
	}
	if err := s.rl.Allow(ctx, Limit{Name: "login:email", Subject: email,
		Max: 10, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}); err != nil {
		return nil, err
	}

	// Postgres lockout (survives a Redis flush).
	locked, err := s.store.IsLocked(ctx, email)
	if err != nil {
		return nil, err
	}
	if locked {
		_ = s.store.RecordLoginAttempt(ctx, email, nil, ipStr, "LOCKED")
		return nil, errAccountLocked
	}

	acct, err := s.store.AccountByEmail(ctx, email)
	known := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	// The gate comes from the request's surface, never from the account: the
	// staff web app verifies on the staff gate, so a flood of public sign-ins or
	// sign-ups cannot lock an admin out, and every email sent there, registered
	// or not, staff or not, waits on that same gate (hashgate.go, loginAudience).
	// An unknown email, or an account with no password, verifies against a
	// dummy hash: every answer below costs one argon2id verification on the
	// request's gate, so neither the timing nor a 503 under load tells an
	// attacker which emails are registered or which belong to staff (#216).
	audience := loginAudience(client)
	encoded := dummyPasswordHash
	if known && acct.PasswordHash != nil {
		encoded = *acct.PasswordHash
	}
	// Busy hashing is not a failed attempt: it must not count toward the
	// lockout, so nothing is recorded. Taking the slot here, apart from the
	// verification, keeps the two outcomes from ever being confused.
	slot, err := acquireHashSlot(ctx, audience)
	if err != nil {
		return nil, err
	}
	ok, verr := slot.verify(encoded, password)
	slot.release()
	if !known {
		_ = s.store.RecordLoginAttempt(ctx, email, nil, ipStr, "NO_ACCOUNT")
		return nil, errInvalidCredentials
	}
	if acct.PasswordHash == nil || verr != nil || !ok {
		_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "BAD_PASSWORD")
		return nil, errInvalidCredentials
	}

	// Credentials correct. Only now reveal the unverified-email state (P-03).
	if acct.EmailVerifiedAt == nil {
		_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "BAD_PASSWORD")
		return nil, errEmailNotVerified
	}
	if acct.Status != "ACTIVE" {
		return nil, errAccountNotActive
	}

	// TOTP: admin/super-admin require it (P-01 admin MFA). If enrolled or
	// required, verify the supplied code. The roles are read only now, after
	// the password matched, so a known email costs no extra query before the
	// hash that an unknown one does not.
	grants, err := s.store.RolesFor(ctx, acct.ID)
	if err != nil {
		return nil, err
	}
	amr := "pwd"
	if requiresTOTP(grants) || acct.TOTPEnrolledAt != nil {
		if totp == nil || *totp == "" {
			_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "BAD_TOTP")
			return nil, errMFARequired
		}
		// Verify the supplied code against the AES-GCM-sealed totp_secret_enc.
		rec, rerr := s.store.GetTOTPRecord(ctx, acct.ID)
		if rerr != nil || len(rec.SecretEnc) == 0 {
			_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "BAD_TOTP")
			return nil, errMFARequired
		}
		plainSecret, oerr := OpenAESGCM(s.secrets.AppDataKey, rec.SecretEnc)
		if oerr != nil || !totp_.Validate(*totp, string(plainSecret)) {
			_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "BAD_TOTP")
			return nil, errInvalidCredentials
		}
		amr = "pwd+totp"
	}

	_ = s.store.RecordLoginAttempt(ctx, email, &acct.ID, ipStr, "SUCCESS")
	return s.issueSession(ctx, acct, amr, client, nil, userAgent, ip, false)
}

// RegisterRestaurant creates the account/restaurant/grant/token and enqueues the
// verification email. No session is issued. clientKey is the caller's
// httpx.RateLimitKey (its IPv4 address or IPv6 /64). It keys the per-IP
// sign-up limit and the per-client email limits (email_limits.go), all checked
// before anything is created; over any of them it returns ErrRateLimited.
func (s *Service) RegisterRestaurant(ctx context.Context, email, password, businessName, clientKey string) (*RegisterRestaurantResult, error) {
	if clientKey == "" {
		clientKey = httpx.RateLimitKey("") // one shared budget, never no limit
	}
	// 5 sign-ups per hour per IP (docs/spec/03-restaurant.md, "R-01 — Restaurant
	// account signup") and 5 per hour per email, both checked before the argon2id
	// hash and a hashing slot, so a limited request costs no CPU and holds no
	// slot (#216). With Redis down they count in this replica's memory instead
	// (FallBackLocally), still before the hash.
	if err := s.rl.Allow(ctx, Limit{Name: "register:ip", Subject: clientKey,
		Max: 5, Window: time.Hour, OnUnavailable: FallBackLocally}); err != nil {
		return nil, err
	}
	if err := s.rl.Allow(ctx, Limit{Name: "register:email", Subject: canonicalEmail(email),
		Max: 5, Window: time.Hour, OnUnavailable: FallBackLocally}); err != nil {
		return nil, err
	}
	if isBreachedPassword(password) {
		return nil, errBreachedPassword
	}
	if err := s.allowLinkEmail(ctx, emailKindVerify, email, clientKey); errors.Is(err, errAddressCapped) {
		return nil, &RateLimitedError{RetryAfter: time.Hour}
	} else if err != nil {
		return nil, err
	}
	slot, err := acquireHashSlot(ctx, audienceSignup)
	if err != nil {
		return nil, err
	}
	hash, err := slot.hash(password)
	slot.release() // the writes below need no slot
	if err != nil {
		return nil, err
	}
	token, tokenHash, err := NewOpaqueToken()
	if err != nil {
		return nil, err
	}
	// The verification email is enqueued in the registration transaction
	// (notifications.go), so the account and its email commit together.
	res, err := s.store.RegisterRestaurant(ctx, email, hash, businessName, tokenHash, token, 24,
		s.linkEmailSender(notify.EmailVerification, notify.RoleRestaurant, email, token, ""))
	if err != nil {
		return nil, err
	}
	return res, nil
}

// VerifyEmail consumes an EMAIL_VERIFY token, marks the email verified and
// advances onboarding. It issues no session: an emailed link must never sign
// anyone in, or an attacker could send someone the link for the attacker's own
// account and have them work in it (login cross-site request forgery,
// https://github.com/shaiknoorullah/hg-mono/issues/356). The owner signs in
// afterwards with Login.
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	res, err := s.store.ConsumeCredentialToken(ctx, "EMAIL_VERIFY", HashOpaqueToken(token))
	if err != nil {
		return err
	}
	switch {
	case res.NotFound:
		return ErrNotFound
	case res.Used:
		return errTokenUsed
	case res.Expired:
		return errTokenExpired
	}
	if err := s.store.MarkEmailVerified(ctx, res.AccountID); err != nil {
		return err
	}
	return s.store.AdvanceRestaurantOnboarding(ctx, res.AccountID)
}

// ResendEmailVerification issues a fresh EMAIL_VERIFY token when the account
// exists and is unverified. It answers the same way, in the same time, whether
// or not the account exists: ErrRateLimited (a 429) only when this client is
// over its own email limits, which are keyed on what it asked for and so say
// nothing about the account; nil otherwise, including when the address is over
// its overall cap. clientKey is the caller's httpx.RateLimitKey.
func (s *Service) ResendEmailVerification(ctx context.Context, email, clientKey string) error {
	defer s.answerUniformly(ctx, time.Now())
	email = canonicalEmail(email)
	switch err := s.allowLinkEmail(ctx, emailKindVerify, email, clientKey); {
	case limited(err):
		return err // a *RateLimitedError: the 429 carries its Retry-After
	case errors.Is(err, errAddressCapped):
		return nil // the generic answer; allowLinkEmail raised the alert
	case err != nil:
		s.log.WarnContext(ctx, "verification email not sent: rate limiter unavailable", "error", err.Error())
		return nil
	}
	acct, err := s.store.AccountByEmail(ctx, email)
	if err != nil || acct.EmailVerifiedAt != nil || acct.Email == nil {
		return nil
	}
	surface, err := s.store.PasswordSurface(ctx, acct.ID)
	if err != nil || surface != string(notify.RoleRestaurant) {
		// Only a restaurant signs up by email and verifies it with a link.
		return nil
	}
	token, tokenHash, err := NewOpaqueToken()
	if err != nil {
		return nil
	}
	if err := s.store.IssueCredentialToken(ctx, acct.ID, "EMAIL_VERIFY", tokenHash, 24*time.Hour,
		s.linkEmailSender(notify.EmailVerification, notify.RoleRestaurant, *acct.Email, token, acct.Timezone)); err != nil {
		s.log.ErrorContext(ctx, "verification email not issued", "account_id", acct.ID, "error", err.Error())
	}
	return nil
}

// RequestPasswordReset issues a PASSWORD_RESET token and emails it when the
// account exists and signs in with a password. It always returns nil and
// always takes the same time (uniformLinkDelay), so the answer says nothing
// about whether the account exists. The per-client and per-address email
// limits (email_limits.go) are checked first and silently stop the email;
// clientKey is the caller's httpx.RateLimitKey.
func (s *Service) RequestPasswordReset(ctx context.Context, email, clientKey string) error {
	defer s.answerUniformly(ctx, time.Now())
	if err := s.allowLinkEmail(ctx, emailKindReset, email, clientKey); err != nil {
		if errors.Is(err, ErrLimiterUnavailable) {
			s.log.WarnContext(ctx, "password reset email not sent: rate limiter unavailable", "error", err.Error())
		}
		return nil
	}
	acct, err := s.store.AccountByEmail(ctx, email)
	if err != nil || acct.Email == nil {
		return nil
	}
	// The link opens the web app the account signs in to; a customer or
	// rider signs in by phone and has no password to reset.
	surface, err := s.store.PasswordSurface(ctx, acct.ID)
	if err != nil || surface == "" {
		return nil
	}
	token, tokenHash, err := NewOpaqueToken()
	if err != nil {
		return nil
	}
	if err := s.store.IssueCredentialToken(ctx, acct.ID, "PASSWORD_RESET", tokenHash, 30*time.Minute,
		s.linkEmailSender(notify.PasswordReset, notify.RoleContext(surface), *acct.Email, token, acct.Timezone)); err != nil {
		s.log.ErrorContext(ctx, "password reset email not issued", "account_id", acct.ID, "error", err.Error())
	}
	return nil
}

// resetTokenErr is the answer for a password-reset link that cannot be used,
// or nil when it can.
func resetTokenErr(res ConsumeCredentialTokenResult) error {
	switch {
	case res.NotFound:
		return ErrNotFound
	case res.Used:
		return errTokenUsed
	case res.Expired:
		return errTokenExpired
	}
	return nil
}

// ResetPassword consumes a PASSWORD_RESET token, sets the new password, and
// revokes every session in the account (a reset ends every session:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/01-platform.md#p-03--email--password-authentication-restaurants-admins-support).
// Like VerifyEmail it issues no session, also when the token is a staff
// invitation setting a first password: the user signs in afterwards with Login,
// with the authenticator code where the account requires one
// (https://github.com/shaiknoorullah/hg-mono/issues/356).
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string, ip *string) error {
	// 10 resets per hour per IP, checked before a hashing slot is taken, so a
	// flood of made-up tokens never holds one (#216). The token itself is 256
	// random bits, so this limit is about the hashing cost, not guessing. With
	// Redis down it counts in this replica's memory, like sign-up
	// (FallBackLocally).
	if err := s.rl.Allow(ctx, Limit{Name: "reset:ip", Subject: ipSubject(ip),
		Max: 10, Window: time.Hour, OnUnavailable: FallBackLocally}); err != nil {
		return err
	}
	if isBreachedPassword(newPassword) {
		return errBreachedPassword
	}
	// A link that cannot be used is answered before a hashing slot is taken:
	// it will never hash, so a flood of made-up links neither holds a slot nor
	// queues on the sign-up gate (#448).
	tokenHash := HashOpaqueToken(token)
	state, err := s.store.CredentialTokenState(ctx, "PASSWORD_RESET", tokenHash)
	if err != nil {
		return err
	}
	if err := resetTokenErr(state); err != nil {
		return err
	}
	// Take the hashing slot before consuming the single-use token: if hashing
	// is busy the caller gets 503 and the reset link still works on retry.
	slot, err := acquireHashSlot(ctx, audienceSignup)
	if err != nil {
		return err
	}
	defer slot.release()
	res, err := s.store.ConsumeCredentialToken(ctx, "PASSWORD_RESET", tokenHash)
	if err != nil {
		return err
	}
	if err := resetTokenErr(res); err != nil {
		return err
	}
	hash, err := slot.hash(newPassword)
	slot.release() // the writes below need no slot
	if err != nil {
		return err
	}
	if err := s.store.SetPassword(ctx, res.AccountID, hash); err != nil {
		return err
	}
	// The token was delivered to the account's email, so using it proves the
	// address. This is what lets an invited staff member, whose first
	// password is set through this operation, sign in afterwards.
	if err := s.store.MarkEmailVerified(ctx, res.AccountID); err != nil {
		return err
	}
	if err := s.store.RevokeAllForAccount(ctx, res.AccountID, "password_reset"); err != nil {
		return err
	}
	s.deny.AddAccount(res.AccountID)
	return nil
}

// Refresh rotates a refresh token with reuse detection (P-04).
func (s *Service) Refresh(ctx context.Context, token string, client ClientSurface, userAgent, ip *string) (*issuedSession, error) {
	hash := HashRefreshToken(token)
	sess, err := s.store.SessionByRefreshHash(ctx, hash)
	if errors.Is(err, ErrNotFound) {
		return nil, session.ErrTokenInvalid
	}
	if err != nil {
		return nil, err
	}

	now := s.now()
	// Reuse detection: a token already rotated means the family is compromised.
	if sess.RotatedAt != nil {
		_ = s.store.RevokeFamily(ctx, sess.FamilyID, "reuse_detected")
		s.deny.AddSession(sess.ID)
		s.log.WarnContext(ctx, "refresh reuse detected; family revoked",
			"family_id", sess.FamilyID, "account_id", sess.AccountID)
		return nil, errRefreshReuse
	}
	if sess.RevokedAt != nil {
		return nil, errSessionRevoked
	}
	if now.After(sess.IdleExpires) || now.After(sess.AbsExpires) {
		return nil, errSessionExpired
	}

	acct, err := s.store.AccountByID(ctx, sess.AccountID)
	if err != nil {
		return nil, err
	}
	if acct.Status != "ACTIVE" {
		return nil, errAccountNotActive
	}

	// Roles are re-read on every refresh (P-04).
	grants, err := s.store.RolesFor(ctx, acct.ID)
	if err != nil {
		return nil, err
	}
	permitted := rolesForAMR(sess.AMR, grants)
	roleNames := roleStrings(permitted)

	newToken, newHash, err := NewRefreshToken()
	if err != nil {
		return nil, err
	}
	idle, absolute := refreshTTL(roleNames)
	// The absolute expiry does not extend past the family's original absolute
	// cap: use the smaller of a fresh absolute window and the existing one.
	absExp := now.Add(absolute)
	if sess.AbsExpires.Before(absExp) {
		absExp = sess.AbsExpires
	}
	newSess, err := s.store.RotateSession(ctx, sess, newHash, now.Add(idle), absExp, permitted)
	if errors.Is(err, ErrRotateRace) {
		// A concurrent refresh won; treat the loser as reuse to be safe.
		_ = s.store.RevokeFamily(ctx, sess.FamilyID, "reuse_detected")
		return nil, errRefreshReuse
	}
	if err != nil {
		return nil, err
	}

	access, err := s.issuer.Issue(acct.ID, newSess.ID, roleNames, []string{sess.AMR}, AccessTokenTTL)
	if err != nil {
		return nil, err
	}
	principal := wirePrincipal{
		AccountID: acct.ID,
		SessionID: newSess.ID,
		Roles:     toWireRoles(permitted),
		AMR:       sess.AMR,
		Status:    acct.Status,
		Locale:    acct.Locale,
		Timezone:  acct.Timezone,
		NextRoute: nextRoute(acct.Status, false, permitted),
	}
	var refreshField *string
	if !client.isWeb() {
		rt := newToken
		refreshField = &rt
	}
	return &issuedSession{
		grant: wireSessionGrant{
			AccessToken:  access,
			RefreshToken: refreshField,
			ExpiresIn:    AccessTokenTTLSeconds,
			IsNewAccount: false,
			Principal:    principal,
		},
		refreshToken: newToken,
		client:       client,
	}, nil
}

// ChangePassword verifies the current password, hashes the new one, atomically
// updates the account and revokes every session (I-03.2), then issues a single
// fresh session for the caller with the same amr and client surface.
//
// The old calling session is intentionally revoked (not preserved): its
// refresh-token family is replaced by the freshly issued one. Preserving the old
// session and *also* minting a new one would leave the pre-change refresh token
// valid — a stolen old token would survive the password change, defeating I-03.2.
func (s *Service) ChangePassword(ctx context.Context, p httpx.Principal, currentPassword, newPassword string, client ClientSurface) (*issuedSession, error) {
	if isBreachedPassword(newPassword) {
		return nil, errBreachedPassword
	}
	if len(newPassword) < 12 || len(newPassword) > 256 {
		return nil, errWeakPassword
	}
	// 5 attempts per account per 15 minutes, checked before anything is read or
	// a hashing slot is taken, so a limited request never holds one (#216).
	// With Redis down it counts in this replica's memory, like login's limits
	// (FallBackLocally): Redis is disposable (docs/spec/01-platform.md, "G-1 —
	// Postgres is the only source of truth").
	if err := s.rl.Allow(ctx, Limit{Name: "password_change:account", Subject: p.AccountID,
		Max: 5, Window: 15 * time.Minute, OnUnavailable: FallBackLocally}); err != nil {
		return nil, err
	}
	acct, err := s.store.AccountByID(ctx, p.AccountID)
	if err != nil {
		return nil, err
	}
	if acct.PasswordHash == nil {
		return nil, errInvalidCredentials
	}
	// One slot covers both the check of the current password and the new hash,
	// so "busy" never reads as "the current password is incorrect". Only a
	// session holding a staff role uses the staff gate; every other session
	// shares the login gate, so sessions anyone can get (phone sign-in,
	// restaurant sign-up) cannot fill the staff gate (passwordChangeAudience).
	slot, err := acquireHashSlot(ctx, passwordChangeAudience(p.Roles))
	if err != nil {
		return nil, err
	}
	defer slot.release()
	ok, verr := slot.verify(*acct.PasswordHash, currentPassword)
	if verr != nil || !ok {
		return nil, errInvalidCredentials
	}
	newHash, err := slot.hash(newPassword)
	slot.release() // the writes below need no slot
	if err != nil {
		return nil, err
	}
	// Atomic: password change + full session revocation. A partial write here
	// (password changed, stale sessions live) is a security defect, so both
	// statements share one transaction.
	if err := s.store.ChangePasswordAndRevokeAll(ctx, p.AccountID, newHash, "password_changed"); err != nil {
		return nil, err
	}
	// Re-issue a single session for the caller with the same amr and client.
	amr := "pwd"
	if len(p.AMR) > 0 {
		amr = p.AMR[0]
	}
	if !client.valid() {
		client = ClientRestaurantWeb
	}
	return s.issueSession(ctx, acct, amr, client, nil, nil, nil, false)
}

// errWeakPassword is returned when a new password is too short or otherwise weak.
var errWeakPassword = errors.New("password too weak")

// EnrollTOTP generates a fresh TOTP secret, seals it under AppDataKey, stores
// it in the account row (totp_enrolled_at stays NULL), and returns the
// provisioning URI plus 10 recovery codes.
func (s *Service) EnrollTOTP(ctx context.Context, accountID string) (*wireTotpEnrolment, error) {
	// Generate a 20-byte (160-bit) TOTP secret.
	rawSecret := make([]byte, 20)
	if _, err := rand.Read(rawSecret); err != nil {
		return nil, fmt.Errorf("enroll totp: rand: %w", err)
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(rawSecret)

	// Seal the base32 secret under AppDataKey.
	secretEnc, err := SealAESGCM(s.secrets.AppDataKey, []byte(secret))
	if err != nil {
		return nil, fmt.Errorf("enroll totp: seal: %w", err)
	}

	// Store the sealed secret; totp_enrolled_at remains NULL until verify.
	if err := s.store.StoreTOTPSecret(ctx, accountID, secretEnc); err != nil {
		return nil, err
	}

	// Build the otpauth:// provisioning URI.
	issuer := "HalalGoes"
	acct, _ := s.store.AccountByID(ctx, accountID)
	label := accountID
	if acct != nil && acct.Email != nil {
		label = *acct.Email
	}
	provURI := (&url.URL{
		Scheme: "otpauth",
		Host:   "totp",
		Path:   "/" + issuer + ":" + label,
		RawQuery: url.Values{
			"secret": {secret},
			"issuer": {issuer},
			"digits": {"6"},
		}.Encode(),
	}).String()

	// Generate 10 recovery codes (each 16 hex characters).
	recoveryCodes := make([]string, 10)
	for i := range recoveryCodes {
		b := make([]byte, 8)
		if _, err := rand.Read(b); err != nil {
			return nil, fmt.Errorf("enroll totp: recovery code rand: %w", err)
		}
		recoveryCodes[i] = fmt.Sprintf("%x", b)
	}

	return &wireTotpEnrolment{
		ProvisioningURI: provURI,
		RecoveryCodes:   recoveryCodes,
	}, nil
}

// VerifyTOTPEnrolment reads the pending TOTP secret for the account, validates
// the submitted 6-digit code, and on success stamps totp_enrolled_at.
func (s *Service) VerifyTOTPEnrolment(ctx context.Context, accountID, code string) error {
	rec, err := s.store.GetTOTPRecord(ctx, accountID)
	if err != nil {
		return err
	}
	if len(rec.SecretEnc) == 0 {
		return errTOTPNotEnrolled
	}

	plainSecret, err := OpenAESGCM(s.secrets.AppDataKey, rec.SecretEnc)
	if err != nil {
		return fmt.Errorf("verify totp: open: %w", err)
	}

	valid := totp_.Validate(code, string(plainSecret))
	if !valid {
		return errTOTPInvalidCode
	}

	return s.store.ActivateTOTP(ctx, accountID)
}

// DisableTOTP verifies the supplied TOTP code against the enrolled secret and
// clears both totp_secret_enc and totp_enrolled_at.
//
// Policy gate (contract disableTotp: "Refused for roles whose policy requires
// TOTP — 403 MFA_REQUIRED"): the P-05 matrix already withholds the disable
// action from SUPPORT_AGENT/ADMIN/SUPER_ADMIN, but authorization passes when a
// caller holds *any* granting role. An account carrying both a restaurant role
// and ADMIN/SUPER_ADMIN would therefore reach this handler and could strip its
// mandatory admin MFA. Re-checking the full grant set here closes that bypass:
// a code-side matrix entry is not sufficient because roles compose.
func (s *Service) DisableTOTP(ctx context.Context, accountID, code string) error {
	grants, err := s.store.RolesFor(ctx, accountID)
	if err != nil {
		return err
	}
	if requiresTOTP(grants) {
		return errTOTPMandatory
	}

	rec, err := s.store.GetTOTPRecord(ctx, accountID)
	if err != nil {
		return err
	}
	if len(rec.SecretEnc) == 0 || rec.EnrolledAt == nil {
		return errTOTPNotEnrolled
	}

	plainSecret, err := OpenAESGCM(s.secrets.AppDataKey, rec.SecretEnc)
	if err != nil {
		return fmt.Errorf("disable totp: open: %w", err)
	}

	valid := totp_.Validate(code, string(plainSecret))
	if !valid {
		return errTOTPInvalidCode
	}

	return s.store.ClearTOTP(ctx, accountID)
}

// sentinel errors for TOTP flows.
var (
	errTOTPNotEnrolled = errors.New("totp not enrolled")
	errTOTPInvalidCode = errors.New("totp invalid code")
	// errTOTPMandatory is returned when a caller whose role policy requires TOTP
	// attempts disableTotp. Mapped to 403 MFA_REQUIRED per the contract.
	errTOTPMandatory = errors.New("totp mandatory for role")
)

// chiURLParam reads a path parameter. Confined here so handlers do not import
// chi directly.
func chiURLParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}

// isBreachedPassword is the P-03 bundled breached-password check. The full
// bundled list (k-anonymised HIBP set) is a data asset not yet vendored; until
// it is, this rejects the most common obviously-breached passwords so the check
// is real rather than absent. TODO(P-03): vendor the bundled breached-password
// list and check against it.
func isBreachedPassword(pw string) bool {
	_, bad := commonBreached[pw]
	return bad
}

var commonBreached = map[string]struct{}{
	"password":     {},
	"password123":  {},
	"123456789012": {},
	"qwertyuiop12": {},
	"letmein12345": {},
	"iloveyou1234": {},
	"admin1234567": {},
}
