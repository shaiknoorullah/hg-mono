package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// SessionRow is the persisted session (P-04). The refresh token is never stored;
// only its SHA-256.
type SessionRow struct {
	ID          string
	FamilyID    string
	AccountID   string
	AMR         string
	Client      string
	DeviceID    *string
	IPCity      *string
	IssuedAt    time.Time
	LastUsedAt  time.Time
	IdleExpires time.Time
	AbsExpires  time.Time
	RevokedAt   *time.Time
	RotatedAt   *time.Time
}

// NewSessionParams are the inputs to CreateSession.
type NewSessionParams struct {
	AccountID   string
	AMR         string // "otp" | "pwd" | "pwd+totp"
	Roles       []RoleGrant
	Client      string
	DeviceID    *string
	UserAgent   *string
	IP          *string
	RefreshHash []byte
	IdleExpires time.Time
	AbsExpires  time.Time
}

// CreateSession inserts a new session, starting a new family. roles_snapshot is
// the amr-filtered grant set captured at issue time.
func (s *Store) CreateSession(ctx context.Context, p NewSessionParams) (*SessionRow, error) {
	snapshot, err := json.Marshal(p.Roles)
	if err != nil {
		return nil, err
	}
	var row SessionRow
	err = s.pool.QueryRow(ctx, `
		INSERT INTO session
		  (family_id, account_id, amr, roles_snapshot, client, device_id, user_agent,
		   ip, refresh_hash, idle_expires_at, absolute_expires_at)
		VALUES (gen_random_uuid(), $1, $2::auth_method, $3::jsonb, $4::client_surface, $5, $6,
		        $7::inet, $8, $9, $10)
		RETURNING id, family_id, account_id, amr, client, device_id, ip_city,
		          issued_at, last_used_at, idle_expires_at, absolute_expires_at,
		          revoked_at, rotated_at`,
		p.AccountID, p.AMR, snapshot, p.Client, p.DeviceID, p.UserAgent,
		p.IP, p.RefreshHash, p.IdleExpires, p.AbsExpires).Scan(
		&row.ID, &row.FamilyID, &row.AccountID, &row.AMR, &row.Client, &row.DeviceID,
		&row.IPCity, &row.IssuedAt, &row.LastUsedAt, &row.IdleExpires, &row.AbsExpires,
		&row.RevokedAt, &row.RotatedAt)
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// SessionByRefreshHash returns the session matching a presented refresh token's
// hash, or ErrNotFound. It returns the row regardless of revoked/rotated state so
// the caller can implement reuse detection (P-04).
func (s *Store) SessionByRefreshHash(ctx context.Context, hash []byte) (*SessionRow, error) {
	var row SessionRow
	err := s.pool.QueryRow(ctx, `
		SELECT id, family_id, account_id, amr, client, device_id, ip_city,
		       issued_at, last_used_at, idle_expires_at, absolute_expires_at,
		       revoked_at, rotated_at
		FROM session WHERE refresh_hash = $1`, hash).Scan(
		&row.ID, &row.FamilyID, &row.AccountID, &row.AMR, &row.Client, &row.DeviceID,
		&row.IPCity, &row.IssuedAt, &row.LastUsedAt, &row.IdleExpires, &row.AbsExpires,
		&row.RevokedAt, &row.RotatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// RotateSession rotates a refresh token: it marks the presented session rotated,
// inserts a successor in the same family, and links them — all in one
// transaction. It returns the new session row. The caller has already verified
// the presented session is live and unrotated.
func (s *Store) RotateSession(ctx context.Context, old *SessionRow, newHash []byte, idleExp, absExp time.Time, roles []RoleGrant) (*SessionRow, error) {
	snapshot, err := json.Marshal(roles)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Guard against a concurrent rotate: only rotate a row that is still live and
	// unrotated. Zero rows means someone else rotated it first.
	var newID string
	err = tx.QueryRow(ctx, `
		INSERT INTO session
		  (family_id, account_id, amr, roles_snapshot, client, device_id, user_agent,
		   ip, refresh_hash, idle_expires_at, absolute_expires_at)
		SELECT family_id, account_id, amr, $2::jsonb, client, device_id, user_agent,
		       ip, $3, $4, $5
		FROM session WHERE id = $1
		RETURNING id`, old.ID, snapshot, newHash, idleExp, absExp).Scan(&newID)
	if err != nil {
		return nil, err
	}

	ct, err := tx.Exec(ctx, `
		UPDATE session
		SET rotated_at = now(), rotated_to = $2, last_used_at = now()
		WHERE id = $1 AND rotated_at IS NULL AND revoked_at IS NULL`, old.ID, newID)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() != 1 {
		// Lost the race; abort so we do not mint an orphan successor.
		return nil, ErrRotateRace
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.SessionByID(ctx, newID)
}

// ErrRotateRace is returned when a concurrent refresh already rotated the token.
var ErrRotateRace = errors.New("auth: session already rotated")

// SessionByID returns any session by id (no ownership predicate; internal use in
// rotation). Handler-facing reads use the account-scoped variants below.
func (s *Store) SessionByID(ctx context.Context, id string) (*SessionRow, error) {
	var row SessionRow
	err := s.pool.QueryRow(ctx, `
		SELECT id, family_id, account_id, amr, client, device_id, ip_city,
		       issued_at, last_used_at, idle_expires_at, absolute_expires_at,
		       revoked_at, rotated_at
		FROM session WHERE id = $1`, id).Scan(
		&row.ID, &row.FamilyID, &row.AccountID, &row.AMR, &row.Client, &row.DeviceID,
		&row.IPCity, &row.IssuedAt, &row.LastUsedAt, &row.IdleExpires, &row.AbsExpires,
		&row.RevokedAt, &row.RotatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// RevokeFamily revokes every session sharing a family id (reuse detection,
// logout-all, password reset). reason is written to revoke_reason.
func (s *Store) RevokeFamily(ctx context.Context, familyID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE session SET revoked_at = now(), revoke_reason = $2
		WHERE family_id = $1 AND revoked_at IS NULL`, familyID, reason)
	return err
}

// RevokeAllForAccount revokes every live session for an account (password reset,
// account suspension).
func (s *Store) RevokeAllForAccount(ctx context.Context, accountID, reason string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE session SET revoked_at = now(), revoke_reason = $2
		WHERE account_id = $1 AND revoked_at IS NULL`, accountID, reason)
	return err
}

// RevokeSessionForAccount revokes one session, but only if it belongs to the
// account (P-07 ownership pushed into SQL). It returns ErrNotFound when the
// session is not the caller's — the 404-vs-403 rule: another account's session
// is invisible, not forbidden. Revoking an already-revoked own session is
// idempotent (still nil).
func (s *Store) RevokeSessionForAccount(ctx context.Context, accountID, sessionID, reason string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE session SET revoked_at = COALESCE(revoked_at, now()),
		                   revoke_reason = COALESCE(revoke_reason, $3)
		WHERE id = $2 AND account_id = $1`, accountID, sessionID, reason)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListLiveSessions returns the account's live sessions newest-first, capped at
// limit. Ownership is the account_id predicate.
func (s *Store) ListLiveSessions(ctx context.Context, accountID string, limit int) ([]SessionRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, family_id, account_id, amr, client, device_id, ip_city,
		       issued_at, last_used_at, idle_expires_at, absolute_expires_at,
		       revoked_at, rotated_at
		FROM session
		WHERE account_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL
		  AND idle_expires_at > now() AND absolute_expires_at > now()
		ORDER BY issued_at DESC
		LIMIT $2`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionRow
	for rows.Next() {
		var row SessionRow
		if err := rows.Scan(
			&row.ID, &row.FamilyID, &row.AccountID, &row.AMR, &row.Client, &row.DeviceID,
			&row.IPCity, &row.IssuedAt, &row.LastUsedAt, &row.IdleExpires, &row.AbsExpires,
			&row.RevokedAt, &row.RotatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// LoadRevoked implements session.Loader: the revoked session ids and the
// wholesale-revoked account ids the deny set refreshes from every 10 s (P-04).
//
// A session id is denied when it is revoked; an account is denied wholesale when
// its status is not ACTIVE (I-01.3). Both are bounded to recent activity so the
// set does not grow without limit — an ancient revoked session's token expired
// long ago and needs no deny entry.
func (s *Store) LoadRevoked(ctx context.Context) (sessions, accounts []string, err error) {
	srows, err := s.pool.Query(ctx, `
		SELECT id::text FROM session
		WHERE revoked_at IS NOT NULL AND revoked_at > now() - interval '20 minutes'`)
	if err != nil {
		return nil, nil, err
	}
	defer srows.Close()
	for srows.Next() {
		var id string
		if err := srows.Scan(&id); err != nil {
			return nil, nil, err
		}
		sessions = append(sessions, id)
	}
	if err := srows.Err(); err != nil {
		return nil, nil, err
	}

	arows, err := s.pool.Query(ctx, `
		SELECT id::text FROM account WHERE status <> 'ACTIVE'`)
	if err != nil {
		return nil, nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var id string
		if err := arows.Scan(&id); err != nil {
			return nil, nil, err
		}
		accounts = append(accounts, id)
	}
	return sessions, accounts, arows.Err()
}
