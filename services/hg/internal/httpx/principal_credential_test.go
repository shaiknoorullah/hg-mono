package httpx

import (
	"fmt"
	"strings"
	"testing"
)

// TestAPrincipalCarriesItsTokenButNeverPrintsIt: the credential is what a staff
// account action hands the database, and a Principal that is logged or printed
// shows an address, not the token.
func TestAPrincipalCarriesItsTokenButNeverPrintsIt(t *testing.T) {
	bare := Principal{AccountID: "a"}
	if got := bare.Credential(); got != "" {
		t.Fatalf("a principal with no credential reports %q", got)
	}
	const token = "header.payload.signature"
	p := bare.WithCredential(token)
	if p.Credential() != token {
		t.Fatalf("Credential = %q, want the token", p.Credential())
	}
	if bare.Credential() != "" {
		t.Fatal("WithCredential changed the principal it was called on")
	}
	for _, shown := range []string{fmt.Sprintf("%v", p), fmt.Sprintf("%+v", p)} {
		if strings.Contains(shown, token) {
			t.Fatalf("printing a principal shows its token: %s", shown)
		}
	}
}
