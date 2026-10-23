package config

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Tests for secrets read from files (issue #309:
// https://github.com/shaiknoorullah/hg-mono/issues/309) and placeholder
// secrets refused outside local (issue #316:
// https://github.com/shaiknoorullah/hg-mono/issues/316).

// productionEnv is validEnv made valid for HG_ENV=production.
func productionEnv() map[string]string {
	env := validEnv()
	env["HG_ENV"] = "production"
	env["HG_TRUSTED_PROXY_CIDRS"] = "172.16.0.0/12"
	env["HG_MINIO_PRESIGN_BASE_URL"] = "https://files.example.test"
	return env
}

// secretFile writes value to a fresh file with the given mode and returns its
// path. The mode is set with Chmod so the umask cannot change it.
func secretFile(t *testing.T, name, value string, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(value), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, mode); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSecretFromFileLoads(t *testing.T) {
	const secret = "minio-secret-from-a-file"
	const dsn = "postgres://hg:pw-from-a-file@postgres:5432/hg?sslmode=disable"
	const dataKey = "5f2b9c0e7a1d4e8f3b6c9a0d2e5f8b1c4a7d0e3f6b9c2a5d8e1f4b7c0a3d6e9f"
	for _, envName := range []string{"local", "production"} {
		t.Run(envName, func(t *testing.T) {
			env := validEnv()
			if envName == "production" {
				env = productionEnv()
			}
			delete(env, "HG_MINIO_SECRET_KEY")
			delete(env, "HG_POSTGRES_DSN")
			// `echo value > file` leaves one trailing newline; it is not part of
			// the value.
			env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "minio_secret", secret+"\n", 0o400)
			env["HG_POSTGRES_DSN_FILE"] = secretFile(t, "postgres_dsn", dsn+"\r\n", 0o400)
			env["HG_APP_DATA_KEY_FILE"] = secretFile(t, "app_data_key", dataKey, 0o400)

			cfg, err := Load(getenvFrom(env))
			if err != nil {
				t.Fatalf("a secret given as a file was refused: %v", err)
			}
			if cfg.MinIO.SecretKey != secret {
				t.Errorf("MinIO.SecretKey did not come from the file with its newline trimmed")
			}
			if cfg.Postgres.DSN != dsn || cfg.Postgres.Host() != "postgres:5432" {
				t.Errorf("Postgres.DSN did not come from the file with its CRLF trimmed")
			}
			// auth.LoadSecrets reads its keys through Lookup.
			if cfg.Lookup("HG_APP_DATA_KEY") != dataKey {
				t.Errorf("Lookup(HG_APP_DATA_KEY) did not return the file's value")
			}
			if cfg.Lookup("HG_ENV") != envName {
				t.Errorf("Lookup does not pass other variables through")
			}
			for name, want := range map[string]SecretSource{
				"HG_MINIO_SECRET_KEY":  SecretFromFile,
				"HG_POSTGRES_DSN":      SecretFromFile,
				"HG_APP_DATA_KEY":      SecretFromFile,
				"HG_MINIO_ACCESS_KEY":  SecretFromEnv,
				"HG_STRIPE_SECRET_KEY": SecretNotSet,
			} {
				if got := cfg.SecretSources[name]; got != want {
					t.Errorf("SecretSources[%s] = %q, want %q", name, got, want)
				}
			}
			if len(cfg.Warnings) != 0 {
				t.Errorf("unexpected warnings for 0400 files: %v", cfg.Warnings)
			}
		})
	}
}

// Every secret setting accepts the file form, not only the ones above.
func TestEverySecretSettingAcceptsAFile(t *testing.T) {
	for _, name := range SecretSettings {
		t.Run(name, func(t *testing.T) {
			p := secretFile(t, "s", "value-of-"+name, 0o400)
			v, src, _, err := ReadSecret(getenvFrom(map[string]string{name + "_FILE": p}), name, true)
			if err != nil || src != SecretFromFile || v != "value-of-"+name {
				t.Fatalf("ReadSecret(%s) = (%q, %q, %v)", name, v, src, err)
			}
		})
	}
}

