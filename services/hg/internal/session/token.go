// Package session issues, verifies and revokes the P-04 access and refresh
// tokens, and holds the in-process revocation deny set.
//
// Split tokens: a short-lived EdDSA access JWT proves identity to the API; a
// long-lived opaque refresh token (owned by internal/auth's store) buys new
// access JWTs and is the only revocable artefact. This package is deliberately
// free of database access — it is pure token cryptography plus an in-memory deny
// set — so it can be unit-tested without Postgres and imported by both the
// authenticator middleware and the auth service without a cycle.
package session

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Claims is the P-04 access-token payload. The `amr` is an array so a token can
// record `pwd+totp`; `roles` are already filtered to those the amr permits.
type Claims struct {
	Issuer    string   `json:"iss"`
	Subject   string   `json:"sub"` // account_id
	SessionID string   `json:"sid"`
	Roles     []string `json:"roles"`
	AMR       []string `json:"amr"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
	NotBefore int64    `json:"nbf"`
}

// header is the JOSE header. `kid` selects the verification key.
type header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

// Issuer signs access tokens with one active Ed25519 key.
type Issuer struct {
	kid  string
	priv ed25519.PrivateKey
	iss  string
	now  func() time.Time
}

// NewIssuer builds an Issuer. iss is the token's `iss` claim ("hg-api").
func NewIssuer(kid string, priv ed25519.PrivateKey, iss string) *Issuer {
	return &Issuer{kid: kid, priv: priv, iss: iss, now: time.Now}
}

// Issue signs a 15-minute access token for the session.
func (i *Issuer) Issue(accountID, sessionID string, roles, amr []string, ttl time.Duration) (string, error) {
	now := i.now().UTC()
	h := header{Alg: "EdDSA", Typ: "JWT", Kid: i.kid}
	c := Claims{
		Issuer:    i.iss,
		Subject:   accountID,
		SessionID: sessionID,
		Roles:     roles,
		AMR:       amr,
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(ttl).Unix(),
	}
	hb, err := json.Marshal(h)
	if err != nil {
		return "", fmt.Errorf("session: marshal header: %w", err)
	}
	cb, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("session: marshal claims: %w", err)
	}
	signingInput := b64(hb) + "." + b64(cb)
	sig := ed25519.Sign(i.priv, []byte(signingInput))
	return signingInput + "." + b64(sig), nil
}

// Verifier checks access tokens against a set of active public keys, selected by
// `kid`. Multiple keys are held so a rotation verifies tokens signed by either
// (P-04).
type Verifier struct {
	keys map[string]ed25519.PublicKey
	iss  string
	now  func() time.Time
}

// NewVerifier builds a Verifier over the active keys keyed by kid.
func NewVerifier(keys map[string]ed25519.PublicKey, iss string) *Verifier {
	return &Verifier{keys: keys, iss: iss, now: time.Now}
}

// ErrTokenInvalid is returned for any malformed, wrong-signature, wrong-issuer
// or expired token. The caller maps it to 401 without distinguishing the reason
// to the client.
var ErrTokenInvalid = errors.New("session: access token invalid")

// Verify parses and validates a compact access token, returning its claims.
func (v *Verifier) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrTokenInvalid
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrTokenInvalid
	}
	var h header
	if err := json.Unmarshal(hb, &h); err != nil || h.Alg != "EdDSA" {
		return Claims{}, ErrTokenInvalid
	}
	pub, ok := v.keys[h.Kid]
	if !ok {
		return Claims{}, ErrTokenInvalid
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrTokenInvalid
	}
	signingInput := parts[0] + "." + parts[1]
	if !ed25519.Verify(pub, []byte(signingInput), sig) {
		return Claims{}, ErrTokenInvalid
	}
	cb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrTokenInvalid
	}
	var c Claims
	if err := json.Unmarshal(cb, &c); err != nil {
		return Claims{}, ErrTokenInvalid
	}
	now := v.now().UTC().Unix()
	if c.Issuer != v.iss || c.ExpiresAt <= now || c.NotBefore > now {
		return Claims{}, ErrTokenInvalid
	}
	return c, nil
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
