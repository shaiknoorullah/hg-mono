package dispatch

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests for the rider availability sweeps (availability_sweeper.go,
// https://github.com/shaiknoorullah/hg-mono/issues/255), against the rules of
// docs/spec/04-rider.md, "D-10 — Availability: online / offline". They need
// HG_TEST_POSTGRES_DSN and skip without it.

func newTestSweeper(pool *pgxpool.Pool) *AvailabilitySweeper {
	return NewAvailabilitySweeper(NewService(NewStore(pool), nil),
		slog.New(slog.NewTextHandler(io.Discard, nil)), DefaultAvailabilitySweepConfig())
}

// seedSweepRider creates an active rider in the given availability state. With
// lastFixAge >= 0 the rider's current location reached the server that long
// ago; with lastFixAge < 0 the rider has no location row.
func seedSweepRider(t *testing.T, pool *pgxpool.Pool, state string, lastFixAge time.Duration, goOfflineAfter bool) string {
	t.Helper()
	ctx := context.Background()
	var acct string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &acct)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM rider_availability_event WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acct)
	})
	mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status,
                           availability_state, is_online, go_offline_after_delivery, approved_at)
VALUES ($1, 'S', 'R', '1990-01-01', 'ACTIVE', 'ACTIVE', $2::rider_availability_state, $3, $4, now())`,
		acct, state, state != "OFFLINE", goOfflineAfter)
	if lastFixAge >= 0 {
		mustExec(t, pool, `
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 10,
        now() - make_interval(secs => $2), now() - make_interval(secs => $2))`, acct, lastFixAge.Seconds())
	}
	return acct
}

func availabilityOf(t *testing.T, pool *pgxpool.Pool, acct string) string {
	t.Helper()
	var state string
	mustQuery(t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id=$1`, &state, acct)
	return state
}

func reconciledEvents(t *testing.T, pool *pgxpool.Pool, acct string) int {
	t.Helper()
	var n int
	mustQuery(t, pool, `
SELECT count(*) FROM rider_availability_event
 WHERE account_id=$1 AND reason='RECONCILED' AND from_state='ON_DELIVERY'`, &n, acct)
	return n
}

