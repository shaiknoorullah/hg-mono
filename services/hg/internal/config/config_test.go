package config

import (
	"strings"
	"testing"
)

// validEnv is a complete, valid environment. Tests mutate a copy of it so that
// each case isolates exactly one defect.
func validEnv() map[string]string {
	return map[string]string{
		"HG_ENV":                  "local",
		"HG_POSTGRES_DSN":         "postgres://hg:hg@postgres:5432/hg?sslmode=disable",
		"HG_REDIS_ADDR":           "redis:6379",
		"HG_MINIO_ENDPOINT":       "minio:9000",
		"HG_MINIO_ACCESS_KEY":     "hgminio",
		"HG_MINIO_SECRET_KEY":     "hgminiosecret",
		"HG_CORS_ALLOWED_ORIGINS": "http://localhost:5173",
	}
}

func getenvFrom(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadAcceptsACompleteEnvironment(t *testing.T) {
	cfg, err := Load(getenvFrom(validEnv()))
	if err != nil {
		t.Fatalf("valid environment was rejected: %v", err)
	}
	if cfg.Env != EnvLocal {
		t.Errorf("Env = %q, want local", cfg.Env)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr = %q, want the :8080 default", cfg.HTTPAddr)
	}
	if got := cfg.Postgres.Host(); got != "postgres:5432" {
		t.Errorf("Postgres.Host() = %q, want postgres:5432", got)
	}
	if len(cfg.MinIO.Buckets.Private()) != 4 {
		t.Errorf("expected 4 private buckets, got %d", len(cfg.MinIO.Buckets.Private()))
	}
	if cfg.Realtime.MaxSockets != 2000 {
		t.Errorf("Realtime.MaxSockets = %d, want the 2000 default", cfg.Realtime.MaxSockets)
	}
}

// TestLoadFailsLoudlyOnEachMissingRequiredVar is the G-7 test.
//
// The failure this prevents: a missing variable becoming a zero value, which is
// indistinguishable from a deliberate one. The assertion is specifically that
// the error *names the variable* — an error that says "invalid config" sends an
// operator reading source code.
func TestLoadFailsLoudlyOnEachMissingRequiredVar(t *testing.T) {
	required := []string{
		"HG_ENV",
		"HG_POSTGRES_DSN",
		"HG_REDIS_ADDR",
		"HG_MINIO_ENDPOINT",
		"HG_MINIO_ACCESS_KEY",
		"HG_MINIO_SECRET_KEY",
		"HG_CORS_ALLOWED_ORIGINS",
	}
	for _, key := range required {
		t.Run(key, func(t *testing.T) {
			env := validEnv()
			delete(env, key)

			cfg, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatalf("Load succeeded with %s unset — a missing required variable must never boot", key)
			}
			if cfg != nil {
				t.Errorf("Load returned a non-nil Config alongside an error; there is no partially-valid config")
			}
			if !strings.Contains(err.Error(), key) {
				t.Errorf("error does not name the missing variable %s: %v", key, err)
			}
		})
	}
}

func TestLoadTreatsBlankAsMissing(t *testing.T) {
	env := validEnv()
	env["HG_POSTGRES_DSN"] = "   "

	if _, err := Load(getenvFrom(env)); err == nil {
		t.Fatal("a whitespace-only value was accepted; it must be treated as unset")
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	env := validEnv()
	delete(env, "HG_REDIS_ADDR")
	delete(env, "HG_MINIO_ACCESS_KEY")

	_, err := Load(getenvFrom(env))
	if err == nil {
		t.Fatal("expected an error")
	}
	// One boot should show the whole diff, not the first problem and then another
	// restart for the next one.
	for _, want := range []string{"HG_REDIS_ADDR", "HG_MINIO_ACCESS_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error omits %s; all problems must be reported together: %v", want, err)
		}
	}
}

