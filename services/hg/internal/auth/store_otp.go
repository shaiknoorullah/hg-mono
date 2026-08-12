package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// OtpChallenge mirrors the otp_challenge row the flows need.
type OtpChallenge struct {
	ID           string
	PhoneE164    string
	Purpose      string
	Attempts     int
	MaxAttempts  int
	Sends        int
	LastSentAt   time.Time
	ExpiresAt    time.Time
	WindowEndsAt time.Time
	ConsumedAt   *time.Time
}

// OpenChallenge returns the current open (unconsumed, unexpired-window)
// challenge for a phone+purpose, or ErrNotFound. Used to decide whether a
// request re-sends the same code (P-02).
func (s *Store) OpenChallenge(ctx context.Context, phone, purpose string) (*OtpChallenge, error) {
	var c OtpChallenge
	err := s.pool.QueryRow(ctx, `
		SELECT id, phone_e164, purpose, attempts, max_attempts, sends,
		       last_sent_at, expires_at, window_ends_at, consumed_at
		FROM otp_challenge
		WHERE phone_e164 = $1 AND purpose = $2
		  AND consumed_at IS NULL AND window_ends_at > now()
		ORDER BY created_at DESC
		LIMIT 1`, phone, purpose).Scan(
		&c.ID, &c.PhoneE164, &c.Purpose, &c.Attempts, &c.MaxAttempts, &c.Sends,
		&c.LastSentAt, &c.ExpiresAt, &c.WindowEndsAt, &c.ConsumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// InsertChallenge creates a fresh challenge with the supplied code hash. expires
// is last_sent_at + 5 min; window is created_at + 15 min (P-02). request_ip and
// device_id are recorded for abuse investigation, never returned.
func (s *Store) InsertChallenge(ctx context.Context, phone, purpose string, codeHash []byte, deviceID *string, ip *string) (*OtpChallenge, error) {
	var c OtpChallenge
	err := s.pool.QueryRow(ctx, `
		INSERT INTO otp_challenge
		  (phone_e164, purpose, code_hash, expires_at, window_ends_at, device_id, request_ip)
		VALUES ($1, $2, $3, now() + interval '5 minutes', now() + interval '15 minutes', $4, $5::inet)
		RETURNING id, phone_e164, purpose, attempts, max_attempts, sends,
		          last_sent_at, expires_at, window_ends_at, consumed_at`,
		phone, purpose, codeHash, deviceID, ip).Scan(
		&c.ID, &c.PhoneE164, &c.Purpose, &c.Attempts, &c.MaxAttempts, &c.Sends,
		&c.LastSentAt, &c.ExpiresAt, &c.WindowEndsAt, &c.ConsumedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// BumpSend increments sends and resets the 5-minute code validity for a re-sent
// (same code) challenge, bounded at 3 sends by the row's CHECK. It returns the
// updated challenge, or ErrNotFound when the send cap is hit (the UPDATE matches
// zero rows).
func (s *Store) BumpSend(ctx context.Context, challengeID string) (*OtpChallenge, error) {
	var c OtpChallenge
	err := s.pool.QueryRow(ctx, `
		UPDATE otp_challenge
		SET sends = sends + 1,
		    last_sent_at = now(),
		    expires_at = now() + interval '5 minutes'
		WHERE id = $1 AND consumed_at IS NULL AND sends < 3
		RETURNING id, phone_e164, purpose, attempts, max_attempts, sends,
		          last_sent_at, expires_at, window_ends_at, consumed_at`,
		challengeID).Scan(
		&c.ID, &c.PhoneE164, &c.Purpose, &c.Attempts, &c.MaxAttempts, &c.Sends,
		&c.LastSentAt, &c.ExpiresAt, &c.WindowEndsAt, &c.ConsumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// VerifyOutcome is the result of a single conditional consume attempt.
type VerifyOutcome struct {
	// Consumed is true when the code matched and the challenge was consumed.
	Consumed bool
	// InvalidOrExpired is true when no open challenge matched the id at all
	// (zero rows) — expired, already consumed, or unknown id.
	InvalidOrExpired bool
	// AttemptsRemaining is set when the code was wrong but the challenge is still
	// open.
	AttemptsRemaining int
	// Phone is the challenge's phone on a successful consume.
	Phone string
}

// ConsumeChallenge performs the P-02 single-statement consume with reuse and
// expiry handled atomically:
//
//  1. It first tries the conditional UPDATE that consumes the row only when the
//     id is open, unexpired, under the attempt cap, and the code hash matches.
//  2. On zero rows it distinguishes "no open challenge" (invalid/expired) from
//     "open but wrong code" by incrementing attempts and reading the remainder.
//
// The attempts counter lives in Postgres, so a Redis flush cannot reset it.
func (s *Store) ConsumeChallenge(ctx context.Context, challengeID string, codeHash []byte) (VerifyOutcome, error) {
	// Step 1: attempt to consume atomically on a matching code.
	var phone string
	err := s.pool.QueryRow(ctx, `
		UPDATE otp_challenge
		SET consumed_at = now(), attempts = attempts + 1
		WHERE id = $1
		  AND consumed_at IS NULL
		  AND expires_at > now()
		  AND attempts < max_attempts
		  AND code_hash = $2
		RETURNING phone_e164`, challengeID, codeHash).Scan(&phone)
	if err == nil {
		return VerifyOutcome{Consumed: true, Phone: phone}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return VerifyOutcome{}, err
	}

	// Step 2: no consume. Is there an open, unexpired, under-cap challenge? If so
	// the code was wrong: charge an attempt and report the remainder. Otherwise
	// it is invalid/expired.
	var remaining int
	err = s.pool.QueryRow(ctx, `
		UPDATE otp_challenge
		SET attempts = attempts + 1
		WHERE id = $1
		  AND consumed_at IS NULL
		  AND expires_at > now()
		  AND attempts < max_attempts
		RETURNING max_attempts - attempts`, challengeID).Scan(&remaining)
	if errors.Is(err, pgx.ErrNoRows) {
		return VerifyOutcome{InvalidOrExpired: true}, nil
	}
	if err != nil {
		return VerifyOutcome{}, err
	}
	if remaining < 0 {
		remaining = 0
	}
	return VerifyOutcome{AttemptsRemaining: remaining}, nil
}