// forgetSweepRuns deletes the job_run rows the sweeps write during the test.
func forgetSweepRuns(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	since := time.Now()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM job_run WHERE job = ANY($1) AND started_at >= $2`,
			[]string{staleSweepJob, reconcileJob}, since.Add(-time.Second))
	})
}

// TestStaleSweep: an online rider whose last location is older than the
// threshold (120 s) moves to ONLINE_STALE; a rider whose location is inside it
// is untouched.
func TestStaleSweep(t *testing.T) {
	pool := openPool(t)
	forgetSweepRuns(t, pool)
	silent := seedSweepRider(t, pool, "ONLINE_IDLE", 3*time.Minute, false)
	fresh := seedSweepRider(t, pool, "ONLINE_IDLE", 90*time.Second, false)

	rep, err := newTestSweeper(pool).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if !rep.Stale.Ran || rep.Stale.Moved < 1 {
		t.Errorf("stale sweep report = %+v, want it to have run and moved the silent rider", rep.Stale)
	}
	if got := availabilityOf(t, pool, silent); got != "ONLINE_STALE" {
		t.Errorf("rider silent for 3 min: availability = %s, want ONLINE_STALE", got)
	}
	if got := availabilityOf(t, pool, fresh); got != "ONLINE_IDLE" {
		t.Errorf("rider heard from 90 s ago: availability = %s, want ONLINE_IDLE (untouched)", got)
	}
}

// TestReconcileSweep: a rider stranded ON_DELIVERY with no live assignment
// returns to ONLINE_IDLE (or OFFLINE when they asked to stop after the
// delivery) and the anomaly is logged; a rider whose assignment is live is
// untouched until that assignment ends without restoring them.
func TestReconcileSweep(t *testing.T) {
	pool := openPool(t)
	forgetSweepRuns(t, pool)
	ctx := context.Background()
	sweeper := newTestSweeper(pool)

	stranded := seedSweepRider(t, pool, "ON_DELIVERY", -1, false)
	strandedEndingShift := seedSweepRider(t, pool, "ON_DELIVERY", -1, true)
	_, offers := seedFixture(t, pool, 1)
	busy := offers[0].riderAccountID
	assignmentID, err := NewStore(pool).AcceptOffer(ctx, busy, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	rep, err := sweeper.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	restored := map[string]bool{}
	for _, id := range rep.Reconcile.Riders {
		restored[id] = true
	}
	if !restored[stranded] || !restored[strandedEndingShift] || restored[busy] {
		t.Errorf("reconcile restored %v; want both stranded riders and not the one with a live assignment", rep.Reconcile.Riders)
	}
	if got := availabilityOf(t, pool, stranded); got != "ONLINE_IDLE" {
		t.Errorf("stranded rider: availability = %s, want ONLINE_IDLE", got)
	}
	var online bool
	mustQuery(t, pool, `SELECT is_online FROM rider_profile WHERE account_id=$1`, &online, strandedEndingShift)
	if got := availabilityOf(t, pool, strandedEndingShift); got != "OFFLINE" || online {
		t.Errorf("stranded rider who asked to go offline after the delivery: availability = %s, is_online = %v; want OFFLINE, false", got, online)
	}
	for _, id := range []string{stranded, strandedEndingShift} {
		if n := reconciledEvents(t, pool, id); n != 1 {
			t.Errorf("rider %s: %d RECONCILED availability events, want 1", id, n)
		}
	}
	if got := availabilityOf(t, pool, busy); got != "ON_DELIVERY" {
		t.Errorf("rider with a live assignment: availability = %s, want ON_DELIVERY (untouched)", got)
	}
	if n := reconciledEvents(t, pool, busy); n != 0 {
		t.Errorf("rider with a live assignment: %d RECONCILED events, want 0", n)
	}

	// The assignment ends abnormally, without its terminal step restoring the
	// rider (an ops cancellation done by hand, say). The backstop catches it.
	mustExec(t, pool, `UPDATE assignment SET state='CANCELLED_BY_PLATFORM', terminated_at=now() WHERE id=$1`, assignmentID)
	if _, err := sweeper.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if got := availabilityOf(t, pool, busy); got != "ONLINE_IDLE" {
		t.Errorf("rider whose assignment ended: availability = %s, want ONLINE_IDLE", got)
	}
	if n := reconciledEvents(t, pool, busy); n != 1 {
		t.Errorf("rider whose assignment ended: %d RECONCILED events, want 1", n)
	}
}

// TestAvailabilitySweepsOnTwoReplicas runs both sweeps from two replicas (two
// sweepers, each on its own pool) at once, scheduled ticks and "sweep now"
// calls mixed. Nothing fails (a deadlock would surface as an error), every
// rider is moved, and no stranded rider is restored or logged twice.
func TestAvailabilitySweepsOnTwoReplicas(t *testing.T) {
	poolA, poolB := openPool(t), openPool(t)
	forgetSweepRuns(t, poolA)
	replicas := []*AvailabilitySweeper{newTestSweeper(poolA), newTestSweeper(poolB)}

	// The stranded riders' phones still report a location, so once restored
	// they stay ONLINE_IDLE; one with no location would rightly go on to
	// ONLINE_STALE at the next stale-location sweep.
	const n = 8
	var stranded, silent []string
	for i := 0; i < n; i++ {
		stranded = append(stranded, seedSweepRider(t, poolA, "ON_DELIVERY", 0, false))
		silent = append(silent, seedSweepRider(t, poolA, "ONLINE_IDLE", 10*time.Minute, false))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	type outcome struct {
		stale, reconcile SweepResult
		err              error
	}
	const callers = 6 // per replica
	results := make(chan outcome, 2*callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for _, s := range replicas {
		for i := 0; i < callers; i++ {
			wg.Add(1)
			go func(s *AvailabilitySweeper, now bool) {
				defer wg.Done()
				<-start
				var o outcome
				if now {
					var rep AvailabilitySweepReport
					rep, o.err = s.RunOnce(ctx)
					o.stale, o.reconcile = rep.Stale, rep.Reconcile
				} else {
					var err1, err2 error
					o.stale, err1 = s.sweepStale(ctx, false)
					o.reconcile, err2 = s.reconcile(ctx, false)
					if o.err = err1; o.err == nil {
						o.err = err2
					}
				}
				results <- o
			}(s, i%2 == 0)
		}
	}
	close(start)
	wg.Wait()
	close(results)

	restored := map[string]int{}
	for o := range results {
		if o.err != nil {
			t.Fatalf("a concurrent sweep failed: %v", o.err)
		}
		for _, id := range o.reconcile.Riders {
			restored[id]++
		}
	}
	for _, id := range stranded {
		if restored[id] != 1 {
			t.Errorf("stranded rider %s restored %d times across both replicas, want exactly 1", id, restored[id])
		}
		if got := reconciledEvents(t, poolA, id); got != 1 {
			t.Errorf("stranded rider %s: %d RECONCILED events, want exactly 1", id, got)
		}
		if got := availabilityOf(t, poolA, id); got != "ONLINE_IDLE" {
			t.Errorf("stranded rider %s: availability = %s, want ONLINE_IDLE", id, got)
		}
	}
	for _, id := range silent {
		if got := availabilityOf(t, poolA, id); got != "ONLINE_STALE" {
			t.Errorf("silent rider %s: availability = %s, want ONLINE_STALE", id, got)
		}
	}
}

// TestAvailabilitySweepLease: while another replica holds a sweep's lease, a
// scheduled tick skips without touching anyone, and "sweep now" waits for the
// lease and then runs.
func TestAvailabilitySweepLease(t *testing.T) {
	pool := openPool(t)
	forgetSweepRuns(t, pool)
	ctx := context.Background()
	sweeper := newTestSweeper(pool)
	stranded := seedSweepRider(t, pool, "ON_DELIVERY", -1, false)

	// The other replica, mid-sweep: it holds the reconcile lease.
	other, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Release()
	mustLease := func(sql string) {
		t.Helper()
		if _, err := other.Exec(ctx, sql, "hg."+reconcileJob); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	mustLease(`SELECT pg_advisory_lock(hashtextextended($1, 0))`)

	res, err := sweeper.reconcile(ctx, false)
	if err != nil {
		t.Fatalf("scheduled reconcile: %v", err)
	}
	if res.Ran || res.Moved != 0 {
		t.Errorf("scheduled reconcile while the lease is held elsewhere = %+v, want skipped", res)
	}
	if got := availabilityOf(t, pool, stranded); got != "ON_DELIVERY" {
		t.Errorf("availability = %s while the lease was held elsewhere, want ON_DELIVERY (untouched)", got)
	}

	done := make(chan AvailabilitySweepReport, 1)
	go func() {
		rep, err := sweeper.RunOnce(ctx)
		if err != nil {
			t.Errorf("RunOnce: %v", err)
		}
		done <- rep
	}()
	select {
	case rep := <-done:
		t.Fatalf("RunOnce returned %+v while the lease was held elsewhere; it should wait", rep)
	case <-time.After(300 * time.Millisecond):
	}
	mustLease(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`)

	select {
	case rep := <-done:
		if !rep.Reconcile.Ran {
			t.Errorf("RunOnce reconcile = %+v, want it to have run once the lease was free", rep.Reconcile)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("RunOnce still waiting after the lease was released")
	}
	if got := availabilityOf(t, pool, stranded); got != "ONLINE_IDLE" {
		t.Errorf("availability = %s after RunOnce, want ONLINE_IDLE", got)
	}
}
