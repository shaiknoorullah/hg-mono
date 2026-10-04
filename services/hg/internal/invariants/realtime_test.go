package invariants

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// ---------------------------------------------------------------------------
// Invariant — the realtime contract, end to end: one order from checkout to
// completion records, on each channel, the events contracts/websocket.md lists
// for that path, with a gapless seq per channel, every payload — for every role
// that receives it — validates against the schema GET /v1/realtime/schema
// serves, and nothing a rider receives carries a handover code
// (https://github.com/shaiknoorullah/hg-mono/issues/247).
//
// It runs the real orders.Store (checkout, the payment gateway's authorise and
// the deadline-free system transitions), the real payments module over the fake
// Stripe client, and the real dispatch.Service (wave, accept, the assignment
// steps and the bridge back into orders). The restaurant's accept and
// mark-ready go through orders.Store.Transition, the path
// https://github.com/shaiknoorullah/hg-mono/pull/354 moves the restaurant
// module onto; until it merges, internal/restaurant writes those two states
// itself and they emit nothing.
// ---------------------------------------------------------------------------

// lifecycleBridge is dispatch.OrderLifecycle over the real orders.Store, the
// shape cmd/hg/main.go wires.
type lifecycleBridge struct{ st *orders.Store }

func (b lifecycleBridge) ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error {
	return b.st.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StatePickedUp, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider confirmed pickup",
	})
}

func (b lifecycleBridge) CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error {
	return b.st.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider completed delivery",
	})
}

