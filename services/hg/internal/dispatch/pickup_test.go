package dispatch

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// atTheCounter seeds a ready order with one offer, walks the rider's accepted
// assignment to ARRIVED_AT_PICKUP through the service, which is wired to the
// real orders store as cmd/hg wires it, and then puts the order in state.
func atTheCounter(t *testing.T, pool *pgxpool.Pool, state, deadlineAction string) (svc *Service, orderID, riderID, assignmentID string) {
	t.Helper()
	svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool), 1, state, deadlineAction)
	return svc, orderID, riders[0], assignmentID
}

// counterFixture is atTheCounter with the orders store to wire and the number
// of riders offered the order; the first accepts. An empty deadlineAction
// leaves the order with no deadline, as a terminal state must.
func counterFixture(t *testing.T, pool *pgxpool.Pool, st *orders.Store, riders int, state, deadlineAction string) (svc *Service, orderID string, riderIDs []string, assignmentID string) {
	t.Helper()
	svc = NewService(NewStore(pool), &realOrderLifecycle{store: st})
	orderID, offers := seedFixture(t, pool, riders)
	for _, o := range offers {
		riderIDs = append(riderIDs, o.riderAccountID)
	}
	// order_transition rows reference the order; delete them before
	// seedFixture's cleanup deletes the order (cleanups run last-in first-out).
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_transition WHERE order_id=$1`, orderID)
	})

	var err error
	assignmentID, err = svc.store.AcceptOffer(context.Background(), riderIDs[0], offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	override := "test override"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"} {
		if _, err := svc.Transition(context.Background(), riderIDs[0], assignmentID, TransitionInput{
			ToState: step, OccurredAt: time.Now().UTC(), OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}

	if deadlineAction == "" {
		// A terminal order. A cancelled or rejected one carries its reason.
		mustExec(t, pool, `
UPDATE "order" SET state = $2::order_state, deadline_action = NULL, deadline_at = NULL, ready_at = NULL,
                   cancel_reason = CASE WHEN $2::order_state = 'CANCELLED' THEN 'CUSTOMER_CANCELLED'::order_cancellation_reason_code END,
                   reject_reason = CASE WHEN $2::order_state = 'REJECTED' THEN 'ITEM_UNAVAILABLE'::restaurant_reject_reason_code END
 WHERE id = $1`, orderID, state)
	} else {
		mustExec(t, pool, `
UPDATE "order" SET state = $2, deadline_action = $3, deadline_at = now() + interval '10 minutes',
                   ready_at = NULL
 WHERE id = $1`, orderID, state, deadlineAction)
	}
	return svc, orderID, riderIDs, assignmentID
}

// pickupLeftNothingMoved checks a refused pickup moved nothing: the assignment
// is still at the counter with no PICKED_UP row, and the order is still in
// orderState with no timeline row.
func pickupLeftNothingMoved(t *testing.T, pool *pgxpool.Pool, orderID, assignmentID, orderState string) {
	t.Helper()
	var asnState, gotOrder string
	var pickedRows, orderRows int
	mustQueryRow(t, pool, `
SELECT a.state::text, o.state::text,
       (SELECT count(*) FROM assignment_transition t WHERE t.assignment_id = a.id AND t.to_state = 'PICKED_UP'),
       (SELECT count(*) FROM order_transition t WHERE t.order_id = o.id)
  FROM assignment a JOIN "order" o ON o.id = a.order_id WHERE a.id = $1`,
		[]any{assignmentID}, &asnState, &gotOrder, &pickedRows, &orderRows)
	if asnState != "ARRIVED_AT_PICKUP" || pickedRows != 0 || gotOrder != orderState || orderRows != 0 {
		t.Errorf("after the refusal: assignment %s with %d PICKED_UP row(s), order %s with %d timeline row(s); want ARRIVED_AT_PICKUP with none, %s with none",
			asnState, pickedRows, gotOrder, orderRows, orderState)
	}
}

// TestEarlyPickupIsRefusedWhileTheKitchenIsPreparing: a rider at the counter
// cannot declare an order picked up while the kitchen has not marked it
// ready. The rider spec allows an early handover only when the rider types
// the pickup code the kitchen reads out (docs/spec/04-rider.md, "D-20 —
// Delivery status updates"), and nothing checks that code yet
// (https://github.com/shaiknoorullah/hg-mono/pull/315). Marking the order
// ready on the rider's word would let a rider do the restaurant's step. So
// the pickup is refused with 409 INVALID_TRANSITION, with or without an
// override reason, and neither the assignment nor the order moves
// (https://github.com/shaiknoorullah/hg-mono/issues/317).
func TestEarlyPickupIsRefusedWhileTheKitchenIsPreparing(t *testing.T) {
	pool := openPool(t)
	svc, orderID, riderID, assignmentID := atTheCounter(t, pool, "PREPARING", "PREP_OVERDUE")

	reason := "the kitchen handed it over"
	for _, override := range []*string{nil, &reason} {
		_, err := svc.Transition(context.Background(), riderID, assignmentID, TransitionInput{
			ToState: "PICKED_UP", OccurredAt: time.Now().UTC(), OverrideReason: override,
		})
		se, ok := asServiceError(err)
		if !ok || se.Status != 409 || se.Code != CodeInvalidTransition {
			t.Fatalf("PICKED_UP while the order is PREPARING (override %v): err = %v, want 409 %s",
				override != nil, err, CodeInvalidTransition)
		}
		if !strings.Contains(se.Message, "kitchen") {
			t.Errorf("refusal message %q does not tell the rider to wait for the kitchen", se.Message)
		}
	}
	pickupLeftNothingMoved(t, pool, orderID, assignmentID, "PREPARING")
}

// TestPickupOnlyByTheRiderWhoHoldsTheOrder: only the rider who holds the
// order's live dispatch can move the order to PICKED_UP. The orders module
// checks it itself, in the statement that locks the order and its dispatch
// row, so no caller can move an order for a rider who does not hold it.
func TestPickupOnlyByTheRiderWhoHoldsTheOrder(t *testing.T) {
	pool := openPool(t)

	t.Run("another rider's assignment is not found", func(t *testing.T) {
		svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool), 2, "READY_FOR_PICKUP", "PICKUP_OVERDUE")
		_, err := svc.Transition(context.Background(), riders[1], assignmentID, TransitionInput{
			ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
		})
		if se, ok := asServiceError(err); !ok || se.Status != 404 {
			t.Fatalf("another rider's PICKED_UP: err = %v, want 404", err)
		}
		pickupLeftNothingMoved(t, pool, orderID, assignmentID, "READY_FOR_PICKUP")
	})

	t.Run("a rider the order was taken from is refused", func(t *testing.T) {
		svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool), 2, "READY_FOR_PICKUP", "PICKUP_OVERDUE")
		// The order's delivery now belongs to the second rider; the first
		// still has an assignment at the counter.
		mustExec(t, pool, `UPDATE dispatch SET rider_account_id = $2 WHERE order_id = $1`, orderID, riders[1])
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `UPDATE dispatch SET rider_account_id = $2 WHERE order_id = $1`, orderID, riders[0])
		})
		_, err := svc.Transition(context.Background(), riders[0], assignmentID, TransitionInput{
			ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
		})
		if se, ok := asServiceError(err); !ok || se.Status != 404 {
			t.Fatalf("PICKED_UP by a rider who no longer holds the order: err = %v, want 404", err)
		}
		pickupLeftNothingMoved(t, pool, orderID, assignmentID, "READY_FOR_PICKUP")
	})

	t.Run("the orders module refuses a rider who does not hold the order", func(t *testing.T) {
		for _, c := range []struct{ state, action string }{
			{"READY_FOR_PICKUP", "PICKUP_OVERDUE"}, {"PICKED_UP", "DELIVERY_OVERDUE"},
		} {
			state := c.state
			_, orderID, riders, _ := counterFixture(t, pool, orders.NewStore(pool), 2, state, c.action)
			lc := &realOrderLifecycle{store: orders.NewStore(pool)}
			ctx := context.Background()
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			err = lc.ConfirmPickupTx(ctx, tx, orderID, riders[1])
			_ = tx.Rollback(ctx)
			if !errors.Is(err, ErrRiderDoesNotHoldOrder) {
				t.Errorf("order %s, pickup for a rider who does not hold it: err = %v, want %v", state, err, ErrRiderDoesNotHoldOrder)
			}
		}
	})
}

// TestPickupRefusesAnOrderThatCannotBeCollected: a cancelled, rejected,
// failed, disputed, resolved, delivered or completed order, or one the
// restaurant has not accepted, is never collected. The pickup is refused with
// 409 INVALID_TRANSITION and nothing moves.
func TestPickupRefusesAnOrderThatCannotBeCollected(t *testing.T) {
	pool := openPool(t)
	for _, c := range []struct{ state, action string }{
		{"CANCELLED", ""}, {"REJECTED", ""}, {"FAILED", ""}, {"RESOLVED", ""}, {"COMPLETED", ""},
		{"DISPUTED", "DISPUTE_SLA_BREACH"}, {"DELIVERED", "SETTLE"}, {"ARRIVED", "HANDOVER_OVERDUE"},
		{"RESTAURANT_PENDING", "RESTAURANT_TIMEOUT"},
	} {
		t.Run(c.state, func(t *testing.T) {
			svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool), 1, c.state, c.action)
			_, err := svc.Transition(context.Background(), riders[0], assignmentID, TransitionInput{
				ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
			})
			if se, ok := asServiceError(err); !ok || se.Status != 409 || se.Code != CodeInvalidTransition {
				t.Fatalf("PICKED_UP of a %s order: err = %v, want 409 %s", c.state, err, CodeInvalidTransition)
			}
			pickupLeftNothingMoved(t, pool, orderID, assignmentID, c.state)
		})
	}
}

// TestPickupIsIdempotent: repeating the pickup moves the order once and says
// so once. An order the seal scan already moved to PICKED_UP for the rider
// who holds it lets the rider's own step catch up without moving it again.
func TestPickupIsIdempotent(t *testing.T) {
	pool := openPool(t)

	t.Run("a repeated step", func(t *testing.T) {
		emitter := &recordingEmitter{}
		svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool, emitter), 1, "READY_FOR_PICKUP", "PICKUP_OVERDUE")
		for i := 0; i < 2; i++ {
			if _, err := svc.Transition(context.Background(), riders[0], assignmentID, TransitionInput{
				ToState: "PICKED_UP", PickupCode: pickupCodeFor("PICKED_UP"), OccurredAt: time.Now().UTC(),
			}); err != nil {
				t.Fatalf("PICKED_UP #%d: %v", i+1, err)
			}
		}
		var picked int
		mustQueryRow(t, pool, `SELECT count(*) FROM order_transition WHERE order_id = $1 AND to_state = 'PICKED_UP'`,
			[]any{orderID}, &picked)
		if got := emitter.emitted(); picked != 1 || !slices.Equal(got, []string{"PICKED_UP"}) {
			t.Errorf("after two pickups: %d PICKED_UP timeline row(s), events %v; want 1 and [PICKED_UP]", picked, got)
		}
	})

	t.Run("after the seal scan moved the order", func(t *testing.T) {
		emitter := &recordingEmitter{}
		svc, orderID, riders, assignmentID := counterFixture(t, pool, orders.NewStore(pool, emitter), 1, "PICKED_UP", "DELIVERY_OVERDUE")
		asn, err := svc.Transition(context.Background(), riders[0], assignmentID, TransitionInput{
			ToState: "PICKED_UP", OccurredAt: time.Now().UTC(),
		})
		if err != nil || asn.State != "PICKED_UP" {
			t.Fatalf("PICKED_UP of an order already picked up by its rider = %+v, %v; want the assignment to catch up", asn, err)
		}
		var rows int
		mustQueryRow(t, pool, `SELECT count(*) FROM order_transition WHERE order_id = $1`, []any{orderID}, &rows)
		if rows != 0 || len(emitter.emitted()) != 0 {
			t.Errorf("the catch-up wrote %d timeline row(s) and events %v, want none", rows, emitter.emitted())
		}
	})
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
