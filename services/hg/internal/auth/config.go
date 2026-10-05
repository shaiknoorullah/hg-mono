package auth

import (
	"crypto/ed25519"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Secrets holds the cryptographic material this module needs. It is loaded from
// the environment at boot by LoadSecrets, which keeps the shared config package
// untouched while still failing loud on a missing required variable (G-7).
//
// The signing key is Ed25519. In V1 the module carries a single active key; the
// signing_key table and 90-day rotation (P-04) are a follow-up — see the TODO in
// LoadSecrets. Verification already tries by `kid`, so adding a second key is a
// data change, not a code change.
type Secrets struct {
	// OTPPepper is the HMAC key for otp_challenge.code_hash (P-02).
	OTPPepper []byte
	// SigningKID identifies the active Ed25519 key in the access token header.
	SigningKID string
	// SigningPriv signs access tokens.
	SigningPriv ed25519.PrivateKey
	// SigningPub verifies them (and is exposed for a future JWKS).
	SigningPub ed25519.PublicKey
	// RefreshCookieSecure controls the Secure attribute on the hg_rt cookie. It
	// is false only in local, where there is no TLS.
	RefreshCookieSecure bool
	// CurrentTermsVersion is the terms string registerRestaurant must match
	// (409 TERMS_VERSION_STALE otherwise).
	CurrentTermsVersion string
	// AppDataKey is the 32-byte AES-256-GCM key used to seal TOTP secrets in the
	// database (totp_secret_enc). Read from HG_APP_DATA_KEY (hex or base64).
	AppDataKey [32]byte
}

// Getenv is the minimal environment accessor, matching config.Load's shape so a
// test can inject a map.
type Getenv func(string) string

// LoadSecrets reads the auth-specific secrets from the environment.
//
//   - HG_OTP_PEPPER            (required) base64 or raw, ≥16 bytes (≥32 outside local)
//   - HG_AUTH_SIGNING_KEY_SEED (required) base64 32-byte Ed25519 seed
//   - HG_APP_DATA_KEY          (required outside local) 32 bytes, hex or base64
//   - HG_AUTH_SIGNING_KID      (optional, default "k1")
//   - HG_AUTH_TERMS_VERSION    (optional, default "2026-01")
//
// In production getenv is config.Config.Lookup, so each key may also come
// from a file (HG_APP_DATA_KEY_FILE and so on).
//
// strict is true outside HG_ENV=local. It makes the refresh cookie Secure, and
// it refuses weak keys: a missing HG_APP_DATA_KEY, a key that is all zero
// bytes or still a deploy/.env.example placeholder, a pepper shorter than the
// HMAC-SHA256 output, or one key reused as another (issue #316:
// https://github.com/shaiknoorullah/hg-mono/issues/316). Only HG_ENV=local
// keeps the zero data key as its default. No problem message contains a key.
func LoadSecrets(getenv Getenv, strict bool) (*Secrets, error) {
	var problems []string

	pepperRaw := strings.TrimSpace(getenv("HG_OTP_PEPPER"))
	if pepperRaw == "" {
		problems = append(problems, "HG_OTP_PEPPER is required and was not set")
	}
	pepper := decodeMaybeBase64(pepperRaw)
	if pepperRaw != "" && len(pepper) < 16 {
		problems = append(problems, "HG_OTP_PEPPER must be at least 16 bytes")
	} else if strict && pepperRaw != "" && len(pepper) < minStrictPepperBytes {
		// RFC 2104 section 3: an HMAC key shorter than the hash output (32
		// bytes for SHA-256) weakens it. A six-digit code has a million values,
		// so the pepper is all that stands between a leaked hash and the code.
		problems = append(problems, fmt.Sprintf(
			"HG_OTP_PEPPER must be at least %d bytes outside HG_ENV=local (generate one with: openssl rand -base64 32)",
			minStrictPepperBytes))
	}

	seedRaw := strings.TrimSpace(getenv("HG_AUTH_SIGNING_KEY_SEED"))
	var priv ed25519.PrivateKey
	var pub ed25519.PublicKey
	if seedRaw == "" {
		problems = append(problems, "HG_AUTH_SIGNING_KEY_SEED is required and was not set")
	} else {
		seed, err := base64.StdEncoding.DecodeString(seedRaw)
		if err != nil {
			seed, err = base64.RawURLEncoding.DecodeString(seedRaw)
		}
		if err != nil || len(seed) != ed25519.SeedSize {
			problems = append(problems, fmt.Sprintf(
				"HG_AUTH_SIGNING_KEY_SEED must be a base64-encoded %d-byte Ed25519 seed", ed25519.SeedSize))
		} else {
			priv = ed25519.NewKeyFromSeed(seed)
			pub = priv.Public().(ed25519.PublicKey)
		}
	}

	kid := strings.TrimSpace(getenv("HG_AUTH_SIGNING_KID"))
	if kid == "" {
		kid = "k1"
	}
	terms := strings.TrimSpace(getenv("HG_AUTH_TERMS_VERSION"))
	if terms == "" {
		terms = "2026-01"
	}

	// AppDataKey (HG_APP_DATA_KEY): 32-byte hex or base64, for AES-GCM TOTP sealing.
	var appDataKey [32]byte
	var appDataKeyDecoded []byte // nil unless the key decoded to 32 bytes
	appDataKeyRaw := strings.TrimSpace(getenv("HG_APP_DATA_KEY"))
	if appDataKeyRaw == "" {
		// Only HG_ENV=local (and the tests) keep the 32-zero-byte default.
		// Anywhere else it would seal every TOTP secret under a key everyone
		// knows, so it does not boot.
		if strict {
			problems = append(problems, "HG_APP_DATA_KEY (or HG_APP_DATA_KEY_FILE) is required outside "+
				"HG_ENV=local: it seals staff TOTP secrets (generate one with: openssl rand -hex 32)")
		}
	} else {
		keyBytes, kerr := hex.DecodeString(appDataKeyRaw)
		if kerr != nil || len(keyBytes) != 32 {
			// try base64
			keyBytes, kerr = base64.StdEncoding.DecodeString(appDataKeyRaw)
			if kerr != nil {
				keyBytes, kerr = base64.RawURLEncoding.DecodeString(appDataKeyRaw)
			}
		}
		if kerr != nil || len(keyBytes) != 32 {
			problems = append(problems, "HG_APP_DATA_KEY must be 32 bytes as hex or base64")
		} else {
			copy(appDataKey[:], keyBytes)
			appDataKeyDecoded = appDataKey[:]
		}
	}

	if strict {
		var seed []byte
		if priv != nil {
			seed = priv.Seed()
		}
		problems = append(problems, weakKeyProblems([]namedKey{
			{"HG_OTP_PEPPER", pepperRaw, pepper},
			{"HG_AUTH_SIGNING_KEY_SEED", seedRaw, seed},
			{"HG_APP_DATA_KEY", appDataKeyRaw, appDataKeyDecoded},
		})...)
	}

	if len(problems) > 0 {
		return nil, fmt.Errorf("invalid auth configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}

	// TODO(P-04 rotation): load the signing_key table, hold two active keys, seal
	// private keys under APP_DATA_KEY, and rotate every 90 days. The single env
	// seed is the V1 bootstrap key; the verifier already selects by kid.
	return &Secrets{
		OTPPepper:           pepper,
		SigningKID:          kid,
		SigningPriv:         priv,
		SigningPub:          pub,
		RefreshCookieSecure: strict,
		CurrentTermsVersion: terms,
		AppDataKey:          appDataKey,
	}, nil
}

// minStrictPepperBytes is the shortest OTP pepper accepted outside local: the
// SHA-256 output size, the length RFC 2104 section 3 recommends for an HMAC key.
const minStrictPepperBytes = 32

// namedKey is one key as configured (raw) and as used (decoded).
type namedKey struct {
	name    string
	raw     string
	decoded []byte
}

// weakKeyProblems returns one message per key that is still a
// deploy/.env.example placeholder or all zero bytes, and one per pair of keys
// that are the same. A key that is unset or failed to decode is skipped here:
// its own check already reported it. The messages name settings, never values.
func weakKeyProblems(keys []namedKey) []string {
	var problems []string
	for _, k := range keys {
		if k.raw == "" {
			continue
		}
		if config.IsPlaceholder(k.raw) {
			problems = append(problems, k.name+" is still the placeholder from deploy/.env.example; "+
				"set a real key (refused outside HG_ENV=local)")
			continue
		}
		if len(k.decoded) > 0 && allZero(k.decoded) {
			problems = append(problems, k.name+" is all zero bytes, a key everyone knows "+
				"(refused outside HG_ENV=local)")
		}
	}
	// Each key protects something different; reusing one makes a leak of
	// any of them a leak of all of them.
	for i := range keys {
		for j := i + 1; j < len(keys); j++ {
			a, b := keys[i], keys[j]
			if a.raw == "" || b.raw == "" {
				continue
			}
			sameDecoded := len(a.decoded) > 0 && subtle.ConstantTimeCompare(a.decoded, b.decoded) == 1
			if a.raw == b.raw || sameDecoded {
				problems = append(problems, fmt.Sprintf(
					"%s and %s are the same key; give each its own (refused outside HG_ENV=local)", a.name, b.name))
			}
		}
	}
	return problems
}

func allZero(b []byte) bool {
	for _, c := range b {
		if c != 0 {
			return false
		}
	}
	return true
}

// decodeMaybeBase64 returns the base64-decoded bytes when the input decodes
// cleanly, else the raw bytes. A pepper may be supplied either way.
func decodeMaybeBase64(s string) []byte {
	if s == "" {
		return nil
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil && len(b) >= 16 {
		return b
	}
	return []byte(s)
}

// Access-token and refresh-token lifetimes (P-04).
const (
	// AccessTokenTTL is 15 minutes for every role.
	AccessTokenTTL = 15 * time.Minute
	// AccessTokenTTLSeconds is the expires_in the contract returns (900).
	AccessTokenTTLSeconds = int32(AccessTokenTTL / time.Second)
)

// refreshTTL returns the idle and absolute refresh-token TTLs for a role class
// (P-04 table). The most privileged role in the session decides the class, so a
// short-lived admin session cannot be extended by a co-held customer grant.
func refreshTTL(roles []string) (idle, absolute time.Duration) {
	class := roleClass(roles)
	switch class {
	case classAdmin:
		return 8 * time.Hour, 24 * time.Hour
	case classSupport:
		return 12 * time.Hour, 7 * 24 * time.Hour
	case classRestaurant:
		return 14 * 24 * time.Hour, 90 * 24 * time.Hour
	default: // customer / rider
		return 30 * 24 * time.Hour, 180 * 24 * time.Hour
	}
}

type refreshClass int

const (
	classCustomer refreshClass = iota
	classRestaurant
	classSupport
	classAdmin
)

func roleClass(roles []string) refreshClass {
	best := classCustomer
	for _, r := range roles {
		switch r {
		case "ADMIN", "SUPER_ADMIN":
			if best < classAdmin {
				best = classAdmin
			}
		case "SUPPORT_AGENT":
			if best < classSupport {
				best = classSupport
			}
		case "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF":
			if best < classRestaurant {
				best = classRestaurant
			}
		}
	}
	return best
}
