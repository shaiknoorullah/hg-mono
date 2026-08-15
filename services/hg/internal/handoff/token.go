package handoff

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ErrInvalidToken is returned by VerifySealToken for any malformed token, bad
// signature, or unparseable claims. It is deliberately one error: the caller
// (and the client) never learns *which* part of a forged token failed.
var ErrInvalidToken = errors.New("handoff: seal token invalid")

// sealTokenPrefix makes a scanned string unambiguously a seal token in logs and
// error messages, and lets VerifySealToken reject a foreign-shaped string (e.g.
// a JWT access token) before attempting to decode it as one.
const sealTokenPrefix = "hgseal."

// SealClaims is the payload signed into every seal QR token: exactly the three
// fields migration 00027's comment promises and nothing else — no price, no
// PII, ever encoded in the QR.
type SealClaims struct {
	OrderID string `json:"order_id"`
	SealID  string `json:"seal_id"`
	Nonce   string `json:"nonce"`
}

// NewNonce mints a 16-byte crypto/rand nonce, base64url-encoded, for a fresh
// SealClaims. It is unique per seal binding (one per seal's lifetime); the
// per-proof-type scoping that makes two legitimate scans of the same physical
// token possible happens in eventNonce, not here.
func NewNonce() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("handoff: nonce: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// MintSealToken signs claims with priv and returns the compact token a client
// renders as the QR: "hgseal.<base64url(claims json)>.<base64url(signature)>".
// This is a minimal, self-contained encoding (mirroring auth.SignAccessToken's
// compact-JWS shape) rather than a JWT dependency — the payload is three plain
// strings, not a claims set that needs registered-claim handling.
func MintSealToken(priv ed25519.PrivateKey, claims SealClaims) (string, error) {
	body, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("handoff: marshal claims: %w", err)
	}
	bodyB64 := base64.RawURLEncoding.EncodeToString(body)
	sig := ed25519.Sign(priv, []byte(bodyB64))
	sigB64 := base64.RawURLEncoding.EncodeToString(sig)
	return sealTokenPrefix + bodyB64 + "." + sigB64, nil
}

// VerifySealToken checks the EdDSA signature over token and returns the claims
// it carries. It never trusts the claims before the signature has verified —
// unlike a client-asserted field, a forged token cannot produce a valid
// signature without priv's matching private key, which never leaves this
// process (P-04).
func VerifySealToken(pub ed25519.PublicKey, token string) (SealClaims, error) {
	var claims SealClaims
	if !strings.HasPrefix(token, sealTokenPrefix) {
		return claims, ErrInvalidToken
	}
	rest := strings.TrimPrefix(token, sealTokenPrefix)
	bodyB64, sigB64, ok := strings.Cut(rest, ".")
	if !ok || bodyB64 == "" || sigB64 == "" {
		return claims, ErrInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return claims, ErrInvalidToken
	}
	if !ed25519.Verify(pub, []byte(bodyB64), sig) {
		return claims, ErrInvalidToken
	}
	body, err := base64.RawURLEncoding.DecodeString(bodyB64)
	if err != nil {
		return claims, ErrInvalidToken
	}
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&claims); err != nil {
		return claims, ErrInvalidToken
	}
	if claims.OrderID == "" || claims.SealID == "" || claims.Nonce == "" {
		return claims, ErrInvalidToken
	}
	return claims, nil
}

// eventNonce scopes a token's raw nonce to one proof type, so the *same*
// physical QR can be scanned once at pickup and once at delivery without the
// second scan tripping handoff_event_nonce_unique as a false replay, while a
// genuine repeat of the same step still collides on the same key.
func eventNonce(nonce, eventType string) string {
	return nonce + ":" + eventType
}
