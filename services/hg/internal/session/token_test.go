package session

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"
)

func newKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	return pub, priv
}

func TestIssueAndVerifyRoundTrip(t *testing.T) {
	pub, priv := newKey(t)
	iss := NewIssuer("k1", priv, "hg-api")
	tok, err := iss.Issue("acct-1", "sess-1", []string{"CUSTOMER"}, []string{"otp"}, 15*time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	v := NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	claims, err := v.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.Subject != "acct-1" || claims.SessionID != "sess-1" {
		t.Fatalf("claims = %+v", claims)
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "CUSTOMER" {
		t.Fatalf("roles = %v", claims.Roles)
	}
	if len(claims.AMR) != 1 || claims.AMR[0] != "otp" {
		t.Fatalf("amr = %v", claims.AMR)
	}
}

func TestVerifyRejectsWrongKey(t *testing.T) {
	_, priv := newKey(t)
	otherPub, _ := newKey(t)
	iss := NewIssuer("k1", priv, "hg-api")
	tok, _ := iss.Issue("a", "s", nil, []string{"otp"}, time.Minute)
	v := NewVerifier(map[string]ed25519.PublicKey{"k1": otherPub}, "hg-api")
	if _, err := v.Verify(tok); err == nil {
		t.Fatal("Verify accepted a token signed by a different key")
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	pub, priv := newKey(t)
	iss := NewIssuer("k1", priv, "hg-api")
	iss.now = func() time.Time { return time.Now().Add(-time.Hour) }
	tok, _ := iss.Issue("a", "s", nil, []string{"otp"}, 15*time.Minute)
	v := NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	if _, err := v.Verify(tok); err == nil {
		t.Fatal("Verify accepted an expired token")
	}
}

func TestVerifyRejectsWrongIssuer(t *testing.T) {
	pub, priv := newKey(t)
	iss := NewIssuer("k1", priv, "evil")
	tok, _ := iss.Issue("a", "s", nil, []string{"otp"}, time.Minute)
	v := NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	if _, err := v.Verify(tok); err == nil {
		t.Fatal("Verify accepted a token with the wrong issuer")
	}
}

func TestVerifyRejectsTamperedClaims(t *testing.T) {
	pub, priv := newKey(t)
	iss := NewIssuer("k1", priv, "hg-api")
	tok, _ := iss.Issue("a", "s", []string{"CUSTOMER"}, []string{"otp"}, time.Minute)
	// Flip a character in the claims segment.
	b := []byte(tok)
	for i := len(b) / 3; i < len(b)/3+5; i++ {
		if b[i] != 'A' {
			b[i] = 'A'
			break
		}
	}
	v := NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	if _, err := v.Verify(string(b)); err == nil {
		t.Fatal("Verify accepted a tampered token")
	}
}
