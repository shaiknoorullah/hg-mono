package restaurant_test

// delay_integration_test.go — the restaurant's delay goes through the orders
// module, which owns the order's deadline and transition log, and reaches the
// customer (https://github.com/shaiknoorullah/hg-mono/issues/351).
//
// Guarded by HG_TEST_POSTGRES_DSN.

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// delayRecorder is recordingEmitter that also records the delays it is told
// about, as the notifier cmd/hg/main.go wires (orders.DelayNotifier).
type delayRecorder struct {
	recordingEmitter
	dmu    sync.Mutex
	delays [][2]int // {delay number, added minutes}
}

func (d *delayRecorder) EmitOrderDelay(_ context.Context, _ pgx.Tx, _ string, delayNo, addedMinutes int) error {
	d.dmu.Lock()
	defer d.dmu.Unlock()
	d.delays = append(d.delays, [2]int{delayNo, addedMinutes})
	return nil
}

// TestRestaurantDelay_GoesThroughOrdersAndReachesCustomer: a delay records an
// order_delay row, moves the deadline and the promised ready time by the added
// minutes, writes the PREPARING → PREPARING transition row, emits
// order.state_changed with the new deadline and tells the notifier.
func TestRestaurantDelay_GoesThroughOrdersAndReachesCustomer(t *testing.T) {
	pool := testPool(t)
	f := seedOrderableFixtures(t, pool) // certified and live, so accept succeeds
	orderID := stepOrder(t, pool, f)
	ctx := context.Background()

	em := &delayRecorder{}
	h := restaurant.NewHandler(restaurant.NewRepo(pool, orders.NewStore(pool, em)), nil, &fakePayActions{})
	if rec := postStep(t, h.AcceptOrder, orderID, "accept", `{"prep_eta_minutes":20}`, f.ownerAccountID); rec.Code != http.StatusOK {
		t.Fatalf("accept: status=%d (body: %s)", rec.Code, rec.Body.String())
	}
	var deadlineBefore, promisedBefore time.Time
	if err := pool.QueryRow(ctx, `SELECT deadline_at, promised_ready_at FROM "order" WHERE id = $1`, orderID).
		Scan(&deadlineBefore, &promisedBefore); err != nil {
		t.Fatalf("read deadline: %v", err)
	}

	rec := postStep(t, h.DelayOrder, orderID, "delay", `{"added_minutes":10,"reason_code":"HIGH_VOLUME"}`, f.ownerAccountID)
	if rec.Code != http.StatusOK {
		t.Fatalf("delay: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	var deadlineAfter, promisedAfter time.Time
	var action string
	if err := pool.QueryRow(ctx, `SELECT deadline_at, promised_ready_at, deadline_action FROM "order" WHERE id = $1`, orderID).
		Scan(&deadlineAfter, &promisedAfter, &action); err != nil {
		t.Fatalf("read deadline: %v", err)
	}
	if got := deadlineAfter.Sub(deadlineBefore); got != 10*time.Minute || action != "PREP_OVERDUE" {
		t.Errorf("deadline moved %v (action %s), want 10m (PREP_OVERDUE)", got, action)
	}
	if got := promisedAfter.Sub(promisedBefore); got != 10*time.Minute {
		t.Errorf("promised_ready_at moved %v, want 10m", got)
	}

	var minutes int
	var reason, by string
	if err := pool.QueryRow(ctx, `
		SELECT added_minutes, reason_code::text, created_by::text FROM order_delay WHERE order_id = $1`, orderID).
		Scan(&minutes, &reason, &by); err != nil {
		t.Fatalf("read order_delay: %v", err)
	}
	if minutes != 10 || reason != "HIGH_VOLUME" || by != f.ownerAccountID {
		t.Errorf("order_delay = %d/%s/%s, want 10/HIGH_VOLUME/%s", minutes, reason, by, f.ownerAccountID)
	}
	assertTransitionRow(t, pool, orderID, "PREPARING", "PREPARING", f.ownerAccountID)

	var events int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM realtime_event
		 WHERE channel = $1 AND type = 'order.state_changed'
		   AND payload->>'from' = 'PREPARING' AND payload->>'to' = 'PREPARING'
		   AND payload->>'reason' = 'HIGH_VOLUME'
		   AND abs(extract(epoch FROM (payload->>'deadline_at')::timestamptz - $2::timestamptz)) < 0.001`,
		"order:"+orderID, deadlineAfter).Scan(&events); err != nil {
		t.Fatalf("read realtime_event: %v", err)
	}
	if events != 1 {
		t.Errorf("order.state_changed delay events with the new deadline = %d, want 1", events)
	}

	em.dmu.Lock()
	defer em.dmu.Unlock()
	if len(em.delays) != 1 || em.delays[0] != [2]int{1, 10} {
		t.Errorf("notifier told about delays %v, want [[1 10]]", em.delays)
	}
}
