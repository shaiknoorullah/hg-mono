package auth

import (
	"context"
<<<<<<< HEAD
	"time"
=======
	"errors"
>>>>>>> feat/gap2-authtotp

	"github.com/jackc/pgx/v5"
)

<<<<<<< HEAD
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
=======
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

// ChangePasswordAndRevokeAll sets a new argon2id hash and revokes every live
// session for the account in a single transaction. changePassword then issues
// one fresh session for the caller.
//
// Atomicity matters: two separate Execs could leave the password changed while
// stale refresh-token families on other devices survive (a partial write with a
// security consequence — a leaked old token would still authenticate). The
// transaction makes "password changed but old sessions live" unrepresentable.
//
// Revoking *all* sessions (including the calling one) rather than "all but the
// caller" is deliberate: the caller's pre-change session is replaced by a freshly
// issued one, so its old refresh token must not survive the change.
func (s *Store) ChangePasswordAndRevokeAll(ctx context.Context, accountID, newHash, reason string) error {
>>>>>>> feat/gap2-authtotp
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
<<<<<<< HEAD
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
=======
	defer func() { _ = tx.Rollback(ctx) }()

	ct, err := tx.Exec(ctx, `
		UPDATE account
		SET password_hash = $2, password_set_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, accountID, newHash)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}

	if _, err = tx.Exec(ctx, `
		UPDATE session SET revoked_at = now(), revoke_reason = $2
		WHERE account_id = $1 AND revoked_at IS NULL`, accountID, reason); err != nil {
>>>>>>> feat/gap2-authtotp
		return err
	}

	return tx.Commit(ctx)
}
<<<<<<< HEAD

// RevokeOtherSessions revokes all sessions for an account except the given one.
func (s *Store) RevokeOtherSessions(ctx context.Context, accountID, exceptSessionID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE session
		SET revoked_at = NOW(), revoke_reason = $1
		WHERE account_id = $2 AND id != $3 AND revoked_at IS NULL`,
		reason, accountID, exceptSessionID)
	return err
}
=======
>>>>>>> feat/gap2-authtotp
