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
		// A negative suspension delay must not boot as "suspend at once" or "never".
		"negative halal suspension": {"HG_HALAL_SUSPEND_AFTER_EXPIRED_DAYS", "-14", "HG_HALAL_SUSPEND_AFTER_EXPIRED_DAYS"},
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
