package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Environment is the deployment environment. It gates the G-7 localhost rule and
// is reported verbatim by GET /internal/deps (contract: DependencyReport.environment).
type Environment string

const (
	EnvLocal      Environment = "local"
	EnvStaging    Environment = "staging"
	EnvProduction Environment = "production"
)

// IsLocal reports whether dependency hosts are allowed to be loopback addresses.
func (e Environment) IsLocal() bool { return e == EnvLocal }

// Config is the fully resolved configuration of the process. Every field is
// populated at boot by Load; there are no lazily-read variables anywhere else.
type Config struct {
	Env             Environment
	ServiceVersion  string
	HTTPAddr        string
	ShutdownTimeout time.Duration
	LogLevel        slog.Level
	CORSOrigins     []string
	// TrustedProxies are the reverse proxies (Traefik) whose X-Forwarded-For
	// the API believes when it works out a request's client address. When
	// empty, the socket peer is the client and the header is ignored. Empty is
	// allowed only when HG_ENV=local: staging and production run behind
	// Traefik, where an empty list makes every caller share one address.
	TrustedProxies []netip.Prefix

	Postgres Postgres
	Redis    Redis
	MinIO    MinIO
	Dispatch Dispatch
	Stripe   Stripe
	SMS      SMS
	OTP      OTP
	Tax      Tax
	Realtime Realtime
	Payouts  Payouts
}

// Payouts holds the payout settings the owner may still change.
type Payouts struct {
	// RestaurantNegativeBalanceBlockDays: a restaurant whose payout balance
	// has been below zero for longer than this many days takes no new orders
	// until it recovers; 0 turns the block off. The default, 30, is the
	// documented behaviour (docs/spec/01-platform.md, "P-19 — Stripe Connect:
	// onboarding and payouts (Canada)", Schedules). Whether to block at all is
	// still the owner's open question:
	// https://github.com/shaiknoorullah/hg-mono/issues/164.
	RestaurantNegativeBalanceBlockDays int
	// RestaurantHoldHours: a restaurant's earning from an order is paid once
	// the order has been settled this long, so a dispute raised inside the
	// window is netted before the money leaves. The default, 72, is the
	// proposed three-day hold that stands until the owner decides
	// (docs/spec/03-restaurant.md, "R-32 — Payout schedule, preferences and
	// payout requests").
	RestaurantHoldHours int
}

// Realtime holds the WebSocket gateway's per-replica limits.
type Realtime struct {
	// MaxSockets caps the live sockets one replica holds. An upgrade beyond it
	// is closed with 1013 (try again later) so the client retries, possibly on
	// the other replica (contracts/websocket.md "Limits").
	MaxSockets int
}

// OTP holds the phone-verification provider selection. It is orthogonal to SMS
// (which only transports a code this service generated): with a Verify provider
// the code is generated, delivered AND validated by the provider, so no code is
// stored locally. The default provider is "log" — the self-hosted challenge path
// (LogSMSSender + stored otp_challenge) — so dev is unchanged with nothing set.
type OTP struct {
	// Provider selects the phone-verification path. "log" (default) is the
	// self-hosted challenge; "twilio_verify" delegates to Twilio Verify. Any
	// other value is a boot-time config error.
	Provider string
	Verify   TwilioVerify
}

// TwilioVerify holds the Twilio Verify service credentials. The account SID and
// auth token are the same HG_TWILIO_ACCOUNT_SID/HG_TWILIO_AUTH_TOKEN the
// Messages sender uses; the Verify Service SID (VA...) and channel are distinct.
// Required only when OTP.Provider == "twilio_verify".
type TwilioVerify struct {
	AccountSID string
	AuthToken  string
	// ServiceSID is the Verify Service SID (starts with "VA").
	ServiceSID string
	// Channel is "whatsapp" (default when twilio_verify) or "sms".
	Channel string
}

// Configured reports whether enough credentials were supplied to call Twilio
// Verify: an account sid, an auth token, and a Verify service sid.
func (v TwilioVerify) Configured() bool {
	return v.AccountSID != "" && v.AuthToken != "" && v.ServiceSID != ""
}

