package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the auth module's data access. Every method takes a context and
// pushes ownership predicates into SQL where the entity is owned (P-07): the
// session methods are all scoped to an account_id argument, so there is no way
// to read or revoke another account's session by id alone.
type Store struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewStore builds a Store over an existing pool. Repositories never open a pool
// (they take the shared one), matching internal/store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, now: func() time.Time { return time.Now().UTC() }}
}

// ErrNotFound is returned when a scoped lookup matches no row. Handlers map it to
// 404 (the 404-vs-403 rule: a subject the principal has no relationship to is
// invisible).
var ErrNotFound = errors.New("auth: not found")

// Account is the subset of the account row the auth flows read.
type Account struct {
	ID              string
	PhoneE164       *string
	Email           *string
	PhoneVerifiedAt *time.Time
	EmailVerifiedAt *time.Time
	PasswordHash    *string
	TOTPEnrolledAt  *time.Time
	Status          string
	Locale          string
	Timezone        string
}

// RoleGrant is one un-revoked account_role row.
type RoleGrant struct {
	Role      string
	ScopeType string
	ScopeID   *string
}

// AccountByPhone returns the live (non-deleted) account for a phone, or
// ErrNotFound. There is deliberately no enumeration signal at the handler: the
// caller decides latency shaping.
func (s *Store) AccountByPhone(ctx context.Context, phone string) (*Account, error) {
	return s.scanAccount(ctx, `
		SELECT id, phone_e164, email, phone_verified_at, email_verified_at,
		       password_hash, totp_enrolled_at, status, locale, timezone
		FROM account
		WHERE phone_e164 = $1 AND deleted_at IS NULL`, phone)
}

// AccountByEmail returns the live account for an email, or ErrNotFound.
func (s *Store) AccountByEmail(ctx context.Context, email string) (*Account, error) {
	return s.scanAccount(ctx, `
		SELECT id, phone_e164, email, phone_verified_at, email_verified_at,
		       password_hash, totp_enrolled_at, status, locale, timezone
		FROM account
		WHERE email = $1 AND deleted_at IS NULL`, email)
}

// AccountByID returns the live account by id, or ErrNotFound.
func (s *Store) AccountByID(ctx context.Context, id string) (*Account, error) {
	return s.scanAccount(ctx, `
		SELECT id, phone_e164, email, phone_verified_at, email_verified_at,
		       password_hash, totp_enrolled_at, status, locale, timezone
		FROM account
		WHERE id = $1 AND deleted_at IS NULL`, id)
}

func (s *Store) scanAccount(ctx context.Context, q string, args ...any) (*Account, error) {
	var a Account
	err := s.pool.QueryRow(ctx, q, args...).Scan(
		&a.ID, &a.PhoneE164, &a.Email, &a.PhoneVerifiedAt, &a.EmailVerifiedAt,
		&a.PasswordHash, &a.TOTPEnrolledAt, &a.Status, &a.Locale, &a.Timezone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// RolesFor returns every un-revoked role grant for an account, except the
// grants of a banned partner: a banned rider holds no RIDER role, and the staff
// of a banned or closed restaurant hold none of its restaurant roles. Every
// sign-in and every refresh reads roles here, so a ban takes effect on the next
// token as well as ending the sessions it revokes
// (https://github.com/shaiknoorullah/hg-mono/issues/253). The person keeps any
// other role, such as CUSTOMER.
func (s *Store) RolesFor(ctx context.Context, accountID string) ([]RoleGrant, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT ar.role, ar.scope_type, ar.scope_id
		FROM account_role ar
		WHERE ar.account_id = $1 AND ar.revoked_at IS NULL
		  AND NOT (ar.role = 'RIDER' AND EXISTS (
		        SELECT 1 FROM rider_profile rp
		         WHERE rp.account_id = ar.account_id AND rp.account_status = 'BANNED'))
		  AND NOT (ar.scope_type = 'RESTAURANT' AND EXISTS (
		        SELECT 1 FROM restaurant r
		         WHERE r.id = ar.scope_id AND r.account_state IN ('BANNED', 'CLOSED')))
		ORDER BY ar.role`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoleGrant
	for rows.Next() {
		var g RoleGrant
		if err := rows.Scan(&g.Role, &g.ScopeType, &g.ScopeID); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
