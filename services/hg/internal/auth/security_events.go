package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// account.security_event on the account's own channel (contracts/websocket.md
// section 4.6), written in the transaction that makes the change, so the
// account's other signed-in devices see it: a sign-in from a new device, a
// password changed or reset, a session revoked from another device. ip_city
// is the session's coarse place when known, never an IP address.
func emitSecurityEvent(ctx context.Context, tx pgx.Tx, accountID string, kind realtime.SecurityEventKind, ipCity *string) error {
	return realtime.EmitAccount(ctx, tx, accountID, realtime.AccountSecurityEvent{
		Kind: kind, At: realtime.At(time.Now()), IPCity: ipCity,
	})
}

// isNewDevice reports whether sessionID is the account's first session from
// its device, on an account that has signed in before: a phone or tablet the
// account has never used. A first sign-in ever is not news to anyone, and a
// web session has no device id to compare.
func isNewDevice(ctx context.Context, tx pgx.Tx, accountID, sessionID string, deviceID *string) (bool, error) {
	if deviceID == nil || *deviceID == "" {
		return false, nil
	}
	var seenDevice, signedInBefore bool
	err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM session WHERE account_id = $1 AND id <> $2 AND device_id = $3),
		       EXISTS (SELECT 1 FROM session WHERE account_id = $1 AND id <> $2)`,
		accountID, sessionID, *deviceID).Scan(&seenDevice, &signedInBefore)
	if err != nil {
		return false, err
	}
	return signedInBefore && !seenDevice, nil
}

// sendSecurityAlert enqueues the security email for one change (issue #348),
// in the transaction that makes it, beside the account.security_event above:
// the email exists if and only if the change committed. ref names the change
// (the session id, or the time the password was set), so it is sent once.
// client is the new session's surface, or "" for a password change or reset;
// it picks the role the email is filed under, falling back to the account's
// highest live role. The address is the account's verified email, resolved
// at send time (notify.PgAccountLookup); an account without one gets none.
// Without notifications wired (tests that build a bare Store) it sends nothing.
func (s *Store) sendSecurityAlert(ctx context.Context, tx pgx.Tx, accountID string, kind notify.SecurityAlertKind,
	client, ref string, at time.Time, ipCity *string) error {
	if s.alerts == nil {
		return nil
	}
	id, err := uuid.Parse(accountID)
	if err != nil {
		return fmt.Errorf("auth: account id %q: %w", accountID, err)
	}
	var zone, accountRole string
	if err := tx.QueryRow(ctx, `
		SELECT a.timezone,
		       CASE WHEN bool_or(r.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')) THEN 'ADMIN'
		            WHEN bool_or(r.role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER', 'RESTAURANT_STAFF')) THEN 'RESTAURANT'
		            WHEN bool_or(r.role = 'RIDER') THEN 'RIDER'
		            ELSE 'CUSTOMER' END
		  FROM account a
		  LEFT JOIN account_role r ON r.account_id = a.id AND r.revoked_at IS NULL
		 WHERE a.id = $1
		 GROUP BY a.id`, accountID).Scan(&zone, &accountRole); err != nil {
		return fmt.Errorf("auth: load account for security alert: %w", err)
	}
	role := notify.RoleContext(accountRole)
	switch client {
	case "customer-app":
		role = notify.RoleCustomer
	case "rider-app":
		role = notify.RoleRider
	case "restaurant-web":
		role = notify.RoleRestaurant
	case "admin-web":
		role = notify.RoleAdmin
	}
	place := ""
	if ipCity != nil {
		place = *ipCity
	}
	n, err := notify.SecurityAlertEmail(notify.SecurityAlert{
		AccountID: id, Role: role, Kind: kind, Ref: ref, At: at, Place: place, Zone: notify.Zone(zone),
	})
	if err != nil {
		return err
	}
	_, err = s.alerts.Enqueue(ctx, tx, n)
	return err
}
