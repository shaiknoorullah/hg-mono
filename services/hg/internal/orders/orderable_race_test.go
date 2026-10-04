package orders

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// An order placed at the moment its restaurant is suspended must not slip
// through: it is refused, or it commits first and the suspension finds it and
// cancels it. It is never left open at a suspended restaurant.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/328

// suspender stands in for an admin suspending a restaurant
// (https://github.com/shaiknoorullah/hg-mono/pull/335), in the order that action
// takes its steps: lock the restaurant row FOR UPDATE, cancel every order the
// restaurant has not accepted, then write SUSPENDED, all in one transaction. It
// holds its own connection, so its backend pid is known before it starts.
type suspender struct {
	conn *pgxpool.Conn
	pid  uint32
}

func newSuspender(t *testing.T, pool *pgxpool.Pool) *suspender {
	t.Helper()
	conn, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire the suspension's connection: %v", err)
	}
	t.Cleanup(conn.Release)
	return &suspender{conn: conn, pid: conn.Conn().PgConn().PID()}
}

// suspend runs the suspension and returns the orders it cancelled. afterLock,
// when set, runs once the restaurant row is locked and before the open orders
// are read.
func (s *suspender) suspend(ctx context.Context, restaurantID string, afterLock func()) ([]string, error) {
	tx, err := s.conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT 1 FROM restaurant WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, restaurantID); err != nil {
		return nil, fmt.Errorf("lock restaurant: %w", err)
	}
	if afterLock != nil {
		afterLock()
	}
	rows, err := tx.Query(ctx, `
		UPDATE "order"
		   SET state = 'CANCELLED', cancel_reason = 'RESTAURANT_CLOSED',
		       deadline_at = NULL, deadline_action = NULL, state_since = now()
		 WHERE restaurant_id = $1 AND state IN ('CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING')
		RETURNING id::text`, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("cancel open orders: %w", err)
	}
	var cancelled []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		cancelled = append(cancelled, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, restaurantID); err != nil {
		return nil, fmt.Errorf("suspend: %w", err)
	}
	return cancelled, tx.Commit(ctx)
}

// waitBlockedBy waits until some backend is waiting for a lock that the
// backend pid holds, and reports whether that happened within the timeout.
func waitBlockedBy(t *testing.T, pool *pgxpool.Pool, pid uint32, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var n int
		if err := pool.QueryRow(context.Background(), `
			SELECT count(*) FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))`,
			int(pid)).Scan(&n); err != nil {
			t.Fatalf("read lock waits: %v", err)
		}
		if n > 0 {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return false
}

// waitBlocked waits until the backend pid is waiting for a lock, and reports
// whether that happened within the timeout.
func waitBlocked(t *testing.T, pool *pgxpool.Pool, pid uint32, timeout time.Duration) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := pool.QueryRow(context.Background(),
			`SELECT cardinality(pg_blocking_pids($1::int)) > 0`, int(pid)).Scan(&blocked); err != nil {
			t.Fatalf("read lock waits: %v", err)
		}
		if blocked {
			return true
		}
		time.Sleep(2 * time.Millisecond)
	}
	return false
}

// orderResult is what placing the order returned.
type orderResult struct {
	orderID string
	err     error
}

func placeOrder(ctx context.Context, st *Store, pc pastCheckout) orderResult {
	var fresh *Quote
	p, err := st.CreateOrder(ctx, OrderInput{AccountID: pc.accountID, QuoteID: pc.quoteID}, &fresh)
	if err != nil {
		return orderResult{err: err}
	}
	return orderResult{orderID: p.OrderID}
}