func TestSecretFileRefusals(t *testing.T) {
	const secret = "hunter2-do-not-print"
	cases := []struct {
		name    string
		env     func(t *testing.T) map[string]string
		wantMsg string
	}{
		{
			name: "both the variable and its file are set",
			env: func(t *testing.T) map[string]string {
				env := validEnv()
				env["HG_MINIO_SECRET_KEY"] = secret
				env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "s", secret, 0o400)
				return env
			},
			wantMsg: "HG_MINIO_SECRET_KEY and HG_MINIO_SECRET_KEY_FILE are both set",
		},
		{
			name: "a world-readable file in production",
			env: func(t *testing.T) map[string]string {
				env := productionEnv()
				delete(env, "HG_MINIO_SECRET_KEY")
				env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "s", secret, 0o644)
				return env
			},
			wantMsg: "HG_MINIO_SECRET_KEY_FILE",
		},
		{
			name: "a group-readable file in staging",
			env: func(t *testing.T) map[string]string {
				env := productionEnv()
				env["HG_ENV"] = "staging"
				env["HG_REDIS_PASSWORD_FILE"] = secretFile(t, "s", secret, 0o440)
				return env
			},
			wantMsg: "HG_REDIS_PASSWORD_FILE",
		},
		{
			name: "a missing file",
			env: func(t *testing.T) map[string]string {
				env := validEnv()
				delete(env, "HG_MINIO_SECRET_KEY")
				env["HG_MINIO_SECRET_KEY_FILE"] = filepath.Join(t.TempDir(), "absent")
				return env
			},
			wantMsg: "does not exist",
		},
		{
			name: "an empty file",
			env: func(t *testing.T) map[string]string {
				env := validEnv()
				delete(env, "HG_MINIO_SECRET_KEY")
				env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "s", "\n", 0o400)
				return env
			},
			wantMsg: "is empty",
		},
		{
			name: "a directory",
			env: func(t *testing.T) map[string]string {
				env := validEnv()
				delete(env, "HG_MINIO_SECRET_KEY")
				env["HG_MINIO_SECRET_KEY_FILE"] = t.TempDir()
				return env
			},
			wantMsg: "not a regular file",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load(getenvFrom(tc.env(t)))
			if err == nil {
				t.Fatalf("accepted (cfg=%v)", cfg != nil)
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Errorf("error does not say %q: %v", tc.wantMsg, err)
			}
			if strings.Contains(err.Error(), secret) {
				t.Errorf("the error carries the secret value: %v", err)
			}
			// A secret whose file failed is reported once, not again as unset.
			if strings.Contains(err.Error(), "HG_MINIO_SECRET_KEY is required") {
				t.Errorf("a failed file was reported a second time as unset: %v", err)
			}
		})
	}
}

// Outside local a loose file does not boot; in local it boots with a warning.
func TestSecretFileModeIsAWarningInLocal(t *testing.T) {
	env := validEnv()
	delete(env, "HG_MINIO_SECRET_KEY")
	env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "s", "local-secret", 0o644)
	cfg, err := Load(getenvFrom(env))
	if err != nil {
		t.Fatalf("local refused a world-readable secret file; it should only warn: %v", err)
	}
	if len(cfg.Warnings) != 1 || !strings.Contains(cfg.Warnings[0], "HG_MINIO_SECRET_KEY_FILE") {
		t.Errorf("Warnings = %v, want one naming HG_MINIO_SECRET_KEY_FILE", cfg.Warnings)
	}
}

