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

// IssueCredentialToken stores a token hash like InsertCredentialToken and, in
// the same transaction, runs issued — which enqueues the email that carries
// the token, so a token row never exists without its email queued, nor an
// email without its token.
func (s *Store) IssueCredentialToken(ctx context.Context, accountID, kind string, tokenHash []byte, ttl time.Duration, issued TokenIssued) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var tokenID string
	var expiresAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO credential_token (account_id, kind, token_hash, expires_at)
		VALUES ($1, $2, $3, now() + $4::interval)
		RETURNING id, expires_at`,
		accountID, kind, tokenHash, ttl.String()).Scan(&tokenID, &expiresAt); err != nil {
		return err
	}
	if err := capLiveTokens(ctx, tx, accountID, kind); err != nil {
		return err
	}
	if issued != nil {
		if err := issued(ctx, tx, accountID, tokenID, expiresAt); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// capLiveTokens ends all but the newest liveTokensPerKind live tokens of a
// kind for an account. Issuing a token does not cancel the earlier ones, so
// someone asking for links to another person's address cannot cancel the link
// that person is about to use; the cap bounds how many links are live at once.
func capLiveTokens(ctx context.Context, tx pgx.Tx, accountID, kind string) error {
	_, err := tx.Exec(ctx, `
		UPDATE credential_token
		SET expires_at = LEAST(expires_at, now())
		WHERE account_id = $1 AND kind = $2 AND consumed_at IS NULL AND expires_at > now()
		  AND id NOT IN (
			SELECT id FROM credential_token
			 WHERE account_id = $1 AND kind = $2 AND consumed_at IS NULL AND expires_at > now()
			 ORDER BY created_at DESC, id DESC
			 LIMIT $3)`, accountID, kind, liveTokensPerKind)
	return err
}

// PasswordSurface names the web app an account signs in to with a password:
// "ADMIN" for platform staff, "RESTAURANT" for restaurant owners, managers and
// staff, and "" for an account that signs in by phone (customers and riders),
// which has no password to reset.
func (s *Store) PasswordSurface(ctx context.Context, accountID string) (string, error) {
	var surface string
	err := s.pool.QueryRow(ctx, `
		SELECT CASE
		         WHEN bool_or(role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')) THEN 'ADMIN'
		         WHEN bool_or(role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER', 'RESTAURANT_STAFF')) THEN 'RESTAURANT'
		         ELSE ''
		       END
		  FROM account_role
		 WHERE account_id = $1 AND revoked_at IS NULL`, accountID).Scan(&surface)
	return surface, err
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
//
// Using a token ends every other live token of the same kind for the account
// in the same statement: once a reset link has set the password, an older
// reset link (perhaps requested by someone else) no longer works.
func (s *Store) ConsumeCredentialToken(ctx context.Context, kind string, tokenHash []byte) (ConsumeCredentialTokenResult, error) {
	var accountID string
	err := s.pool.QueryRow(ctx, `
		WITH used AS (
			UPDATE credential_token
			SET consumed_at = now()
			WHERE token_hash = $1 AND kind = $2
			  AND consumed_at IS NULL AND expires_at > now()
			RETURNING id, account_id
		), others AS (
			UPDATE credential_token c
			SET expires_at = LEAST(c.expires_at, now())
			FROM used
			WHERE c.account_id = used.account_id AND c.kind = $2
			  AND c.id <> used.id AND c.consumed_at IS NULL
			RETURNING c.id
		)
		SELECT account_id FROM used`, tokenHash, kind).Scan(&accountID)
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