func TestRealtime_CheckoutToCompletedEmitsTheContractsEvents(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	pay := paymentsService(pool)

	staffID, riderID := seedRealtimeParticipants(t, pool, b)

	// 1. Checkout. The gateway authorises and moves the order to
	//    RESTAURANT_PENDING, as the Stripe webhook does in production.
	orderID, _ := quoteAndOrder(t, st, b, localGateway{pay: pay, store: st})
	orderCh := realtime.OrderChannel(orderID)
	restaurantCh := realtime.RestaurantChannel(b.restaurantID)
	riderCh := realtime.RiderChannel(riderID)
	t.Cleanup(func() {
		c := context.Background()
		for _, ch := range []string{orderCh, restaurantCh, riderCh} {
			_, _ = pool.Exec(c, `DELETE FROM outbox_message WHERE channel = $1`, ch)
			_, _ = pool.Exec(c, `DELETE FROM realtime_event WHERE channel = $1`, ch)
			_, _ = pool.Exec(c, `DELETE FROM channel_cursor WHERE channel = $1`, ch)
		}
		_, _ = pool.Exec(c, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id = $1)`, orderID)
		_, _ = pool.Exec(c, `DELETE FROM assignment WHERE order_id = $1`, orderID)
		_, _ = pool.Exec(c, `DELETE FROM dispatch_offer WHERE order_id = $1`, orderID)
		_, _ = pool.Exec(c, `DELETE FROM dispatch_wave WHERE order_id = $1`, orderID)
		_, _ = pool.Exec(c, `DELETE FROM dispatch WHERE order_id = $1`, orderID)
		_, _ = pool.Exec(c, `DELETE FROM rider_position_history WHERE account_id = $1`, riderID)
	})

	// 2. The restaurant accepts and marks the order ready (see the header).
	move := func(to machine.State, actor machine.ActorKind, by string, prep int) {
		t.Helper()
		if err := st.Transition(ctx, orders.TransitionRequest{
			OrderID: orderID, To: to, Actor: actor, ActorAccountID: by, PrepEtaMinutes: prep, Reason: "e2e",
		}); err != nil {
			t.Fatalf("transition to %s: %v", to, err)
		}
	}
	move(machine.StatePreparing, machine.ActorRestaurant, staffID, 20)
	move(machine.StateReadyForPickup, machine.ActorRestaurant, staffID, 0)

	// 3. Dispatch: one wave, the rider accepts, walks the assignment through
	//    pickup (reporting a position) to delivery.
	svc := dispatch.NewService(dispatch.NewStore(pool), lifecycleBridge{st: st})
	if res, err := svc.RunWave(ctx, orderID, 1, 3000); err != nil || res.Offered == 0 {
		t.Fatalf("RunWave = %+v, %v; the seeded rider should be offered the order", res, err)
	}
	var offerID string
	if err := pool.QueryRow(ctx, `SELECT id FROM dispatch_offer WHERE order_id = $1 AND rider_account_id = $2`,
		orderID, riderID).Scan(&offerID); err != nil {
		t.Fatalf("find the rider's offer: %v", err)
	}
	asn, err := svc.AcceptOffer(ctx, riderID, offerID)
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	override := "e2e"
	step := func(to string) {
		t.Helper()
		if _, err := svc.Transition(ctx, riderID, asn.ID, dispatch.TransitionInput{
			ToState: to, OccurredAt: time.Now().UTC(), OverrideReason: &override,
		}); err != nil {
			t.Fatalf("assignment to %s: %v", to, err)
		}
	}
	step("EN_ROUTE_TO_PICKUP")
	step("ARRIVED_AT_PICKUP")
	step("PICKED_UP")
	accuracy := 8.0
	if _, err := svc.IngestPositions(ctx, riderID, []dispatch.PositionPoint{{
		Lat: 43.6416, Lng: -79.3812, AccuracyM: &accuracy, RecordedAt: time.Now().UTC(),
	}}); err != nil {
		t.Fatalf("IngestPositions: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE assignment SET pod_recorded = true WHERE id = $1`, asn.ID); err != nil {
		t.Fatal(err)
	}
	step("EN_ROUTE_TO_DROPOFF")
	step("ARRIVED_AT_DROPOFF")
	step("DELIVERED")

	// 4. Settlement completes the order (T18, a system transition).
	move(machine.StateCompleted, machine.ActorSystem, "", 0)

	// Each channel carries, in order, the events the contract lists for this path.
	store := realtime.NewStore(pool, "e2e")
	read := func(ch string) []realtime.StoredEvent {
		t.Helper()
		events, truncated, err := store.Replay(ctx, ch, 0)
		if err != nil || truncated {
			t.Fatalf("replay %s: truncated=%v err=%v", ch, truncated, err)
		}
		for i, e := range events {
			if e.Seq != int64(i+1) {
				t.Errorf("%s: event %d (%s) has seq %d; seq must be gapless", ch, i, e.Type, e.Seq)
			}
		}
		return events
	}
	orderEvents := read(orderCh)
	assertSubsequence(t, "order channel", described(orderEvents), []string{
		"order.created",
		"order.state_changed→CREATED",
		"order.state_changed→AUTHORIZED",
		"payment.authorized",
		"order.state_changed→RESTAURANT_PENDING",
		"order.state_changed→PREPARING",
		"order.state_changed→READY_FOR_PICKUP",
		"dispatch.state_changed→SEARCHING",
		"dispatch.assigned",
		"dispatch.state_changed→ASSIGNED",
		"order.state_changed→PICKED_UP",
		"rider.location",
		"dispatch.state_changed→COMPLETED",
		"order.state_changed→DELIVERED",
		"order.state_changed→COMPLETED",
		"order.completed",
	})
	assertSubsequence(t, "restaurant channel", described(read(restaurantCh)), []string{
		"restaurant.order_offered", "restaurant.order_accepted",
	})
	assertSubsequence(t, "rider channel", described(read(riderCh)), []string{
		"dispatch.offer", "rider.availability_changed", "rider.availability_changed",
	})

	// Every payload, for every role that receives it, validates against the
	// published schema; a rider never receives a handover code; and the order's
	// rider does not receive the customer-only events.
	riderSees := map[string]bool{}
	for _, ch := range []string{orderCh, restaurantCh, riderCh} {
		for _, e := range read(ch) {
			schema := compileEventSchema(t, e.Type)
			for _, v := range []realtime.Viewer{realtime.ViewCustomer, realtime.ViewRestaurant, realtime.ViewRider, realtime.ViewSupport, realtime.ViewSelf} {
				out, ok := realtime.Project(e.Type, v, e.Audience, e.Payload)
				if !ok {
					continue
				}
				var val any
				if err := json.Unmarshal(out, &val); err != nil {
					t.Fatal(err)
				}
				if err := schema.VisitJSON(val); err != nil {
					t.Errorf("%s seq %d for viewer %d violates its schema: %v\n%s", e.Type, e.Seq, v, err, out)
				}
				if v == realtime.ViewRider || (ch == riderCh && v == realtime.ViewSelf) {
					riderSees[e.Type] = true
					for _, code := range []string{"pickup_code", "delivery_code", "otp_code"} {
						if strings.Contains(string(out), `"`+code+`"`) {
							t.Errorf("%s carries %s to the rider", e.Type, code)
						}
					}
				}
			}
		}
	}
	for _, customerOnly := range []string{"order.created", "payment.authorized", "rider.location"} {
		if riderSees[customerOnly] {
			t.Errorf("the rider received %s, which is not in a rider's audience", customerOnly)
		}
	}
	if !riderSees["dispatch.offer"] || !riderSees["order.state_changed"] {
		t.Errorf("the rider should receive its offer and the order's progress; got %v", riderSees)
	}

	// The customer sees the rider's precise position once the order is picked up.
	for _, e := range orderEvents {
		if e.Type == "rider.location" {
			out, _ := realtime.Project(e.Type, realtime.ViewCustomer, e.Audience, e.Payload)
			if !strings.Contains(string(out), `"accuracy_m":8`) {
				t.Errorf("after pickup the customer's rider.location should be precise, got %s", out)
			}
			out, _ = realtime.Project(e.Type, realtime.ViewRestaurant, e.Audience, e.Payload)
			if !strings.Contains(string(out), `"accuracy_m":null`) {
				t.Errorf("the restaurant's rider.location must be coarse, got %s", out)
			}
		}
	}
}

// seedRealtimeParticipants adds what the realtime path needs on top of
// seedBasics: the customer's first name, a staff member of the restaurant, and
// an online, approved rider at the restaurant with a payout account.
func seedRealtimeParticipants(t *testing.T, pool *pgxpool.Pool, b basics) (staffID, riderID string) {
	t.Helper()
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}
	exec(`INSERT INTO customer_profile (account_id, first_name) VALUES ($1, 'Ayesha')`, b.accountID)
	for _, id := range []*string{&staffID, &riderID} {
		if err := pool.QueryRow(ctx,
			`INSERT INTO account (email, status) VALUES ('inv-rt-'||uuid_generate_v7()||'@test.local', 'ACTIVE') RETURNING id`).Scan(id); err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}
	exec(`INSERT INTO restaurant_staff_profile (account_id, full_name, status) VALUES ($1, 'Hamza Khan', 'ACTIVE')`, staffID)
	exec(`INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_STAFF', 'RESTAURANT', $2)`, staffID, b.restaurantID)
	exec(`
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status,
                           availability_state, is_online, approved_at, rating_avg)
VALUES ($1, 'Bilal', 'Rashid', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now(), 4.9)`, riderID)
	exec(`INSERT INTO rider_vehicle (account_id, vehicle_type, licence_plate) VALUES ($1, 'SCOOTER', 'RT'||substr(md5(random()::text),1,6))`, riderID)
	exec(`
INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography, 5, now(), now())`, riderID)
	exec(`INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled) VALUES ('RIDER', $1::uuid, 'acct_rt_'||$1::text, true)`, riderID)

	t.Cleanup(func() {
		c := context.Background()
		for _, sql := range []string{
			`DELETE FROM connect_account WHERE owner_id = $1`,
			`DELETE FROM rider_position WHERE account_id = $1`,
			`DELETE FROM rider_availability_event WHERE account_id = $1`,
			`DELETE FROM rider_vehicle WHERE account_id = $1`,
			`DELETE FROM rider_profile WHERE account_id = $1`,
			`DELETE FROM account WHERE id = $1`,
		} {
			_, _ = pool.Exec(c, sql, riderID)
		}
		_, _ = pool.Exec(c, `DELETE FROM account_role WHERE account_id = $1`, staffID)
		_, _ = pool.Exec(c, `DELETE FROM restaurant_staff_profile WHERE account_id = $1`, staffID)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id = $1`, staffID)
		_, _ = pool.Exec(c, `DELETE FROM customer_profile WHERE account_id = $1`, b.accountID)
	})
	return staffID, riderID
}

// described names each event, with the destination state for the two
// state_changed events.
func described(events []realtime.StoredEvent) []string {
	out := make([]string, len(events))
	for i, e := range events {
		out[i] = e.Type
		if e.Type == "order.state_changed" || e.Type == "dispatch.state_changed" {
			var p struct {
				To string `json:"to"`
			}
			_ = json.Unmarshal(e.Payload, &p)
			out[i] += "→" + p.To
		}
	}
	return out
}

// assertSubsequence checks want appears in got, in order.
func assertSubsequence(t *testing.T, where string, got, want []string) {
	t.Helper()
	i := 0
	for _, g := range got {
		if i < len(want) && g == want[i] {
			i++
		}
	}
	if i < len(want) {
		t.Errorf("%s: missing %q (and after) in order\n got:  %v\n want: %v", where, want[i], got, want)
	}
	if where != "order channel" {
		return
	}
	// The order channel carries nothing the contract does not list for this path.
	for _, g := range got {
		if !slices.Contains(want, g) {
			t.Errorf("%s: unexpected event %q", where, g)
		}
	}
}

func compileEventSchema(t *testing.T, eventType string) *openapi3.Schema {
	t.Helper()
	raw, err := json.Marshal(realtime.SchemaFor(eventType))
	if err != nil {
		t.Fatal(err)
	}
	s := openapi3.NewSchema()
	if err := s.UnmarshalJSON(raw); err != nil {
		t.Fatalf("compile %s schema: %v", eventType, err)
	}
	return s
}