// SMS holds the O-03 SMS-provider settings. The default provider is "log"
// (LogSMSSender: records the send, delivers nothing) so the OTP flow is fully
// functional end to end without a provider. Setting HG_SMS_PROVIDER=twilio
// plus the three Twilio variables is the one-line flip that activates
// internal/auth's TwilioSMSSender at boot — no code change, no rebuild.
type SMS struct {
	// Provider selects the SMSSender implementation. "log" (default) or
	// "twilio". Any other value is a boot-time config error.
	Provider string
	Twilio   TwilioSMS
}

// TwilioSMS holds the Twilio Messages API credentials. Required only when
// SMS.Provider == "twilio".
type TwilioSMS struct {
	AccountSID          string
	AuthToken           string
	FromNumber          string
	MessagingServiceSID string
}

// Configured reports whether enough Twilio credentials were supplied to place
// a call (account sid + auth token, and either a from number or a messaging
// service sid).
func (t TwilioSMS) Configured() bool {
	return t.AccountSID != "" && t.AuthToken != "" && (t.FromNumber != "" || t.MessagingServiceSID != "")
}

// Tax holds the O-01 tax-registration settings that flow into every
// customer-facing receipt (contract: Receipt.platform_tax_registration_number).
// The field is rendered only when configured — a placeholder token is never
// printed (I-08 in spirit: silence, not an optimistic guess, when a
// compliance-critical field is unset).
type Tax struct {
	// HSTRegistrationNumber is the platform's own CRA HST/GST registration
	// number. Empty until O-01 (accountant sign-off on supplier position) is
	// resolved; setting HG_TAX_HST_REGISTRATION_NUMBER is the one-line flip.
	HSTRegistrationNumber string
	// PlatformLegalName is the legal entity name printed on the receipt
	// alongside the registration number.
	PlatformLegalName string
}

// Stripe holds the P-16..P-21 payment-provider settings. The secret key is
// test-mode outside production; the payments module's livemode boot probe
// (P-17 / I-17.3) asserts the key's mode matches the environment so a test key
// can never reach production and a live key can never reach staging.
type Stripe struct {
	// SecretKey is the sk_test_… or sk_live_… API key. Optional at config load
	// so a process that does not exercise payments can still boot; the payments
	// module fails loudly at its own boot if it is missing.
	SecretKey string
	// WebhookSecret is the whsec_… signing secret for Stripe-Signature
	// verification (P-17).
	WebhookSecret string
	// ConnectReturnURL and ConnectRefreshURL are the server-generated bases for
	// the Stripe AccountLink (P-19): the client never supplies these URLs.
	ConnectReturnURL  string
	ConnectRefreshURL string
}

// Configured reports whether a Stripe API key was supplied.
func (s Stripe) Configured() bool { return s.SecretKey != "" }

// LiveMode reports whether the configured secret key is a live-mode key.
func (s Stripe) LiveMode() bool { return strings.HasPrefix(s.SecretKey, "sk_live_") }

// Postgres holds the connection settings for the only source of truth (G-1).
type Postgres struct {
	DSN         string
	MaxConns    int32
	MinConns    int32
	ConnTimeout time.Duration
}

// Host returns the host:port the DSN points at, for the G-7 loopback check and
// for the "configured versus connected" report at /debug/deps.
func (p Postgres) Host() string { return hostFromDSN(p.DSN) }

// Redis holds the settings for the disposable cache and pub/sub transport (G-1).
type Redis struct {
	Addr     string
	Password string
	DB       int
}

// Host returns the configured address.
func (r Redis) Host() string { return r.Addr }

