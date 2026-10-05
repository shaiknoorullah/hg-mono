package dispatch

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// emitNoRiderFound tells the customer, the restaurant and ops, in the caller's
// transaction, that no rider accepted any wave: dispatch.state_changed to
// NO_RIDER_FOUND on the order's channel, and admin.dispatch_failure on
// admin:ops, with the payloads contracts/websocket.md defines (sections 4.5 and
// 4.7). They are written through the transactional outbox, so they exist only
// if the search's end commits. The order's own deadline takes it from here
// (MarkNoRiderFound).
//
// The realtime contract events branch
// (https://github.com/shaiknoorullah/hg-mono/pull/378) defines this same
// function in events.go, with typed events. Whichever merges second keeps that
// one and deletes this file; the duplicate name makes the build say so.
func emitNoRiderFound(ctx context.Context, tx pgx.Tx, orderID, from string, waves, radiusM int, at time.Time) error {
	oid := orderID

	state, err := json.Marshal(struct {
		OrderID string                 `json:"order_id"`
		From    contract.DispatchState `json:"from"`
		To      contract.DispatchState `json:"to"`
		At      string                 `json:"at"`
	}{orderID, contract.DispatchState(from), contract.DispatchStateNORIDERFOUND, tsMillis(at)})
	if err != nil {
		return fmt.Errorf("marshal dispatch.state_changed: %w", err)
	}
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.OrderChannel(orderID), "dispatch.state_changed", 1,
		[]string{"customer", "restaurant", "rider"}, state, &oid, nil); err != nil {
		return fmt.Errorf("emit dispatch.state_changed: %w", err)
	}

	var offered int
	if err := tx.QueryRow(ctx, `
SELECT count(DISTINCT rider_account_id)::int FROM dispatch_offer WHERE order_id = $1`, orderID).Scan(&offered); err != nil {
		return fmt.Errorf("count offered riders for admin.dispatch_failure: %w", err)
	}
	failure, err := json.Marshal(struct {
		OrderID       string `json:"order_id"`
		Waves         int    `json:"waves"`
		RidersOffered int    `json:"riders_offered"`
		RadiusM       int    `json:"radius_m"`
	}{orderID, waves, offered, radiusM})
	if err != nil {
		return fmt.Errorf("marshal admin.dispatch_failure: %w", err)
	}
	if _, _, err := realtime.EmitInTx(ctx, tx, realtime.AdminOpsChannel, "admin.dispatch_failure", 1,
		nil, failure, &oid, nil); err != nil {
		return fmt.Errorf("emit admin.dispatch_failure: %w", err)
	}
	return nil
}
