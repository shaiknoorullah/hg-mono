package dispatch

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
)

// dsn returns the integration DSN, or skips with a clear message when unset.
func dsn(t *testing.T) string {
	t.Helper()
	v := os.Getenv("HG_TEST_POSTGRES_DSN")
	if v == "" {
		t.Skip("HG_TEST_POSTGRES_DSN is not set; skipping the dispatch integration test that needs real Postgres+PostGIS")
	}
	return v
}

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn(t))
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seedFixture creates a restaurant, an order in READY_FOR_PICKUP, a dispatch row
// in SEARCHING, and n online riders each holding a PENDING offer for that order.
// It returns the order id and the (riderAccountID, offerID) pairs. Everything is
// created under a t.Cleanup that deletes it again.
type seededOffer struct {
	riderAccountID string
	offerID        string
}

// e164SQL is a SQL expression that yields a random, unique-enough phone number
// in E.164 form ('+1' followed by 9 digits), satisfying both the
// account_has_identifier and account_phone_e164_shape constraints. It is
// embedded directly in the INSERT so each seeded account gets a valid
// identifier without touching the race-free accept logic under test.
// testPickupCode is the pickup code seedFixture stores on its order: the code
// the kitchen would read to the rider.
const testPickupCode = "3051"

// pickupCodeFor returns the code the rider types for a step: the seeded pickup
// code for PICKED_UP, nothing for every other step.
func pickupCodeFor(step string) *string {
	if step != "PICKED_UP" {
		return nil
	}
	c := testPickupCode
	return &c
}

const e164SQL = `'+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0')`

func seedFixture(t *testing.T, pool *pgxpool.Pool, n int) (orderID string, offers []seededOffer) {
	t.Helper()
	ctx := context.Background()
	expires := time.Now().UTC().Add(30 * time.Second)

	// A minimal quote is required by the order FK/trigger (total must match).
	var restaurantID, quoteID, custAccount string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &custAccount)
	mustQuery(t, pool, `
INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), 'it-'||substr(md5(random()::text),1,10), 'IT Co', 'IT Kitchen',
        '1 Main St', 'Toronto', 'ON', 'M4J1M4',
        ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 'America/Toronto')
RETURNING id`, &restaurantID)

	// The order FK chain requires an address, a cart and a quote; the quote
	// requires a seeded pricing_config and tax_jurisdiction. We reference whichever
	// seed rows exist, failing loudly if the DB was not seeded.
	var addressID, cartID, pricingConfigID, taxJurisdiction string
	mustQuery(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustQuery(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), $1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
        ST_SetSRID(ST_MakePoint(-79.381, 43.6412),4326)::geography, 'America/Toronto')
RETURNING id`, &addressID, custAccount)
	mustQuery(t, pool, `
INSERT INTO cart (id, account_id, restaurant_id, delivery_address_id, fulfilment)
VALUES (uuid_generate_v7(), $1, $2, $3, 'DELIVERY') RETURNING id`, &cartID, custAccount, restaurantID, addressID)
	mustQuery(t, pool, `
INSERT INTO quote (id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
                   pricing_config_id, tax_jurisdiction_code,
                   subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
                   input_hash, state_hash, created_at, expires_at)
VALUES (uuid_generate_v7(), $1, $2, $3, $4, 'DELIVERY', 'CAD', $5, $6,
        1000, 449, 0, 1449,
        sha256('it'::bytea), sha256('it'::bytea), now(), now()+interval '1 hour')
RETURNING id`, &quoteID, custAccount, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)

	mustQuery(t, pool, `
INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
                     deadline_at, deadline_action,
                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
VALUES (uuid_generate_v7(), 'IT-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
        now()+interval '15 min', 'PICKUP_OVERDUE', 1000, 449, 0, 1449)
RETURNING id`, &orderID, quoteID, custAccount, restaurantID, addressID)
	// The order was inserted straight into READY_FOR_PICKUP, past the
	// acceptance that mints the pickup code, so store a known one for the rider
	// to type (testPickupCode).
	if err := handover.SetCodeTx(ctx, pool, orderID, handover.Pickup, testPickupCode); err != nil {
		t.Fatalf("seed pickup code: %v", err)
	}

	mustExec(t, pool, `
INSERT INTO dispatch (order_id, state, deadline_at, deadline_action)
VALUES ($1, 'SEARCHING', now()+interval '20 s', 'NEXT_WAVE')`, orderID)

	var waveID string
	mustQuery(t, pool, `
INSERT INTO dispatch_wave (order_id, wave_no, radius_m, expires_at)
VALUES ($1, 1, 3000, $2) RETURNING id`, &waveID, orderID, expires)

	for i := 0; i < n; i++ {
		var acct, offerID string
		mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &acct)
		mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, availability_state, is_online, approved_at)
VALUES ($1, 'R', 'R', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, acct)
		mustExec(t, pool, `
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 10, now(), now())`, acct)
		mustQuery(t, pool, `
INSERT INTO dispatch_offer (order_id, dispatch_wave_id, rider_account_id, wave, distance_m,
                            earnings_cents, tip_estimate_cents, state, expires_at)
