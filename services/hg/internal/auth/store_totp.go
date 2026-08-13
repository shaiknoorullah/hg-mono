package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// TOTPRecord is the TOTP row data for an account.
type TOTPRecord struct {
	SecretEnc  []byte
	EnrolledAt *time.Time
}

// StoreTOTPSecret seals and stores the TOTP secret for the account.
// totp_enrolled_at is left NULL; it is stamped on ActivateTOTP.
func (s *Store) StoreTOTPSecret(ctx context.Context, accountID string, secretEnc []byte) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_secret_enc = $1
		WHERE id = $2 AND deleted_at IS NULL`,
		secretEnc, accountID)
	return err
}

// GetTOTPRecord reads the TOTP secret and enrolled_at for an account.
func (s *Store) GetTOTPRecord(ctx context.Context, accountID string) (*TOTPRecord, error) {
	var rec TOTPRecord
	err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(totp_secret_enc, ''), totp_enrolled_at
		FROM account
		WHERE id = $1 AND deleted_at IS NULL`,
		accountID).Scan(&rec.SecretEnc, &rec.EnrolledAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &rec, nil
}

// ActivateTOTP stamps totp_enrolled_at to mark enrolment complete.
func (s *Store) ActivateTOTP(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_enrolled_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL`,
		accountID)
	return err
}

// DisableTOTP clears totp_secret_enc and totp_enrolled_at.
func (s *Store) DisableTOTP(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account
		SET totp_secret_enc = NULL, totp_enrolled_at = NULL
		WHERE id = $1 AND deleted_at IS NULL`,
		accountID)
	return err
}

// ChangePassword updates the password hash.
func (s *Store) ChangePassword(ctx context.Context, accountID string, hash string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account
		SET password_hash = $1
		WHERE id = $2 AND deleted_at IS NULL`,
		hash, accountID)
	return err
}

// ChangePasswordAndRevokeAll updates the password and revokes all sessions
// in a single transaction.
func (s *Store) ChangePasswordAndRevokeAll(ctx context.Context, accountID string, hash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Update password
	_, err = tx.Exec(ctx, `
		UPDATE account
		SET password_hash = $1
		WHERE id = $2 AND deleted_at IS NULL`,
		hash, accountID)
	if err != nil {
		return err
	}

	// Revoke all sessions
	_, err = tx.Exec(ctx, `
		UPDATE session
		SET revoked_at = NOW(), revoke_reason = $1
		WHERE account_id = $2 AND revoked_at IS NULL`,
		"password_changed", accountID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// RevokeOtherSessions revokes all sessions for an account except the given one.
func (s *Store) RevokeOtherSessions(ctx context.Context, accountID, exceptSessionID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE session
		SET revoked_at = NOW(), revoke_reason = $1
		WHERE account_id = $2 AND id != $3 AND revoked_at IS NULL`,
		reason, accountID, exceptSessionID)
	return err
}
