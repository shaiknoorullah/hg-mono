package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrEmailInUse is returned when registration hits the account.email unique
// constraint. Mapped to 409 EMAIL_ALREADY_REGISTERED.
var ErrEmailInUse = errors.New("auth: email already registered")

// RegisterRestaurantResult carries the ids created by registration.
type RegisterRestaurantResult struct {
	AccountID       string
	RestaurantID    string
	OnboardingState string
	// VerifyToken is the plaintext email-verification token to deliver. It is
	// never persisted (only its hash is), and never logged.
	VerifyToken string
}

// TokenIssued runs inside the transaction that stored a credential token, so
// the email carrying it is enqueued in the same commit (the notification
// outbox: internal/notify/doc.go). tokenID is the credential_token row id.
type TokenIssued func(ctx context.Context, tx pgx.Tx, accountID, tokenID string, expiresAt time.Time) error

// RegisterRestaurant creates one unverified account (email + argon2id hash), one
// restaurant in onboarding_state REGISTERED, one RESTAURANT_OWNER grant scoped to
// that restaurant, and one EMAIL_VERIFY credential token — atomically (R-01). No
// session is issued until the email is verified. issued, when non-nil, enqueues
// the verification email in the same transaction.
//
// slug is derived from the business name and de-duplicated with a short random
// suffix; the restaurant's display_name and legal_name are the business name.
func (s *Store) RegisterRestaurant(ctx context.Context, email, passwordHash, businessName string, tokenHash []byte, verifyToken string, verifyTTLHours int, issued TokenIssued) (*RegisterRestaurantResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var accountID string
	err = tx.QueryRow(ctx, `
		INSERT INTO account (email, password_hash, password_set_at)
		VALUES ($1, $2, now())
		RETURNING id`, email, passwordHash).Scan(&accountID)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrEmailInUse
		}
		return nil, err
	}

	slug := slugify(businessName)
	var restaurantID, onboardingState string
	err = tx.QueryRow(ctx, `
		INSERT INTO restaurant (slug, legal_name, display_name, email, onboarding_state)
		VALUES ($1, $2, $2, $3, 'REGISTERED')
		RETURNING id, onboarding_state`, slug, businessName, email).Scan(&restaurantID, &onboardingState)
	if err != nil {
		if isUniqueViolation(err) {
			// slug collided; retry once with a random suffix.
			slug = slug + "-" + randSuffix()
			err = tx.QueryRow(ctx, `
				INSERT INTO restaurant (slug, legal_name, display_name, email, onboarding_state)
				VALUES ($1, $2, $2, $3, 'REGISTERED')
				RETURNING id, onboarding_state`, slug, businessName, email).Scan(&restaurantID, &onboardingState)
		}
		if err != nil {
			return nil, err
		}
	}

	if _, err = tx.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type, scope_id)
		VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`, accountID, restaurantID); err != nil {
		return nil, err
	}

	var tokenID string
	var expiresAt time.Time
	if err = tx.QueryRow(ctx, `
		INSERT INTO credential_token (account_id, kind, token_hash, expires_at)
		VALUES ($1, 'EMAIL_VERIFY', $2, now() + ($3::text || ' hours')::interval)
		RETURNING id, expires_at`,
		accountID, tokenHash, fmt.Sprintf("%d", verifyTTLHours)).Scan(&tokenID, &expiresAt); err != nil {
		return nil, err
	}
	if issued != nil {
		if err = issued(ctx, tx, accountID, tokenID, expiresAt); err != nil {
			return nil, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &RegisterRestaurantResult{
		AccountID:       accountID,
		RestaurantID:    restaurantID,
		OnboardingState: onboardingState,
		VerifyToken:     verifyToken,
	}, nil
}

// AdvanceRestaurantOnboarding moves the restaurant owned by accountID from
// REGISTERED/EMAIL_VERIFIED to PROFILE_PENDING on email verification (R-02). It
// is a no-op for a restaurant already past that step.
func (s *Store) AdvanceRestaurantOnboarding(ctx context.Context, accountID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE restaurant r
		SET onboarding_state = 'PROFILE_PENDING'
		FROM account_role ar
		WHERE ar.account_id = $1
		  AND ar.role = 'RESTAURANT_OWNER'
		  AND ar.scope_type = 'RESTAURANT'
		  AND ar.scope_id = r.id
		  AND ar.revoked_at IS NULL
		  AND r.onboarding_state IN ('REGISTERED', 'EMAIL_VERIFIED')`, accountID)
	return err
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// slugify makes a URL-safe slug from a business name.
func slugify(name string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "restaurant"
	}
	return out + "-" + randSuffix()
}
