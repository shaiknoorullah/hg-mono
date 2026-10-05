package restaurant_test

// transition_integration_test.go — the restaurant's accept, reject and
// mark-ready move the order through the orders module's one transition
// function (docs/spec/01-platform.md, "P-14 — Order lifecycle states and
// transitions"; https://github.com/shaiknoorullah/hg-mono/issues/337). Each
// move writes its order_transition row, arms the deadline the runner handles
// and emits its realtime outbox event in the same transaction, and the
// authorise-then-capture seam is unchanged: capture after accept, void after
// reject.
//
// Guarded by HG_TEST_POSTGRES_DSN.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// recordingEmitter is the orders.EventEmitter cmd/hg/main.go wires, minus the
// notification half: it writes the realtime outbox event inside the
// transition's transaction and records which states it was told about. In
// production the same call also enqueues the customer's notification, so a
// state recorded here is a state the customer hears about.
type recordingEmitter struct {
	mu     sync.Mutex
	states []string
	fail   error
}

func (e *recordingEmitter) EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	if e.fail != nil {
		return e.fail
	}
	payload, err := json.Marshal(struct {
		State string `json:"state"`
	}{State: newState})
	if err != nil {
		return err
	}
	oid := orderID
	if _, _, err := realtime.EmitInTx(ctx, tx, "order:"+orderID, "order.state_changed", 1, nil,
		json.RawMessage(payload), &oid, nil); err != nil {
		return err
	}
	e.mu.Lock()
	e.states = append(e.states, newState)
	e.mu.Unlock()
	return nil
}

// stepOrder seeds a RESTAURANT_PENDING order and removes the rows the moves
// add to it before seedOrder's own cleanup deletes the order.
func stepOrder(t *testing.T, pool *pgxpool.Pool, f fixtures) string {
	t.Helper()
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")
	t.Cleanup(func() {
		c := context.Background()
		ch := "order:" + orderID
		_, _ = pool.Exec(c, `DELETE FROM outbox_message WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM realtime_event WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM channel_cursor WHERE channel = $1`, ch)
		_, _ = pool.Exec(c, `DELETE FROM order_transition WHERE order_id = $1`, orderID)
	})
	return orderID
}

