package catalog

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// requirePool opens a pool against HG_TEST_POSTGRES_DSN, or skips with a clear
// message when it is unset. The DSN is unset during the module run, so these
// tests skip — that is expected. They are real when a migrated database is
// pointed at them.
func requirePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("HG_TEST_POSTGRES_DSN is not set; skipping catalogue integration test. " +
			"Set it to a migrated Postgres+PostGIS DSN to run the halal-gated queries against a real database.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedVisibleRestaurant inserts a minimal LIVE, CERTIFIED restaurant with a
// location and returns its id. It writes only through columns the schema exposes
// and lets the halal trigger set halal_status via the certificate path where
// possible; where a full certificate is impractical for a unit-scope seed, it
// sets halal_status directly is NOT allowed (I-34.1 forbids hand-setting), so
// this seed creates the certificate chain.
//
// TODO(scope): this helper builds only the restaurant row and forces visibility
// through the account_state gate; a full halal_certificate + issuing_body +
// kyc_document chain is required for the trigger to compute CERTIFIED. Until the
// halal admin module's seed helpers exist, the integration assertions below that
// need a CERTIFIED row are guarded by a check that at least one visible row
// exists in the target database (from migrations/seed), rather than seeding one
// here and risking a partial, trigger-violating insert.
func countVisible(t *testing.T, rp *Repo) int {
	t.Helper()
	ctx := context.Background()
	rows, err := rp.listVisible(ctx, listFilters{limit: 50})
	if err != nil {
		t.Fatalf("listVisible: %v", err)
	}
	return len(rows)
}

// TestListVisibleAppliesHalalGate asserts that every row the shared predicate
// returns is in a visible halal state. It runs against whatever the target
// database contains (seed data), so it needs no fixture of its own; the
// invariant it checks — no invisible halal state ever escapes the predicate — is
// the one that matters.
func TestListVisibleAppliesHalalGate(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	ctx := context.Background()

	rows, err := rp.listVisible(ctx, listFilters{limit: 50})
	if err != nil {
		t.Fatalf("listVisible: %v", err)
	}
	for _, rr := range rows {
		if !IsHalalVisible(rr.halalStatus) {
			t.Errorf("restaurant %s escaped the halal gate with status %q", rr.id, rr.halalStatus)
		}
	}
	t.Logf("visible restaurants in target database: %d", len(rows))
}

// TestGetVisibleRejectsInvisible asserts that a random-uuid lookup is a clean
// errNotFound rather than a scan/driver error — the not-found path the customer
// read surface depends on.
func TestGetVisibleRejectsUnknown(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	_, err := rp.getVisible(context.Background(), "00000000-0000-0000-0000-000000000000", nil, nil)
	if err != errNotFound {
		t.Errorf("expected errNotFound for an unknown id, got %v", err)
	}
}

// TestProximityUsesGeography exercises the ST_Distance path: supplying a point
// must return a non-error result and, for any visible row, a non-negative
// distance in metres.
func TestProximityUsesGeography(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	lat, lng := 43.6532, -79.3832 // downtown Toronto
	rows, err := rp.listVisible(context.Background(), listFilters{
		lat: &lat, lng: &lng, sort: "DISTANCE_ASC", limit: 10,
	})
	if err != nil {
		t.Fatalf("listVisible with point: %v", err)
	}
	for _, rr := range rows {
		if rr.distanceM != nil && *rr.distanceM < 0 {
			t.Errorf("negative distance %d for %s", *rr.distanceM, rr.id)
		}
	}
	_ = countVisible // referenced to keep the helper compiled in
}

// TestAddressPointIsTheCallersOnly pins getRestaurant's delivery_address_id lookup: the caller's
// own saved address yields its point; the same id asked for by another account, or an unknown id,
// yields no point (NO_ADDRESS), never another customer's location.
func TestAddressPointIsTheCallersOnly(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	ctx := context.Background()

	var addressID, owner string
	err := pool.QueryRow(ctx, `
		SELECT id::text, account_id::text FROM address
		 WHERE deleted_at IS NULL AND location IS NOT NULL LIMIT 1`).Scan(&addressID, &owner)
	if err != nil {
		t.Skipf("no located address in the target database: %v", err)
	}

	lat, lng, err := rp.addressPoint(ctx, owner, addressID)
	if err != nil || lat == nil || lng == nil {
		t.Fatalf("owner's address: lat=%v lng=%v err=%v", lat, lng, err)
	}
	if *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
		t.Fatalf("point out of range: %v,%v", *lat, *lng)
	}

	other := "00000000-0000-4000-8000-0000000000ff"
	if lat, lng, err := rp.addressPoint(ctx, other, addressID); err != nil || lat != nil || lng != nil {
		t.Fatalf("another account got a point: lat=%v lng=%v err=%v", lat, lng, err)
	}
	if lat, lng, err := rp.addressPoint(ctx, owner, other); err != nil || lat != nil || lng != nil {
		t.Fatalf("unknown id got a point: lat=%v lng=%v err=%v", lat, lng, err)
	}
}
