package dispatch

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// addResolvedOffer gives rider a resolved (EXPIRED/REJECTED/…) offer on orderID's
// wave, with a chosen outcome time — one offer per (order, rider), per D-15.
func addResolvedOffer(t *testing.T, pool *pgxpool.Pool, orderID, rider, outcome string, outcomeAt time.Time) {
	t.Helper()
	ctx := context.Background()
	var waveID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM dispatch_wave WHERE order_id=$1 LIMIT 1`, orderID).Scan(&waveID); err != nil {
		t.Fatalf("wave for %s: %v", orderID, err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO dispatch_offer (order_id, dispatch_wave_id, rider_account_id, wave, distance_m,
                            earnings_cents, tip_estimate_cents, state, outcome, outcome_at, expires_at,
                            reject_reason_code)
VALUES ($1, $2, $3, 1, 100, 449, 0, $4::offer_state, $5::dispatch_offer_outcome, $6, now(),
        CASE WHEN $4 = 'REJECTED' THEN 'OTHER'::offer_reject_reason_code ELSE NULL END)`,
		orderID, waveID, rider, outcome, outcome, outcomeAt); err != nil {
		t.Fatalf("add %s offer: %v", outcome, err)
	}
}

// TestEscalation_ExpireFindHardStop drives the D-15 wave lifecycle at the store
// level: lapsed PENDING offers expire, the lapsed wave surfaces for escalation, and
// an order that has run out of candidates is marked NO_RIDER_FOUND.
func TestEscalation_ExpireFindHardStop(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 3)

	// Lapse the wave (with a realistic wave/radius, as CreateWave would set) and its
	// offers into the past.
	past := time.Now().Add(-time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE dispatch_offer SET expires_at=$2 WHERE order_id=$1`, orderID, past); err != nil {
		t.Fatalf("age offers: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE dispatch SET deadline_at=$2, wave=1, radius_m=3000 WHERE order_id=$1`, orderID, past); err != nil {
		t.Fatalf("age wave: %v", err)
	}

	n, err := store.ExpireDueOffers(ctx, time.Now())
	if err != nil {
		t.Fatalf("ExpireDueOffers: %v", err)
	}
	if n < int64(len(offers)) {
		t.Fatalf("expired %d offers, want >= %d", n, len(offers))
	}
	var pending int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM dispatch_offer WHERE order_id=$1 AND state='PENDING'`, orderID).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if pending != 0 {
		t.Fatalf("%d offers still PENDING after expire", pending)
	}

	due, err := store.FindWavesToEscalate(ctx, time.Now(), interWaveGap)
	if err != nil {
		t.Fatalf("FindWavesToEscalate: %v", err)
	}
	var got *waveToEscalate
	for i := range due {
		if due[i].OrderID == orderID {
			got = &due[i]
		}
	}
	if got == nil {
		t.Fatal("lapsed wave not returned for escalation")
	}
	if got.Wave != 1 || got.RadiusM != 3000 {
		t.Fatalf("escalation wave/radius = %d/%d, want 1/3000", got.Wave, got.RadiusM)
	}

	if err := store.MarkNoRiderFound(ctx, orderID); err != nil {
		t.Fatalf("MarkNoRiderFound: %v", err)
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT state::text FROM dispatch WHERE order_id=$1`, orderID).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "NO_RIDER_FOUND" {
		t.Fatalf("dispatch state=%s, want NO_RIDER_FOUND", st)
	}
	// Idempotent.
	if err := store.MarkNoRiderFound(ctx, orderID); err != nil {
		t.Fatalf("idempotent MarkNoRiderFound: %v", err)
	}
}

// TestSweepUnresponsiveRiders forces a rider offline after three consecutive
// EXPIRED offers (across three orders, per the one-offer-per-order rule) with no
// interaction, and confirms the is_online CHECK holds and a UNRESPONSIVE event is
// recorded.
func TestSweepUnresponsiveRiders(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	o1, offers := seedFixture(t, pool, 1)
	o2, _ := seedFixture(t, pool, 1)
	o3, _ := seedFixture(t, pool, 1)
	rider := offers[0].riderAccountID

	if _, err := pool.Exec(ctx, `UPDATE rider_profile SET availability_state='ONLINE_IDLE', is_online=true WHERE account_id=$1`, rider); err != nil {
		t.Fatalf("set online: %v", err)
	}
	// The rider's three most-recent resolved offers are all EXPIRED.
	if _, err := pool.Exec(ctx, `UPDATE dispatch_offer SET state='EXPIRED', outcome='EXPIRED', outcome_at=now()-interval '90 s' WHERE order_id=$1 AND rider_account_id=$2`, o1, rider); err != nil {
		t.Fatal(err)
	}
	addResolvedOffer(t, pool, o2, rider, "EXPIRED", time.Now().Add(-60*time.Second))
	addResolvedOffer(t, pool, o3, rider, "EXPIRED", time.Now().Add(-30*time.Second))

	n, err := store.SweepUnresponsiveRiders(ctx)
	if err != nil {
		t.Fatalf("SweepUnresponsiveRiders: %v", err)
	}
	if n < 1 {
		t.Fatalf("offlined %d riders, want >= 1", n)
	}
	var st string
	var online bool
	if err := pool.QueryRow(ctx, `SELECT availability_state::text, is_online FROM rider_profile WHERE account_id=$1`, rider).Scan(&st, &online); err != nil {
		t.Fatal(err)
	}
	if st != "OFFLINE" || online {
		t.Fatalf("rider state=%s online=%v, want OFFLINE/false", st, online)
	}
	var ev int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM rider_availability_event WHERE account_id=$1 AND reason='UNRESPONSIVE'`, rider).Scan(&ev); err != nil {
		t.Fatal(err)
	}
	if ev < 1 {
		t.Fatal("no UNRESPONSIVE availability event recorded")
	}
}

// TestUnresponsive_RejectionBreaksStreak confirms an explicit rejection resets the
// streak: a rider whose most recent resolved offer is REJECTED is NOT offlined even
// with older expiries (spec 04-rider: "explicit rejections do not count").
func TestUnresponsive_RejectionBreaksStreak(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	o1, offers := seedFixture(t, pool, 1)
	o2, _ := seedFixture(t, pool, 1)
	o3, _ := seedFixture(t, pool, 1)
	rider := offers[0].riderAccountID

	if _, err := pool.Exec(ctx, `UPDATE rider_profile SET availability_state='ONLINE_IDLE', is_online=true WHERE account_id=$1`, rider); err != nil {
		t.Fatal(err)
	}
	// Oldest→newest: EXPIRED, EXPIRED, then a REJECTION as the most recent.
	if _, err := pool.Exec(ctx, `UPDATE dispatch_offer SET state='EXPIRED', outcome='EXPIRED', outcome_at=now()-interval '90 s' WHERE order_id=$1 AND rider_account_id=$2`, o1, rider); err != nil {
		t.Fatal(err)
	}
	addResolvedOffer(t, pool, o2, rider, "EXPIRED", time.Now().Add(-60*time.Second))
	addResolvedOffer(t, pool, o3, rider, "REJECTED", time.Now().Add(-10*time.Second))

	if _, err := store.SweepUnresponsiveRiders(ctx); err != nil {
		t.Fatalf("SweepUnresponsiveRiders: %v", err)
	}
	var st string
	if err := pool.QueryRow(ctx, `SELECT availability_state::text FROM rider_profile WHERE account_id=$1`, rider).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "ONLINE_IDLE" {
		t.Fatalf("rider state=%s, want ONLINE_IDLE (rejection must break the streak)", st)
	}
}
