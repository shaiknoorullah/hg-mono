package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// TOTPRecord holds the TOTP-related columns from the account row.
type TOTPRecord struct {
	SecretEnc  []byte  // totp_secret_enc — AES-GCM sealed TOTP base32 secret
	EnrolledAt *string // totp_enrolled_at — NULL until verified
}

// GetTOTPRecord reads totp_secret_enc and totp_enrolled_at for the given
// account. Returns ErrNotFound when the account doesn't exist.
func (s *Store) GetTOTPRecord(ctx context.Context, accountID string) (*TOTPRecord, error) {
	var r TOTPRecord
	err := s.pool.QueryRow(ctx, `
		SELECT totp_secret_enc,
		       CASE WHEN totp_enrolled_at IS NOT NULL THEN 'enrolled' ELSE NULL END
		FROM account
		WHERE id = $1 AND deleted_at IS NULL`, accountID).Scan(&r.SecretEnc, &r.EnrolledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// StoreTOTPSecret persists the sealed TOTP secret and clears totp_enrolled_at
// (a fresh enrolment start). Called by enrollTotp — the enrolment is not yet
// activated until verifyTotpEnrolment succeeds.
func (s *Store) StoreTOTPSecret(ctx context.Context, accountID string, secretEnc []byte) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_secret_enc = $2, totp_enrolled_at = NULL
		WHERE id = $1 AND deleted_at IS NULL`, accountID, secretEnc)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ActivateTOTP stamps totp_enrolled_at = now(), completing the enrolment.
// Ownership: the accountID must match (no IDOR).
func (s *Store) ActivateTOTP(ctx context.Context, accountID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_enrolled_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND totp_secret_enc IS NOT NULL`, accountID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ClearTOTP removes the TOTP secret and enrolled_at, disabling TOTP for the
// account. Ownership is enforced by the accountID predicate.
func (s *Store) ClearTOTP(ctx context.Context, accountID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_secret_enc = NULL, totp_enrolled_at = NULL
		WHERE id = $1 AND deleted_at IS NULL`, accountID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ChangePassword sets a new argon2id hash and records password_set_at.
// It does NOT revoke sessions; the service layer does that after calling this.
func (s *Store) ChangePassword(ctx context.Context, accountID, newHash string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE account
		SET password_hash = $2, password_set_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, accountID, newHash)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RevokeOtherSessions revokes every live session for an account except the one
// with the given session ID (the calling session). Used by changePassword to
// ensure other devices are signed out while preserving the current session.
func (s *Store) RevokeOtherSessions(ctx context.Context, accountID, keepSessionID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE session
		SET revoked_at = now(), revoke_reason = $3
		WHERE account_id = $1 AND id::text <> $2 AND revoked_at IS NULL`,
		accountID, keepSessionID, reason)
	return err
}