// assertNoOrderSlippedThrough checks the end state of one race. The order is
// either refused with RESTAURANT_UNAVAILABLE or placed, and a placed order is
// one the suspension found and cancelled. No order is left open at the
// suspended restaurant.
func assertNoOrderSlippedThrough(t *testing.T, pool *pgxpool.Pool, pc pastCheckout, o orderResult, cancelled []string) {
	t.Helper()
	ctx := context.Background()
	switch {
	case o.err == nil:
		if !slices.Contains(cancelled, o.orderID) {
			t.Errorf("order %s was placed after the suspension read the restaurant's open orders (it cancelled %v)",
				o.orderID, cancelled)
		}
	case errors.Is(o.err, ErrRestaurantUnavailable):
	default:
		t.Errorf("create order: err = %v, want nil or ErrRestaurantUnavailable", o.err)
	}

	var state string
	if err := pool.QueryRow(ctx, `SELECT account_state::text FROM restaurant WHERE id = $1`, pc.restaurantID).Scan(&state); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if state != "SUSPENDED" {
		t.Fatalf("restaurant account_state = %s, want SUSPENDED", state)
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, state::text FROM "order"
		 WHERE restaurant_id = $1 AND state NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')`,
		pc.restaurantID)
	if err != nil {
		t.Fatalf("read open orders: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, st string
		if err := rows.Scan(&id, &st); err != nil {
			t.Fatalf("scan open order: %v", err)
		}
		t.Errorf("order %s is %s at a SUSPENDED restaurant", id, st)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read open orders: %v", err)
	}
}

// TestIntegrationSuspensionRacingAnOrder races placing an order against
// suspending its restaurant, on two connections released together by a
// barrier, then pins each ordering the race can take.
func TestIntegrationSuspensionRacingAnOrder(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	const wait = 5 * time.Second

	t.Run("the order commits first, and the suspension cancels it", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		o := placeOrder(ctx, st, pc)
		if o.err != nil {
			t.Fatalf("create order: %v", o.err)
		}
		cancelled, err := newSuspender(t, pool).suspend(ctx, pc.restaurantID, nil)
		if err != nil {
			t.Fatalf("suspend: %v", err)
		}
		assertNoOrderSlippedThrough(t, pool, pc, o, cancelled)
	})

	t.Run("the suspension commits first, and the order is refused", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		cancelled, err := newSuspender(t, pool).suspend(ctx, pc.restaurantID, nil)
		if err != nil {
			t.Fatalf("suspend: %v", err)
		}
		o := placeOrder(ctx, st, pc)
		if !errors.Is(o.err, ErrRestaurantUnavailable) {
			t.Errorf("create order: err = %v, want ErrRestaurantUnavailable", o.err)
		}
		assertNoOrderSlippedThrough(t, pool, pc, o, cancelled)
	})

	// The suspension holds the restaurant row while the order is being placed.
	// The order waits for it, then sees SUSPENDED and is refused. This is the
	// window of the issue: without the lock, the order read LIVE here and was
	// written once the suspension had committed.
	t.Run("the suspension locks the restaurant first: the order waits, then is refused", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		sp := newSuspender(t, pool)
		orderDone := make(chan orderResult, 1)
		cancelled, err := sp.suspend(ctx, pc.restaurantID, func() {
			go func() { orderDone <- placeOrder(ctx, st, pc) }()
			if !waitBlockedBy(t, pool, sp.pid, wait) {
				t.Errorf("placing the order did not wait for the suspension's lock on the restaurant row")
			}
		})
		if err != nil {
			t.Fatalf("suspend: %v", err)
		}
		o := <-orderDone
		if !errors.Is(o.err, ErrRestaurantUnavailable) {
			t.Errorf("create order: err = %v, want ErrRestaurantUnavailable", o.err)
		}
		assertNoOrderSlippedThrough(t, pool, pc, o, cancelled)
	})

	// The order's transaction holds the restaurant row and is held up before it
	// commits: a third connection holds the customer's account row FOR UPDATE,
	// and writing the order checks its foreign key to the account, after the
	// restaurant is locked and before the foreign key to the restaurant. The
	// suspension must wait for the order to commit, and then finds it and
	// cancels it. Without the lock, the suspension committed while the order
	// was held up, and the order was written after it.
	t.Run("the order locks the restaurant first: the suspension waits, then cancels it", func(t *testing.T) {
		pc := checkoutWhileCertified(t, st, pool)
		blocker := newSuspender(t, pool) // only its connection is used
		hold, err := blocker.conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = hold.Rollback(ctx) }()
		if _, err := hold.Exec(ctx, `SELECT 1 FROM account WHERE id = $1 FOR UPDATE`, pc.accountID); err != nil {
			t.Fatal(err)
		}
		orderDone := make(chan orderResult, 1)
		go func() { orderDone <- placeOrder(ctx, st, pc) }()
		if !waitBlockedBy(t, pool, blocker.pid, wait) {
			t.Fatalf("placing the order never reached the write of the order row")
		}

		sp := newSuspender(t, pool)
		type suspended struct {
			cancelled []string
			err       error
		}
		suspendDone := make(chan suspended, 1)
		go func() {
			cancelled, err := sp.suspend(ctx, pc.restaurantID, nil)
			suspendDone <- suspended{cancelled, err}
		}()
		if !waitBlocked(t, pool, sp.pid, time.Second) {
			t.Errorf("the suspension did not wait for the order transaction that holds the restaurant row")
		}
		if err := hold.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		o := <-orderDone
		if o.err != nil {
			t.Fatalf("create order: %v", o.err)
		}
		r := <-suspendDone
		if r.err != nil {
			t.Fatalf("suspend: %v", r.err)
		}
		assertNoOrderSlippedThrough(t, pool, pc, o, r.cancelled)
	})

	// The race itself: 40 rounds, each on a new restaurant, with the order and
	// the suspension on their own connections. A barrier releases both at once.
	// The suspension starts a little later each round, so the rounds cover both
	// outcomes and the moments in between.
	t.Run("40 rounds released by a barrier", func(t *testing.T) {
		const rounds = 40
		var placed, refused int
		for i := 0; i < rounds; i++ {
			// A subtest per round, so each round's restaurant is cleaned up
			// before the next is seeded.
			t.Run(fmt.Sprintf("round %d", i), func(t *testing.T) {
				pc := checkoutWhileCertified(t, st, pool)
				sp := newSuspender(t, pool)
				barrier := make(chan struct{})
				var wg sync.WaitGroup
				var o orderResult
				var cancelled []string
				var serr error
				wg.Add(2)
				go func() {
					defer wg.Done()
					<-barrier
					o = placeOrder(ctx, st, pc)
				}()
				go func() {
					defer wg.Done()
					<-barrier
					time.Sleep(time.Duration(i%8) * 400 * time.Microsecond)
					cancelled, serr = sp.suspend(ctx, pc.restaurantID, nil)
				}()
				close(barrier)
				wg.Wait()
				if serr != nil {
					t.Fatalf("suspend: %v", serr)
				}
				assertNoOrderSlippedThrough(t, pool, pc, o, cancelled)
				if o.err == nil {
					placed++
				} else {
					refused++
				}
			})
		}
		t.Logf("%d rounds: the order was placed in %d and refused in %d", rounds, placed, refused)
	})
}

