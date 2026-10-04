package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The tests in this file pin https://github.com/shaiknoorullah/hg-mono/issues/294:
// a ready order nobody near can take still gets its dispatch row, widens
// 3 → 6 → 10 km, finds a rider who comes online meanwhile, and otherwise ends in
// NO_RIDER_FOUND within the wave budget, once, however many replicas run the
// dispatch runner.
//
// They run the runner on a clock in 2001, with each order far from any city.
// The runner's queries are fleet-wide (every due search, every lapsed offer),
// so the old clock keeps them to this file's rows: nothing else in a shared
// test database is due in 2001, and nothing else is offered these orders.

// testClock is a settable clock shared by the services standing in for replicas.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func newTestClock() *testClock {
	base := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	return &testClock{t: base.Add(time.Duration(rand.Int63n(300*24*3600)) * time.Second)}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// untilNextWave is how far a test moves the clock to make an empty wave due.
const untilNextWave = emptyWaveHold + interWaveGap + time.Millisecond

// remoteOrder is a READY_FOR_PICKUP order with no dispatch row yet, at a
// restaurant somewhere in the far north where no rider is.
type remoteOrder struct {
	id       string
	lng, lat float64
}

func seedRemoteReadyOrder(t *testing.T, pool *pgxpool.Pool) remoteOrder {
	t.Helper()
	ctx := context.Background()
	o := remoteOrder{lng: -110 + rand.Float64()*20, lat: 60 + rand.Float64()*8}

	var restaurantID, quoteID, custAccount, addressID, cartID, pricingConfigID, taxJurisdiction string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &custAccount)
	mustQuery(t, pool, `
INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), 'nr-'||substr(md5(random()::text),1,10), 'NR Co', 'NR Kitchen',
        '1 North Rd', 'Toronto', 'ON', 'M4J1M4',
        ST_SetSRID(ST_MakePoint($1, $2),4326)::geography, 'America/Toronto')
RETURNING id`, &restaurantID, o.lng, o.lat)
	mustQuery(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustQuery(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
VALUES (uuid_generate_v7(), $1, '2 North Rd', 'Toronto', 'ON', 'M5J0C3',
        ST_SetSRID(ST_MakePoint($2, $3),4326)::geography, 'America/Toronto')
RETURNING id`, &addressID, custAccount, o.lng+0.01, o.lat+0.01)
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
        sha256('nr'::bytea), sha256('nr'::bytea), now(), now()+interval '1 hour')
RETURNING id`, &quoteID, custAccount, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)
	mustQuery(t, pool, `
INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
                     deadline_at, deadline_action,
                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
VALUES (uuid_generate_v7(), 'NR-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
        now()+interval '15 min', 'PICKUP_OVERDUE', 1000, 449, 0, 1449)
RETURNING id`, &o.id, quoteID, custAccount, restaurantID, addressID)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM assignment WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_offer WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_wave WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM outbox_message WHERE realtime_event_id IN (SELECT id FROM realtime_event WHERE order_id=$1)`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM realtime_event WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM order_transition WHERE order_id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, o.id)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, custAccount)
	})
	return o
}

// seedOnlineRider puts a dispatchable rider (online, active, payouts enabled,
// fresh fix) at the given point and returns the rider's account id.
func seedOnlineRider(t *testing.T, pool *pgxpool.Pool, lng, lat float64) string {
	t.Helper()
	ctx := context.Background()
	var acct string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &acct)
	mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, availability_state, is_online, approved_at)
VALUES ($1, 'N', 'Late', '1992-02-02', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, acct)
	mustExec(t, pool, `
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3),4326)::geography, 5, now(), now())`, acct, lng, lat)
	mustExec(t, pool, `
INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled)
VALUES ('RIDER', $1, 'acct_test_'||substr(md5(random()::text),1,12), true)`, acct)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE rider_account_id=$1)`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM assignment WHERE rider_account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch_offer WHERE rider_account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `UPDATE dispatch SET rider_account_id=NULL, state='NO_RIDER_FOUND', deadline_at=NULL, deadline_action=NULL WHERE rider_account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_availability_event WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_account WHERE owner_type='RIDER' AND owner_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acct)
	})
	return acct
}

// newClockedService is a dispatch Service (one replica) on the test clock.
func newClockedService(pool *pgxpool.Pool, clk *testClock) *Service {
	svc := NewService(NewStore(pool), &fakeLifecycle{})
	svc.now = clk.Now
	return svc
}

// dispatchRow is the order's dispatch row as the tests check it.
type dispatchRow struct {
	state      string
	wave       int
	radiusM    int
	deadlineAt *time.Time
	leased     bool
}

func readDispatch(t *testing.T, pool *pgxpool.Pool, orderID string) dispatchRow {
	t.Helper()
	var d dispatchRow
	if err := pool.QueryRow(context.Background(), `