// MinIO holds the settings for the private-by-default object store (P-27).
type MinIO struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	UseSSL    bool
	Region    string
	// PublicBaseURL is the scheme+host clients reach the public hg-media bucket
	// at, without a trailing slash — e.g. "https://cdn.halalgoes.ca" in
	// production, or "http://localhost:9000" in dev. A public media object's URL
	// is <PublicBaseURL>/<bucket>/<object_key>, with no presigning: hg-media is
	// public-read by design (the other buckets are never served this way). It
	// defaults to scheme+host derived from Endpoint when unset, which is correct
	// for the dev compose stack where MinIO is reached directly.
	PublicBaseURL string
	// PresignBaseURL is the scheme+host phones and browsers reach the object
	// store's S3 API at, without a trailing slash or a path — e.g.
	// "https://files.halalgoes.com". Every presigned upload and download link is
	// signed for this host. It cannot be patched in afterwards: the signature
	// covers the Host header, so a link signed for the internal endpoint
	// (minio:9000), which no phone can resolve, stays unusable. The reverse proxy
	// in front of it must forward the Host header unchanged. Locally it defaults
	// to scheme+host derived from Endpoint; outside local it is required.
	PresignBaseURL string
	// Buckets is the P-27 bucket layout. Private buckets are subject to the
	// boot-time privacy probe.
	Buckets Buckets
}

// Host returns the configured endpoint.
func (m MinIO) Host() string { return m.Endpoint }

// Buckets names the five P-27 buckets. Only hg-media is public-read.
type Buckets struct {
	KYC     string
	POD     string
	Media   string
	Exports string
	Tmp     string
}

// Private returns the buckets that must never be anonymously readable or
// writable. hg-media is deliberately excluded: it is public-read by design.
func (b Buckets) Private() []string {
	return []string{b.KYC, b.POD, b.Exports, b.Tmp}
}

// All returns every configured bucket name.
func (b Buckets) All() []string {
	return []string{b.KYC, b.POD, b.Media, b.Exports, b.Tmp}
}

// Dispatch holds the rider availability sweeps' threshold and schedule
// (internal/dispatch/availability_sweeper.go). The defaults are the values
// docs/spec/04-rider.md sets in "D-10 — Availability: online / offline".
type Dispatch struct {
	// RiderStaleAfter (HG_RIDER_STALE_AFTER, default 120s): an online rider
	// whose last location is older than this is moved to ONLINE_STALE and
	// offered no work until their next location update.
	RiderStaleAfter time.Duration
	// RiderStaleSweepEvery (HG_RIDER_STALE_SWEEP_INTERVAL, default 15s): how
	// often the stale-location sweep runs.
	RiderStaleSweepEvery time.Duration
	// RiderReconcileEvery (HG_RIDER_RECONCILE_INTERVAL, default 60s): how often
	// a rider stuck ON_DELIVERY with no live assignment is looked for and
	// restored.
	RiderReconcileEvery time.Duration
}

