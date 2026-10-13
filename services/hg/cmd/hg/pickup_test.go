package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestPickupEscalatorEffects runs the production escalator for a lapsed
// pickup deadline against the real schema, inside one transaction that is
// rolled back: the search that found no rider is re-opened, ops get an
// admin.alert, and the customer gets one notice for the lapse. Any effect the
// schema refused would roll back every escalation, and the ready order would
// be stuck again (https://github.com/shaiknoorullah/hg-mono/issues/293).
func TestPickupEscalatorEffects(t *testing.T) {
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN is not set; skipping (set it to a migrated Postgres to run)")
	}
	if err := testseed.Seed(dsn, true); err != nil {
		t.Fatalf("seed: %v", err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	client, err := notify.NewClient(pool, notify.Options{Notifier: notify.NewNotifier()})
	if err != nil {
		t.Fatalf("notify client: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// HG-TEST01 from migrations/test/fixtures.sql, changed only inside this
	// transaction: ready, and its search for a rider ended with none found.
	const orderID = "88888888-8888-4888-8888-888888888888"
	const customerID = "11111111-1111-4111-8111-111111111111"
	if _, err := tx.Exec(ctx, `
		UPDATE "order" SET state = 'READY_FOR_PICKUP', deadline_action = 'PICKUP_OVERDUE',
		                   deadline_at = now() + interval '10 minutes'
		 WHERE id = $1`, orderID); err != nil {
		t.Fatalf("make the order ready: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO dispatch (order_id, state) VALUES ($1, 'NO_RIDER_FOUND')
		ON CONFLICT (order_id) DO UPDATE
		   SET state = 'NO_RIDER_FOUND', rider_account_id = NULL, deadline_at = NULL, deadline_action = NULL`,
		orderID); err != nil {
		t.Fatalf("end the search with no rider: %v", err)
	}

	esc := &pickupEscalator{notify: client.Enqueue}
	if err := esc.EscalatePickup(ctx, tx, orders.PickupEscalation{
		OrderID: orderID, Lapse: 3, CapReached: true, NextDeadlineAt: time.Now().Add(10 * time.Minute),
	}); err != nil {
		t.Fatalf("EscalatePickup: %v", err)
	}

	var dispatchState, severity, kind string
	var notices int
	if err := tx.QueryRow(ctx, `
		SELECT (SELECT state::text FROM dispatch WHERE order_id = $1),
		       COALESCE((SELECT payload->>'severity' FROM realtime_event
		                  WHERE channel = 'admin:ops' AND type = 'admin.alert' AND order_id = $1
		                  ORDER BY seq DESC LIMIT 1), ''),
		       COALESCE((SELECT payload->>'kind' FROM realtime_event
		                  WHERE channel = 'admin:ops' AND type = 'admin.alert' AND order_id = $1
		                  ORDER BY seq DESC LIMIT 1), ''),
		       (SELECT count(*) FROM notification
		         WHERE account_id = $2 AND kind = $3 AND dedupe_key = 'order_pickup_delayed:' || $1 || ':3')`,
		orderID, customerID, string(notify.KindOrderPickupDelayed)).Scan(&dispatchState, &severity, &kind, &notices); err != nil {
		t.Fatalf("read the effects: %v", err)
	}
	if dispatchState != "SEARCHING" {
		t.Errorf("dispatch = %s, want SEARCHING (re-opened)", dispatchState)
	}
	if severity != "CRITICAL" || kind != "PICKUP_OVERDUE" {
		t.Errorf("ops alert = %q/%q, want CRITICAL/PICKUP_OVERDUE", severity, kind)
	}
	if notices != 1 {
		t.Errorf("%d customer notices for lapse 3, want 1", notices)
	}
}
