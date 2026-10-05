package realtime

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// These tests drive real sockets (net.Pipe) through the gateway against a real
// Postgres, for the delivery half of
// https://github.com/shaiknoorullah/hg-mono/issues/247:
//
//   - only an order's participants can subscribe to its channel, and a
//     customer never receives another customer's order;
//   - a rider who loses the order is force-unsubscribed;
//   - a reconnecting client resumes from a seq and gets exactly what it missed,
//     projected for its role, with a resume_complete that moves its cursor past
//     the events its role does not receive.

// orderFixture is one order with its customer, a staff member of its
// restaurant and an assigned rider.
type orderFixture struct {
	orderID, customerID, restaurantID, staffID, riderID string
}

func seedRealtimeOrder(t *testing.T, pool *pgxpool.Pool) orderFixture {
	t.Helper()
	ctx := context.Background()
	var f orderFixture
	var addressID, cartID, quoteID string
	q := func(sql string, dst *string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dst); err != nil {
			t.Fatalf("seed: %v\n%s", err, sql)
		}
	}
	newAccount := func(dst *string) {
		q(`INSERT INTO account (email, status) VALUES ('rt-'||uuid_generate_v7()||'@test.local', 'ACTIVE') RETURNING id`, dst)
	}
	newAccount(&f.customerID)
	newAccount(&f.staffID)
	newAccount(&f.riderID)
	q(`
INSERT INTO restaurant (slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
VALUES ('rt-'||substr(md5(random()::text),1,10), 'RT Co', 'RT Kitchen', '1 Main St', 'Toronto', 'ON', 'M4J1M4',
        ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 'America/Toronto')
RETURNING id`, &f.restaurantID)
	if _, err := pool.Exec(ctx, `
INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_STAFF', 'RESTAURANT', $2)`,
		f.staffID, f.restaurantID); err != nil {
		t.Fatalf("seed staff role: %v", err)
	}
	q(`
INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone)
VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3', ST_SetSRID(ST_MakePoint(-79.381, 43.6412),4326)::geography, 'America/Toronto')
RETURNING id`, &addressID, f.customerID)
	q(`INSERT INTO cart (account_id, restaurant_id, delivery_address_id, fulfilment) VALUES ($1, $2, $3, 'DELIVERY') RETURNING id`,
		&cartID, f.customerID, f.restaurantID, addressID)
	q(`
INSERT INTO quote (account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
                   pricing_config_id, tax_jurisdiction_code, subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
                   input_hash, state_hash, created_at, expires_at)
SELECT $1, $2, $3, $4, 'DELIVERY', 'CAD', (SELECT id FROM pricing_config LIMIT 1), (SELECT code FROM tax_jurisdiction LIMIT 1),
       1000, 449, 0, 1449, sha256('rt'::bytea), sha256('rt'::bytea), now(), now()+interval '1 hour'
RETURNING id`, &quoteID, f.customerID, cartID, f.restaurantID, addressID)
	q(`
INSERT INTO "order" (code, quote_id, account_id, restaurant_id, delivery_address_id, state, deadline_at, deadline_action,
                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
VALUES ('RT-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'PICKED_UP', now()+interval '30 min', 'DELIVERY_OVERDUE',
        1000, 449, 0, 1449)
RETURNING id`, &f.orderID, quoteID, f.customerID, f.restaurantID, addressID)
	if _, err := pool.Exec(ctx, `
INSERT INTO dispatch (order_id, state, rider_account_id, assigned_at, deadline_at, deadline_action)
VALUES ($1, 'ASSIGNED', $2, now(), now()+interval '20 min', 'RIDER_NOT_ARRIVING')`, f.orderID, f.riderID); err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}

	t.Cleanup(func() {
		c := context.Background()
		ch := OrderChannel(f.orderID)
		_, _ = pool.Exec(c, `DELETE FROM outbox_message WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM realtime_event WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM channel_cursor WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM dispatch WHERE order_id = $1`, f.orderID)
		_, _ = pool.Exec(c, `DELETE FROM "order" WHERE id = $1`, f.orderID)
		_, _ = pool.Exec(c, `DELETE FROM quote WHERE id = $1`, quoteID)
		_, _ = pool.Exec(c, `DELETE FROM cart WHERE id = $1`, cartID)
		_, _ = pool.Exec(c, `DELETE FROM address WHERE id = $1`, addressID)
		_, _ = pool.Exec(c, `DELETE FROM account_role WHERE account_id = $1`, f.staffID)
		_, _ = pool.Exec(c, `DELETE FROM restaurant WHERE id = $1`, f.restaurantID)
		for _, a := range []string{f.customerID, f.staffID, f.riderID} {
			_, _ = pool.Exec(c, `DELETE FROM account WHERE id = $1`, a)
		}
	})
	return f
}

