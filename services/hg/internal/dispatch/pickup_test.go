package dispatch

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// atTheCounter seeds a ready order with one offer, puts the order in state,
// and walks the rider's accepted assignment to ARRIVED_AT_PICKUP through the
// service, which is wired to the real orders store as cmd/hg wires it.
func atTheCounter(t *testing.T, pool *pgxpool.Pool, state, deadlineAction string) (svc *Service, orderID, riderID, assignmentID string) {
	t.Helper()
	svc = NewService(NewStore(pool), &realOrderLifecycle{store: orders.NewStore(pool)})
	orderID, offers := seedFixture(t, pool, 1)
	riderID = offers[0].riderAccountID
	// order_transition rows reference the order; delete them before
	// seedFixture's cleanup deletes the order (cleanups run last-in first-out).
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_transition WHERE order_id=$1`, orderID)
	})
	mustExec(t, pool, `
UPDATE "order" SET state = $2, deadline_action = $3, deadline_at = now() + interval '10 minutes',
                   ready_at = NULL
 WHERE id = $1`, orderID, state, deadlineAction)

	var err error
	assignmentID, err = svc.store.AcceptOffer(context.Background(), riderID, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	override := "test override"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"} {
		if _, err := svc.Transition(context.Background(), riderID, assignmentID, TransitionInput{
			ToState: step, OccurredAt: time.Now().UTC(), OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}
	return svc, orderID, riderID, assignmentID
}

// TestEarlyPickupMovesTheOrderThroughReady: the kitchen handed the food over
// before tapping ready, and the rider confirms pickup at the counter. The
// order goes PREPARING → READY_FOR_PICKUP (as the system) → PICKED_UP (as the
// rider) in the step's own transaction, so the assignment and the order both
// end PICKED_UP, with one timeline row for each move
// (https://github.com/shaiknoorullah/hg-mono/issues/317).
func TestEarlyPickupMovesTheOrderThroughReady(t *testing.T) {
	pool := openPool(t)
	svc, orderID, riderID, assignmentID := atTheCounter(t, pool, "PREPARING", "PREP_OVERDUE")

	asn, err := svc.Transition(context.Background(), riderID, assignmentID, TransitionInput{
		ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("PICKED_UP while the order is PREPARING: %v", err)
	}
	if asn.State != "PICKED_UP" {
		t.Errorf("assignment = %s, want PICKED_UP", asn.State)
	}

	var orderState, action string
	var readySet, pickedSet bool
	mustQueryRow(t, pool, `
SELECT state::text, deadline_action, ready_at IS NOT NULL, picked_up_at IS NOT NULL
  FROM "order" WHERE id = $1`, []any{orderID}, &orderState, &action, &readySet, &pickedSet)
	if orderState != "PICKED_UP" || action != "DELIVERY_OVERDUE" || !readySet || !pickedSet {
		t.Errorf("order = %s (deadline %s, ready_at set %v, picked_up_at set %v), want PICKED_UP with DELIVERY_OVERDUE and both times set",
			orderState, action, readySet, pickedSet)
	}

	var ready, picked int
	mustQueryRow(t, pool, `
SELECT count(*) FILTER (WHERE from_state = 'PREPARING' AND to_state = 'READY_FOR_PICKUP'
                          AND actor_kind = 'SYSTEM' AND actor_account_id IS NULL),
       count(*) FILTER (WHERE from_state = 'READY_FOR_PICKUP' AND to_state = 'PICKED_UP'
                          AND actor_kind = 'RIDER' AND actor_account_id = $2)
  FROM order_transition WHERE order_id = $1`, []any{orderID, riderID}, &ready, &picked)
	if ready != 1 || picked != 1 {
		t.Errorf("timeline: %d system ready row(s) and %d rider pickup row(s), want 1 and 1", ready, picked)
	}
}

// TestPickupOfAnOrderWithSupportIsRefused: the restaurant reported a problem
// and the order is with support (DISPUTED). The rider's PICKED_UP is refused
// with 409 INVALID_TRANSITION and nothing moves: not the assignment, not the
// order.
func TestPickupOfAnOrderWithSupportIsRefused(t *testing.T) {
	pool := openPool(t)
	svc, _, riderID, assignmentID := atTheCounter(t, pool, "DISPUTED", "DISPUTE_SLA_BREACH")

	_, err := svc.Transition(context.Background(), riderID, assignmentID, TransitionInput{
		ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
	})
	if se, ok := asServiceError(err); !ok || se.Status != 409 || se.Code != CodeInvalidTransition {
		t.Fatalf("PICKED_UP of a disputed order: err = %v, want 409 %s", err, CodeInvalidTransition)
	}

	var asnState, orderState string
	var orderRows int
	mustQueryRow(t, pool, `
SELECT a.state::text, o.state::text,
       (SELECT count(*) FROM order_transition t WHERE t.order_id = o.id)
  FROM assignment a JOIN "order" o ON o.id = a.order_id WHERE a.id = $1`,
		[]any{assignmentID}, &asnState, &orderState, &orderRows)
	if asnState != "ARRIVED_AT_PICKUP" || orderState != "DISPUTED" || orderRows != 0 {
		t.Errorf("after the refusal: assignment %s, order %s, %d order transition(s); want ARRIVED_AT_PICKUP, DISPUTED, 0",
			asnState, orderState, orderRows)
	}
}

// TestResumeSearchReopensANoRiderFoundSearch: the dispatch half of a lapsed
// pickup deadline (https://github.com/shaiknoorullah/hg-mono/issues/293). A
// search that found no rider is searching again, due now, from the first
// radius and with a fresh wave and time budget, so the dispatch runner offers
// it to riders who came online since; when nobody is there, the round ends in
// NO_RIDER_FOUND again. A running search is left alone.
func TestResumeSearchReopensANoRiderFoundSearch(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	orderID, _ := seedFixture(t, pool, 1)

	resume := func() SearchStatus {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		got, err := ResumeSearchTx(ctx, tx, orderID)
		if err != nil {
			t.Fatalf("ResumeSearchTx: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return got
	}

	if got := resume(); got != SearchRunning {
		t.Fatalf("a running search: %s, want %s", got, SearchRunning)
	}

	// The search ran out of riders, long ago: its wave budget and time budget
	// are spent, and its one rider let the offer lapse.
	mustExec(t, pool, `UPDATE dispatch_offer SET state = 'EXPIRED', outcome = 'EXPIRED', outcome_at = now() WHERE order_id = $1`, orderID)
	mustExec(t, pool, `UPDATE dispatch SET wave = $2, created_at = now() - interval '1 hour' WHERE order_id = $1`, orderID, maxWaves)
	if err := store.MarkNoRiderFound(ctx, orderID); err != nil {
		t.Fatalf("MarkNoRiderFound: %v", err)
	}

	if got := resume(); got != SearchReopened {
		t.Fatalf("a search that found no rider: %s, want %s", got, SearchReopened)
	}
	var state, action string
	var due bool
	var radius, wave int
	mustQueryRow(t, pool, `
SELECT state::text, deadline_action, deadline_at <= now(), radius_m, wave FROM dispatch WHERE order_id = $1`,
		[]any{orderID}, &state, &action, &due, &radius, &wave)
	if state != "SEARCHING" || action != "NEXT_WAVE" || !due || radius != radiusLadderM[0] || wave != maxWaves {
		t.Errorf("re-opened dispatch = %s/%s due=%v radius %d wave %d; want SEARCHING/NEXT_WAVE due, radius %d, wave %d kept",
			state, action, due, radius, wave, radiusLadderM[0], maxWaves)
	}

	waves, err := store.FindWavesToEscalate(ctx, time.Now().Add(interWaveGap+time.Second), interWaveGap)
	if err != nil {
		t.Fatalf("FindWavesToEscalate: %v", err)
	}
	var found *waveToEscalate
	for i := range waves {
		if waves[i].OrderID == orderID {
			found = &waves[i]
		}
	}
	if found == nil {
		t.Fatal("the re-opened search is not due for its next wave")
	}
	if found.RoundWaves != 0 || found.ElapsedS > 60 {
		t.Errorf("re-opened search budget: %d waves, %d s spent; want a fresh budget", found.RoundWaves, found.ElapsedS)
	}

	// Nobody is there to take it: the dispatch runner widens through the
	// ladder and ends the round in NO_RIDER_FOUND, ready for the next lapse.
	svc := NewService(store, nil)
	svc.now = func() time.Time { return time.Now().UTC().Add(interWaveGap + time.Second) }
	if err := NewDispatchRunner(svc, newTestLogger(), 0, 0).EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire: %v", err)
	}
	mustQueryRow(t, pool, `SELECT state::text FROM dispatch WHERE order_id = $1`, []any{orderID}, &state)
	if state != "NO_RIDER_FOUND" {
		t.Errorf("after a round with nobody to offer: dispatch %s, want NO_RIDER_FOUND", state)
	}
}

// mustQueryRow scans one row into dst, failing the test on any error.
func mustQueryRow(t *testing.T, pool *pgxpool.Pool, sql string, args []any, dst ...any) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(dst...); err != nil {
		t.Fatalf("query failed: %v\nSQL: %s", err, sql)
	}
}