// TestIntegrationOrderAndMenuApprovalDoNotDeadlock pins the lock order of the
// order path against an admin approving a menu item, which updates the item and
// then locks the restaurant row FOR UPDATE (restaurant.RecomputeOnboarding). The
// order locks the cart's items before the restaurant, the same order, so it
// waits for the approval instead of deadlocking with it.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/328
func TestIntegrationOrderAndMenuApprovalDoNotDeadlock(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	pc := checkoutWhileCertified(t, st, pool)

	approval := newSuspender(t, pool) // only its connection is used
	tx, err := approval.conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `UPDATE menu_item SET pending_version_id = NULL WHERE id = $1`, pc.menuItemID); err != nil {
		t.Fatal(err)
	}

	orderDone := make(chan orderResult, 1)
	go func() { orderDone <- placeOrder(ctx, st, pc) }()
	if !waitBlockedBy(t, pool, approval.pid, 5*time.Second) {
		t.Fatalf("placing the order never reached the menu item")
	}
	// The approval goes on to lock the restaurant. The order must not be
	// holding it.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM restaurant WHERE id = $1 FOR UPDATE`, pc.restaurantID); err != nil {
		t.Fatalf("the approval could not lock the restaurant: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit the approval: %v", err)
	}
	if o := <-orderDone; o.err != nil {
		t.Fatalf("create order: %v", o.err)
	}
}
