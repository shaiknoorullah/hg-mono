package notify

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PgAccountLookup resolves delivery targets from Postgres: the account's
// verified phone and verified email, and the push tokens of its live devices
// for the notification's role. It only reads; the account table belongs to
// auth and the device table to the account module, and neither is written
// here.
//
// Only verified addresses are used. A message to an address nobody has proven
// they own could tell a stranger about someone's restaurant or payout; the
// emails that verify an address (sign-up, password reset, staff invite) name
// their address explicitly instead (ChannelOverride.Target). Riders never
// verify an email today, so their emails resolve no address (issue #333).
type PgAccountLookup struct {
	DB DB
}

// ResolveTargets implements AccountLookup.
func (l PgAccountLookup) ResolveTargets(ctx context.Context, accountID uuid.UUID, role RoleContext) (AccountTargets, error) {
	var t AccountTargets
	var zone string
	err := l.DB.QueryRow(ctx, `
		SELECT CASE WHEN phone_verified_at IS NOT NULL THEN COALESCE(phone_e164, '') ELSE '' END,
		       CASE WHEN email_verified_at IS NOT NULL THEN COALESCE(email::text, '') ELSE '' END,
		       timezone
		  FROM account
		 WHERE id = $1 AND deleted_at IS NULL`, accountID).Scan(&t.PhoneE164, &t.Email, &zone)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccountTargets{}, nil
	}
	if err != nil {
		return AccountTargets{}, fmt.Errorf("notify: resolve targets for %s: %w", accountID, err)
	}
	t.Zone = Zone(zone)
	rows, err := l.DB.Query(ctx, `
		SELECT expo_push_token
		  FROM device
		 WHERE account_id = $1 AND role_context = $2 AND revoked_at IS NULL AND push_enabled
		 ORDER BY last_seen_at DESC`, accountID, string(role))
	if err != nil {
		return AccountTargets{}, fmt.Errorf("notify: resolve push tokens for %s: %w", accountID, err)
	}
	t.PushTokens, err = pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return AccountTargets{}, fmt.Errorf("notify: resolve push tokens for %s: %w", accountID, err)
	}
	return t, nil
}
