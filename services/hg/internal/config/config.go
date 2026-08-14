package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
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

	Postgres Postgres
	Redis    Redis
	MinIO    MinIO
	Stripe   Stripe
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

	cfg.Stripe = Stripe{
		SecretKey:         l.optional("HG_STRIPE_SECRET_KEY", ""),
		WebhookSecret:     l.optional("HG_STRIPE_WEBHOOK_SECRET", ""),
		ConnectReturnURL:  l.optional("HG_STRIPE_CONNECT_RETURN_URL", ""),
		ConnectRefreshURL: l.optional("HG_STRIPE_CONNECT_REFRESH_URL", ""),
	}

	// G-7: outside local, no dependency may point at loopback. This is the
	// check that would have caught the hardcoded localhost:6379.
	if cfg.Env != "" && !cfg.Env.IsLocal() {
		l.denyLoopback("HG_POSTGRES_DSN", cfg.Postgres.Host())
		l.denyLoopback("HG_REDIS_ADDR", cfg.Redis.Host())
		l.denyLoopback("HG_MINIO_ENDPOINT", cfg.MinIO.Host())
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