// TestLoadRejectsLoopbackOutsideLocal is the second half of G-7, and it is the
// specific check that would have caught a cache hardcoded to localhost:6379:
// it works on a laptop and points at the container itself in Docker.
func TestLoadRejectsLoopbackOutsideLocal(t *testing.T) {
	cases := map[string]struct {
		key, value string
	}{
		"postgres hostname": {"HG_POSTGRES_DSN", "postgres://hg:hg@localhost:5432/hg"},
		"postgres ipv4":     {"HG_POSTGRES_DSN", "postgres://hg:hg@127.0.0.1:5432/hg"},
		"redis hostname":    {"HG_REDIS_ADDR", "localhost:6379"},
		"redis ipv4":        {"HG_REDIS_ADDR", "127.0.0.1:6379"},
		"minio":             {"HG_MINIO_ENDPOINT", "localhost:9000"},
		"minio presign":     {"HG_MINIO_PRESIGN_BASE_URL", "http://localhost:9000"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			env := validEnv()
			env["HG_ENV"] = "production"
			env["HG_CORS_ALLOWED_ORIGINS"] = "https://app.halalgoes.com"
			env[tc.key] = tc.value

			_, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatalf("%s = %q was accepted in production; G-7 forbids a loopback dependency outside local", tc.key, tc.value)
			}
			if !strings.Contains(err.Error(), tc.key) {
				t.Errorf("error does not name %s: %v", tc.key, err)
			}
		})
	}
}

// Outside local, presigned links must name a host phones can reach. Left unset,
// they would be signed for the internal endpoint (minio:9000), which no phone
// can resolve — so the process does not boot. Issue #203.
func TestLoadRequiresPresignBaseURLOutsideLocal(t *testing.T) {
	env := validEnv()
	env["HG_ENV"] = "production"
	env["HG_CORS_ALLOWED_ORIGINS"] = "https://app.halalgoes.com"
	// Also required outside local (TestLoadRequiresTrustedProxiesOutsideLocal);
	// set here so this test sees only the presign rule.
	env["HG_TRUSTED_PROXY_CIDRS"] = "172.16.0.0/12"

	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "HG_MINIO_PRESIGN_BASE_URL") {
		t.Fatalf("production booted without HG_MINIO_PRESIGN_BASE_URL (err: %v)", err)
	}

	env["HG_MINIO_PRESIGN_BASE_URL"] = "https://files.halalgoes.com/"
	cfg, err := Load(getenvFrom(env))
	if err != nil {
		t.Fatalf("a valid presign base was rejected: %v", err)
	}
	if cfg.MinIO.PresignBaseURL != "https://files.halalgoes.com" {
		t.Errorf("PresignBaseURL = %q, want https://files.halalgoes.com", cfg.MinIO.PresignBaseURL)
	}

	// The S3 client takes a host only; a path would be dropped silently.
	env["HG_MINIO_PRESIGN_BASE_URL"] = "https://halalgoes.com/files"
	if _, err := Load(getenvFrom(env)); err == nil {
		t.Error("a presign base with a path was accepted")
	}

	// Presigned links are bearer credentials, KYC download links included;
	// a plain-http host would hand them out in cleartext.
	env["HG_MINIO_PRESIGN_BASE_URL"] = "http://files.halalgoes.com"
	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "must be https") {
		t.Errorf("production accepted a plain-http presign base (err: %v)", err)
	}
}

func TestLoadAllowsLoopbackInLocal(t *testing.T) {
	env := validEnv()
	env["HG_REDIS_ADDR"] = "localhost:6379"

	if _, err := Load(getenvFrom(env)); err != nil {
		t.Fatalf("loopback must be allowed when HG_ENV=local: %v", err)
	}
}

// TestLoadRejectsWildcardCORS covers I-06.5: every route here can carry
// credentials, so Access-Control-Allow-Origin: * must be unconfigurable rather
// than merely discouraged.
func TestLoadRejectsWildcardCORS(t *testing.T) {
	env := validEnv()
	env["HG_CORS_ALLOWED_ORIGINS"] = "*"

	_, err := Load(getenvFrom(env))
	if err == nil {
		t.Fatal("a wildcard CORS origin was accepted")
	}
	if !strings.Contains(err.Error(), "I-06.5") {
		t.Errorf("error should cite the invariant it enforces: %v", err)
	}
}