// extraAccount is an account with no relationship to any order.
func extraAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO account (email, status) VALUES ('rt-'||uuid_generate_v7()||'@test.local', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1`, id) })
	return id
}

// testClient is one socket on a net.Pipe, with a goroutine reading its frames.
type testClient struct {
	c      *connection
	frames chan Envelope
}

func newTestClient(t *testing.T, gw *Gateway, accountID string, roles []string) *testClient {
	t.Helper()
	srv, peer := net.Pipe()
	c := newConnection(gw, &wsConn{raw: srv, br: bufio.NewReader(srv)}, gw.log, "", accountID, "", roles)
	go c.writeLoop()
	gw.register(c)
	frames := make(chan Envelope, 256)
	go func() {
		defer close(frames)
		r := bufio.NewReader(peer)
		for {
			op, body, err := readServerFrame(r)
			if err != nil {
				return
			}
			if op != opText {
				continue
			}
			var e Envelope
			if json.Unmarshal(body, &e) == nil {
				frames <- e
			}
		}
	}()
	t.Cleanup(func() {
		c.stop(0, "")
		<-c.writerDone
		_ = peer.Close()
		gw.unregister(c)
	})
	return &testClient{c: c, frames: frames}
}

// next returns the next frame, or false after timeout.
func (tc *testClient) next(timeout time.Duration) (Envelope, bool) {
	select {
	case e, ok := <-tc.frames:
		return e, ok
	case <-time.After(timeout):
		return Envelope{}, false
	}
}

// until reads frames up to and including the first of type typ.
func (tc *testClient) until(t *testing.T, typ string) []Envelope {
	t.Helper()
	var got []Envelope
	for {
		e, ok := tc.next(3 * time.Second)
		if !ok {
			t.Fatalf("no %s frame arrived; got %v", typ, typesOf(got))
		}
		got = append(got, e)
		if e.Type == typ {
			return got
		}
	}
}

func typesOf(es []Envelope) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.Type
	}
	return out
}

// subscribe runs a subscribe frame and returns the reply.
func (tc *testClient) subscribe(t *testing.T, channel string) Envelope {
	t.Helper()
	go tc.c.handleSubscribe(channel)
	e, ok := tc.next(3 * time.Second)
	if !ok {
		t.Fatalf("no reply to subscribe %s", channel)
	}
	return e
}

func testGateway(pool *pgxpool.Pool) *Gateway {
	return NewGateway(NewStore(pool, "test-node"), nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, 50)
}

// emitAndFanOut writes events in one committed transaction, then hands each
// one's outbox payload to the gateway exactly as the relay publishes it.
func emitAndFanOut(t *testing.T, pool *pgxpool.Pool, gw *Gateway, orderID string, evs ...OrderEvent) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range evs {
		if err := EmitOrder(ctx, tx, orderID, ev); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("EmitOrder: %v", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	fanOutPending(t, pool, gw, OrderChannel(orderID))
}

// fanOutPending publishes a channel's unpublished outbox rows to the gateway.
func fanOutPending(t *testing.T, pool *pgxpool.Pool, gw *Gateway, channel string) {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `
		UPDATE outbox_message SET published_at = now()
		 WHERE channel = $1 AND kind = 'REALTIME' AND published_at IS NULL
		RETURNING id, payload`, channel)
	if err != nil {
		t.Fatal(err)
	}
	type msg struct {
		id      int64
		payload []byte
	}
	var msgs []msg
	for rows.Next() {
		var m msg
		if err := rows.Scan(&m.id, &m.payload); err != nil {
			t.Fatal(err)
		}
		msgs = append(msgs, m)
	}
	rows.Close()
	slices.SortFunc(msgs, func(a, b msg) int { return int(a.id - b.id) })
	for _, m := range msgs {
		gw.dispatch("rt:"+channel, m.payload)
	}
}

func stateChanged(orderID string, to contract.OrderState) OrderStateChanged {
	return OrderStateChanged{
		OrderID: orderID, To: to, At: At(time.Now()), ActorKind: contract.OrderActorKindSYSTEM,
	}
}

func TestIntegrationOrderChannelIsForParticipantsOnly(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := NewStore(pool, "test-node")
	a := seedRealtimeOrder(t, pool)
	b := seedRealtimeOrder(t, pool)
	stranger := extraAccount(t, pool)
	ch, _ := ParseChannel(OrderChannel(a.orderID))

	cases := []struct {
		who   string
		acct  string
		roles []string
		want  SubResult
		view  Viewer
	}{
		{"the order's customer", a.customerID, []string{"CUSTOMER"}, SubAllowed, ViewCustomer},
		{"the restaurant's staff", a.staffID, []string{"RESTAURANT_STAFF"}, SubAllowed, ViewRestaurant},
		{"the assigned rider", a.riderID, []string{"RIDER"}, SubAllowed, ViewRider},
		{"support", stranger, []string{"SUPPORT_AGENT"}, SubAllowed, ViewSupport},
		// Several roles: the ONE relationship that authorised the subscription,
		// never support's fuller view because the account also holds it.
		{"the customer, who is also support", a.customerID, []string{"CUSTOMER", "SUPPORT_AGENT"}, SubAllowed, ViewCustomer},
		{"the staff member, who is also an admin", a.staffID, []string{"RESTAURANT_STAFF", "ADMIN"}, SubAllowed, ViewRestaurant},
		{"the rider, who is also support", a.riderID, []string{"RIDER", "SUPPORT_AGENT"}, SubAllowed, ViewRider},
		// Not found, never forbidden: a stranger must not learn the order exists.
		{"another order's customer", b.customerID, []string{"CUSTOMER"}, SubNotFound, ViewNone},
		{"another restaurant's staff", b.staffID, []string{"RESTAURANT_STAFF"}, SubNotFound, ViewNone},
		{"another order's rider", b.riderID, []string{"RIDER"}, SubNotFound, ViewNone},
		{"a stranger", stranger, []string{"CUSTOMER", "RIDER"}, SubNotFound, ViewNone},
		{"a stranger with no role", stranger, nil, SubNotFound, ViewNone},
		{"a stranger with an unknown role", stranger, []string{"WIZARD"}, SubNotFound, ViewNone},
	}
	for _, c := range cases {
		g, err := store.AuthorizeSubscribe(ctx, c.acct, c.roles, ch)
		if err != nil || g.Result != c.want || g.Viewer != c.view {
			t.Errorf("%s: AuthorizeSubscribe = %+v (err %v), want %v as %s", c.who, g, err, c.want, c.view)
		}
	}

	// The rider's own channel is the rider's, as a rider: an account without
	// the RIDER role is not granted it.
	riderCh, _ := ParseChannel(RiderChannel(a.riderID))
	if g, err := store.AuthorizeSubscribe(ctx, a.riderID, []string{"RIDER"}, riderCh); err != nil || g.Viewer != ViewRiderSelf {
		t.Errorf("rider on own channel = %+v (err %v), want rider_self", g, err)
	}
	if g, err := store.AuthorizeSubscribe(ctx, a.riderID, []string{"CUSTOMER"}, riderCh); err != nil || g.Result != SubNotFound {
		t.Errorf("a non-rider on rider:{self} = %+v (err %v), want not found", g, err)
	}
}

func TestIntegrationACustomerNeverReceivesAnotherCustomersOrder(t *testing.T) {
	pool := testPool(t)
	gw := testGateway(pool)
	a := seedRealtimeOrder(t, pool)
	b := seedRealtimeOrder(t, pool)

	alice := newTestClient(t, gw, a.customerID, []string{"CUSTOMER"})
	bob := newTestClient(t, gw, b.customerID, []string{"CUSTOMER"})
	if e := alice.subscribe(t, OrderChannel(a.orderID)); e.Type != CtrlSubscribed {
		t.Fatalf("alice subscribe to her order: %s", e.Type)
	}
	if e := bob.subscribe(t, OrderChannel(b.orderID)); e.Type != CtrlSubscribed {
		t.Fatalf("bob subscribe to his order: %s", e.Type)
	}
	// Bob asking for Alice's order learns nothing, not even that it exists.
	if e := bob.subscribe(t, OrderChannel(a.orderID)); e.Type != CtrlSubscribeError || !strings.Contains(string(e.Data), `"not_found"`) {
		t.Fatalf("bob subscribe to alice's order = %s %s, want subscribe_error not_found", e.Type, e.Data)
	}

	emitAndFanOut(t, pool, gw, a.orderID, stateChanged(a.orderID, contract.OrderStateARRIVED))
	got := alice.until(t, "order.state_changed")
	if got[len(got)-1].Channel != OrderChannel(a.orderID) {
		t.Fatalf("alice's event on the wrong channel: %s", got[len(got)-1].Channel)
	}
	if e, ok := bob.next(300 * time.Millisecond); ok {
		t.Fatalf("bob received %s on %s: a customer must never receive another customer's order", e.Type, e.Channel)
	}
}

func TestIntegrationAnUnknownRoleReceivesNothing(t *testing.T) {
	pool := testPool(t)
	gw := testGateway(pool)
	a := seedRealtimeOrder(t, pool)
	ch := OrderChannel(a.orderID)

	customer := newTestClient(t, gw, a.customerID, []string{"CUSTOMER"})
	if e := customer.subscribe(t, ch); e.Type != CtrlSubscribed {
		t.Fatalf("customer subscribe: %s %s", e.Type, e.Data)
	}
	// Subscriptions whose role is missing or outside the closed set. The
	// subscribe path never records one (it refuses a grant without a known
	// role); these are planted directly, as a bug elsewhere might.
	var strays []*testClient
	for _, v := range []Viewer{ViewNone, Viewer(99), Viewer(-3)} {
		tc := newTestClient(t, gw, a.customerID, []string{"CUSTOMER"})
		tc.c.mu.Lock()
		tc.c.subs[ch] = v
		tc.c.mu.Unlock()
		gw.indexSubscribe(tc.c, ch)
		strays = append(strays, tc)
	}

	emitAndFanOut(t, pool, gw, a.orderID,
		stateChanged(a.orderID, contract.OrderStateARRIVED),
		OrderNoteAdded{OrderID: a.orderID, AuthorKind: contract.OrderActorKindSUPPORT, Text: "Call on arrival", At: At(time.Now())},
	)
	if got := customer.until(t, "order.state_changed"); got[len(got)-1].Channel != ch {
		t.Fatalf("customer's event on the wrong channel")
	}
	for i, tc := range strays {
		if e, ok := tc.next(300 * time.Millisecond); ok {
			t.Errorf("a subscription with an unknown role (%d) received %s %s", i, e.Type, e.Data)
		}
	}
}

func TestIntegrationSeveralRolesAreProjectedForTheOneThatAuthorised(t *testing.T) {
	pool := testPool(t)
	gw := testGateway(pool)
	a := seedRealtimeOrder(t, pool)
	ch := OrderChannel(a.orderID)

	// The order's customer also holds SUPPORT_AGENT. On their own order they
	// are its customer: support's fuller view is not theirs here.
	both := newTestClient(t, gw, a.customerID, []string{"CUSTOMER", "SUPPORT_AGENT"})
	if e := both.subscribe(t, ch); e.Type != CtrlSubscribed {
		t.Fatalf("subscribe: %s %s", e.Type, e.Data)
	}
	if v, _ := both.c.viewerFor(ch); v != ViewCustomer {
		t.Fatalf("the subscription was granted as %s, want customer", v)
	}

	// order.note_added goes to the restaurant, the rider and support — not the
	// customer — and rider.location is precise for support, coarse for a
	// customer before pickup.
	emitAndFanOut(t, pool, gw, a.orderID,
		OrderNoteAdded{OrderID: a.orderID, AuthorKind: contract.OrderActorKindSUPPORT, Text: "Internal note", At: At(time.Now())},
	)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	accuracy := 4.0
	if _, err := EmitRiderLocation(ctx, tx, RiderLocation{
		OrderID: a.orderID, Lat: 43.6532157, Lng: -79.3831846, AccuracyM: &accuracy, RecordedAt: At(time.Now()),
	}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	fanOutPending(t, pool, gw, ch)
	emitAndFanOut(t, pool, gw, a.orderID, stateChanged(a.orderID, contract.OrderStateARRIVED))

	got := both.until(t, "order.state_changed")
	if want := []string{"rider.location", "order.state_changed"}; !slices.Equal(typesOf(got), want) {
		t.Errorf("a customer who is also support received %v, want %v", typesOf(got), want)
	}
	for _, e := range got {
		if e.Type == "rider.location" && !strings.Contains(string(e.Data), `"accuracy_m":null`) {
			t.Errorf("a customer who is also support got support's precise position before pickup: %s", e.Data)
		}
	}
}

func TestIntegrationRiderWhoLosesTheOrderIsUnsubscribed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	gw := testGateway(pool)
	a := seedRealtimeOrder(t, pool)
	newRider := extraAccount(t, pool)

	rider := newTestClient(t, gw, a.riderID, []string{"RIDER"})
	if e := rider.subscribe(t, OrderChannel(a.orderID)); e.Type != CtrlSubscribed {
		t.Fatalf("rider subscribe: %s %s", e.Type, e.Data)
	}

	// The order is taken off the rider and given to another, and the change is
	// announced, in one transaction — as a reassignment does.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE dispatch SET rider_account_id = $2 WHERE order_id = $1`, a.orderID, newRider); err != nil {
		t.Fatal(err)
	}
	if err := EmitOrder(ctx, tx, a.orderID, DispatchUnassigned{OrderID: a.orderID, Reason: "rider_unresponsive"}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	fanOutPending(t, pool, gw, OrderChannel(a.orderID))

	got := rider.until(t, CtrlUnsubscribed)
	if took := time.Since(start); took > 2*time.Second {
		t.Errorf("forced unsubscribe took %v; the contract allows 2 s", took)
	}
	var data unsubscribedData
	_ = json.Unmarshal(got[len(got)-1].Data, &data)
	if data.Channel != OrderChannel(a.orderID) || data.Reason != ReasonNoLongerAuth {
		t.Fatalf("unsubscribed = %+v, want the order channel and no_longer_authorized", data)
	}

	// Nothing more for that order reaches the old rider.
	emitAndFanOut(t, pool, gw, a.orderID, stateChanged(a.orderID, contract.OrderStateARRIVED))
	if e, ok := rider.next(300 * time.Millisecond); ok {
		t.Fatalf("the unassigned rider still received %s", e.Type)
	}
}

