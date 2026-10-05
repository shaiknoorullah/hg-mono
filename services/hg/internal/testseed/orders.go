package testseed

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanUpOrderFixtures registers, on t, the removal of what an order test seeds
// for one customer account and one restaurant: the account's orders and what
// was recorded about them, its quotes, carts and addresses, then the
// restaurant's menu, the restaurant and the account. Leaf rows go first, so no
// foreign key refuses a delete. Register it before CertifyRestaurant, whose own
// cleanup has to run first.
func CleanUpOrderFixtures(t testing.TB, pool *pgxpool.Pool, accountID, restaurantID string) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.Background()
		for _, del := range []struct{ sql, id string }{
			{`DELETE FROM order_line_addon WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID},
			{`DELETE FROM order_line WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID},
			{`DELETE FROM order_transition WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID},
			{`DELETE FROM deadline_audit WHERE subject_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID},
			{`DELETE FROM "order" WHERE account_id=$1`, accountID},
			{`DELETE FROM quote WHERE account_id=$1`, accountID},
			{`DELETE FROM cart_line_addon WHERE cart_line_id IN (SELECT cl.id FROM cart_line cl JOIN cart c ON c.id=cl.cart_id WHERE c.account_id=$1)`, accountID},
			{`DELETE FROM cart_line WHERE cart_id IN (SELECT id FROM cart WHERE account_id=$1)`, accountID},
			{`DELETE FROM cart WHERE account_id=$1`, accountID},
			{`DELETE FROM address WHERE account_id=$1`, accountID},
			{`DELETE FROM menu_item WHERE restaurant_id=$1`, restaurantID},
			{`DELETE FROM menu_category WHERE restaurant_id=$1`, restaurantID},
			{`DELETE FROM restaurant WHERE id=$1`, restaurantID},
			{`DELETE FROM account WHERE id=$1`, accountID},
		} {
			_, _ = pool.Exec(ctx, del.sql, del.id)
		}
	})
}

// WaitBlockedBy waits until some backend is waiting for a lock that the backend
// pid holds, and reports whether that happened within timeout. A race test uses
// it to know the other transaction has reached the lock before it lets go.
func WaitBlockedBy(t testing.TB, pool *pgxpool.Pool, pid uint32, timeout time.Duration) bool {
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
