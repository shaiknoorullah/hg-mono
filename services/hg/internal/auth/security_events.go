package auth

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

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