func TestLoadRejectsMalformedValues(t *testing.T) {
	cases := map[string]struct{ key, value, wantIn string }{
		"unknown environment":   {"HG_ENV", "prod", "HG_ENV"},
		"bad log level":         {"HG_LOG_LEVEL", "chatty", "HG_LOG_LEVEL"},
		"bad duration":          {"HG_SHUTDOWN_TIMEOUT", "20 seconds", "HG_SHUTDOWN_TIMEOUT"},
		"bad integer":           {"HG_REDIS_DB", "two", "HG_REDIS_DB"},
		"bad boolean":           {"HG_MINIO_USE_SSL", "sometimes", "HG_MINIO_USE_SSL"},
		"origin without scheme": {"HG_CORS_ALLOWED_ORIGINS", "app.halalgoes.com", "HG_CORS_ALLOWED_ORIGINS"},
		"zero socket cap":       {"HG_REALTIME_MAX_SOCKETS", "0", "HG_REALTIME_MAX_SOCKETS"},
		"proxy not a CIDR":      {"HG_TRUSTED_PROXY_CIDRS", "172.18.0.0/16,traefik", "HG_TRUSTED_PROXY_CIDRS"},
		"proxy trusts all IPv4": {"HG_TRUSTED_PROXY_CIDRS", "0.0.0.0/0", "HG_TRUSTED_PROXY_CIDRS"},
		"proxy trusts all IPv6": {"HG_TRUSTED_PROXY_CIDRS", "::/0", "HG_TRUSTED_PROXY_CIDRS"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			env := validEnv()
			env[tc.key] = tc.value

			_, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatalf("%s = %q was accepted", tc.key, tc.value)
			}
			if !strings.Contains(err.Error(), tc.wantIn) {
				t.Errorf("error does not name %s: %v", tc.key, err)
			}
		})
	}
}

// TestLoadTrustedProxies pins the default (no proxy trusted, so a forged
// X-Forwarded-For is inert) and the accepted forms: CIDRs and bare addresses.
func TestLoadTrustedProxies(t *testing.T) {
	cfg, err := Load(getenvFrom(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.TrustedProxies) != 0 {
		t.Errorf("TrustedProxies = %v by default, want none", cfg.TrustedProxies)
	}

	env := validEnv()
	env["HG_TRUSTED_PROXY_CIDRS"] = " 172.18.0.7/16 , 10.0.0.2, fd00::/8 "
	cfg, err = Load(getenvFrom(env))
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, p := range cfg.TrustedProxies {
		got = append(got, p.String())
	}
	if want := "172.18.0.0/16 10.0.0.2/32 fd00::/8"; strings.Join(got, " ") != want {
		t.Errorf("TrustedProxies = %v, want %s", got, want)
	}
}

// TestLoadRequiresTrustedProxiesOutsideLocal pins the fail-closed rule:
// staging and production run behind Traefik, where an empty list would give
// every caller Traefik's address and so one shared sign-in code limit for all
// customers. The rule is step 3 (RealIP) of the middleware chain in
// docs/spec/01-platform.md, "Deny-by-default routing and the middleware chain".
func TestLoadRequiresTrustedProxiesOutsideLocal(t *testing.T) {
	for _, envName := range []string{"staging", "production"} {
		t.Run(envName, func(t *testing.T) {
			env := validEnv()
			env["HG_ENV"] = envName
			// Also required outside local (TestLoadRequiresPresignBaseURLOutsideLocal);
			// set here so this test sees only the trusted-proxy rule.
			env["HG_MINIO_PRESIGN_BASE_URL"] = "https://files.halalgoes.com"

			_, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatal("HG_TRUSTED_PROXY_CIDRS unset was accepted outside local")
			}
			if !strings.Contains(err.Error(), "HG_TRUSTED_PROXY_CIDRS") {
				t.Errorf("error does not name HG_TRUSTED_PROXY_CIDRS: %v", err)
			}

			env["HG_TRUSTED_PROXY_CIDRS"] = "172.16.0.0/12"
			if _, err := Load(getenvFrom(env)); err != nil {
				t.Fatalf("a set HG_TRUSTED_PROXY_CIDRS was refused: %v", err)
			}
		})
	}
}

