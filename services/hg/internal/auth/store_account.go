package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// FindOrCreateByPhone returns the existing account for a verified phone or
// creates one, sets phone_verified_at, and grants the signup role (P-02 / I-01.1
// — no second account is ever created for a phone already on file). It runs in a
// single transaction so a crash cannot leave an account without its grant.
//
// isNew reports whether the account was created in this call, driving the
// client's is_new_account routing.
func (s *Store) FindOrCreateByPhone(ctx context.Context, phone, role string) (acct *Account, isNew bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var id string
	err = tx.QueryRow(ctx, `
		SELECT id FROM account WHERE phone_e164 = $1 AND deleted_at IS NULL`, phone).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Create the account with the phone already verified (the OTP is the
		// proof of possession).
		if err = tx.QueryRow(ctx, `
			INSERT INTO account (phone_e164, phone_verified_at)
			VALUES ($1, now())
			RETURNING id`, phone).Scan(&id); err != nil {
			return nil, false, err
		}
		isNew = true
	case err != nil:
		return nil, false, err
	default:
		// Existing account: ensure phone_verified_at is set.
		if _, err = tx.Exec(ctx, `
			UPDATE account SET phone_verified_at = COALESCE(phone_verified_at, now())
			WHERE id = $1`, id); err != nil {
			return nil, false, err
		}
	}

	// Grant the audience role if not already held. The partial unique index makes
	// a duplicate live grant a no-op via ON CONFLICT DO NOTHING.
	if _, err = tx.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type)
		VALUES ($1, $2, 'GLOBAL')
		ON CONFLICT (account_id, role, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
		WHERE revoked_at IS NULL DO NOTHING`, id, role); err != nil {
		return nil, false, err
	}

	// A CUSTOMER-audience signup must leave a customer_profile row behind:
	// GET /v1/me/profile (and everything gated behind it — Addresses, Checkout)
	// otherwise 404s forever for a first-time customer, since nothing else on
	// this path ever creates the row. first_name is NOT NULL with no default,
	// so a lazy placeholder is inserted; UpdateCustomerProfile lets the
	// customer replace it. ON CONFLICT DO NOTHING makes this idempotent for an
	// existing account that is only now being granted the CUSTOMER role.
	if role == "CUSTOMER" {
		if _, err = tx.Exec(ctx, `
			INSERT INTO customer_profile (account_id, first_name)
			VALUES ($1, 'there')
			ON CONFLICT (account_id) DO NOTHING`, id); err != nil {
			return nil, false, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, false, err
	}

	acct, err = s.AccountByID(ctx, id)
	if err != nil {
		return nil, false, err
	}
	return acct, isNew, nil
}