// Load reads the environment into a Config.
//
// It accumulates every problem it finds and returns them together, so a
// misconfigured deployment surfaces its whole diff in one boot rather than one
// variable per restart. A non-nil error means the process must exit non-zero:
// there is no partially-valid Config.
func Load(getenv func(string) string) (*Config, error) {
	l := &loader{getenv: getenv}

	cfg := &Config{
		ServiceVersion:  l.optional("HG_SERVICE_VERSION", "dev"),
		HTTPAddr:        l.optional("HG_HTTP_ADDR", ":8080"),
		ShutdownTimeout: l.duration("HG_SHUTDOWN_TIMEOUT", 20*time.Second),
	}

	cfg.Env = Environment(l.required("HG_ENV"))
	switch cfg.Env {
	case EnvLocal, EnvStaging, EnvProduction, "":
	default:
		l.errf("HG_ENV: %q is not one of local, staging, production", string(cfg.Env))
	}

	cfg.LogLevel = l.logLevel("HG_LOG_LEVEL", slog.LevelInfo)
	cfg.CORSOrigins = l.originList("HG_CORS_ALLOWED_ORIGINS")
	cfg.TrustedProxies = l.prefixList("HG_TRUSTED_PROXY_CIDRS")

	cfg.Postgres = Postgres{
		DSN:         l.required("HG_POSTGRES_DSN"),
		MaxConns:    int32(l.intVal("HG_POSTGRES_MAX_CONNS", 10)),
		MinConns:    int32(l.intVal("HG_POSTGRES_MIN_CONNS", 2)),
		ConnTimeout: l.duration("HG_POSTGRES_CONNECT_TIMEOUT", 5*time.Second),
	}

	cfg.Redis = Redis{
		Addr:     l.required("HG_REDIS_ADDR"),
		Password: l.optional("HG_REDIS_PASSWORD", ""),
		DB:       l.intVal("HG_REDIS_DB", 0),
	}

	cfg.MinIO = MinIO{
		Endpoint:  l.required("HG_MINIO_ENDPOINT"),
		AccessKey: l.required("HG_MINIO_ACCESS_KEY"),
		SecretKey: l.required("HG_MINIO_SECRET_KEY"),
		UseSSL:    l.boolVal("HG_MINIO_USE_SSL", false),
		Region:    l.optional("HG_MINIO_REGION", "ca-central-1"),
		Buckets: Buckets{
			KYC:     l.optional("HG_MINIO_BUCKET_KYC", "hg-kyc"),
			POD:     l.optional("HG_MINIO_BUCKET_POD", "hg-pod"),
			Media:   l.optional("HG_MINIO_BUCKET_MEDIA", "hg-media"),
			Exports: l.optional("HG_MINIO_BUCKET_EXPORTS", "hg-exports"),
			Tmp:     l.optional("HG_MINIO_BUCKET_TMP", "hg-tmp"),
		},
	}
	// The public base for hg-media defaults to the MinIO endpoint's scheme+host
	// (dev serves objects directly off MinIO); production sets it to the CDN/edge
	// host that fronts the public bucket. Any trailing slash is trimmed so the
	// resolver can join "/bucket/key" without doubling it.
	cfg.MinIO.PublicBaseURL = strings.TrimSuffix(
		l.optional("HG_MINIO_PUBLIC_BASE_URL", defaultPublicBaseURL(cfg.MinIO.Endpoint, cfg.MinIO.UseSSL)), "/")
	// Presigned links are signed for the host phones reach, never the internal
	// endpoint. Locally that is the same MinIO the API dials; anywhere else an
	// unset value would mint links for minio:9000, so it does not boot.
	presignBase := l.optional("HG_MINIO_PRESIGN_BASE_URL", "")
	presignSet := presignBase != ""
	if !presignSet {
		if cfg.Env != "" && !cfg.Env.IsLocal() {
			l.errf("HG_MINIO_PRESIGN_BASE_URL is required when HG_ENV is not local: presigned links "+
				"are signed for this host, and phones cannot reach the internal endpoint %q", cfg.MinIO.Endpoint)
		}
		presignBase = defaultPublicBaseURL(cfg.MinIO.Endpoint, cfg.MinIO.UseSSL)
	}
	cfg.MinIO.PresignBaseURL = l.baseURL("HG_MINIO_PRESIGN_BASE_URL", presignBase)

	cfg.Stripe = Stripe{
		SecretKey:         l.optional("HG_STRIPE_SECRET_KEY", ""),
		WebhookSecret:     l.optional("HG_STRIPE_WEBHOOK_SECRET", ""),
		ConnectReturnURL:  l.optional("HG_STRIPE_CONNECT_RETURN_URL", ""),
		ConnectRefreshURL: l.optional("HG_STRIPE_CONNECT_REFRESH_URL", ""),
	}

	cfg.SMS = SMS{
		Provider: l.optional("HG_SMS_PROVIDER", "log"),
		Twilio: TwilioSMS{
			AccountSID:          l.optional("HG_TWILIO_ACCOUNT_SID", ""),
			AuthToken:           l.optional("HG_TWILIO_AUTH_TOKEN", ""),
			FromNumber:          l.optional("HG_TWILIO_FROM_NUMBER", ""),
			MessagingServiceSID: l.optional("HG_TWILIO_MESSAGING_SERVICE_SID", ""),
		},
	}
	switch cfg.SMS.Provider {
	case "log", "twilio":
	default:
		l.errf("HG_SMS_PROVIDER: %q is not one of log, twilio", cfg.SMS.Provider)
	}
	if cfg.SMS.Provider == "twilio" && !cfg.SMS.Twilio.Configured() {
		l.errf("HG_SMS_PROVIDER=twilio requires HG_TWILIO_ACCOUNT_SID, HG_TWILIO_AUTH_TOKEN, and either " +
			"HG_TWILIO_FROM_NUMBER or HG_TWILIO_MESSAGING_SERVICE_SID")
	}

	cfg.OTP = OTP{
		Provider: l.optional("HG_OTP_PROVIDER", "log"),
		Verify: TwilioVerify{
			// The account creds are shared with the Messages sender's Twilio vars.
			AccountSID: l.optional("HG_TWILIO_ACCOUNT_SID", ""),
			AuthToken:  l.optional("HG_TWILIO_AUTH_TOKEN", ""),
			ServiceSID: l.optional("HG_TWILIO_VERIFY_SERVICE_SID", ""),
			Channel:    l.optional("HG_TWILIO_VERIFY_CHANNEL", ""),
		},
	}
	switch cfg.OTP.Provider {
	case "log", "twilio_verify":
	default:
		l.errf("HG_OTP_PROVIDER: %q is not one of log, twilio_verify", cfg.OTP.Provider)
	}
	if cfg.OTP.Provider == "twilio_verify" {
		// WhatsApp is the default channel when Verify is active; the client can
		// opt down to SMS.
		if cfg.OTP.Verify.Channel == "" {
			cfg.OTP.Verify.Channel = "whatsapp"
		}
		switch cfg.OTP.Verify.Channel {
		case "whatsapp", "sms":
		default:
			l.errf("HG_TWILIO_VERIFY_CHANNEL: %q is not one of whatsapp, sms", cfg.OTP.Verify.Channel)
		}
		if !cfg.OTP.Verify.Configured() {
			l.errf("HG_OTP_PROVIDER=twilio_verify requires HG_TWILIO_VERIFY_SERVICE_SID, " +
				"HG_TWILIO_ACCOUNT_SID, and HG_TWILIO_AUTH_TOKEN")
		}
	}

	cfg.Dispatch = Dispatch{
		RiderStaleAfter:      l.duration("HG_RIDER_STALE_AFTER", 120*time.Second),
		RiderStaleSweepEvery: l.duration("HG_RIDER_STALE_SWEEP_INTERVAL", 15*time.Second),
		RiderReconcileEvery:  l.duration("HG_RIDER_RECONCILE_INTERVAL", 60*time.Second),
	}
	for _, v := range []struct {
		key string
		d   time.Duration
	}{
		{"HG_RIDER_STALE_AFTER", cfg.Dispatch.RiderStaleAfter},
		{"HG_RIDER_STALE_SWEEP_INTERVAL", cfg.Dispatch.RiderStaleSweepEvery},
		{"HG_RIDER_RECONCILE_INTERVAL", cfg.Dispatch.RiderReconcileEvery},
	} {
		if v.d <= 0 {
			l.errf("%s: %s must be more than zero", v.key, v.d)
		}
	}

	cfg.Tax = Tax{
		HSTRegistrationNumber: l.optional("HG_TAX_HST_REGISTRATION_NUMBER", ""),
		PlatformLegalName:     l.optional("HG_TAX_PLATFORM_LEGAL_NAME", ""),
	}

	cfg.Realtime = Realtime{
		MaxSockets: l.intVal("HG_REALTIME_MAX_SOCKETS", 2000),
	}
	if cfg.Realtime.MaxSockets < 1 {
		l.errf("HG_REALTIME_MAX_SOCKETS: %d must be at least 1", cfg.Realtime.MaxSockets)
	}

	cfg.Payouts = Payouts{
		RestaurantNegativeBalanceBlockDays: l.intVal("HG_RESTAURANT_NEGATIVE_BALANCE_BLOCK_DAYS", 30),
		RestaurantHoldHours:                l.intVal("HG_PAYOUT_RESTAURANT_HOLD_HOURS", 72),
	}
	if cfg.Payouts.RestaurantHoldHours < 0 {
		l.errf("HG_PAYOUT_RESTAURANT_HOLD_HOURS: %d must be 0 or more", cfg.Payouts.RestaurantHoldHours)
	}
	if cfg.Payouts.RestaurantNegativeBalanceBlockDays < 0 {
		l.errf("HG_RESTAURANT_NEGATIVE_BALANCE_BLOCK_DAYS: %d must be 0 (off) or more",
			cfg.Payouts.RestaurantNegativeBalanceBlockDays)
	}

	// G-7: outside local, no dependency may point at loopback. This is the
	// check that would have caught the hardcoded localhost:6379.
	if cfg.Env != "" && !cfg.Env.IsLocal() {
		l.denyLoopback("HG_POSTGRES_DSN", cfg.Postgres.Host())
		l.denyLoopback("HG_REDIS_ADDR", cfg.Redis.Host())
		l.denyLoopback("HG_MINIO_ENDPOINT", cfg.MinIO.Host())
		if u, err := url.Parse(cfg.MinIO.PresignBaseURL); err == nil {
			l.denyLoopback("HG_MINIO_PRESIGN_BASE_URL", u.Host)
			// Every presigned link is a bearer credential, including the
			// two-minute KYC and certificate download links, and an upload
			// link carries the document itself. Over plain http both would
			// cross the network in cleartext, breaking the rule that KYC and
			// certificates stay private (AGENTS.md, "Non-negotiable
			// invariants": ../../../../AGENTS.md#3-non-negotiable-invariants).
			// iOS App Transport Security and Android 9+ also refuse cleartext
			// by default, so the links would fail on phones anyway. An unset
			// value already failed above, so only an explicit http host is
			// reported here.
			if presignSet && u.Scheme != "https" {
				l.errf("HG_MINIO_PRESIGN_BASE_URL must be https when HG_ENV is not local: " +
					"presigned links are bearer credentials")
			}
		}

		// Outside local the API runs behind Traefik. With no trusted proxy,
		// every request's client address is Traefik's, so each per-IP limit
		// (the sign-in code limit in internal/auth/service_flows.go among
		// them) becomes one limit for all customers. Refuse to boot rather
		// than fail open. The rule is step 3 (RealIP, the client address) of
		// the middleware chain in docs/spec/01-platform.md, "Deny-by-default
		// routing and the middleware chain".
		if len(cfg.TrustedProxies) == 0 {
			l.errf("HG_TRUSTED_PROXY_CIDRS: required outside local; behind Traefik an empty list " +
				"makes every per-IP limit global")
		}
	}

	if err := l.err(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// LoadFromOS is Load against the real process environment.
func LoadFromOS() (*Config, error) { return Load(os.Getenv) }

type loader struct {
	getenv func(string) string
	errs   []string
}

func (l *loader) errf(format string, args ...any) {
	l.errs = append(l.errs, fmt.Sprintf(format, args...))
}

func (l *loader) err() error {
	if len(l.errs) == 0 {
		return nil
	}
	sort.Strings(l.errs)
	return fmt.Errorf("invalid configuration (%d problem(s)):\n  - %s",
		len(l.errs), strings.Join(l.errs, "\n  - "))
}

// required returns the variable's value, recording an error when it is unset or
// blank. It never substitutes a zero value silently — that is the whole point.
func (l *loader) required(key string) string {
	v := strings.TrimSpace(l.getenv(key))
	if v == "" {
		l.errf("%s is required and was not set", key)
	}
	return v
}

func (l *loader) optional(key, def string) string {
	if v := strings.TrimSpace(l.getenv(key)); v != "" {
		return v
	}
	return def
}

func (l *loader) intVal(key string, def int) int {
	raw := strings.TrimSpace(l.getenv(key))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		l.errf("%s: %q is not an integer", key, raw)
		return def
	}
	return n
}

func (l *loader) boolVal(key string, def bool) bool {
	raw := strings.TrimSpace(l.getenv(key))
	if raw == "" {
		return def
	}
	b, err := strconv.ParseBool(raw)
	if err != nil {
		l.errf("%s: %q is not a boolean", key, raw)
		return def
	}
	return b
}

func (l *loader) duration(key string, def time.Duration) time.Duration {
	raw := strings.TrimSpace(l.getenv(key))
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		l.errf("%s: %q is not a duration (e.g. 20s, 1m)", key, raw)
		return def
	}
	return d
}

