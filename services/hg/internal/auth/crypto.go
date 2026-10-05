package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters from the contract's Password schema: t=3, m=64 MiB, p=2.
const (
	argonTime    = 3
	argonMemory  = 64 * 1024 // KiB → 64 MiB
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

// HashPassword produces a PHC-encoded argon2id string suitable for the
// account.password_hash column. The encoding is self-describing so a future
// parameter change verifies old hashes without a migration. It waits for a slot
// on the sign-up gate first (hashgate.go) and returns an error matching
// ErrPasswordHashBusy when none frees up in time. Request flows take the slot
// for their own audience instead; this is for tools such as cmd/seedpw.
func HashPassword(ctx context.Context, password string) (string, error) {
	slot, err := acquireHashSlot(ctx, audienceSignup)
	if err != nil {
		return "", err
	}
	defer slot.release()
	return slot.hash(password)
}

// VerifyPassword reports whether password matches the PHC-encoded argon2id hash.
// It waits for a slot like HashPassword. A caller that must tell "busy" apart
// from "wrong password" should hold a slot and call slot.verify instead, so the
// two can never be confused.
func VerifyPassword(ctx context.Context, encoded, password string) (bool, error) {
	slot, err := acquireHashSlot(ctx, audienceSignup)
	if err != nil {
		return false, err
	}
	defer slot.release()
	return slot.verify(encoded, password)
}

// dummyPasswordHash is what Login verifies against when the email has no
// account or the account has no password, so that answer costs the same
// argon2id work as a wrong password and its timing does not reveal which
// emails are registered. It is built from the same parameter constants as a
// real hash, so it cannot drift to a cheaper cost, and its key is random bytes
// that no password derives to. Nothing is hashed to build it.
var dummyPasswordHash = func() string {
	salt := make([]byte, argonSaltLen)
	key := make([]byte, argonKeyLen)
	if _, err := rand.Read(salt); err != nil {
		panic("argon2id: read dummy salt: " + err.Error())
	}
	if _, err := rand.Read(key); err != nil {
		panic("argon2id: read dummy key: " + err.Error())
	}
	b64 := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64(salt), b64(key))
}()

// hash is the argon2id hash itself, run under a held slot.
func (*hashSlot) hash(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("argon2id: read salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		b64(salt), b64(key)), nil
}

// verify is the argon2id verification itself, run under a held slot. It is
// constant time in the comparison and returns false (not an error) on a
// mismatch; a malformed encoding is an error.
func (*hashSlot) verify(encoded, password string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// ["", "argon2id", "v=19", "m=65536,t=3,p=2", salt, key]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errors.New("argon2id: malformed hash encoding")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, fmt.Errorf("argon2id: version: %w", err)
	}
	var m, t, p uint32
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false, fmt.Errorf("argon2id: params: %w", err)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("argon2id: salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("argon2id: key: %w", err)
	}
	got := argon2.IDKey([]byte(password), salt, t, m, uint8(p), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// GenerateOTPCode returns a 6-digit code drawn uniformly from [0, 999999] with
// crypto/rand, zero-padded (P-02). The uniform draw avoids the modulo bias the
// old system had.
func GenerateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("otp: rand: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// HMACCode returns HMAC-SHA256(code, pepper) for storage in
// otp_challenge.code_hash. The pepper never leaves the process's config, so a
// database dump alone does not reveal codes (P-02).
func HMACCode(code string, pepper []byte) []byte {
	mac := hmac.New(sha256.New, pepper)
	mac.Write([]byte(code))
	return mac.Sum(nil)
}

// ConstantTimeEqual compares two byte slices without leaking timing.
func ConstantTimeEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}

// NewRefreshToken mints a 32-byte base64url refresh token in the contract's
// `hgrt_<base64url>` shape and returns it together with the SHA-256 that is the
// only thing persisted (P-04).
func NewRefreshToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("refresh: rand: %w", err)
	}
	token = "hgrt_" + base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(token))
	return token, h[:], nil
}

// HashRefreshToken returns the SHA-256 of a presented refresh token, for the
// constant-key lookup against session.refresh_hash.
func HashRefreshToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// NewOpaqueToken mints a URL-safe opaque token (email verification, password
// reset) and returns it with its SHA-256 for storage. The token is at least 32
// characters, satisfying the contract's minLength.
func NewOpaqueToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("token: rand: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	h := sha256.Sum256([]byte(token))
	return token, h[:], nil
}

// HashOpaqueToken returns the SHA-256 of a presented opaque token.
func HashOpaqueToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// SignAccessToken builds a compact EdDSA (Ed25519) JWS from the already-encoded
// header and claims segments. It is a minimal, standards-compliant signer rather
// than a JWT dependency.
func SignAccessToken(headerB64, claimsB64 string, priv ed25519.PrivateKey) string {
	signingInput := headerB64 + "." + claimsB64
	sig := ed25519.Sign(priv, []byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// b64url is the JOSE base64url (no padding) encoder used for JWT segments.
func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// SealAESGCM encrypts plaintext under a 32-byte key using AES-256-GCM with a
// random 12-byte nonce prepended to the ciphertext. The output is
// nonce || ciphertext || tag (96 bytes overhead).
func SealAESGCM(key [32]byte, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("seal: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("seal: new gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("seal: nonce: %w", err)
	}
	ct := gcm.Seal(nonce, nonce, plaintext, nil)
	return ct, nil
}

// OpenAESGCM decrypts ciphertext produced by SealAESGCM. It returns an error
// if the ciphertext is malformed or the authentication tag fails.
func OpenAESGCM(key [32]byte, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("open: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("open: new gcm: %w", err)
	}
	ns := gcm.NonceSize()
	if len(ciphertext) < ns {
		return nil, errors.New("open: ciphertext too short")
	}
	nonce, ct := ciphertext[:ns], ciphertext[ns:]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("open: decrypt: %w", err)
	}
	return plain, nil
}
