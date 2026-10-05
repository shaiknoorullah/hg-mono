package auth

import (
	"context"
	"crypto/ed25519"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// Module is the fully-wired auth module: the handler for route registration, the
// Authenticator and Authorizer for the router chain, and the deny-set refresher
// the process must start.
type Module struct {
	Handler       *Handler
	Authenticator httpx.Authenticator
	Authorizer    httpx.Authorizer

	deny  *session.DenySet
	store *Store
	svc   *Service
}

// NewModule constructs the module from the shared pool, redis client, secrets
// and logger. The SMS sender defaults to a LogSMSSender while O-03 is unresolved
// (pass a real sender once a provider is chosen). echoOTP logs the code and must
// be true only in local.
func NewModule(pool *pgxpool.Pool, rdb *redis.Client, secrets *Secrets, sms SMSSender, phoneVerifier PhoneVerifier, verifyChannel string, echoOTP bool, log *slog.Logger) *Module {
	if log == nil {
		log = slog.Default()
	}
	if sms == nil {
		sms = NewLogSMSSender(log, echoOTP)
	}
	store := NewStore(pool)
	rl := NewRateLimiter(rdb, log)
	deny := session.NewDenySet()

	issuer := session.NewIssuer(secrets.SigningKID, secrets.SigningPriv, "hg-api")
	verifier := session.NewVerifier(
		map[string]ed25519.PublicKey{secrets.SigningKID: secrets.SigningPub}, "hg-api")

	// Cap concurrent argon2id hashing in this process, per audience, so a burst
	// of sign-ups or logins can neither exhaust the replica's memory nor lock
	// staff out (hashgate.go).
	ConfigurePasswordHashing(secrets.HashConcurrency, secrets.HashWait, secrets.HashMaxWaiters)

	svc := NewService(store, rl, sms, issuer, deny, secrets, log)
	// O-03 / phone-OTP provider: a non-nil PhoneVerifier (Twilio Verify) takes
	// over requestOtp/verifyOtp; nil leaves the self-hosted challenge default.
	svc.UsePhoneVerifier(phoneVerifier, verifyChannel)
	handler := NewHandler(svc, store, deny, secrets)

	return &Module{
		Handler:       handler,
		Authenticator: NewAuthenticator(verifier, deny),
		Authorizer:    Matrix{},
		deny:          deny,
		store:         store,
		svc:           svc,
	}
}

// StartRevocationRefresher launches the 10-second Postgres refresh of the deny
// set (P-04). It runs until ctx is cancelled and should be started once after
// boot. Redis pub/sub invalidation is a follow-up — see the TODO.
func (m *Module) StartRevocationRefresher(ctx context.Context) {
	// TODO(P-04 pub/sub): subscribe to Redis channel sys:session_revoked and call
	// deny.AddSession / deny.AddAccount on each message for instant propagation.
	// The 10-second Postgres refresh already bounds worst-case propagation at
	// ≤10 s with Redis entirely down, which is the correctness guarantee.
	go m.deny.RunRefresher(ctx, m.store, 10*time.Second)
}
