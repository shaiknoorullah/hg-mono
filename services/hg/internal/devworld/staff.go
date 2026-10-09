package devworld

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

// StaffPersona is a seeded platform staff account that signs in to the admin
// console with the shared password and an authenticator code. Support, admin
// and super admin all need the code to sign in (docs/spec/05-admin.md, "A-03 —
// Staff authentication, MFA and session policy"), so reset enrols each one.
type StaffPersona struct {
	Slug  string
	Email string
	Role  string
}

// Staff is one persona per staff role, so the admin console's role matrix can be
// walked after a reset. The accounts are in migrations/devworld (001 and
// 010_admin_staff.sql).
var Staff = []StaffPersona{
	{Slug: "admin-seed", Email: AdminEmail, Role: "SUPER_ADMIN"},
	{Slug: "ops-admin", Email: "ops-admin@seed.hg", Role: "ADMIN"},
	{Slug: "support-seed", Email: "support-seed@seed.hg", Role: "SUPPORT_AGENT"},
}

// enrolStaff seals each staff persona's derived authenticator secret with the
// app data key and marks it enrolled.
func enrolStaff(ctx context.Context, conn *pgx.Conn, key [32]byte) error {
	for _, s := range Staff {
		secret, err := AdminTOTPSecret(s.Email)
		if err != nil {
			return err
		}
		sealed, err := auth.SealAESGCM(key, []byte(secret))
		if err != nil {
			return fmt.Errorf("devworld: seal %s authenticator: %w", s.Slug, err)
		}
		tag, err := conn.Exec(ctx, `
			UPDATE account
			   SET totp_secret_enc = $2,
			       totp_enrolled_at = COALESCE(totp_enrolled_at, now())
			 WHERE email = $1`, s.Email, sealed)
		if err != nil {
			return fmt.Errorf("devworld: enrol %s authenticator: %w", s.Slug, err)
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("devworld: %s was not enrolled", s.Slug)
		}
		if _, err := conn.Exec(ctx, `
			UPDATE staff_profile sp
			   SET mfa_enrolled = true
			  FROM account a
			 WHERE a.id = sp.account_id AND a.email = $1`, s.Email); err != nil {
			return fmt.Errorf("devworld: mark %s enrolled: %w", s.Slug, err)
		}
	}
	fmt.Fprintf(os.Stderr, "devworld: staff authenticators enrolled (%d)\n", len(Staff))
	return nil
}

// verifyStaff checks that each staff persona holds its global role and, when
// HG_APP_DATA_KEY is set, that its sealed authenticator opens to the derived
// secret, so `make dev-totp` codes sign it in.
func verifyStaff(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	key, haveKey, err := dataKeyFromEnv()
	if err != nil {
		return nil, err
	}
	var problems []string
	for _, s := range Staff {
		var hasRole, enrolled bool
		var sealed []byte
		err := conn.QueryRow(ctx, `
			SELECT EXISTS (
			         SELECT 1 FROM account_role r
			          WHERE r.account_id = a.id AND r.role = $2::role_name
			            AND r.scope_type = 'GLOBAL' AND r.revoked_at IS NULL),
			       a.totp_enrolled_at IS NOT NULL,
			       a.totp_secret_enc
			  FROM account a
			 WHERE a.email = $1`, s.Email, s.Role).Scan(&hasRole, &enrolled, &sealed)
		if errors.Is(err, pgx.ErrNoRows) {
			problems = append(problems, s.Slug+": staff account missing")
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("devworld: staff check %s: %w", s.Slug, err)
		}
		var bad []string
		if !hasRole {
			bad = append(bad, "role "+s.Role+" missing")
		}
		authn := "not checked (HG_APP_DATA_KEY is not set)"
		if haveKey {
			authn = "enrolled"
			want, derr := AdminTOTPSecret(s.Email)
			if derr != nil {
				return nil, derr
			}
			got, oerr := auth.OpenAESGCM(key, sealed)
			if !enrolled || oerr != nil || string(got) != want {
				authn = "not enrolled"
				bad = append(bad, "authenticator not enrolled")
			}
		}
		result := "ok"
		if len(bad) > 0 {
			result = fmt.Sprint(bad)
			problems = append(problems, s.Slug+": "+result)
		}
		fmt.Fprintf(out, "staff %-14s %-14s authenticator %s: %s\n", s.Slug, s.Role, authn, result)
	}
	return problems, nil
}