VALUES ($1, $2, $3, 1, 100, 449, 0, 'PENDING', $4) RETURNING id`, &offerID, orderID, waveID, acct, expires)
		offers = append(offers, seededOffer{riderAccountID: acct, offerID: offerID})
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM assignment WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_offer WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_wave WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch WHERE order_id=$1`, orderID)
		for _, o := range offers {
			_, _ = pool.Exec(ctx, `DELETE FROM rider_availability_event WHERE account_id=$1`, o.riderAccountID)
			_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, o.riderAccountID)
			_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, o.riderAccountID)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, custAccount)
		for _, o := range offers {
			_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, o.riderAccountID)
		}
	})
	return orderID, offers
}

func mustExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec failed: %v\nSQL: %s", err, sql)
	}
}

func mustQuery(t *testing.T, pool *pgxpool.Pool, sql string, dst any, args ...any) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(dst); err != nil {
		t.Fatalf("query failed: %v\nSQL: %s", err, sql)
	}
}

// TestAcceptIsRaceFree is the load-bearing invariant of D-16: N riders holding
// PENDING offers for one order all POST accept concurrently; exactly one wins,
// the order ends up with exactly one rider, and the winner is ON_DELIVERY.
func TestAcceptIsRaceFree(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	orderID, offers := seedFixture(t, pool, 3)

	var wg sync.WaitGroup
	results := make([]error, len(offers))
	assignments := make([]string, len(offers))
	start := make(chan struct{})
	for i, o := range offers {
		wg.Add(1)
		go func(i int, o seededOffer) {
			defer wg.Done()
			<-start
			id, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC())
			results[i] = err
			assignments[i] = id
		}(i, o)
	}
	close(start)
	wg.Wait()

	winners := 0
	for i, err := range results {
		if err == nil {
			winners++
			if assignments[i] == "" {
				t.Errorf("winner %d returned an empty assignment id", i)
			}
		} else if se, ok := asServiceError(err); ok {
			// A loser can lose three legitimate ways: the order was claimed
			// (OFFER_ALREADY_TAKEN), the winner's accept withdrew this sibling
			// offer first (OFFER_WITHDRAWN, store.go Step 5 / D-15), or the offer
			// lapsed (OFFER_EXPIRED). Which one is raced-timing-dependent; all are
			// correct. Only a NON-loser code (or a real winner miscount) is a bug.
			if se.Code != CodeOfferAlreadyTaken && se.Code != CodeOfferWithdrawn &&
				se.Code != CodeOfferExpired && se.Code != CodeRiderNotAvailable {
				t.Errorf("loser %d got unexpected code %s", i, se.Code)
			}
		} else {
			t.Errorf("loser %d got a non-service error: %v", i, err)
		}
	}
	if winners != 1 {
		t.Fatalf("expected exactly one winner, got %d", winners)
	}

	// The order has exactly one assigned rider on the dispatch row.
	var riders int
	mustQuery(t, pool, `SELECT count(*) FROM dispatch WHERE order_id=$1 AND rider_account_id IS NOT NULL`, &riders, orderID)
	if riders != 1 {
		t.Fatalf("expected exactly one assigned rider on the dispatch row, got %d", riders)
	}
	// Exactly one live assignment.
	var asn int
	mustQuery(t, pool, `SELECT count(*) FROM assignment WHERE order_id=$1 AND terminated_at IS NULL`, &asn, orderID)
	if asn != 1 {
		t.Fatalf("expected exactly one live assignment, got %d", asn)
	}
	// Every losing offer is WITHDRAWN or REJECTED/EXPIRED; the winner is ACCEPTED.
	var accepted, pending int
	mustQuery(t, pool, `SELECT count(*) FROM dispatch_offer WHERE order_id=$1 AND state='ACCEPTED'`, &accepted, orderID)
	mustQuery(t, pool, `SELECT count(*) FROM dispatch_offer WHERE order_id=$1 AND state='PENDING'`, &pending, orderID)
	if accepted != 1 {
		t.Errorf("expected 1 ACCEPTED offer, got %d", accepted)
	}
	if pending != 0 {
		t.Errorf("expected 0 PENDING offers after accept, got %d", pending)
	}
}

// TestAcceptSetsOnDelivery verifies the accept transaction flips the winner's
// availability to ON_DELIVERY in the same transaction (D-16 AC-2).
func TestAcceptSetsOnDelivery(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	_, offers := seedFixture(t, pool, 1)
	o := offers[0]
	if _, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC()); err != nil {
		t.Fatalf("accept failed: %v", err)
	}
	var state string
	mustQuery(t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id=$1`, &state, o.riderAccountID)
	if state != "ON_DELIVERY" {
		t.Fatalf("winner availability = %s, want ON_DELIVERY", state)
	}
}

// TestReconcileRestoresStuckRider verifies the 60 s backstop: a rider stuck in
// ON_DELIVERY with no live assignment is restored (D-10 AC-4).
func TestReconcileRestoresStuckRider(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()

	var acct string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &acct)
	mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, availability_state, is_online, approved_at)
VALUES ($1, 'R', 'R', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ON_DELIVERY', true, now())`, acct)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM rider_availability_event WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acct)
	})

	if _, err := store.ReconcileAvailability(ctx); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	var state string
	mustQuery(t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id=$1`, &state, acct)
	if state != "ONLINE_IDLE" {
		t.Fatalf("stuck rider availability = %s, want ONLINE_IDLE after reconcile", state)
	}
}
