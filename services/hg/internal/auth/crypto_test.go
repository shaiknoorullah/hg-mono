package auth

import (
	"context"
	"regexp"
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	const pw = "correct horse battery staple"
	enc, err := HashPassword(context.Background(), pw)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(enc, "$argon2id$") {
		t.Fatalf("encoding is not argon2id PHC: %q", enc)
	}
	ok, err := VerifyPassword(context.Background(), enc, pw)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword correct = (%v, %v), want (true, nil)", ok, err)
	}
	ok, err = VerifyPassword(context.Background(), enc, "wrong password entirely")
	if err != nil {
		t.Fatalf("VerifyPassword wrong returned error: %v", err)
	}
	if ok {
		t.Fatal("VerifyPassword accepted the wrong password")
	}
}

func TestHashPasswordIsSalted(t *testing.T) {
	a, _ := HashPassword(context.Background(), "same-password-1234")
	b, _ := HashPassword(context.Background(), "same-password-1234")
	if a == b {
		t.Fatal("two hashes of the same password are identical — salt is not random")
	}
}

func TestGenerateOTPCodeShape(t *testing.T) {
	re := regexp.MustCompile(`^[0-9]{6}$`)
	for i := 0; i < 200; i++ {
		c, err := GenerateOTPCode()
		if err != nil {
			t.Fatalf("GenerateOTPCode: %v", err)
		}
		if !re.MatchString(c) {
			t.Fatalf("code %q is not 6 digits", c)
		}
	}
}

func TestHMACCodeIsDeterministicAndPeppered(t *testing.T) {
	p1 := []byte("pepper-one-abcdef")
	p2 := []byte("pepper-two-abcdef")
	a := HMACCode("123456", p1)
	b := HMACCode("123456", p1)
	if !ConstantTimeEqual(a, b) {
		t.Fatal("HMAC of the same code+pepper differs")
	}
	c := HMACCode("123456", p2)
	if ConstantTimeEqual(a, c) {
		t.Fatal("HMAC with a different pepper matches — pepper is not used")
	}
}

func TestRefreshTokenShapeAndHash(t *testing.T) {
	tok, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("NewRefreshToken: %v", err)
	}
	if !strings.HasPrefix(tok, "hgrt_") {
		t.Fatalf("refresh token %q lacks hgrt_ prefix", tok)
	}
	if got := HashRefreshToken(tok); !ConstantTimeEqual(got, hash) {
		t.Fatal("HashRefreshToken does not reproduce the stored hash")
	}
}