func TestHostFromDSN(t *testing.T) {
	cases := map[string]string{
		"postgres://hg:hg@postgres:5432/hg?sslmode=disable": "postgres:5432",
		"postgresql://hg@db.internal:6432/hg":               "db.internal:6432",
		"host=postgres port=5432 user=hg dbname=hg":         "postgres:5432",
		"host=/var/run/postgresql user=hg":                  "/var/run/postgresql",
		"":                                                  "",
	}
	for dsn, want := range cases {
		if got := hostFromDSN(dsn); got != want {
			t.Errorf("hostFromDSN(%q) = %q, want %q", dsn, got, want)
		}
	}
}

// TestLoadEmailSettings pins the rules that keep email safe: no key means the
// log sender, and outside production the allow-list is the only way out
// (issue #235); in production an allow-list would silently drop customers'
// mail, and links must point at the deployed apps over https.
func TestLoadEmailSettings(t *testing.T) {
	prod := func() map[string]string {
		env := validEnv()
		env["HG_ENV"] = "production"
		env["HG_CORS_ALLOWED_ORIGINS"] = "https://app.halalgoes.com"
		env["HG_TRUSTED_PROXY_CIDRS"] = "172.16.0.0/12"
		env["HG_MINIO_PRESIGN_BASE_URL"] = "https://files.halalgoes.com"
		return env
	}

	cfg, err := Load(getenvFrom(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Email.Provider != "log" || cfg.Email.Configured() {
		t.Errorf("no key: provider = %q, configured = %v; want the log sender", cfg.Email.Provider, cfg.Email.Configured())
	}

	env := validEnv()
	env["HG_RESEND_API_KEY"] = "re_test"
	env["HG_EMAIL_ALLOWLIST"] = "Dev@HalalGoes.test, @example.com"
	if cfg, err = Load(getenvFrom(env)); err != nil {
		t.Fatal(err)
	}
	if !cfg.Email.Configured() || len(cfg.Email.AllowList) != 2 || cfg.Email.AllowList[0] != "dev@halalgoes.test" {
		t.Errorf("key set: provider = %q, allow-list = %v", cfg.Email.Provider, cfg.Email.AllowList)
	}

	env = validEnv()
	env["HG_EMAIL_PROVIDER"] = "resend"
	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "HG_RESEND_API_KEY") {
		t.Errorf("resend without a key booted (err: %v)", err)
	}

	env = prod()
	env["HG_EMAIL_ALLOWLIST"] = "owner@example.com"
	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "HG_EMAIL_ALLOWLIST") {
		t.Errorf("production booted with an allow-list (err: %v)", err)
	}

	env = prod()
	env["HG_RESEND_API_KEY"] = "re_live"
	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "HG_RESTAURANT_WEB_URL") {
		t.Errorf("production sent email with links to localhost (err: %v)", err)
	}
	env["HG_RESTAURANT_WEB_URL"] = "https://partners.halalgoes.com"
	env["HG_ADMIN_WEB_URL"] = "https://halalgoes-admin.example.com"
	if _, err := Load(getenvFrom(env)); err == nil || !strings.Contains(err.Error(), "HG_ADMIN_WEB_URL") {
		t.Errorf("production emails linked to another domain (err: %v)", err)
	}
	env["HG_ADMIN_WEB_URL"] = "https://admin.halalgoes.com"
	if _, err := Load(getenvFrom(env)); err != nil {
		t.Errorf("a valid production email setup was refused: %v", err)
	}
}
