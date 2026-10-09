package devworld

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

// ApplyCredentials sets the shared local password on every email persona and,
// when HG_APP_DATA_KEY is set, enrols the authenticator of every staff persona
// (see Staff).
// Email verification is left as the persona SQL recorded it.
func ApplyCredentials(ctx context.Context, dsn string) error {
	hash, err := auth.HashPassword(ctx, PersonaPassword)
	if err != nil {
		return fmt.Errorf("devworld: hash persona password: %w", err)
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	tag, err := conn.Exec(ctx, `
		UPDATE account AS a
		   SET password_hash = $1,
		       password_set_at = COALESCE(a.password_set_at, now())
		  FROM devworld_persona AS p
		 WHERE a.id = p.account_id
		   AND p.expect_password`, hash)
	if err != nil {
		return fmt.Errorf("devworld: set persona passwords: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("devworld: no persona accepted a password")
	}
	// The catalogue's restaurant owners sign in the same way.
	owners := make([]string, 0, len(Catalogue))
	for _, r := range Catalogue {
		if !r.Persona {
			owners = append(owners, r.OwnerID)
		}
	}
	if _, err := conn.Exec(ctx, `
		UPDATE account
		   SET password_hash = $1,
		       password_set_at = COALESCE(password_set_at, now())
		 WHERE id = ANY($2::uuid[])`, hash, owners); err != nil {
		return fmt.Errorf("devworld: set catalogue owner passwords: %w", err)
	}

	key, ok, err := dataKeyFromEnv()
	if err != nil {
		return err
	}
	if !ok {
		fmt.Fprintln(os.Stderr, "devworld: staff authenticators skipped (HG_APP_DATA_KEY is not set)")
		return nil
	}
	return enrolStaff(ctx, conn, key)
}

// PasswordMatches reports whether hash is the shared persona password.
func PasswordMatches(ctx context.Context, hash string) (bool, error) {
	return auth.VerifyPassword(ctx, hash, PersonaPassword)
}

func dataKeyFromEnv() ([32]byte, bool, error) {
	var key [32]byte
	raw := strings.TrimSpace(os.Getenv("HG_APP_DATA_KEY"))
	if raw == "" {
		return key, false, nil
	}
	parsed, err := parseDataKey(raw)
	if err != nil {
		return key, false, err
	}
	return parsed, true, nil
}

func parseDataKey(raw string) ([32]byte, error) {
	var key [32]byte
	if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
		copy(key[:], b)
		return key, nil
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		copy(key[:], b)
		return key, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		copy(key[:], b)
		return key, nil
	}
	return key, fmt.Errorf("devworld: HG_APP_DATA_KEY must be 32 bytes as hex or base64")
}
