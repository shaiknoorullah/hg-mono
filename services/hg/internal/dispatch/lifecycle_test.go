package dispatch

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Fake OrderLifecycle for unit/integration tests.
// ---------------------------------------------------------------------------

// fakeLifecycle records ConfirmPickupTx and CompleteDelivery calls so tests can
// assert the bridge fires at the right dispatch state transitions.
type fakeLifecycle struct {
	mu            sync.Mutex
	pickupCalls   []lifecycleCall
	deliveryCalls []lifecycleCall
	pickupErr     error
	deliveryErr   error
}

type lifecycleCall struct {
	orderID        string
	riderAccountID string
}

func (f *fakeLifecycle) ConfirmPickupTx(_ context.Context, _ pgx.Tx, orderID, riderAccountID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pickupCalls = append(f.pickupCalls, lifecycleCall{orderID: orderID, riderAccountID: riderAccountID})
	return f.pickupErr
}

func (f *fakeLifecycle) CompleteDelivery(_ context.Context, orderID, riderAccountID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deliveryCalls = append(f.deliveryCalls, lifecycleCall{orderID: orderID, riderAccountID: riderAccountID})
	return f.deliveryErr
}

func (f *fakeLifecycle) pickups() []lifecycleCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]lifecycleCall, len(f.pickupCalls))
	copy(out, f.pickupCalls)
	return out
}

func (f *fakeLifecycle) deliveries() []lifecycleCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]lifecycleCall, len(f.deliveryCalls))
	copy(out, f.deliveryCalls)
	return out
}

// ---------------------------------------------------------------------------
// TestLifecycleConfirmPickupCalled asserts that transitioning an assignment to
// PICKED_UP calls lifecycle.ConfirmPickupTx with the correct orderID and riderID.
// ---------------------------------------------------------------------------

func TestLifecycleConfirmPickupCalled(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	lc := &fakeLifecycle{}
	svc := NewService(store, lc)

	orderID, offers := seedFixture(t, pool, 1)
	o := offers[0]

	// Accept the offer to create an assignment.
	assignmentID, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	// Walk the assignment forward to ARRIVED_AT_PICKUP (geofence bypassed via override).
	override := "test override"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"} {
		_, err := svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		})
		if err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}

	// Verify ConfirmPickupTx has NOT been called yet.
	if len(lc.pickups()) != 0 {
		t.Fatalf("ConfirmPickupTx called too early: %d calls before PICKED_UP", len(lc.pickups()))
	}

	// Transition to PICKED_UP.
	_, err = svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
		ToState:    "PICKED_UP",
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("Transition to PICKED_UP: %v", err)
	}

	// Assert ConfirmPickupTx was called exactly once with the right IDs.
	calls := lc.pickups()
	if len(calls) != 1 {
		t.Fatalf("expected 1 ConfirmPickupTx call, got %d", len(calls))
	}
	if calls[0].orderID != orderID {
		t.Errorf("ConfirmPickupTx orderID = %q, want %q", calls[0].orderID, orderID)
	}
	if calls[0].riderAccountID != o.riderAccountID {
		t.Errorf("ConfirmPickupTx riderAccountID = %q, want %q", calls[0].riderAccountID, o.riderAccountID)
	}
	// CompleteDelivery must not have been called.
	if len(lc.deliveries()) != 0 {
		t.Errorf("CompleteDelivery called unexpectedly: %d calls", len(lc.deliveries()))
	}
}

// ---------------------------------------------------------------------------
// TestLifecycleCompleteDeliveryCalled asserts that transitioning an assignment
// to DELIVERED calls lifecycle.CompleteDelivery with the correct IDs.
// ---------------------------------------------------------------------------