func TestIntegrationResumeFromSeqProjectsPerRole(t *testing.T) {
	pool := testPool(t)
	gw := testGateway(pool)
	a := seedRealtimeOrder(t, pool)
	o := a.orderID
	heading, accuracy := 214.0, 9.0
	ctx := context.Background()

	// Five events on the order's channel, seq 1..5, before anyone connects.
	refund := &CancelledRefund{Kind: contract.RefundKindFULL, AmountCents: 1449, State: contract.RefundStateREQUESTED}
	emitAndFanOut(t, pool, gw, o,
		OrderCreated{ // 1: customer only
			OrderID: o, Code: "RT-1", State: contract.OrderStateCREATED,
			Restaurant: RestaurantRef{ID: a.restaurantID, Name: "RT Kitchen"},
			TotalCents: 1449, Currency: "CAD", PlacedAt: At(time.Now()), DeadlineAt: At(time.Now().Add(time.Hour)),
		},
		stateChanged(o, contract.OrderStatePICKEDUP), // 2: everyone
		OrderCancelled{ // 3: everyone, the rider without the refund
			OrderID: o, ReasonCode: contract.OrderCancellationReasonCodeSUPPORTCANCELLED,
			By: contract.OrderActorKindSUPPORT, Refund: refund,
		},
	)
	// 4: rider.location goes through its own, throttled writer.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := EmitRiderLocation(ctx, tx, RiderLocation{
		OrderID: o, Lat: 43.6532157, Lng: -79.3831846, HeadingDeg: &heading, AccuracyM: &accuracy,
		RecordedAt: At(time.Now()), PickedUp: true,
	}); err != nil || !ok {
		t.Fatalf("EmitRiderLocation = %v, %v", ok, err)
	}
	// A second fix inside 5 seconds is dropped by the throttle.
	if ok, err := EmitRiderLocation(ctx, tx, RiderLocation{OrderID: o, RecordedAt: At(time.Now())}); err != nil || ok {
		t.Fatalf("a second rider.location inside 5 s was emitted (%v, %v)", ok, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	emitAndFanOut(t, pool, gw, o, OrderNoteAdded{ // 5: restaurant, rider, support
		OrderID: o, AuthorKind: contract.OrderActorKindRESTAURANT, Text: "Bag is on the counter", At: At(time.Now()),
	})

	resume := func(t *testing.T, acct string, roles []string, afterSeq int64) ([]Envelope, resumeCompleteData) {
		t.Helper()
		tc := newTestClient(t, gw, acct, roles)
		go tc.c.handleResume(OrderChannel(o), afterSeq)
		got := tc.until(t, CtrlResumeComplete)
		var done resumeCompleteData
		_ = json.Unmarshal(got[len(got)-1].Data, &done)
		return got[:len(got)-1], done
	}

	t.Run("rider", func(t *testing.T) {
		got, done := resume(t, a.riderID, []string{"RIDER"}, 1)
		var seqs []int64
		for _, e := range got {
			seqs = append(seqs, e.Seq)
			if err := validatePayload(t, e.Type, e.Data); err != nil {
				t.Errorf("seq %d %s does not validate: %v", e.Seq, e.Type, err)
			}
			for _, code := range handoverCodeFields {
				if strings.Contains(string(e.Data), `"`+code+`"`) {
					t.Errorf("seq %d %s carries %s to a rider", e.Seq, e.Type, code)
				}
			}
			if e.Type == "order.cancelled" && !strings.Contains(string(e.Data), `"refund":null`) {
				t.Errorf("the rider's order.cancelled carries the refund: %s", e.Data)
			}
		}
		// Not order.created (seq 1, before the cursor and customer-only) and not
		// rider.location (seq 4, not in the rider's audience).
		if want := []int64{2, 3, 5}; !slices.Equal(seqs, want) {
			t.Errorf("rider resume after 1 replayed seqs %v (%v), want %v", seqs, typesOf(got), want)
		}
		if done.FromSeq != 2 || done.ToSeq != 5 || done.Replayed != 3 || done.Truncated {
			t.Errorf("resume_complete = %+v, want from 2 to 5, 3 replayed, not truncated", done)
		}
	})

	t.Run("customer", func(t *testing.T) {
		got, done := resume(t, a.customerID, []string{"CUSTOMER"}, 0)
		if want := []string{"order.created", "order.state_changed", "order.cancelled", "rider.location"}; !slices.Equal(typesOf(got), want) {
			t.Errorf("customer resume replayed %v, want %v", typesOf(got), want)
		}
		for _, e := range got {
			if err := validatePayload(t, e.Type, e.Data); err != nil {
				t.Errorf("seq %d %s does not validate: %v", e.Seq, e.Type, err)
			}
		}
		if done.ToSeq != 5 || done.Replayed != 4 {
			t.Errorf("resume_complete = %+v, want to 5, 4 replayed", done)
		}
	})

	t.Run("retention", func(t *testing.T) {
		// The oldest events have aged out: a client behind them must refetch
		// over REST (contracts/websocket.md section 6.3).
		if _, err := pool.Exec(ctx, `DELETE FROM realtime_event WHERE channel = $1 AND seq <= 3`, OrderChannel(o)); err != nil {
			t.Fatal(err)
		}
		_, done := resume(t, a.customerID, []string{"CUSTOMER"}, 1)
		if !done.Truncated || done.ToSeq != 5 {
			t.Errorf("resume across a retention gap = %+v, want truncated with to_seq 5", done)
		}
	})
}
