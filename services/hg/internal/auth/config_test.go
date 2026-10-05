package auth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

func validEnv() map[string]string {
	seed := make([]byte, ed25519.SeedSize)
	_, _ = rand.Read(seed)
	appKey := make([]byte, 32)
	_, _ = rand.Read(appKey)
	return map[string]string{
		"HG_OTP_PEPPER":            "this-is-a-sixteen-plus-byte-pepper",
		"HG_AUTH_SIGNING_KEY_SEED": base64.StdEncoding.EncodeToString(seed),
		"HG_APP_DATA_KEY":          base64.StdEncoding.EncodeToString(appKey),
	}
}

func getenvFrom(m map[string]string) Getenv {
	return func(k string) string { return m[k] }
}

func TestLoadSecretsHappy(t *testing.T) {
	s, err := LoadSecrets(getenvFrom(validEnv()), true)
	if err != nil {
		t.Fatalf("LoadSecrets: %v", err)
	}
	if len(s.OTPPepper) < 16 {
		t.Fatal("pepper too short")
	}
	if s.SigningPriv == nil || s.SigningPub == nil {
		t.Fatal("signing key not loaded")
	}
	if s.SigningKID != "k1" {
		t.Fatalf("default kid = %q, want k1", s.SigningKID)
	}
	if !s.RefreshCookieSecure {
		t.Fatal("secure flag not propagated")
	}
}

func TestLoadSecretsMissingPepper(t *testing.T) {
	env := validEnv()
	delete(env, "HG_OTP_PEPPER")
	if _, err := LoadSecrets(getenvFrom(env), true); err == nil {
		t.Fatal("LoadSecrets accepted a missing pepper")
	}
}

func TestLoadSecretsBadSeed(t *testing.T) {
	env := validEnv()
	env["HG_AUTH_SIGNING_KEY_SEED"] = "not-base64-and-too-short"
	if _, err := LoadSecrets(getenvFrom(env), false); err == nil {
		t.Fatal("LoadSecrets accepted a bad signing seed")
	}
}

func TestLoadSecretsSignedTokenVerifies(t *testing.T) {
	s, err := LoadSecrets(getenvFrom(validEnv()), false)
	if err != nil {
		t.Fatal(err)
	}
	msg := []byte("hello")
	sig := ed25519.Sign(s.SigningPriv, msg)
	if !ed25519.Verify(s.SigningPub, msg, sig) {
		t.Fatal("loaded key pair does not round-trip a signature")
	}
}