func (l *loader) logLevel(key string, def slog.Level) slog.Level {
	raw := strings.TrimSpace(l.getenv(key))
	if raw == "" {
		return def
	}
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(raw)); err != nil {
		l.errf("%s: %q is not a log level (debug, info, warn, error)", key, raw)
		return def
	}
	return lvl
}

// originList parses the CORS allowlist. A wildcard is rejected outright:
// invariant I-06.5 forbids Access-Control-Allow-Origin: * on any route that can
// carry credentials, and every route here can.
func (l *loader) originList(key string) []string {
	raw := l.required(key)
	if raw == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		o := strings.TrimSpace(part)
		if o == "" {
			continue
		}
		if o == "*" {
			l.errf("%s: %q is forbidden — I-06.5 bans a wildcard origin on credentialed routes; list exact origins", key, o)
			continue
		}
		u, err := url.Parse(o)
		if err != nil || u.Scheme == "" || u.Host == "" {
			l.errf("%s: %q is not an absolute origin (scheme://host[:port])", key, o)
			continue
		}
		if u.Path != "" && u.Path != "/" {
			l.errf("%s: %q must not carry a path", key, o)
			continue
		}
		out = append(out, strings.TrimSuffix(o, "/"))
	}
	if len(out) == 0 && len(l.errs) == 0 {
		l.errf("%s: no usable origin found", key)
	}
	return out
}