SELECT state::text, wave, radius_m, deadline_at, lease_until IS NOT NULL
  FROM dispatch WHERE order_id=$1`, orderID).Scan(&d.state, &d.wave, &d.radiusM, &d.deadlineAt, &d.leased); err != nil {
		t.Fatalf("read dispatch row: %v", err)
	}
	return d
}

// waveRadii lists the order's waves' radii in wave order.
func waveRadii(t *testing.T, pool *pgxpool.Pool, orderID string) []int {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT radius_m FROM dispatch_wave WHERE order_id=$1 ORDER BY wave_no`, orderID)
	if err != nil {
		t.Fatalf("read waves: %v", err)
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var r int
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// eventPayloads returns the payloads of the order's realtime events of one type.
func eventPayloads(t *testing.T, pool *pgxpool.Pool, orderID, eventType string) []map[string]any {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
SELECT channel, payload FROM realtime_event WHERE order_id=$1 AND type=$2 ORDER BY seq`, orderID, eventType)
	if err != nil {
		t.Fatalf("read %s events: %v", eventType, err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var channel string
		var raw []byte
		if err := rows.Scan(&channel, &raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]any
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("decode %s payload: %v", eventType, err)
		}
		p["_channel"] = channel
		out = append(out, p)
	}
	return out
}

func sameInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestNoRider_WidensToTenKmThenEndsWithinBudget: with nobody online, the first
// wave at 3 km still creates the dispatch row; the search widens to 6 km and
// then 10 km, runs its five waves, and ends in NO_RIDER_FOUND well inside the
// 300-second budget, telling the order's channel and ops once. The order is
// left READY_FOR_PICKUP on its own pickup deadline: dispatch never cancels.
func TestNoRider_WidensToTenKmThenEndsWithinBudget(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	var orderDeadline time.Time
	mustQuery(t, pool, `SELECT deadline_at FROM "order" WHERE id=$1`, &orderDeadline, o.id)

	// The sweep's first wave (DispatchRunner.Sweep runs exactly this per order).
	start := clk.Now()
	res, err := svc.RunWave(ctx, o.id, 1, 3000)
	if err != nil {
		t.Fatalf("first wave: %v", err)
	}
	if res.Offered != 0 || !res.Exhausted {
		t.Fatalf("first wave = %+v, want no offers, exhausted", res)
	}
	d := readDispatch(t, pool, o.id)
	if d.state != "SEARCHING" || d.wave != 1 || d.radiusM != 3000 {
		t.Fatalf("after an empty first wave, dispatch = %+v, want SEARCHING wave 1 at 3000 m", d)
	}
	if d.deadlineAt == nil || !d.deadlineAt.Equal(start.Add(emptyWaveHold)) {
		t.Fatalf("empty wave deadline = %v, want %v", d.deadlineAt, start.Add(emptyWaveHold))
	}

	// Each empty wave holds for emptyWaveHold, then the next one runs.
	for i := 0; i < 10 && readDispatch(t, pool, o.id).state == "SEARCHING"; i++ {
		clk.Advance(untilNextWave)
		if err := runner.EscalateAndExpire(ctx); err != nil {
			t.Fatalf("EscalateAndExpire: %v", err)
		}
	}
	elapsed := clk.Now().Sub(start)

	d = readDispatch(t, pool, o.id)
	if d.state != "NO_RIDER_FOUND" || d.deadlineAt != nil || d.leased {
		t.Fatalf("dispatch = %+v, want NO_RIDER_FOUND with no deadline and no lease", d)
	}
	if got, want := waveRadii(t, pool, o.id), []int{3000, 6000, 10000, 10000, 10000}; !sameInts(got, want) {
		t.Fatalf("wave radii = %v, want %v (3 km, then 6 km, then 10 km until the wave budget)", got, want)
	}
	if elapsed >= maxTotalSearch {
		t.Fatalf("search took %v, want under the %v budget", elapsed, maxTotalSearch)
	}

	// Ops and the order's channel are told exactly once.
	fails := eventPayloads(t, pool, o.id, "admin.dispatch_failure")
	if len(fails) != 1 {
		t.Fatalf("admin.dispatch_failure events = %d, want 1", len(fails))
	}
	f := fails[0]
	if f["_channel"] != "admin:ops" || f["order_id"] != o.id || f["waves"] != float64(maxWaves) ||
		f["radius_m"] != float64(10000) || f["riders_offered"] != float64(0) {
		t.Fatalf("admin.dispatch_failure = %v", f)
	}
	// The order's channel hears the search start (the first wave) and end,
	// once each (events.go).
	changes := eventPayloads(t, pool, o.id, "dispatch.state_changed")
	if len(changes) != 2 ||
		changes[0]["_channel"] != "order:"+o.id || changes[0]["from"] != "PENDING" || changes[0]["to"] != "SEARCHING" ||
		changes[1]["_channel"] != "order:"+o.id || changes[1]["from"] != "SEARCHING" || changes[1]["to"] != "NO_RIDER_FOUND" {
		t.Fatalf("dispatch.state_changed events = %v, want PENDING -> SEARCHING then SEARCHING -> NO_RIDER_FOUND on order:%s", changes, o.id)
	}

	// The order itself is untouched: still ready, on its own pickup deadline,
	// with no transition written by dispatch.
	var state, action string
	var deadline time.Time
	var transitions int
	mustQuery(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &state, o.id)
	mustQuery(t, pool, `SELECT deadline_action FROM "order" WHERE id=$1`, &action, o.id)
	mustQuery(t, pool, `SELECT deadline_at FROM "order" WHERE id=$1`, &deadline, o.id)
	mustQuery(t, pool, `SELECT count(*) FROM order_transition WHERE order_id=$1`, &transitions, o.id)
	if state != "READY_FOR_PICKUP" || action != "PICKUP_OVERDUE" || !deadline.Equal(orderDeadline) || transitions != 0 {
		t.Fatalf("order = %s/%s due %v with %d transitions, want READY_FOR_PICKUP/PICKUP_OVERDUE due %v, untouched",
			state, action, deadline, transitions, orderDeadline)
	}

	// The ended search is never picked up again.
	clk.Advance(time.Hour)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire after the end: %v", err)
	}
	if n := len(waveRadii(t, pool, o.id)); n != maxWaves {
		t.Fatalf("waves after the end = %d, want %d", n, maxWaves)
	}
	if n := len(eventPayloads(t, pool, o.id, "admin.dispatch_failure")); n != 1 {
		t.Fatalf("admin.dispatch_failure events after the end = %d, want 1", n)
	}
}

// TestNoRider_EventsAreProjectedForTheirRoles: the realtime projection fails
// closed (an event type or role with no serializer sends nothing), so the two
// events that end a search must each have a serializer for every role that
// should see them, and only those. dispatch.state_changed goes to the order's
// customer, restaurant and rider and to support, with the contract's four
// fields; admin.dispatch_failure goes to support alone, with its four
// (contracts/websocket.md, sections 4.5 and 4.7).
func TestNoRider_EventsAreProjectedForTheirRoles(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	if _, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil {
		t.Fatalf("first wave: %v", err)
	}
	for i := 0; i < 10 && readDispatch(t, pool, o.id).state == "SEARCHING"; i++ {
		clk.Advance(untilNextWave)
		if err := runner.EscalateAndExpire(ctx); err != nil {
			t.Fatalf("EscalateAndExpire: %v", err)
		}
	}
	if d := readDispatch(t, pool, o.id); d.state != "NO_RIDER_FOUND" {
		t.Fatalf("dispatch = %+v, want NO_RIDER_FOUND", d)
	}

	sees := map[string]map[realtime.Viewer]bool{
		"dispatch.state_changed": {realtime.ViewCustomer: true, realtime.ViewRestaurant: true, realtime.ViewRider: true, realtime.ViewSupport: true},
		"admin.dispatch_failure": {realtime.ViewSupport: true},
	}
	fields := map[string][]string{
		"dispatch.state_changed": {"at", "from", "order_id", "to"},
		"admin.dispatch_failure": {"order_id", "radius_m", "riders_offered", "waves"},
	}
	rows, err := pool.Query(ctx, `
SELECT type, audience, payload FROM realtime_event
 WHERE order_id = $1 AND type = ANY($2) AND payload->>'to' IS DISTINCT FROM 'SEARCHING'`,
		o.id, []string{"dispatch.state_changed", "admin.dispatch_failure"})
	if err != nil {
		t.Fatalf("read events: %v", err)
	}
	defer rows.Close()
	seen := map[string]int{}
	for rows.Next() {
		var typ string
		var audience []string
		var payload []byte
		if err := rows.Scan(&typ, &audience, &payload); err != nil {
			t.Fatal(err)
		}
		seen[typ]++
		for _, v := range realtime.Viewers() {
			out, ok := realtime.Project(typ, v, audience, payload)
			if ok != sees[typ][v] {
				t.Errorf("%s for %s: projected %v, want %v", typ, v, ok, sees[typ][v])
				continue
			}
			if !ok {
				continue
			}
			var got map[string]any
			if err := json.Unmarshal(out, &got); err != nil {
				t.Fatalf("%s for %s: %v", typ, v, err)
			}
			var keys []string
			for k := range got {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			if !slices.Equal(keys, fields[typ]) || got["order_id"] != o.id {
				t.Errorf("%s for %s = %v, want the fields %v for order %s", typ, v, got, fields[typ], o.id)
			}
			if typ == "dispatch.state_changed" && (got["from"] != "SEARCHING" || got["to"] != "NO_RIDER_FOUND") {
				t.Errorf("%s for %s = %v, want SEARCHING -> NO_RIDER_FOUND", typ, v, got)
			}
			if typ == "admin.dispatch_failure" &&
				(got["waves"] != float64(maxWaves) || got["riders_offered"] != float64(0) || got["radius_m"] != float64(10000)) {
				t.Errorf("%s = %v, want %d waves, 0 riders offered, 10000 m", typ, got, maxWaves)
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if seen["dispatch.state_changed"] != 1 || seen["admin.dispatch_failure"] != 1 {
		t.Fatalf("events that end the search = %v, want one of each", seen)
	}
}

// TestNoRider_TimeBudgetEndsTheSearch: the search also ends at its time budget
// (max_total_seconds), even with waves to spare.
func TestNoRider_TimeBudgetEndsTheSearch(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	if _, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil {
		t.Fatalf("first wave: %v", err)
	}
	// The search started the budget ago (on the test clock).
	mustExec(t, pool, `UPDATE dispatch SET created_at=$2 WHERE order_id=$1`, o.id, clk.Now().Add(-maxTotalSearch))
	clk.Advance(untilNextWave)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire: %v", err)
	}
	if d := readDispatch(t, pool, o.id); d.state != "NO_RIDER_FOUND" || d.wave != 1 {
		t.Fatalf("dispatch = %+v, want NO_RIDER_FOUND after wave 1 once the time budget is spent", d)
	}
}

// TestNoRider_RiderWhoComesOnlineIsOffered: the first wave finds nobody; a rider
// comes online 8 km away; the search reaches them at 10 km and they can take it.
func TestNoRider_RiderWhoComesOnlineIsOffered(t *testing.T) {
	pool := openPool(t)
	clk := newTestClock()
	svc := newClockedService(pool, clk)
	runner := NewDispatchRunner(svc, newTestLogger(), 3000, 5*time.Second)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, pool)

	if res, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil || res.Offered != 0 {
		t.Fatalf("first wave = %+v, %v; want an empty wave", res, err)
	}

	// About 8 km north of the restaurant: outside 6 km, inside 10 km.
	rider := seedOnlineRider(t, pool, o.lng, o.lat+8.0/111.32)

	clk.Advance(untilNextWave)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire (wave 2): %v", err)
	}
	if d := readDispatch(t, pool, o.id); d.wave != 2 || d.radiusM != 6000 {
		t.Fatalf("wave 2 = %+v, want 6000 m", d)
	}
	var offers int
	mustQuery(t, pool, `SELECT count(*) FROM dispatch_offer WHERE order_id=$1`, &offers, o.id)
	if offers != 0 {
		t.Fatalf("wave 2 at 6 km made %d offers to a rider 8 km away", offers)
	}

	clk.Advance(untilNextWave)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire (wave 3): %v", err)
	}
	d := readDispatch(t, pool, o.id)
	if d.state != "SEARCHING" || d.wave != 3 || d.radiusM != 10000 {
		t.Fatalf("wave 3 = %+v, want SEARCHING at 10000 m", d)
	}
	if d.deadlineAt == nil || !d.deadlineAt.Equal(clk.Now().Add(offerTTL)) {
		t.Fatalf("offer wave deadline = %v, want the offer TTL", d.deadlineAt)
	}
	var offerID, offerState string
	var distance int
	if err := pool.QueryRow(ctx, `
SELECT id::text, state::text, distance_m FROM dispatch_offer WHERE order_id=$1 AND rider_account_id=$2`,
		o.id, rider).Scan(&offerID, &offerState, &distance); err != nil {
		t.Fatalf("the rider who came online has no offer: %v", err)
	}
	if offerState != "PENDING" || distance < 6000 || distance > 10000 {
		t.Fatalf("offer = %s at %d m, want PENDING between 6 and 10 km", offerState, distance)
	}

	if _, err := svc.AcceptOffer(ctx, rider, offerID); err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	if d := readDispatch(t, pool, o.id); d.state != "ASSIGNED" {
		t.Fatalf("after accept, dispatch = %+v, want ASSIGNED", d)
	}

	// A taken order is never escalated or reported as unfound.
	clk.Advance(time.Hour)
	if err := runner.EscalateAndExpire(ctx); err != nil {
		t.Fatalf("EscalateAndExpire after accept: %v", err)
	}
	if d := readDispatch(t, pool, o.id); d.state != "ASSIGNED" || d.wave != 3 {
		t.Fatalf("after accept and an hour, dispatch = %+v, want ASSIGNED at wave 3", d)
	}
	if n := len(eventPayloads(t, pool, o.id, "admin.dispatch_failure")); n != 0 {
		t.Fatalf("admin.dispatch_failure events for a taken order = %d", n)
	}
}

// TestNoRider_LeaseKeepsADueSearchToOneReplica: a due search claimed by one
// replica is not claimed by another until the lease lapses; a replica that
// lost it and runs its stale wave anyway writes nothing.
func TestNoRider_LeaseKeepsADueSearchToOneReplica(t *testing.T) {
	poolA, poolB := openPool(t), openPool(t)
	clk := newTestClock()
	svcA, svcB := newClockedService(poolA, clk), newClockedService(poolB, clk)
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, poolA)

	if _, err := svcA.RunWave(ctx, o.id, 1, 3000); err != nil {
		t.Fatalf("first wave: %v", err)
	}
	clk.Advance(untilNextWave)

	claimed := func(svc *Service, owner string) *waveToEscalate {
		t.Helper()
		due, err := svc.store.ClaimWavesToEscalate(ctx, clk.Now(), interWaveGap, owner)
		if err != nil {
			t.Fatalf("claim by %s: %v", owner, err)
		}
		for i := range due {
			if due[i].OrderID == o.id {
				return &due[i]
			}
		}
		return nil
	}

	a := claimed(svcA, "replica-a")
	if a == nil || a.Wave != 1 || a.RadiusM != 3000 || !a.LastWaveEmpty {
		t.Fatalf("replica A's claim = %+v, want wave 1 at 3000 m, empty", a)
	}
	if b := claimed(svcB, "replica-b"); b != nil {
		t.Fatalf("replica B claimed a search replica A holds: %+v", b)
	}

	// Replica A stalls past its lease: replica B takes the search over.
	clk.Advance(escalationLease + time.Second)
	b := claimed(svcB, "replica-b")
	if b == nil {
		t.Fatal("replica B could not take over a lapsed lease")
	}
	if _, err := svcB.runWave(ctx, o.id, b.Wave+1, nextWaveRadii(b.RadiusM, b.LastWaveEmpty)); err != nil {
		t.Fatalf("replica B's wave 2: %v", err)
	}
	// Replica A wakes up and runs the wave it claimed: nothing is written.
	if _, err := svcA.runWave(ctx, o.id, a.Wave+1, nextWaveRadii(a.RadiusM, a.LastWaveEmpty)); !errors.Is(err, errWaveNotOpen) {
		t.Fatalf("replica A's stale wave 2 = %v, want errWaveNotOpen", err)
	}
	d := readDispatch(t, poolA, o.id)
	if d.wave != 2 || d.radiusM != 6000 || d.leased {
		t.Fatalf("dispatch = %+v, want wave 2 at 6000 m with the lease released", d)
	}
	if got := waveRadii(t, poolA, o.id); !sameInts(got, []int{3000, 6000}) {
		t.Fatalf("wave radii = %v, want [3000 6000]", got)
	}
}

// TestNoRider_TwoReplicasRunEachWaveOnce: two replicas sweep the same new ready
// order and then run the escalation side by side every tick. The dispatch row
// is created once, every wave exists once, and the search ends once, with one
// admin.dispatch_failure.
func TestNoRider_TwoReplicasRunEachWaveOnce(t *testing.T) {
	poolA, poolB := openPool(t), openPool(t)
	clk := newTestClock()
	svcs := []*Service{newClockedService(poolA, clk), newClockedService(poolB, clk)}
	runners := []*DispatchRunner{
		NewDispatchRunner(svcs[0], newTestLogger(), 3000, 5*time.Second),
		NewDispatchRunner(svcs[1], newTestLogger(), 3000, 5*time.Second),
	}
	ctx := context.Background()
	o := seedRemoteReadyOrder(t, poolA)

	// Both run the order's first wave at once, as two sweeps would.
	var wg sync.WaitGroup
	errs := make([]error, 2)
	gate := make(chan struct{})
	for i, svc := range svcs {
		wg.Add(1)
		go func(i int, svc *Service) {
			defer wg.Done()
			<-gate
			_, errs[i] = svc.RunWave(ctx, o.id, 1, 3000)
		}(i, svc)
	}
	close(gate)
	wg.Wait()
	ran := 0
	for i, err := range errs {
		switch {
		case err == nil:
			ran++
		case errors.Is(err, errWaveNotOpen):
		default:
			t.Fatalf("replica %d first wave: %v", i, err)
		}
	}
	if ran != 1 {
		t.Fatalf("first wave ran on %d replicas, want 1", ran)
	}
	var rows int
	mustQuery(t, poolA, `SELECT count(*) FROM dispatch WHERE order_id=$1`, &rows, o.id)
	if rows != 1 || len(waveRadii(t, poolA, o.id)) != 1 {
		t.Fatalf("after two sweeps: %d dispatch rows, %d waves; want 1 and 1", rows, len(waveRadii(t, poolA, o.id)))
	}

	// Then both escalate on every tick until the search ends.
	for tick := 0; tick < 10 && readDispatch(t, poolA, o.id).state == "SEARCHING"; tick++ {
		clk.Advance(untilNextWave)
		gate := make(chan struct{})
		for i, r := range runners {
			wg.Add(1)
			go func(i int, r *DispatchRunner) {
				defer wg.Done()
				<-gate
				errs[i] = r.EscalateAndExpire(ctx)
			}(i, r)
		}
		close(gate)
		wg.Wait()
		for i, err := range errs {
			if err != nil {
				t.Fatalf("tick %d replica %d: %v", tick, i, err)
			}
		}
		d := readDispatch(t, poolA, o.id)
		if n := len(waveRadii(t, poolA, o.id)); d.state == "SEARCHING" && n != tick+2 {
			t.Fatalf("after tick %d: %d waves, want %d (one wave per tick, never two)", tick, n, tick+2)
		}
	}

	if d := readDispatch(t, poolA, o.id); d.state != "NO_RIDER_FOUND" {
		t.Fatalf("dispatch = %+v, want NO_RIDER_FOUND", d)
	}
	if got, want := waveRadii(t, poolA, o.id), []int{3000, 6000, 10000, 10000, 10000}; !sameInts(got, want) {
		t.Fatalf("wave radii = %v, want %v", got, want)
	}
	if n := len(eventPayloads(t, poolA, o.id, "admin.dispatch_failure")); n != 1 {
		t.Fatalf("admin.dispatch_failure events = %d, want 1", n)
	}
	// The search started once and ended once, however many replicas ran it.
	if n := len(eventPayloads(t, poolA, o.id, "dispatch.state_changed")); n != 2 {
		t.Fatalf("dispatch.state_changed events = %d, want 2 (the search's start and its end)", n)
	}
}

// TestNextWaveRadii pins how the search widens between waves.
func TestNextWaveRadii(t *testing.T) {
	cases := []struct {
		radius int
		empty  bool
		want   []int
	}{
		{3000, true, []int{6000}},
		{6000, true, []int{10000}},
		{10000, true, []int{10000}},
		{3000, false, []int{3000, 6000, 10000}},
		{6000, false, []int{6000, 10000}},
		{10000, false, []int{10000}},
		{4000, true, []int{6000}},
		{12000, true, []int{12000}},
	}
	for _, c := range cases {
		if got := nextWaveRadii(c.radius, c.empty); !sameInts(got, c.want) {
			t.Errorf("nextWaveRadii(%d, empty=%v) = %v, want %v", c.radius, c.empty, got, c.want)
		}
	}
}
