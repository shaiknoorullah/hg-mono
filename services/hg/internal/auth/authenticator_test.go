package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

func newAuth(t *testing.T) (*session.Issuer, *Authenticator, *session.DenySet) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	iss := session.NewIssuer("k1", priv, "hg-api")
	ver := session.NewVerifier(map[string]ed25519.PublicKey{"k1": pub}, "hg-api")
	deny := session.NewDenySet()
	return iss, NewAuthenticator(ver, deny), deny
}

func TestAuthenticateAnonymousWhenNoHeader(t *testing.T) {
	_, a, _ := newAuth(t)
	r, _ := http.NewRequest("GET", "/", nil)
	p, err := a.Authenticate(r.Context(), r)
	if err != nil {
		t.Fatalf("anonymous request returned error: %v", err)
	}
	if !p.Anonymous {
		t.Fatal("no Authorization header should yield an anonymous principal")
	}
}

func TestAuthenticateValidToken(t *testing.T) {
	iss, a, _ := newAuth(t)
	tok, _ := iss.Issue("acct-1", "sess-1", []string{"CUSTOMER"}, []string{"otp"}, 15*time.Minute)
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	p, err := a.Authenticate(r.Context(), r)
	if err != nil {
		t.Fatalf("valid token rejected: %v", err)
	}
	if p.Anonymous || p.AccountID != "acct-1" || p.SessionID != "sess-1" {
		t.Fatalf("principal = %+v", p)
	}
	// The verified token travels with the principal for the database's own check
	// of a staff account action (migration 00045), and printing the principal
	// does not show it.
	if p.Credential() != tok {
		t.Fatal("principal does not carry the token it was proven with")
	}
	if strings.Contains(fmt.Sprintf("%+v %v", p, p), tok) {
		t.Fatal("printing a principal shows its access token")
	}
	if !p.HasRole("CUSTOMER") {
		t.Fatal("principal missing CUSTOMER role")
	}
}

func TestAuthenticateRejectsRevokedSession(t *testing.T) {
	iss, a, deny := newAuth(t)
	tok, _ := iss.Issue("acct-1", "sess-1", []string{"CUSTOMER"}, []string{"otp"}, 15*time.Minute)
	deny.AddSession("sess-1")
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if _, err := a.Authenticate(r.Context(), r); err == nil {
		t.Fatal("a revoked session's token must be rejected")
	}
}

func TestAuthenticateRejectsRevokedAccount(t *testing.T) {
	iss, a, deny := newAuth(t)
	tok, _ := iss.Issue("acct-2", "sess-2", []string{"CUSTOMER"}, []string{"otp"}, 15*time.Minute)
	deny.AddAccount("acct-2")
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	if _, err := a.Authenticate(r.Context(), r); err == nil {
		t.Fatal("a wholesale-revoked account's token must be rejected")
	}
}

func TestAuthenticateRejectsGarbage(t *testing.T) {
	_, a, _ := newAuth(t)
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer not.a.jwt")
	if _, err := a.Authenticate(r.Context(), r); err == nil {
		t.Fatal("a malformed token must be rejected")
	}
}
