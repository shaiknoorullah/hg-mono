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

// TestLoadTrustedProxyRanges pins which ranges HG_TRUSTED_PROXY_CIDRS may
// name. The API's peer is always a container on the Docker network or the
// host, so a trusted proxy lies wholly inside private, loopback or IPv6
// unique-local space; anything reaching outside it stops the API from
// starting, with an error that names the value and what is allowed. See
// "Trusted proxy setting accepts public ranges"
// (https://github.com/shaiknoorullah/hg-mono/issues/268).
func TestLoadTrustedProxyRanges(t *testing.T) {
	accepted := map[string]string{
		"the .env.example default":   "172.16.0.0/12,192.168.0.0/16",
		"the production proxy net":   "10.88.0.0/29",
		"the dev proxy net":          "10.88.0.8/29",
		"all of 10/8":                "10.0.0.0/8",
		"one Docker bridge":          "172.18.0.0/16",
		"one address":                "192.168.1.10",
		"IPv4 loopback":              "127.0.0.1",
		"IPv4 loopback block":        "127.0.0.0/8",
		"IPv6 loopback":              "::1",
		"IPv6 unique-local, all":     "fc00::/7",
		"IPv6 unique-local, a /64":   "fd12:3456:789a:1::/64",
		"IPv6 unique-local, address": "fd00::7",
	}
	for name, value := range accepted {
		t.Run("accepts "+name, func(t *testing.T) {
			env := validEnv()
			env["HG_TRUSTED_PROXY_CIDRS"] = value
			if _, err := Load(getenvFrom(env)); err != nil {
				t.Fatalf("%q was refused: %v", value, err)
			}
		})
	}

	// offending is the value the error must quote. malformed marks a value that
	// is not an address at all, whose error is about syntax, not ranges.
	refused := map[string]struct {
		value, offending string
		malformed        bool
	}{
		"every IPv4 address":            {"0.0.0.0/0", "0.0.0.0/0", false},
		"every IPv6 address":            {"::/0", "::/0", false},
		"split /1, low half":            {"0.0.0.0/1", "0.0.0.0/1", false},
		"split /1, high half":           {"172.16.0.0/12,128.0.0.0/1", "128.0.0.0/1", false},
		"a public /24":                  {"203.0.113.0/24", "203.0.113.0/24", false},
		"a public address":              {"8.8.8.8", "8.8.8.8", false},
		"a public IPv6 /32":             {"2001:db8::/32", "2001:db8::/32", false},
		"straddles 10/8 and public":     {"10.0.0.0/7", "10.0.0.0/7", false},
		"straddles 172.16/12 and 172/8": {"172.0.0.0/8", "172.0.0.0/8", false},
		"straddles 192.168/16":          {"192.168.0.0/15", "192.168.0.0/15", false},
		"straddles fc00::/7":            {"fc00::/6", "fc00::/6", false},
		"IPv6 link-local":               {"fe80::/10", "fe80::/10", false},
		"public beside a private range": {"10.88.0.0/29, 198.51.100.7", "198.51.100.7", false},
		"a mapped public address":       {"::ffff:8.8.8.8", "::ffff:8.8.8.8", false},
		"not an address":                {"172.18.0.0/16,traefik", "traefik", true},
		"prefix longer than the family": {"10.0.0.0/33", "10.0.0.0/33", true},
	}
	for name, tc := range refused {
		t.Run("refuses "+name, func(t *testing.T) {
			env := validEnv()
			env["HG_TRUSTED_PROXY_CIDRS"] = tc.value
			_, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatalf("%q was accepted", tc.value)
			}
			msg := err.Error()
			if !strings.Contains(msg, "HG_TRUSTED_PROXY_CIDRS") || !strings.Contains(msg, `"`+tc.offending+`"`) {
				t.Errorf("error does not name HG_TRUSTED_PROXY_CIDRS and %q: %v", tc.offending, msg)
			}
			if tc.malformed {
				return
			}
			for _, allowed := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128", "fc00::/7"} {
				if !strings.Contains(msg, allowed) {
					t.Errorf("error does not say %s is allowed: %v", allowed, msg)
				}
			}
		})
	}

	// A mapped private range would never match, since the client-address step
	// compares peers as plain IPv4. It is refused with the form that works. See
	// "Trusted proxy setting accepts IPv4-mapped ranges that never match"
	// (https://github.com/shaiknoorullah/hg-mono/issues/263).
	t.Run("refuses a mapped private range, naming its IPv4 form", func(t *testing.T) {
		env := validEnv()
		env["HG_TRUSTED_PROXY_CIDRS"] = "::ffff:172.18.0.0/112"
		_, err := Load(getenvFrom(env))
		if err == nil || !strings.Contains(err.Error(), "172.18.0.0/16") {
			t.Fatalf("a mapped range was not refused with its IPv4 form: %v", err)
		}
	})
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
