package restaurant_test

// A restaurant that is not LIVE, or whose halal certificate is not current now,
// cannot take an order by accepting one: acceptOrder answers 409
// RESTAURANT_UNAVAILABLE, nothing is captured, and the order stays
// RESTAURANT_PENDING until its deadline cancels it and releases the
// authorisation. The check runs under a FOR SHARE lock on the restaurant row,
// so a suspension that holds the row is waited for and then refuses the accept.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/328

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// assertAcceptRefused checks that accepting the order was refused with 409
// RESTAURANT_UNAVAILABLE and left no trace: the order is still
// RESTAURANT_PENDING, it has no PREPARING transition, and nothing was captured.
func assertAcceptRefused(t *testing.T, pool *pgxpool.Pool, rec *httptest.ResponseRecorder, pay *fakePayActions, orderID string) {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if rec.Code != http.StatusConflict || env.Error.Code != "RESTAURANT_UNAVAILABLE" {
		t.Errorf("accept: %d %s, want 409 RESTAURANT_UNAVAILABLE (body: %s)", rec.Code, env.Error.Code, rec.Body.String())
	}
	var state string
	var accepted int
	if err := pool.QueryRow(context.Background(), `
		SELECT o.state::text,
		       (SELECT count(*) FROM order_transition tr WHERE tr.order_id = o.id AND tr.to_state = 'PREPARING')
		  FROM "order" o WHERE o.id = $1`, orderID).Scan(&state, &accepted); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if state != "RESTAURANT_PENDING" || accepted != 0 {
		t.Errorf("order is %s with %d PREPARING transition(s), want RESTAURANT_PENDING with none", state, accepted)
	}
	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.captureCalls) != 0 {
		t.Errorf("Capture called %d time(s) for an accept that was refused", len(pay.captureCalls))
	}
}

func TestIntegration_AcceptOrder_RefusedWhenRestaurantCannotTakeOrders(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	t.Run("suspended after the order was placed", func(t *testing.T) {
		f := seedOrderableFixtures(t, pool)
		orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")
		if _, err := pool.Exec(ctx, `UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, f.restaurantID); err != nil {
			t.Fatal(err)
		}
		pay := &fakePayActions{}
		rec := acceptOnce(t, restaurant.NewHandler(restaurant.NewRepo(pool), nil, pay), orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
		assertAcceptRefused(t, pool, rec, pay, orderID)
	})

	t.Run("halal certificate lapsed after the order was placed, before any job has run", func(t *testing.T) {
		f := seedOrderableFixtures(t, pool)
		orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")
		// The certificate's last day passes, and the stored row still says
		// LIVE and CERTIFIED, as it does until something derives it again
		// (https://github.com/shaiknoorullah/hg-mono/issues/252).
		for _, q := range []string{
			`UPDATE halal_certificate SET issued_on = current_date - 367, expires_on = current_date - 2 WHERE restaurant_id = $1`,
			`UPDATE restaurant SET halal_status = 'CERTIFIED', account_state = 'LIVE' WHERE id = $1`,
		} {
			if _, err := pool.Exec(ctx, q, f.restaurantID); err != nil {
				t.Fatalf("%s: %v", q, err)
			}
		}
		pay := &fakePayActions{}
		rec := acceptOnce(t, restaurant.NewHandler(restaurant.NewRepo(pool), nil, pay), orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
		assertAcceptRefused(t, pool, rec, pay, orderID)
	})

	// A suspension holds the restaurant row FOR UPDATE when the accept
	// arrives. The accept waits for it, then sees SUSPENDED and is refused.
	// Without the lock, the accept read LIVE and moved the order to PREPARING
	// while the suspension was still running.
	t.Run("suspended while the accept is in flight: the accept waits, then is refused", func(t *testing.T) {
		f := seedOrderableFixtures(t, pool)
		orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")

		conn, err := pool.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Release()
		suspension, err := conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = suspension.Rollback(ctx) }()
		if _, err := suspension.Exec(ctx, `SELECT 1 FROM restaurant WHERE id = $1 FOR UPDATE`, f.restaurantID); err != nil {
			t.Fatal(err)
		}

		pay := &fakePayActions{}
		h := restaurant.NewHandler(restaurant.NewRepo(pool), nil, pay)
		done := make(chan *httptest.ResponseRecorder, 1)
		go func() { done <- acceptOnce(t, h, orderID, f.ownerAccountID, httpx.RoleRestaurantOwner) }()
		if !testseed.WaitBlockedBy(t, pool, conn.Conn().PgConn().PID(), time.Second) {
			t.Errorf("the accept did not wait for the suspension's lock on the restaurant row")
		}
		if _, err := suspension.Exec(ctx, `UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, f.restaurantID); err != nil {
			t.Fatal(err)
		}
		if err := suspension.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		assertAcceptRefused(t, pool, <-done, pay, orderID)
	})
}