// baseURL validates an absolute http(s) scheme+host value and returns it without
// a trailing slash. A path, query or fragment is refused: the S3 client takes a
// host only, so a path would be dropped silently and every link would miss it.
// An empty value passes through as "" (nothing configured, nothing to check).
func (l *loader) baseURL(key, raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		l.errf("%s: %q is not an absolute http(s) URL (scheme://host[:port])", key, raw)
		return ""
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		l.errf("%s: %q must be scheme://host[:port] only, with no path, query or credentials", key, raw)
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// trustableProxyRanges is the address space a trusted proxy may sit in: the
// private IPv4 ranges, loopback, and IPv6 unique-local addresses. The API's
// socket peer is always a container on the stack's Docker network or the host
// itself, so the proxy whose X-Forwarded-For it believes (Traefik) always has
// one of these addresses. A CDN in front would be trusted by Traefik, not by
// the API. See "Trusted proxy setting accepts public ranges"
// (https://github.com/shaiknoorullah/hg-mono/issues/268).
var trustableProxyRanges = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),     // private (RFC 1918)
	netip.MustParsePrefix("172.16.0.0/12"),  // private (RFC 1918); Docker's default bridges
	netip.MustParsePrefix("192.168.0.0/16"), // private (RFC 1918)
	netip.MustParsePrefix("127.0.0.0/8"),    // IPv4 loopback
	netip.MustParsePrefix("::1/128"),        // IPv6 loopback
	netip.MustParsePrefix("fc00::/7"),       // IPv6 unique-local (RFC 4193)
}