// Weak keys are refused outside local (issue #316:
// https://github.com/shaiknoorullah/hg-mono/issues/316). Each case changes one
// key of a valid environment; the error must name the setting and never show
// the value.
func TestLoadSecretsRefusesWeakKeysOutsideLocal(t *testing.T) {
	zeroHex := strings.Repeat("00", 32)
	reused := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x5a}, 32))
	cases := []struct {
		name    string
		mutate  func(env map[string]string)
		wantMsg string
		value   string // the value that must not appear in the error
	}{
		{
			name:    "data key missing",
			mutate:  func(env map[string]string) { delete(env, "HG_APP_DATA_KEY") },
			wantMsg: "HG_APP_DATA_KEY (or HG_APP_DATA_KEY_FILE) is required outside HG_ENV=local",
		},
		{
			name:    "data key all zero (hex)",
			mutate:  func(env map[string]string) { env["HG_APP_DATA_KEY"] = zeroHex },
			wantMsg: "HG_APP_DATA_KEY is all zero bytes",
			value:   zeroHex,
		},
		{
			name: "data key all zero (base64)",
			mutate: func(env map[string]string) {
				env["HG_APP_DATA_KEY"] = base64.StdEncoding.EncodeToString(make([]byte, 32))
			},
			wantMsg: "HG_APP_DATA_KEY is all zero bytes",
		},
		{
			name: "signing seed all zero",
			mutate: func(env map[string]string) {
				env["HG_AUTH_SIGNING_KEY_SEED"] = base64.StdEncoding.EncodeToString(make([]byte, 32))
			},
			wantMsg: "HG_AUTH_SIGNING_KEY_SEED is all zero bytes",
		},
		{
			name:    "pepper is the .env.example placeholder",
			mutate:  func(env map[string]string) { env["HG_OTP_PEPPER"] = "change-me-openssl-rand-base64-32" },
			wantMsg: "HG_OTP_PEPPER is still the placeholder",
			value:   "change-me-openssl-rand-base64-32",
		},
		{
			name:    "pepper too short for HMAC-SHA256",
			mutate:  func(env map[string]string) { env["HG_OTP_PEPPER"] = "only-twenty-bytes-xx" },
			wantMsg: "HG_OTP_PEPPER must be at least 32 bytes",
			value:   "only-twenty-bytes-xx",
		},
		{
			name: "data key reused as the signing seed",
			mutate: func(env map[string]string) {
				env["HG_APP_DATA_KEY"] = reused
				env["HG_AUTH_SIGNING_KEY_SEED"] = reused
			},
			wantMsg: "HG_AUTH_SIGNING_KEY_SEED and HG_APP_DATA_KEY are the same key",
			value:   reused,
		},
		{
			name: "pepper reused as the data key, written differently",
			mutate: func(env map[string]string) {
				key := bytes.Repeat([]byte{0xa7}, 32)
				env["HG_OTP_PEPPER"] = base64.StdEncoding.EncodeToString(key)
				env["HG_APP_DATA_KEY"] = hex.EncodeToString(key)
			},
			wantMsg: "HG_OTP_PEPPER and HG_APP_DATA_KEY are the same key",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := validEnv()
			tc.mutate(env)
			_, err := LoadSecrets(getenvFrom(env), true)
			if err == nil {
				t.Fatal("accepted outside local")
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Errorf("error does not say %q: %v", tc.wantMsg, err)
			}
			if tc.value != "" && strings.Contains(err.Error(), tc.value) {
				t.Errorf("the error carries the key: %v", err)
			}
		})
	}
}

// HG_ENV=local keeps today's defaults: no data key means the zero key, and a
// short pepper is still allowed.
func TestLoadSecretsKeepsLocalDefaults(t *testing.T) {
	env := validEnv()
	delete(env, "HG_APP_DATA_KEY")
	env["HG_OTP_PEPPER"] = "only-twenty-bytes-xx"
	s, err := LoadSecrets(getenvFrom(env), false)
	if err != nil {
		t.Fatalf("local refused its defaults: %v", err)
	}
	if s.AppDataKey != [32]byte{} {
		t.Error("local without HG_APP_DATA_KEY did not get the zero key")
	}
}

// The production path end to end: keys given as files, through
// config.Load and Config.Lookup, reach LoadSecrets.
func TestLoadSecretsFromFilesThroughConfig(t *testing.T) {
	keys := validEnv()
	env := map[string]string{
		"HG_ENV":                    "production",
		"HG_POSTGRES_DSN":           "postgres://hg:pw@postgres:5432/hg",
		"HG_REDIS_ADDR":             "redis:6379",
		"HG_MINIO_ENDPOINT":         "minio:9000",
		"HG_MINIO_ACCESS_KEY":       "hgminio",
		"HG_MINIO_SECRET_KEY":       "hgminiosecret",
		"HG_CORS_ALLOWED_ORIGINS":   "https://app.example.test",
		"HG_TRUSTED_PROXY_CIDRS":    "172.16.0.0/12",
		"HG_MINIO_PRESIGN_BASE_URL": "https://files.example.test",
	}
	dir := t.TempDir()
	for _, name := range []string{"HG_OTP_PEPPER", "HG_AUTH_SIGNING_KEY_SEED", "HG_APP_DATA_KEY"} {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(keys[name]+"\n"), 0o400); err != nil {
			t.Fatal(err)
		}
		env[name+"_FILE"] = p
	}
	cfg, err := config.Load(getenvFrom(env))
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	s, err := LoadSecrets(cfg.Lookup, true)
	if err != nil {
		t.Fatalf("LoadSecrets from files: %v", err)
	}
	want, _ := base64.StdEncoding.DecodeString(keys["HG_APP_DATA_KEY"])
	if !bytes.Equal(s.AppDataKey[:], want) {
		t.Error("the data key did not come from its file")
	}
}