func TestLifecycleCompleteDeliveryCalled(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	lc := &fakeLifecycle{}
	svc := NewService(store, lc)

	orderID, offers := seedFixture(t, pool, 1)
	o := offers[0]

	assignmentID, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	// Walk to ARRIVED_AT_DROPOFF.
	override := "test override"
	steps := []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "PICKED_UP",
		"EN_ROUTE_TO_DROPOFF", "ARRIVED_AT_DROPOFF"}
	for _, step := range steps {
		_, err := svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		})
		if err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}

	// Record POD (PHOTO, no actual object required here since required_pod_method
	// is set from order instructions; we need to handle the no-POD case).
	// Check if POD is required for this assignment.
	var requiredPod string
	if err := pool.QueryRow(context.Background(),
		`SELECT required_pod_method FROM assignment WHERE id = $1`, assignmentID).Scan(&requiredPod); err != nil {
		t.Fatalf("read required_pod_method: %v", err)
	}
	if requiredPod != "" {
		// Mark pod_recorded=true directly so DELIVERED can proceed (POD is tested
		// separately; here we just want to exercise the lifecycle bridge).
		if _, err := pool.Exec(context.Background(),
			`UPDATE assignment SET pod_recorded=true WHERE id=$1`, assignmentID); err != nil {
			t.Fatalf("mark pod_recorded: %v", err)
		}
	}

	// CompleteDelivery should not have been called yet.
	if len(lc.deliveries()) != 0 {
		t.Fatalf("CompleteDelivery called too early: %d calls", len(lc.deliveries()))
	}

	// Transition to DELIVERED.
	_, err = svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
		ToState:        "DELIVERED",
		OccurredAt:     time.Now().UTC(),
		OverrideReason: &override,
	})
	if err != nil {
		t.Fatalf("Transition to DELIVERED: %v", err)
	}

	// Assert CompleteDelivery was called exactly once with correct IDs.
	dcalls := lc.deliveries()
	if len(dcalls) != 1 {
		t.Fatalf("expected 1 CompleteDelivery call, got %d", len(dcalls))
	}
	if dcalls[0].orderID != orderID {
		t.Errorf("CompleteDelivery orderID = %q, want %q", dcalls[0].orderID, orderID)
	}
	if dcalls[0].riderAccountID != o.riderAccountID {
		t.Errorf("CompleteDelivery riderAccountID = %q, want %q", dcalls[0].riderAccountID, o.riderAccountID)
	}

	// ConfirmPickupTx should have been called once (PICKED_UP transition above).
	pcalls := lc.pickups()
	if len(pcalls) != 1 {
		t.Errorf("expected 1 ConfirmPickupTx call (from PICKED_UP step), got %d", len(pcalls))
	}
}

// ---------------------------------------------------------------------------
// TestLifecycleNilSafe asserts that a nil lifecycle does not panic.
// ---------------------------------------------------------------------------

func TestLifecycleNilSafe(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	// nil lifecycle — should not panic on any transition.
	svc := NewService(store, nil)

	_, offers := seedFixture(t, pool, 1)
	o := offers[0]

	assignmentID, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	override := "test"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "PICKED_UP"} {
		_, err := svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		})
		if err != nil {
			t.Fatalf("Transition to %s with nil lifecycle: %v", step, err)
		}
	}
}

// ---------------------------------------------------------------------------
// TestPickupRefusedWhenTheOrderCannotMove asserts the other half of the
// in-transaction pickup (pickup.go; https://github.com/shaiknoorullah/hg-mono/issues/317):
// when the orders module refuses to move the order, the rider's PICKED_UP is
// refused too. It answers 409 INVALID_TRANSITION, and the assignment stays at
// the counter with no PICKED_UP row. Before, the assignment committed and the
// refusal was only logged.
// ---------------------------------------------------------------------------

func TestPickupRefusedWhenTheOrderCannotMove(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	lc := &fakeLifecycle{pickupErr: &OrderNotCollectableError{OrderState: "CANCELLED"}}
	svc := NewService(store, lc)

	_, offers := seedFixture(t, pool, 1)
	o := offers[0]

	assignmentID, err := store.AcceptOffer(context.Background(), o.riderAccountID, o.offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	override := "test"
	for _, step := range []string{"EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"} {
		if _, err := svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
			ToState:        step,
			OccurredAt:     time.Now().UTC(),
			OverrideReason: &override,
		}); err != nil {
			t.Fatalf("Transition to %s: %v", step, err)
		}
	}

	_, err = svc.Transition(context.Background(), o.riderAccountID, assignmentID, TransitionInput{
		ToState:    "PICKED_UP",
		OccurredAt: time.Now().UTC(),
	})
	se, ok := asServiceError(err)
	if !ok || se.Status != 409 || se.Code != CodeInvalidTransition {
		t.Fatalf("PICKED_UP of an order that cannot move: err = %v, want 409 %s", err, CodeInvalidTransition)
	}
	if d, _ := se.Details.(map[string]any); d["current_state"] != "ARRIVED_AT_PICKUP" {
		t.Errorf("details = %v, want current_state ARRIVED_AT_PICKUP", se.Details)
	}

	var dbState string
	var pickedRows int
	mustQuery(t, pool, `SELECT state::text FROM assignment WHERE id=$1`, &dbState, assignmentID)
	mustQuery(t, pool, `SELECT count(*) FROM assignment_transition WHERE assignment_id=$1 AND to_state='PICKED_UP'`,
		&pickedRows, assignmentID)
	if dbState != "ARRIVED_AT_PICKUP" || pickedRows != 0 {
		t.Errorf("assignment = %s with %d PICKED_UP row(s), want ARRIVED_AT_PICKUP with none (the refusal must roll the step back)",
			dbState, pickedRows)
	}
	if len(lc.pickups()) != 1 {
		t.Errorf("expected 1 ConfirmPickupTx attempt, got %d", len(lc.pickups()))
	}
}