// withinTrustableRange reports whether every address in p lies inside one of
// trustableProxyRanges. p must be masked. A prefix that straddles a private
// range and public space (10.0.0.0/7, 172.0.0.0/8) is not within one.
func withinTrustableRange(p netip.Prefix) bool {
	for _, r := range trustableProxyRanges {
		if p.Bits() >= r.Bits() && r.Contains(p.Addr()) {
			return true
		}
	}
	return false
}

// prefixList parses a comma-separated list of CIDRs; a bare IP is one address.
//
// Every prefix must lie wholly inside trustableProxyRanges, or the API refuses
// to start. Trusting a public address means believing X-Forwarded-For from
// whoever holds it, so that caller could pick the address its rate limits and
// audit rows are recorded under. Checking the whole prefix, not only for /0,
// also refuses 0.0.0.0/1 plus 128.0.0.0/1 (every IPv4 address in two halves)
// and a range too wide for its private block. The rule is step 3 (RealIP, the
// client address) of the middleware chain in docs/spec/01-platform.md,
// "Deny-by-default routing and the middleware chain"
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain).
//
// An IPv4-mapped IPv6 prefix of a private range (::ffff:172.18.0.0/112) is
// refused with its IPv4 form in the message: the client-address step unmaps
// every peer to plain IPv4 before comparing, so a mapped prefix would never
// match and the proxy would silently not be trusted ("Trusted proxy setting
// accepts IPv4-mapped ranges that never match",
// https://github.com/shaiknoorullah/hg-mono/issues/263).
func (l *loader) prefixList(key string) []netip.Prefix {
	raw := strings.TrimSpace(l.getenv(key))
	if raw == "" {
		return nil
	}
	var out []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
		s := strings.TrimSpace(part)
		if s == "" {
			continue
		}
		var p netip.Prefix
		if ip, err := netip.ParseAddr(s); err == nil && ip.Zone() == "" {
			p = netip.PrefixFrom(ip, ip.BitLen())
		} else if p, err = netip.ParsePrefix(s); err != nil {
			l.errf("%s: %q is not a CIDR (e.g. 172.18.0.0/16) or an IP address", key, s)
			continue
		}
		p = p.Masked()
		if p.Addr().Is4In6() && p.Bits() >= 96 {
			if v4 := netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-96).Masked(); withinTrustableRange(v4) {
				l.errf("%s: %q is an IPv4-mapped IPv6 range, which never matches: the API compares "+
					"peers as plain IPv4; write it as %s", key, s, v4)
				continue
			}
		}
		if !withinTrustableRange(p) {
			l.errf("%s: %q reaches outside private address space; the API's peer is always on "+
				"the Docker network or the host, so a trusted proxy must lie wholly inside %s "+
				"(trusting any other address lets a caller there choose its own client address)",
				key, s, trustableRangesText())
			continue
		}
		out = append(out, p)
	}
	return out
}

