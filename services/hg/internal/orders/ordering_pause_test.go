package orders

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The platform-wide pause on new orders
// (https://github.com/shaiknoorullah/hg-mono/issues/244). Each test runs on a
// database of its own: a pause refuses every order in the database it is set
// in, and other packages' tests share HG_TEST_POSTGRES_DSN while these run.

func pausePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testseed.FreshDatabase(t, "hg_orders_pause")
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// setPause turns the switch on or off and commits, as setOrderingPause does
// without the audit row (that is the admin module's, tested there).
func setPause(t *testing.T, pool *pgxpool.Pool, paused bool) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, _, err := SetOrderingPauseTx(ctx, tx, paused, "integration test of the ordering pause", ""); err != nil {
		t.Fatalf("set pause %v: %v", paused, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

// quoted seeds a customer with a cart and a fresh quote, taken while ordering
// is open.
func quoted(t *testing.T, pool *pgxpool.Pool, st *Store) (basics, *Cart, *Quote) {
	t.Helper()
	ctx := context.Background()
	b := seedBasics(t, pool)
	cart, err := st.AddCartLine(ctx, b.accountID, b.restaurantID, CartLineInput{MenuItemID: b.menuItemID, Quantity: 2}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	q, err := st.CreateQuote(ctx, QuoteRequest{
		AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("quote while open: %v", err)
	}
	return b, cart, q
}

func countOrders(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM "order" WHERE account_id = $1`, accountID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// waitForLockWaiters blocks until at least n sessions of this database are
// waiting on a lock, so a test knows a goroutine has reached its blocking
// statement instead of guessing with a sleep.
func waitForLockWaiters(t *testing.T, pool *pgxpool.Pool, n int) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		var waiting int
		if err := pool.QueryRow(context.Background(), `
			SELECT count(*) FROM pg_stat_activity
			 WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting >= n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("waited 15 s for %d lock waiter(s), saw %d", n, waiting)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// errorCode runs one handler as the customer and returns the status and the
// contract error code it answered with.
func errorCode(t *testing.T, accountID string, handle http.HandlerFunc, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req = req.WithContext(httpx.WithPrincipalForTest(req.Context(), httpx.Principal{
		AccountID: accountID, Roles: []httpx.Role{httpx.RoleCustomer}, AMR: []string{"otp"},
	}))
	rec := httptest.NewRecorder()
	handle(rec, req)
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	return rec.Code, env.Error.Code
}

// While paused, a new quote and a new order are refused with 409
// ORDERING_PAUSED and nothing is stored; the cart says it cannot be quoted.
// Turning the switch off restores ordering.
func TestOrderingPause_RefusesNewQuotesAndOrders(t *testing.T) {
	pool := pausePool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b, cart, q := quoted(t, pool, st)

	setPause(t, pool, true)

	quoteReq := QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"}
	if _, err := st.CreateQuote(ctx, quoteReq); !errors.Is(err, ErrOrderingPaused) {
		t.Fatalf("CreateQuote while paused: err = %v, want ErrOrderingPaused", err)
	}
	var fresh *Quote
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh); !errors.Is(err, ErrOrderingPaused) {
		t.Fatalf("CreateOrder while paused: err = %v, want ErrOrderingPaused", err)
	}
	if n := countOrders(t, pool, b.accountID); n != 0 {
		t.Fatalf("an order was stored while paused: %d", n)
	}
	var quotes int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM quote WHERE account_id = $1`, b.accountID).Scan(&quotes)
	if quotes != 1 {
		t.Errorf("quotes stored = %d, want only the one taken before the pause", quotes)
	}

	// The contract's refusal: 409 ORDERING_PAUSED on both operations.
	h := NewHandler(st, nil, slog.Default())
	quoteBody := `{"cart_id":"` + cart.ID + `","delivery_address_id":"` + b.addressID + `","fulfilment":"DELIVERY"}`
	if status, code := errorCode(t, b.accountID, h.CreateQuote, "/v1/quotes", quoteBody); status != http.StatusConflict || code != "ORDERING_PAUSED" {
		t.Errorf("createQuote while paused = %d %s, want 409 ORDERING_PAUSED", status, code)
	}
	if status, code := errorCode(t, b.accountID, h.CreateOrder, "/v1/orders", `{"quote_id":"`+q.ID+`"}`); status != http.StatusConflict || code != "ORDERING_PAUSED" {
		t.Errorf("createOrder while paused = %d %s, want 409 ORDERING_PAUSED", status, code)
	}

	// The customer sees it on the cart before checkout.
	c, err := st.GetCart(ctx, b.accountID)
	if err != nil {
		t.Fatal(err)
	}
	if c.IsQuotable || !containsString(c.BlockingReasons, "ORDERING_PAUSED") {
		t.Errorf("cart while paused: is_quotable=%v blocking=%v, want false with ORDERING_PAUSED", c.IsQuotable, c.BlockingReasons)
	}

	// Off again: the same quote now places an order.
	setPause(t, pool, false)
	if _, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh); err != nil {
		t.Fatalf("CreateOrder after resume: %v", err)
	}
	if c, _ := st.GetCart(ctx, b.accountID); c != nil && containsString(c.BlockingReasons, "ORDERING_PAUSED") {
		t.Errorf("cart still blocked after resume: %v", c.BlockingReasons)
	}
}

// Orders placed before the pause carry on to the end: one the restaurant had
// already accepted reaches COMPLETED, and one still waiting for payment is
// authorised and accepted, all while new orders are refused.
func TestOrderingPause_PlacedOrdersCarryOn(t *testing.T) {
	pool := pausePool(t)
	st := NewStore(pool)
	ctx := context.Background()

	place := func() (basics, string) {
		b, _, q := quoted(t, pool, st)
		var fresh *Quote
		prepared, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
		if err != nil {
			t.Fatalf("place order while open: %v", err)
		}
		return b, prepared.OrderID
	}
	step := func(orderID string, to machine.State, actor machine.ActorKind) {
		t.Helper()
		req := TransitionRequest{OrderID: orderID, To: to, Actor: actor, Reason: "carries on while paused"}
		if to == machine.StatePreparing {
			req.PrepEtaMinutes = 20
		}
		if err := st.Transition(ctx, req); err != nil {
			t.Fatalf("%s → %s while paused: %v", orderID, to, err)
		}
	}

	_, accepted := place()
	step(accepted, machine.StateAuthorized, machine.ActorSystem)
	step(accepted, machine.StateRestaurantPending, machine.ActorSystem)
	step(accepted, machine.StatePreparing, machine.ActorRestaurant)
	b2, awaitingPayment := place()

	setPause(t, pool, true)

	step(accepted, machine.StateReadyForPickup, machine.ActorRestaurant)
	step(accepted, machine.StatePickedUp, machine.ActorRider)
	step(accepted, machine.StateDelivered, machine.ActorRider)
	step(accepted, machine.StateCompleted, machine.ActorSystem)

	step(awaitingPayment, machine.StateAuthorized, machine.ActorSystem)
	step(awaitingPayment, machine.StateRestaurantPending, machine.ActorSystem)
	step(awaitingPayment, machine.StatePreparing, machine.ActorRestaurant)

	v, err := st.GetOrderForCustomer(ctx, b2.accountID, awaitingPayment)
	if err != nil {
		t.Fatal(err)
	}
	if v.State != string(machine.StatePreparing) {
		t.Errorf("order placed before the pause is %s, want PREPARING", v.State)
	}
}

// The race the row lock exists for, first ordering: an order creation already
// holds the switch FOR SHARE when the pause arrives. The pause waits; the order
// commits first; by the time the pause commits the order is already there.
func TestOrderingPause_PauseWaitsForAnOrderInFlight(t *testing.T) {
	pool := pausePool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b, _, q := quoted(t, pool, st)

	// Hold the quote, so CreateOrder stops after it has read the switch FOR
	// SHARE (its first statement) and before it inserts the order.
	blocker, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = blocker.Rollback(ctx) }()
	if _, err := blocker.Exec(ctx, `SELECT id FROM quote WHERE id = $1 FOR UPDATE`, q.ID); err != nil {
		t.Fatal(err)
	}

	orderDone := make(chan error, 1)
	go func() {
		var fresh *Quote
		_, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
		orderDone <- err
	}()
	waitForLockWaiters(t, pool, 1)

	// ordersAtPauseCommit is how many of the customer's orders the pause
	// transaction could see just before it committed.
	pauseDone := make(chan int, 1)
	pauseErr := make(chan error, 1)
	go func() {
		tx, err := pool.Begin(ctx)
		if err != nil {
			pauseErr <- err
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if _, _, err := SetOrderingPauseTx(ctx, tx, true, "pause racing an order in flight", ""); err != nil {
			pauseErr <- err
			return
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM "order" WHERE account_id = $1`, b.accountID).Scan(&n); err != nil {
			pauseErr <- err
			return
		}
		if err := tx.Commit(ctx); err != nil {
			pauseErr <- err
			return
		}
		pauseDone <- n
	}()
	waitForLockWaiters(t, pool, 2)

	select {
	case <-pauseDone:
		t.Fatal("the pause committed while an order creation held the switch")
	case err := <-pauseErr:
		t.Fatalf("pause: %v", err)
	default:
	}

	if err := blocker.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-orderDone; err != nil {
		t.Fatalf("the order already under way must finish: %v", err)
	}
	select {
	case n := <-pauseDone:
		if n != 1 {
			t.Errorf("orders visible when the pause committed = %d, want 1 (the order must commit first)", n)
		}
	case err := <-pauseErr:
		t.Fatalf("pause: %v", err)
	case <-time.After(15 * time.Second):
		t.Fatal("the pause never committed")
	}

	// And from here on, nothing new gets in.
	if _, err := st.CreateQuote(ctx, QuoteRequest{AccountID: b.accountID, CartID: q.CartID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"}); !errors.Is(err, ErrOrderingPaused) {
		t.Errorf("quote after the pause committed: err = %v, want ErrOrderingPaused", err)
	}
}

// The race, second ordering: the pause holds the switch when an order creation
// starts. The order waits, sees the committed pause and is refused; no order
// row is ever created after the pause.
func TestOrderingPause_OrderStartedDuringPauseIsRefused(t *testing.T) {
	pool := pausePool(t)
	st := NewStore(pool)
	ctx := context.Background()
	b, _, q := quoted(t, pool, st)

	pause, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pause.Rollback(ctx) }()
	if _, _, err := SetOrderingPauseTx(ctx, pause, true, "pause racing a new order", ""); err != nil {
		t.Fatal(err)
	}

	orderDone := make(chan error, 1)
	go func() {
		var fresh *Quote
		_, err := st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: q.ID}, &fresh)
		orderDone <- err
	}()
	waitForLockWaiters(t, pool, 1)
	select {
	case err := <-orderDone:
		t.Fatalf("the order did not wait for the pause in progress: err = %v", err)
	default:
	}

	if err := pause.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-orderDone:
		if !errors.Is(err, ErrOrderingPaused) {
			t.Fatalf("order started during the pause: err = %v, want ErrOrderingPaused", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the order never finished")
	}
	if n := countOrders(t, pool, b.accountID); n != 0 {
		t.Errorf("an order was created after the pause committed: %d", n)
	}
}

func containsString(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