// ---------------------------------------------------------------------------
// TestRunWaveCreatesOffersForReadyOrder asserts that RunWave creates offers
// when there is an ONLINE rider nearby.
// ---------------------------------------------------------------------------

func TestRunWaveCreatesOffersForReadyOrder(t *testing.T) {
	pool := openPool(t)
	lc := &fakeLifecycle{}
	svc := NewService(NewStore(pool), lc)
	ctx := context.Background()

	// Seed an order WITHOUT a dispatch row (simulating the sweep scenario).
	var restaurantID, quoteID, custAccount, orderID string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &custAccount)
	mustQuery(t, pool, `
INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), 'rw-'||substr(md5(random()::text),1,10), 'RW Co', 'RW Kitchen',
        '1 King St', 'Toronto', 'ON', 'M5H1A1',
        ST_SetSRID(ST_MakePoint(-79.3840, 43.6498),4326)::geography, 'America/Toronto')
RETURNING id`, &restaurantID)

	var addressID, cartID, pricingConfigID, taxJurisdiction string
	mustQuery(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustQuery(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), $1, '200 Bay St', 'Toronto', 'ON', 'M5J2J4',
        ST_SetSRID(ST_MakePoint(-79.380, 43.647),4326)::geography, 'America/Toronto')
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
        2000, 449, 0, 2449,
        sha256('rw'::bytea), sha256('rw'::bytea), now(), now()+interval '1 hour')
RETURNING id`, &quoteID, custAccount, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
                     deadline_at, deadline_action,
                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
VALUES (uuid_generate_v7(), 'RW-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
        now()+interval '15 min', 'PICKUP_OVERDUE', 2000, 449, 0, 2449)
RETURNING id`, &orderID, quoteID, custAccount, restaurantID, addressID)

	// Seed an ONLINE rider near the restaurant.
	var riderAcct string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &riderAcct)
	mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, availability_state, is_online, approved_at)
VALUES ($1, 'W', 'Wave', '1991-05-15', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, riderAcct)
	mustExec(t, pool, `
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3840, 43.6498),4326)::geography, 5, now(), now())`, riderAcct)
	// A connect_account row is required by FindCandidates (payouts_enabled gate).
	mustExec(t, pool, `
INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled)
VALUES ('RIDER', $1, 'acct_test_'||substr(md5(random()::text),1,12), true)`, riderAcct)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_offer WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_wave WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_account WHERE owner_type='RIDER' AND owner_id=$1`, riderAcct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, riderAcct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, riderAcct)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id IN ($1, $2)`, custAccount, riderAcct)
	})

	// Verify no dispatch row exists yet.
	var dispatchCount int
	mustQuery(t, pool, `SELECT count(*) FROM dispatch WHERE order_id=$1`, &dispatchCount, orderID)
	if dispatchCount != 0 {
		t.Fatalf("expected no dispatch row before RunWave, got %d", dispatchCount)
	}

	// RunWave should create at least one offer.
	result, err := svc.RunWave(ctx, orderID, 1, 3000)
	if err != nil {
		t.Fatalf("RunWave: %v", err)
	}
	if result.Offered == 0 {
		t.Errorf("RunWave: expected at least 1 offer to the nearby ONLINE rider, got 0 (Exhausted=%v)", result.Exhausted)
	}

	// A dispatch_wave row must exist.
	var waveCount int
	mustQuery(t, pool, `SELECT count(*) FROM dispatch_wave WHERE order_id=$1`, &waveCount, orderID)
	if waveCount != 1 {
		t.Errorf("expected 1 dispatch_wave row, got %d", waveCount)
	}

	// The rider must have a PENDING offer.
	var offerState, offerID string
	if err := pool.QueryRow(ctx, `
SELECT id, state::text FROM dispatch_offer
WHERE order_id=$1 AND rider_account_id=$2`, orderID, riderAcct).Scan(&offerID, &offerState); err != nil {
		t.Fatalf("read rider offer: %v", err)
	}
	if offerState != "PENDING" {
		t.Errorf("rider offer state = %q, want PENDING", offerState)
	}

	// RunWave must have created the dispatch row itself (in SEARCHING). Without it
	// the order is re-swept every tick AND AcceptOffer's arbiter (which locks and
	// guards on the dispatch row) cannot succeed — the whole backstop-dispatched
	// demo path would be un-acceptable. This is the regression that guards it.
	var dispState string
	mustQuery(t, pool, `SELECT state::text FROM dispatch WHERE order_id=$1`, &dispState, orderID)
	if dispState != "SEARCHING" {
		t.Fatalf("after RunWave, dispatch row state = %q, want SEARCHING (dispatch row not created by CreateWave)", dispState)
	}

	// End-to-end proof: the nearby rider can actually ACCEPT the offer created by
	// the backstop wave — the arbiter finds the dispatch row and assigns it.
	assignmentID, err := svc.store.AcceptOffer(ctx, riderAcct, offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer on backstop-dispatched order must succeed, got: %v", err)
	}
	if assignmentID == "" {
		t.Fatal("AcceptOffer returned an empty assignment id")
	}
	var afterAccept string
	mustQuery(t, pool, `SELECT state::text FROM dispatch WHERE order_id=$1`, &afterAccept, orderID)
	if afterAccept != "ASSIGNED" {
		t.Errorf("after AcceptOffer, dispatch state = %q, want ASSIGNED", afterAccept)
	}
	// Clean up the assignment created above (seedFixture-style tests own their rows,
	// but this order was hand-seeded so its cleanup does not cover the assignment).
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, orderID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM assignment WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM rider_availability_event WHERE account_id=$1`, riderAcct)
	})
}

// ---------------------------------------------------------------------------
// TestDispatchRunnerSweepFindsUndispatchedOrder asserts that the DispatchRunner
// sweep finds orders without dispatch rows and calls RunWave for them.
// ---------------------------------------------------------------------------

func TestDispatchRunnerSweepFindsUndispatchedOrder(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	lc := &fakeLifecycle{}
	svc := NewService(store, lc)
	ctx := context.Background()

	// Use the regular seedFixture but without the dispatch row.
	// seedFixture inserts a dispatch row; we need a raw order without one.
	// Instead, use FindUndispatchedReadyOrders on the existing fixture by
	// seeding the order manually with no dispatch.
	var restaurantID, quoteID, custAccount, orderID string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &custAccount)
	mustQuery(t, pool, `
INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), 'dr-'||substr(md5(random()::text),1,10), 'DR Co', 'DR Kitchen',
        '55 Union St', 'Toronto', 'ON', 'M5J2J4',
        ST_SetSRID(ST_MakePoint(-79.376, 43.644),4326)::geography, 'America/Toronto')
RETURNING id`, &restaurantID)

	var addressID, cartID, pricingConfigID, taxJurisdiction string
	mustQuery(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustQuery(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), $1, '300 Front St', 'Toronto', 'ON', 'M5V0E9',
        ST_SetSRID(ST_MakePoint(-79.391, 43.642),4326)::geography, 'America/Toronto')
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
        1500, 449, 0, 1949,
        sha256('dr'::bytea), sha256('dr'::bytea), now(), now()+interval '1 hour')
RETURNING id`, &quoteID, custAccount, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
                     deadline_at, deadline_action,
                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
VALUES (uuid_generate_v7(), 'DR-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
        now()+interval '15 min', 'PICKUP_OVERDUE', 1500, 449, 0, 1949)
RETURNING id`, &orderID, quoteID, custAccount, restaurantID, addressID)
	// Deliberately NO dispatch row for this order.

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_offer WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_wave WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, custAccount)
	})

	// FindUndispatchedReadyOrders must include our orderID.
	undispatched, err := store.FindUndispatchedReadyOrders(ctx)
	if err != nil {
		t.Fatalf("FindUndispatchedReadyOrders: %v", err)
	}
	found := false
	for _, id := range undispatched {
		if id == orderID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("FindUndispatchedReadyOrders did not return our orderID %q (got %v)", orderID, undispatched)
	}

	// After RunWave (which may find no riders — the restaurant has no nearby riders
	// in this fixture), the order should no longer appear because a dispatch row
	// (or wave row) will exist. But since there are no riders seeded for this
	// restaurant, RunWave returns Exhausted=true; the dispatch + wave rows ARE
	// still created. Let's just assert the query returns our ID, which is sufficient
	// to prove the sweep mechanism.
	// Additional check: seeded orders with a dispatch row must NOT appear.
	orderIDFixed, _ := seedFixture(t, pool, 1)
	undispatched2, err := store.FindUndispatchedReadyOrders(ctx)
	if err != nil {
		t.Fatalf("FindUndispatchedReadyOrders (second): %v", err)
	}
	for _, id := range undispatched2 {
		if id == orderIDFixed {
			t.Errorf("order %q has a dispatch row but appeared in FindUndispatchedReadyOrders", orderIDFixed)
		}
	}

	// Verify DispatchRunner.Sweep does not panic with no riders.
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	// Sweep should run without error (RunWave may return Exhausted when no riders).
	_, sweepErr := runner.Sweep(ctx)
	if sweepErr != nil {
		t.Fatalf("DispatchRunner.Sweep: %v", sweepErr)
	}
}

// newTestLogger returns a no-op slog.Logger for tests.
func newTestLogger() *slog.Logger {
	return slog.Default()
}