// trustableRangesText lists trustableProxyRanges for an error message.
func trustableRangesText() string {
	parts := make([]string, len(trustableProxyRanges))
	for i, r := range trustableProxyRanges {
		parts[i] = r.String()
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " or " + parts[len(parts)-1]
}

// denyLoopback implements the second half of G-7.
func (l *loader) denyLoopback(key, hostport string) {
	if hostport == "" {
		return
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		return
	}
	lowered := strings.ToLower(host)
	isLoopback := lowered == "localhost" || strings.HasSuffix(lowered, ".localhost")
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		isLoopback = true
	}
	if isLoopback {
		l.errf("%s points at loopback host %q while HG_ENV is not local — G-7 forbids it "+
			"(this is the hardcoded localhost:6379 failure, made unbootable)", key, host)
	}
}

// hostFromDSN extracts host:port from either a URL-style or keyword-style
// Postgres DSN. It is best-effort and used only for reporting and the G-7 check.
func hostFromDSN(dsn string) string {
	if dsn == "" {
		return ""
	}
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		u, err := url.Parse(dsn)
		if err != nil {
			return ""
		}
		return u.Host
	}
	var host, port string
	for _, field := range strings.Fields(dsn) {
		k, v, ok := strings.Cut(field, "=")
		if !ok {
			continue
		}
		switch strings.ToLower(k) {
		case "host":
			host = v
		case "port":
			port = v
		}
	}
	if host == "" {
		return ""
	}
	if port == "" {
		return host
	}
	return net.JoinHostPort(host, port)
}

// defaultPublicBaseURL derives the public media base from the MinIO endpoint
// when HG_MINIO_PUBLIC_BASE_URL is unset. It is scheme + "://" + host, where
// scheme follows UseSSL. An endpoint that already carries a scheme is used as
// given (host only, dropping any path). An empty endpoint yields "" — the
// resolver then renders every media URL as null, which is contract-valid.
func defaultPublicBaseURL(endpoint string, useSSL bool) string {
	if endpoint == "" {
		return ""
	}
	scheme := "http"
	if useSSL {
		scheme = "https"
	}
	if strings.Contains(endpoint, "://") {
		if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
			s := u.Scheme
			if s == "" {
				s = scheme
			}
			return s + "://" + u.Host
		}
	}
	return scheme + "://" + endpoint
}

// ErrNotConfigured is returned by helpers asked for a dependency the binary was
// not configured to use.
var ErrNotConfigured = errors.New("dependency not configured")
