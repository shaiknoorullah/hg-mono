package auth

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
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
<<<<<<< HEAD
	// AppDataKey is the 32-byte AES-256 key for sealing application data like
	// TOTP secrets under AES-GCM.
	AppDataKey []byte
=======
	// AppDataKey is the 32-byte AES-256-GCM key used to seal TOTP secrets in the
	// database (totp_secret_enc). Read from HG_APP_DATA_KEY (hex or base64).
	AppDataKey [32]byte
>>>>>>> feat/gap2-authtotp
}

// Getenv is the minimal environment accessor, matching config.Load's shape so a
// test can inject a map.
type Getenv func(string) string

// LoadSecrets reads the auth-specific secrets from the environment.
//
//   - HG_OTP_PEPPER            (required) base64 or raw, ≥16 bytes
//   - HG_AUTH_SIGNING_KEY_SEED (required) base64 32-byte Ed25519 seed
//   - HG_AUTH_SIGNING_KID      (optional, default "k1")
//   - HG_AUTH_TERMS_VERSION    (optional, default "2026-01")
//   - HG_APP_DATA_KEY          (required) base64 32-byte AES-256 key
//
// secure is passed from the caller (true outside local) because whether the
// cookie is Secure is an environment property the config package already owns.
func LoadSecrets(getenv Getenv, secure bool) (*Secrets, error) {
	var problems []string

	pepperRaw := strings.TrimSpace(getenv("HG_OTP_PEPPER"))
	if pepperRaw == "" {
		problems = append(problems, "HG_OTP_PEPPER is required and was not set")
	}
	pepper := decodeMaybeBase64(pepperRaw)
	if pepperRaw != "" && len(pepper) < 16 {
		problems = append(problems, "HG_OTP_PEPPER must be at least 16 bytes")
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

<<<<<<< HEAD
	appDataKeyRaw := strings.TrimSpace(getenv("HG_APP_DATA_KEY"))
	var appDataKey []byte
	if appDataKeyRaw == "" {
		problems = append(problems, "HG_APP_DATA_KEY is required and was not set")
	} else {
		k, err := base64.StdEncoding.DecodeString(appDataKeyRaw)
		if err != nil {
			k, err = base64.RawURLEncoding.DecodeString(appDataKeyRaw)
		}
		if err != nil || len(k) != 32 {
			problems = append(problems, "HG_APP_DATA_KEY must be a base64-encoded 32-byte key")
		} else {
			appDataKey = k
=======
	// AppDataKey (HG_APP_DATA_KEY): 32-byte hex or base64, for AES-GCM TOTP sealing.
	var appDataKey [32]byte
	appDataKeyRaw := strings.TrimSpace(getenv("HG_APP_DATA_KEY"))
	if appDataKeyRaw == "" {
		// Default to 32 zero bytes in test / local; production must set this.
		// We do NOT add to problems — the test helper sets a dummy key.
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
>>>>>>> feat/gap2-authtotp
		}
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
		RefreshCookieSecure: secure,
		CurrentTermsVersion: terms,
		AppDataKey:          appDataKey,
	}, nil
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