func postStep(t *testing.T, h http.HandlerFunc, orderID, step, body, accountID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/"+step, strings.NewReader(body))
	req = withPrincipal(req, principalWith(accountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

// assertTransitionRow checks the move left exactly one order_transition row,
// by the restaurant, carrying the acting staff account.
func assertTransitionRow(t *testing.T, pool *pgxpool.Pool, orderID, from, to, accountID string) {
	t.Helper()
	var n int
	var actorKind, actorAccount string
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) OVER (), actor_kind::text, COALESCE(actor_account_id::text, '')
		  FROM order_transition
		 WHERE order_id = $1 AND from_state = $2 AND to_state = $3`,
		orderID, from, to).Scan(&n, &actorKind, &actorAccount); err != nil {
		t.Fatalf("order_transition %s -> %s: %v", from, to, err)
	}
	if n != 1 {
		t.Errorf("order_transition %s -> %s: %d rows, want 1", from, to, n)
	}
	if actorKind != "RESTAURANT" || actorAccount != accountID {
		t.Errorf("order_transition %s -> %s by %s/%s, want RESTAURANT/%s", from, to, actorKind, actorAccount, accountID)
	}
}

// assertDeadline checks the order's deadline action and that deadline_at was
// armed offset after the move, which happened between before and after.
func assertDeadline(t *testing.T, pool *pgxpool.Pool, orderID, wantAction string, offset time.Duration, before, after time.Time) {
	t.Helper()
	var at *time.Time
	var action *string
	if err := pool.QueryRow(context.Background(),
		`SELECT deadline_at, deadline_action FROM "order" WHERE id = $1`, orderID).Scan(&at, &action); err != nil {
		t.Fatalf("read deadline: %v", err)
	}
	if wantAction == "" {
		if at != nil || action != nil {
			t.Errorf("deadline = %v/%v, want none on a terminal state", at, action)
		}
		return
	}
	if action == nil || *action != wantAction {
		t.Errorf("deadline_action = %v, want %s", action, wantAction)
	}
	lo, hi := before.Add(offset).Add(-time.Second), after.Add(offset).Add(time.Second)
	if at == nil || at.Before(lo) || at.After(hi) {
		t.Errorf("deadline_at = %v, want between %v and %v", at, lo, hi)
	}
}

// assertOutboxEvent checks the order's channel carries an order.state_changed
// event for state, with its outbox row for the relay.
func assertOutboxEvent(t *testing.T, pool *pgxpool.Pool, orderID, state string) {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*)
		  FROM realtime_event e
		  JOIN outbox_message m ON m.realtime_event_id = e.id
		 WHERE e.channel = $1 AND e.type = 'order.state_changed'
		   AND e.payload->>'state' = $2 AND m.kind = 'REALTIME'`,
		"order:"+orderID, state).Scan(&n); err != nil {
		t.Fatalf("read outbox event: %v", err)
	}
	if n != 1 {
		t.Errorf("order.state_changed %s outbox events = %d, want 1", state, n)
	}
}

// TestRestaurantSteps_AcceptAndReadyGoThroughTransition: accept then
// mark-ready each write their transition row, arm the deadline from the
// deadline table and emit the realtime event; accept still captures once.
func TestRestaurantSteps_AcceptAndReadyGoThroughTransition(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := stepOrder(t, pool, f)

	em := &recordingEmitter{}
	pay := &fakePayActions{}
	h := restaurant.NewHandler(restaurant.NewRepo(pool, orders.NewStore(pool, em)), nil, pay)

	before := time.Now().UTC()
	rec := postStep(t, h.AcceptOrder, orderID, "accept", `{"prep_eta_minutes":20}`, f.ownerAccountID)
	after := time.Now().UTC()
	if rec.Code != http.StatusOK {
		t.Fatalf("accept: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	assertTransitionRow(t, pool, orderID, "RESTAURANT_PENDING", "PREPARING", f.ownerAccountID)
	// PREPARING: accepted_at + prep ETA (20) + 10 minutes, PREP_OVERDUE.
	assertDeadline(t, pool, orderID, "PREP_OVERDUE", 30*time.Minute, before, after)
	assertOutboxEvent(t, pool, orderID, "PREPARING")
	var prepEta *int
	var promisedReadyAt, acceptedAt *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT prep_eta_minutes, promised_ready_at, accepted_at FROM "order" WHERE id = $1`, orderID).
		Scan(&prepEta, &promisedReadyAt, &acceptedAt); err != nil {
		t.Fatalf("read prep columns: %v", err)
	}
	if prepEta == nil || *prepEta != 20 || promisedReadyAt == nil || acceptedAt == nil {
		t.Errorf("prep_eta_minutes=%v promised_ready_at=%v accepted_at=%v, want 20 and both set", prepEta, promisedReadyAt, acceptedAt)
	}
	pay.mu.Lock()
	if len(pay.captureCalls) != 1 || pay.captureCalls[0].orderID != orderID || len(pay.voidCalls) != 0 {
		t.Errorf("after accept: capture=%v void=%v, want one capture of %s and no void", pay.captureCalls, pay.voidCalls, orderID)
	}
	pay.mu.Unlock()

	before = time.Now().UTC()
	rec = postStep(t, h.MarkOrderReady, orderID, "ready", ``, f.ownerAccountID)
	after = time.Now().UTC()
	if rec.Code != http.StatusOK {
		t.Fatalf("ready: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	assertTransitionRow(t, pool, orderID, "PREPARING", "READY_FOR_PICKUP", f.ownerAccountID)
	// READY_FOR_PICKUP: 15 minutes, PICKUP_OVERDUE, the action the runner handles.
	assertDeadline(t, pool, orderID, "PICKUP_OVERDUE", 15*time.Minute, before, after)
	assertOutboxEvent(t, pool, orderID, "READY_FOR_PICKUP")

	em.mu.Lock()
	defer em.mu.Unlock()
	if got := strings.Join(em.states, ","); got != "PREPARING,READY_FOR_PICKUP" {
		t.Errorf("emitter told about %q, want PREPARING,READY_FOR_PICKUP", got)
	}
}

// TestRestaurantSteps_RejectGoesThroughTransitionAndVoids: reject writes its
// transition row, clears the deadline, emits the realtime event, and the
// handler voids the authorisation and never captures.
func TestRestaurantSteps_RejectGoesThroughTransitionAndVoids(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := stepOrder(t, pool, f)

	em := &recordingEmitter{}
	pay := &fakePayActions{}
	h := restaurant.NewHandler(restaurant.NewRepo(pool, orders.NewStore(pool, em)), nil, pay)

	now := time.Now().UTC()
	rec := postStep(t, h.RejectOrder, orderID, "reject",
		`{"reason_code":"ITEM_UNAVAILABLE","note":"Out of lamb"}`, f.ownerAccountID)
	if rec.Code != http.StatusOK {
		t.Fatalf("reject: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	assertTransitionRow(t, pool, orderID, "RESTAURANT_PENDING", "REJECTED", f.ownerAccountID)
	assertDeadline(t, pool, orderID, "", 0, now, now)
	assertOutboxEvent(t, pool, orderID, "REJECTED")
	var reason, note *string
	if err := pool.QueryRow(context.Background(),
		`SELECT reject_reason::text, reject_note FROM "order" WHERE id = $1`, orderID).Scan(&reason, &note); err != nil {
		t.Fatalf("read reject columns: %v", err)
	}
	if reason == nil || *reason != "ITEM_UNAVAILABLE" || note == nil || *note != "Out of lamb" {
		t.Errorf("reject_reason=%v reject_note=%v, want ITEM_UNAVAILABLE / Out of lamb", reason, note)
	}

	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.voidCalls) != 1 || pay.voidCalls[0] != orderID {
		t.Errorf("void calls = %v, want exactly one for %s", pay.voidCalls, orderID)
	}
	if len(pay.captureCalls) != 0 {
		t.Errorf("capture calls on reject = %v, want none", pay.captureCalls)
	}
}

// TestRestaurantSteps_EventFailureRollsBackTheMove: the state change and its
// event are one transaction. When the event cannot be written the order does
// not move, no transition row is left, and nothing is captured.
func TestRestaurantSteps_EventFailureRollsBackTheMove(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := stepOrder(t, pool, f)

	em := &recordingEmitter{fail: errors.New("outbox unavailable")}
	pay := &fakePayActions{}
	h := restaurant.NewHandler(restaurant.NewRepo(pool, orders.NewStore(pool, em)), nil, pay)

	rec := postStep(t, h.AcceptOrder, orderID, "accept", `{}`, f.ownerAccountID)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("accept with a failing event: status=%d, want 500 (body: %s)", rec.Code, rec.Body.String())
	}
	var state string
	var transitions int
	if err := pool.QueryRow(context.Background(), `
		SELECT o.state::text, (SELECT count(*) FROM order_transition t WHERE t.order_id = o.id)
		  FROM "order" o WHERE o.id = $1`, orderID).Scan(&state, &transitions); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if state != "RESTAURANT_PENDING" || transitions != 0 {
		t.Errorf("after a failed event: state=%s transitions=%d, want RESTAURANT_PENDING and 0", state, transitions)
	}
	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.captureCalls) != 0 {
		t.Errorf("capture calls = %v, want none when the accept did not commit", pay.captureCalls)
	}
}
