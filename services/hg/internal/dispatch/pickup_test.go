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

// resumeSearch runs ResumeSearchTx for orderID in a transaction of its own, as
// the orders deadline runner does when the pickup deadline lapses.
func resumeSearch(t *testing.T, pool *pgxpool.Pool, orderID string) SearchStatus {
	t.Helper()
	ctx := context.Background()
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

// runRoundToNoRider moves the test clock past each empty wave's hold and runs
// the dispatch runner until the search stops SEARCHING, as
// TestNoRider_WidensToTenKmThenEndsWithinBudget does.
func runRoundToNoRider(t *testing.T, pool *pgxpool.Pool, runner *DispatchRunner, clk *testClock, orderID string) {
	t.Helper()
	for i := 0; i < 2*maxWaves && readDispatch(t, pool, orderID).state == "SEARCHING"; i++ {
		clk.Advance(untilNextWave)
		if err := runner.EscalateAndExpire(context.Background()); err != nil {
			t.Fatalf("EscalateAndExpire: %v", err)
		}
	}
	if d := readDispatch(t, pool, orderID); d.state != "NO_RIDER_FOUND" {
		t.Fatalf("after running the round out, dispatch = %+v, want NO_RIDER_FOUND", d)
	}
}

// dueOnTestClock moves a re-opened search's due time onto the test clock.
// ResumeSearchTx makes the search due at the database's now; the runner in
// these tests runs on a clock in 2001 (no_rider_integration_test.go), which
// keeps its fleet-wide queries to this file's rows.
func dueOnTestClock(t *testing.T, pool *pgxpool.Pool, clk *testClock, orderID string) {
	t.Helper()
	mustExec(t, pool, `UPDATE dispatch SET deadline_at = $2 WHERE order_id = $1`, orderID, clk.Now())
}

// TestResumeSearchReopensANoRiderFoundSearch: the dispatch half of a lapsed
// pickup deadline (https://github.com/shaiknoorullah/hg-mono/issues/293). A
// search that found no rider is searching again, due now, from the first
// radius and with a fresh wave and time budget, so the dispatch runner offers
// it to riders who came online since; when nobody is there, the round runs its
// waves and ends in NO_RIDER_FOUND again. A search not started yet, or still
// running, is left alone.
func TestResumeSearchReopensANoRiderFoundSearch(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	if got := resumeSearch(t, pool, o.id); got != SearchNotStarted {
		t.Fatalf("an order with no search yet: %s, want %s", got, SearchNotStarted)
	}
	if _, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil {
		t.Fatalf("first wave: %v", err)
	}
	if got := resumeSearch(t, pool, o.id); got != SearchRunning {
		t.Fatalf("a running search: %s, want %s", got, SearchRunning)
	}

	// Nobody is near: the first round runs its whole wave budget and ends. It
	// started long ago on the test clock, so its time budget is spent too.
	runRoundToNoRider(t, pool, runner, clk, o.id)
	mustExec(t, pool, `UPDATE dispatch SET created_at = $2 WHERE order_id = $1`, o.id, clk.Now().Add(-time.Hour))

	if got := resumeSearch(t, pool, o.id); got != SearchReopened {
		t.Fatalf("a search that found no rider: %s, want %s", got, SearchReopened)
	}
	var state, action string
	var due, leased bool
	var radius, wave int
	mustQueryRow(t, pool, `
SELECT state::text, deadline_action, deadline_at <= now(), lease_until IS NOT NULL, radius_m, wave
  FROM dispatch WHERE order_id = $1`,
		[]any{o.id}, &state, &action, &due, &leased, &radius, &wave)
	if state != "SEARCHING" || action != "NEXT_WAVE" || !due || leased || radius != radiusLadderM[0] || wave != maxWaves {
		t.Errorf("re-opened dispatch = %s/%s due=%v leased=%v radius %d wave %d; want SEARCHING/NEXT_WAVE due, no lease, radius %d, wave %d kept",
			state, action, due, leased, radius, wave, radiusLadderM[0], maxWaves)
	}

	// The runner claims it with a fresh budget: no wave yet in this round, no
	// time spent, and no empty last wave to widen past.
	dueOnTestClock(t, pool, clk, o.id)
	clk.Advance(interWaveGap + time.Millisecond)
	waves, err := svc.store.ClaimWavesToEscalate(ctx, clk.Now(), interWaveGap, runner.owner)
	if err != nil {
		t.Fatalf("ClaimWavesToEscalate: %v", err)
	}
	var found *waveToEscalate
	for i := range waves {
		if waves[i].OrderID == o.id {
			found = &waves[i]
		}
	}
	if found == nil {
		t.Fatal("the re-opened search is not due for its next wave")
	}
	if found.RoundWaves != 0 || found.ElapsedS > 60 || found.LastWaveEmpty {
		t.Errorf("re-opened search budget: %d waves, %d s spent, last wave empty %v; want a fresh budget",
			found.RoundWaves, found.ElapsedS, found.LastWaveEmpty)
	}

	// Nobody is there to take it: the round runs its waves again and ends in
	// NO_RIDER_FOUND, ready for the next lapse.
	runner.escalateOne(ctx, *found)
	runRoundToNoRider(t, pool, runner, clk, o.id)
	if n := len(waveRadii(t, pool, o.id)); n != 2*maxWaves {
		t.Errorf("waves over both rounds = %d, want %d (a full round each)", n, 2*maxWaves)
	}
}

// TestReopenedSearchStartsAgainAtTheNearestRadius: a search re-opened after
// ending on an empty wave at 10 km starts again at 3 km. Whether the last wave
// was empty, which makes the next wave one rung wider, is asked of this
// round's waves only; asked of the round before, the re-opened search would
// skip 3 km and run its first wave at 6 km.
func TestReopenedSearchStartsAgainAtTheNearestRadius(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	if _, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil {
		t.Fatalf("first wave: %v", err)
	}
	runRoundToNoRider(t, pool, runner, clk, o.id)
	if got, want := waveRadii(t, pool, o.id), []int{3000, 6000, 10000, 10000, 10000}; !sameInts(got, want) {
		t.Fatalf("first round's radii = %v, want %v, ending on an empty wave at 10 km", got, want)
	}

	if got := resumeSearch(t, pool, o.id); got != SearchReopened {
		t.Fatalf("ResumeSearchTx = %s, want %s", got, SearchReopened)
	}
	dueOnTestClock(t, pool, clk, o.id)
	// A rider comes online about 2 km from the restaurant: inside 3 km.
	rider := seedOnlineRider(t, pool, o.lng, o.lat+2.0/111.32)

	clk.Advance(interWaveGap + time.Millisecond)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire: %v", err)
	}
	d := readDispatch(t, pool, o.id)
	if d.state != "SEARCHING" || d.wave != maxWaves+1 || d.radiusM != 3000 {
		t.Fatalf("re-opened search's first wave: dispatch = %+v, want SEARCHING wave %d at 3000 m", d, maxWaves+1)
	}
	var waveRadius, distance int
	var offerState string
	if err := pool.QueryRow(ctx, `
SELECT w.radius_m, f.state::text, f.distance_m
  FROM dispatch_offer f JOIN dispatch_wave w ON w.id = f.dispatch_wave_id
 WHERE f.order_id = $1 AND f.rider_account_id = $2`, o.id, rider).Scan(&waveRadius, &offerState, &distance); err != nil {
		t.Fatalf("the rider 2 km away has no offer: %v", err)
	}
	if waveRadius != 3000 || offerState != "PENDING" || distance > 3000 {
		t.Fatalf("offer = %s at %d m from a wave at %d m, want PENDING within 3 km from a wave at 3000 m",
			offerState, distance, waveRadius)
	}
}

// mustQueryRow scans one row into dst, failing the test on any error.
func mustQueryRow(t *testing.T, pool *pgxpool.Pool, sql string, args []any, dst ...any) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(dst...); err != nil {
		t.Fatalf("query failed: %v\nSQL: %s", err, sql)
	}
}
