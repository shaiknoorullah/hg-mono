package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"
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

// The hashing cap defaults to 3 at a time (one per gate) with a 2s wait, can be
// tuned, and a value that would disable or break the cap refuses to boot.
func TestLoadSecretsHashingCap(t *testing.T) {
	s, err := LoadSecrets(getenvFrom(validEnv()), false)
	if err != nil {
		t.Fatal(err)
	}
	if s.HashConcurrency != 3 || s.HashWait != 2*time.Second || s.HashMaxWaiters != 0 {
		t.Fatalf("defaults = (%d, %s, %d), want (3, 2s, 0)", s.HashConcurrency, s.HashWait, s.HashMaxWaiters)
	}

	env := validEnv()
	env["HG_AUTH_HASH_CONCURRENCY"] = "4"
	env["HG_AUTH_HASH_WAIT"] = "1500ms"
	env["HG_AUTH_HASH_MAX_WAITERS"] = "12"
	s, err = LoadSecrets(getenvFrom(env), false)
	if err != nil {
		t.Fatal(err)
	}
	if s.HashConcurrency != 4 || s.HashWait != 1500*time.Millisecond || s.HashMaxWaiters != 12 {
		t.Fatalf("overrides = (%d, %s, %d), want (4, 1.5s, 12)", s.HashConcurrency, s.HashWait, s.HashMaxWaiters)
	}

	for _, bad := range []map[string]string{
		{"HG_AUTH_HASH_CONCURRENCY": "0"},
		{"HG_AUTH_HASH_CONCURRENCY": "2"}, // a gate would have no slot
		{"HG_AUTH_HASH_CONCURRENCY": "two"},
		{"HG_AUTH_HASH_WAIT": "0s"},
		{"HG_AUTH_HASH_WAIT": "2"},
		{"HG_AUTH_HASH_WAIT": "30s"}, // waiters would hold connections that long
		{"HG_AUTH_HASH_MAX_WAITERS": "0"},
	} {
		env := validEnv()
		for k, v := range bad {
			env[k] = v
		}
		if _, err := LoadSecrets(getenvFrom(env), false); err == nil {
			t.Errorf("LoadSecrets accepted %v", bad)
		}
	}
}
