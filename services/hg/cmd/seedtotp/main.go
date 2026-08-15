// Throwaway dev helper: enroll a known TOTP secret for an account so an
// MFA-required (admin/support) login can be driven in dev. Reuses the real
// SealAESGCM so the sealed secret is readable by the running server. Prints the
// base32 secret; generate live codes with cmd/totpnow. Delete after use.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

func parseKey(raw string) [32]byte {
	var k [32]byte
	if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
		copy(k[:], b)
		return k
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		copy(k[:], b)
		return k
	}
	if b, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		copy(k[:], b)
		return k
	}
	panic("HG_APP_DATA_KEY must be 32 bytes hex or base64")
}

func main() {
	email := os.Getenv("SEED_EMAIL")
	if email == "" {
		fmt.Println("SEED_EMAIL required")
		os.Exit(1)
	}
	key := parseKey(os.Getenv("HG_APP_DATA_KEY"))
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	enc, err := auth.SealAESGCM(key, []byte(secret))
	if err != nil {
		panic(err)
	}
	pool, err := pgxpool.New(context.Background(), os.Getenv("HG_POSTGRES_DSN"))
	if err != nil {
		panic(err)
	}
	defer pool.Close()
	tag, err := pool.Exec(context.Background(),
		`UPDATE account SET totp_secret_enc = $2, totp_enrolled_at = now() WHERE email = $1`, email, enc)
	if err != nil {
		panic(err)
	}
	fmt.Printf("updated %d account(s) for %s\nTOTP_SECRET=%s\n", tag.RowsAffected(), email, secret)
}
