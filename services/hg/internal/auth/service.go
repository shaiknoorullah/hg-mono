package auth

import (
	"context"
	"log/slog"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// Service holds the auth module's collaborators. Handlers call it; it owns the
// orchestration (rate limits, crypto, store, token issue) so the HTTP layer
// stays thin.
type Service struct {
	store   *Store
	rl      *RateLimiter
	sms     SMSSender
	issuer  *session.Issuer
	deny    *session.DenySet
	secrets *Secrets
	log     *slog.Logger
	now     func() time.Time

	// verifier, when non-nil, replaces the self-hosted OTP path: the provider
	// generates, sends and validates the code, so no code is stored locally.
	// nil (the default) keeps the LogSMSSender / stored-challenge path, so dev
	// and the conformance suite are unchanged. Set once at wiring time via
	// UsePhoneVerifier; never mutated after boot.
	verifier      PhoneVerifier
	verifyChannel string

	// env is the process environment ("local", "staging", "production").
	// It gates the reserved development sign-in range. Empty refuses that
	// range. Set once from NewModule.
	env string

	// notify is the notification outbox the email flows enqueue into
	// (notifications.go). Nil sends nothing; set once at wiring time.
	notify notify.TxEnqueuer
	// linkEmailDelay is how long an unauthenticated email request takes
	// whatever happens (email_limits.go); tests shorten it.
	linkEmailDelay time.Duration
}

// UsePhoneVerifier switches this service onto the PhoneVerifier (Twilio Verify)
// path for requestOtp/verifyOtp. channel ("whatsapp" or "sms") is passed to
// Start. It is called once during wiring (see NewModule) and must not be called
// after the service is serving. A nil verifier is a no-op, leaving the
// self-hosted default in place.
func (s *Service) UsePhoneVerifier(v PhoneVerifier, channel string) {
	if v == nil {
		return
	}
	s.verifier = v
	s.verifyChannel = channel
}

// SetEnvironment records the process environment. The reserved development
// phone range accepts a fixed code only when env is local or staging.
// Called once from NewModule, before the service is serving.
func (s *Service) SetEnvironment(env string) {
	s.env = env
}

// NewService wires the service.
func NewService(store *Store, rl *RateLimiter, sms SMSSender, issuer *session.Issuer, deny *session.DenySet, secrets *Secrets, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{
		store: store, rl: rl, sms: sms, issuer: issuer, deny: deny,
		secrets: secrets, log: log, now: func() time.Time { return time.Now().UTC() },
		linkEmailDelay: uniformLinkDelay,
	}
}

// issuedSession is the internal result of minting a session, carrying both the
// wire grant and the refresh token so the handler can decide transport.
type issuedSession struct {
	grant        wireSessionGrant
	refreshToken string
	client       ClientSurface
}

// issueSession creates a session for an account with a given amr and returns the
// signed access token, refresh token and principal (P-04). Roles are filtered to
// those the amr permits (I-01.2).
func (s *Service) issueSession(ctx context.Context, acct *Account, amr string, client ClientSurface, deviceID, userAgent, ip *string, isNewAccount bool) (*issuedSession, error) {
	grants, err := s.store.RolesFor(ctx, acct.ID)
	if err != nil {
		return nil, err
	}
	permitted := rolesForAMR(amr, grants)
	roleNames := roleStrings(permitted)

	refreshToken, refreshHash, err := NewRefreshToken()
	if err != nil {
		return nil, err
	}
	idle, absolute := refreshTTL(roleNames)
	now := s.now()

	sess, err := s.store.CreateSession(ctx, NewSessionParams{
		AccountID:   acct.ID,
		AMR:         amr,
		Roles:       permitted,
		Client:      string(client),
		DeviceID:    deviceID,
		UserAgent:   userAgent,
		IP:          ip,
		RefreshHash: refreshHash,
		IdleExpires: now.Add(idle),
		AbsExpires:  now.Add(absolute),
	})
	if err != nil {
		return nil, err
	}

	access, err := s.issuer.Issue(acct.ID, sess.ID, roleNames, []string{amr}, AccessTokenTTL)
	if err != nil {
		return nil, err
	}

	principal := wirePrincipal{
		AccountID: acct.ID,
		SessionID: sess.ID,
		Roles:     toWireRoles(permitted),
		AMR:       amr,
		Status:    acct.Status,
		Locale:    acct.Locale,
		Timezone:  acct.Timezone,
		NextRoute: nextRoute(acct.Status, isNewAccount, permitted),
	}

	var refreshField *string
	if !client.isWeb() {
		rt := refreshToken
		refreshField = &rt
	}

	return &issuedSession{
		grant: wireSessionGrant{
			AccessToken:  access,
			RefreshToken: refreshField,
			ExpiresIn:    AccessTokenTTLSeconds,
			IsNewAccount: isNewAccount,
			Principal:    principal,
		},
		refreshToken: refreshToken,
		client:       client,
	}, nil
}

// principalFor builds the GET /v1/auth/me principal for an already-authenticated
// session, re-reading roles from account_role.
func (s *Service) principalFor(ctx context.Context, accountID, sessionID, amr string) (*wirePrincipal, error) {
	acct, err := s.store.AccountByID(ctx, accountID)
	if err != nil {
		return nil, err
	}
	grants, err := s.store.RolesFor(ctx, accountID)
	if err != nil {
		return nil, err
	}
	permitted := rolesForAMR(amr, grants)
	p := wirePrincipal{
		AccountID: acct.ID,
		SessionID: sessionID,
		Roles:     toWireRoles(permitted),
		AMR:       amr,
		Status:    acct.Status,
		Locale:    acct.Locale,
		Timezone:  acct.Timezone,
		NextRoute: nextRoute(acct.Status, false, permitted),
	}
	return &p, nil
}
