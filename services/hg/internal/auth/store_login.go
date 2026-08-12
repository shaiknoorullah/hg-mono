package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RecordLoginAttempt appends a login_attempt row. outcome is one of SUCCESS,
// BAD_PASSWORD, NO_ACCOUNT, LOCKED, BAD_TOTP. Lockout truth is computed from
// these rows, so a Redis flush cannot unlock an account (P-03).
func (s *Store) RecordLoginAttempt(ctx context.Context, email string, accountID *string, ip, outcome string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO login_attempt (email, account_id, ip, outcome)
		VALUES ($1, $2, $3::inet, $4)`, email, accountID, ip, outcome)
	return err
}

// IsLocked reports whether an email has 10+ consecutive BAD_PASSWORD outcomes in
// the last 15 minutes with no intervening SUCCESS — the Postgres-computed
// lockout (P-03). It counts the trailing run of failures so a success resets it.
func (s *Store) IsLocked(ctx context.Context, email string) (bool, error) {
	// Count BAD_PASSWORD/BAD_TOTP in the window that occur after the most recent
	// SUCCESS (or all of them, if there is no success in the window).
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)
		FROM login_attempt
		WHERE email = $1
		  AND at > now() - interval '15 minutes'
		  AND outcome IN ('BAD_PASSWORD', 'BAD_TOTP')
		  AND at > COALESCE((
		      SELECT max(at) FROM login_attempt
		      WHERE email = $1 AND outcome = 'SUCCESS'
		        AND at > now() - interval '15 minutes'
		  ), '-infinity'::timestamptz)`, email).Scan(&count)
	if err != nil {
		return false, err
	}
	return count >= 10, nil
}

// CredentialToken is the subset of a credential_token row the flows consume.
type CredentialToken struct {
	ID         string
	AccountID  string
	Kind       string
	NewEmail   *string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

// InsertCredentialToken stores a token hash for EMAIL_VERIFY / PASSWORD_RESET /
// EMAIL_CHANGE with the given TTL. Only the SHA-256 is stored.
func (s *Store) InsertCredentialToken(ctx context.Context, accountID, kind string, tokenHash []byte, ttl time.Duration) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO credential_token (account_id, kind, token_hash, expires_at)
		VALUES ($1, $2, $3, now() + $4::interval)`,
		accountID, kind, tokenHash, ttl.String())
	return err
}

// ConsumeCredentialTokenResult distinguishes the token outcomes so the handler
// can return the contract's precise code.
type ConsumeCredentialTokenResult struct {
	AccountID string
	// Used is true when the token existed but was already consumed.
	Used bool
	// Expired is true when the token existed but its TTL had passed.
	Expired bool
	// NotFound is true when no token matched the hash at all.
	NotFound bool
}

// ConsumeCredentialToken atomically consumes a token of a given kind by hash. The
// single conditional UPDATE prevents a replay winning a race (P-03 acceptance
// #3). On zero rows it inspects the row (if any) to report used vs expired vs
// unknown.
func (s *Store) ConsumeCredentialToken(ctx context.Context, kind string, tokenHash []byte) (ConsumeCredentialTokenResult, error) {
	var accountID string
	err := s.pool.QueryRow(ctx, `
		UPDATE credential_token
		SET consumed_at = now()
		WHERE token_hash = $1 AND kind = $2
		  AND consumed_at IS NULL AND expires_at > now()
		RETURNING account_id`, tokenHash, kind).Scan(&accountID)
	if err == nil {
		return ConsumeCredentialTokenResult{AccountID: accountID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ConsumeCredentialTokenResult{}, err
	}

	// Inspect why: consumed already, expired, or unknown.
	var consumed *time.Time
	var expires time.Time
	err = s.pool.QueryRow(ctx, `
		SELECT consumed_at, expires_at FROM credential_token
		WHERE token_hash = $1 AND kind = $2`, tokenHash, kind).Scan(&consumed, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConsumeCredentialTokenResult{NotFound: true}, nil
	}
	if err != nil {
		return ConsumeCredentialTokenResult{}, err
	}
	if consumed != nil {
		return ConsumeCredentialTokenResult{Used: true}, nil
	}
	return ConsumeCredentialTokenResult{Expired: true}, nil
}

// SetPassword sets the account's argon2id hash and stamps password_set_at.
func (s *Store) SetPassword(ctx context.Context, accountID, hash string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account SET password_hash = $2, password_set_at = now()
		WHERE id = $1`, accountID, hash)
	return err
}

// MarkEmailVerified stamps email_verified_at if not already set.
func (s *Store) MarkEmailVerified(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE account SET email_verified_at = COALESCE(email_verified_at, now())
		WHERE id = $1`, accountID)
	return err
}