func TestPlaceholderSecretsAreRefusedOutsideLocal(t *testing.T) {
	for key, value := range map[string]string{
		"HG_MINIO_SECRET_KEY": "change-me-in-your-env",
		"HG_POSTGRES_DSN":     "postgres://hg:change-me-in-your-env@postgres:5432/hg?sslmode=disable",
		"HG_APP_DATA_KEY":     "change-me-openssl-rand-base64-32",
		"HG_OTP_PEPPER":       "CHANGEME",
	} {
		t.Run(key, func(t *testing.T) {
			env := productionEnv()
			env[key] = value
			_, err := Load(getenvFrom(env))
			if err == nil {
				t.Fatalf("production booted with %s still a placeholder", key)
			}
			if !strings.Contains(err.Error(), key+" is still the placeholder") {
				t.Errorf("error does not name %s as a placeholder: %v", key, err)
			}
			if strings.Contains(err.Error(), value) {
				t.Errorf("the error carries the value: %v", err)
			}

			// local keeps working with the example file as it is.
			env["HG_ENV"] = "local"
			if _, err := Load(getenvFrom(env)); err != nil {
				t.Errorf("local refused a placeholder: %v", err)
			}
		})
	}
}

// No secret value, file content or length reaches the log or an error.
func TestSecretsNeverReachTheLog(t *testing.T) {
	values := map[string]string{
		"HG_MINIO_SECRET_KEY":      "file-secret-aaaaaaaaaaaaaaaaaaaaaa",
		"HG_REDIS_PASSWORD":        "env-secret-bbbbbbbbbbbbbbbbbbbbbbbb",
		"HG_STRIPE_WEBHOOK_SECRET": "whsec_file-secret-cccccccccccccccc",
		"HG_APP_DATA_KEY":          "6b1e0f3a9c2d5e8f7a4b1c0d3e6f9a2b5c8d1e4f7a0b3c6d9e2f5a8b1c4d7e0f",
	}
	env := validEnv()
	env["HG_REDIS_PASSWORD"] = values["HG_REDIS_PASSWORD"]
	delete(env, "HG_MINIO_SECRET_KEY")
	// Group- and world-readable in local: loads, with a warning that is logged.
	env["HG_MINIO_SECRET_KEY_FILE"] = secretFile(t, "minio", values["HG_MINIO_SECRET_KEY"]+"\n", 0o644)
	env["HG_STRIPE_WEBHOOK_SECRET_FILE"] = secretFile(t, "whsec", values["HG_STRIPE_WEBHOOK_SECRET"], 0o400)
	env["HG_APP_DATA_KEY_FILE"] = secretFile(t, "app", values["HG_APP_DATA_KEY"], 0o400)

	cfg, err := Load(getenvFrom(env))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var buf bytes.Buffer
	cfg.LogSecretSources(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	out := buf.String()

	for name, v := range values {
		if strings.Contains(out, v) {
			t.Errorf("the log carries the value of %s", name)
		}
	}
	// The log says where each secret came from, and nothing about its size.
	for _, want := range []string{
		`"HG_MINIO_SECRET_KEY":"file"`,
		`"HG_REDIS_PASSWORD":"environment"`,
		`"HG_STRIPE_SECRET_KEY":"not set"`,
		`"level":"WARN"`,
		"HG_MINIO_SECRET_KEY_FILE",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("log does not contain %s:\n%s", want, out)
		}
	}
	// Each secret's attribute is one of the three sources, so nothing about a
	// value (its length included) has anywhere to go.
	for _, name := range SecretSettings {
		ok := false
		for _, src := range []SecretSource{SecretFromFile, SecretFromEnv, SecretNotSet} {
			ok = ok || strings.Contains(out, `"`+name+`":"`+string(src)+`"`)
		}
		if !ok {
			t.Errorf("log reports %s as something other than file, environment or not set:\n%s", name, out)
		}
	}

	// The same holds for a refused boot: every error names, never shows.
	env["HG_ENV"] = "production"
	env["HG_TRUSTED_PROXY_CIDRS"] = "172.16.0.0/12"
	env["HG_MINIO_PRESIGN_BASE_URL"] = "https://files.example.test"
	env["HG_REDIS_PASSWORD_FILE"] = env["HG_APP_DATA_KEY_FILE"] // both set
	_, err = Load(getenvFrom(env))
	if err == nil {
		t.Fatal("production accepted a world-readable file and a doubly-set secret")
	}
	for name, v := range values {
		if strings.Contains(err.Error(), v) {
			t.Errorf("the boot error carries the value of %s: %v", name, err)
		}
	}
}
