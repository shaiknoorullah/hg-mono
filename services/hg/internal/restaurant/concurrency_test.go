package restaurant_test

// Stage-3 boundary audit — concurrency / idempotency (boundary F) and
// data-isolation follow-ups (boundary C) that require the seeded database.
//
// The order-lifecycle writes reuse the orders state machine: AcceptOrder locks
// the row FOR UPDATE and refuses any state other than RESTAURANT_PENDING. The
// audit here proves that running the same write twice — sequentially and
// concurrently — produces exactly ONE effect (one PREPARING transition), never
// a double capture or a duplicate transition row.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// acceptOnce drives one accept request against the handler and returns the
// recorder. Each call builds its own recorder so concurrent calls do not race
// on a shared writer.
func acceptOnce(t *testing.T, h interface {
	AcceptOrder(http.ResponseWriter, *http.Request)
}, orderID, accountID string, role httpx.Role) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/v1/restaurant/orders/%s/accept", orderID), strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(accountID, role))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()
	h.AcceptOrder(rec, req)
	return rec
}

// TestIntegration_AcceptOrder_DoubleAccept_SequentialIdempotent: accepting a
// RESTAURANT_PENDING order twins into (200, then 409). The state machine forbids
// PREPARING → PREPARING via accept, so the second call cannot re-capture. Exactly
// one PREPARING transition row must exist afterwards.
func TestIntegration_AcceptOrder_DoubleAccept_SequentialIdempotent(t *testing.T) {
	pool := testPool(t)
	f := seedOrderableFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")
	h := newHandler(pool)

	rec1 := acceptOnce(t, h, orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first accept: status=%d, want 200 (body: %s)", rec1.Code, rec1.Body.String())
	}
	rec2 := acceptOnce(t, h, orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
	if rec2.Code != http.StatusConflict {
		t.Fatalf("second accept: status=%d, want 409 (no double effect) (body: %s)", rec2.Code, rec2.Body.String())
	}

	// Exactly one accept transition (RESTAURANT_PENDING → PREPARING) must exist.
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM order_transition
		 WHERE order_id=$1 AND from_state='RESTAURANT_PENDING' AND to_state='PREPARING'`,
		orderID).Scan(&n); err != nil {
		t.Fatalf("count transitions: %v", err)
	}
	if n != 1 {
		t.Errorf("accept produced %d PREPARING transitions, want exactly 1 (double-effect leak)", n)
	}

	// The order must be PREPARING exactly once, not multiply-captured.
	var state string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "PREPARING" {
		t.Errorf("order state=%q, want PREPARING", state)
	}
}

// TestIntegration_AcceptOrder_ConcurrentAccept_SingleEffect: two goroutines race
// to accept the same RESTAURANT_PENDING order. The row-level FOR UPDATE lock
// serialises them, so exactly one wins (200) and the other loses (409). Under no
// interleaving may both succeed or two transition rows be written.
func TestIntegration_AcceptOrder_ConcurrentAccept_SingleEffect(t *testing.T) {
	pool := testPool(t)
	f := seedOrderableFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")
	h := newHandler(pool)

	const n = 2
	codes := make([]int, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			rec := acceptOnce(t, h, orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
			codes[i] = rec.Code
		}()
	}
	wg.Wait()

	ok, conflict := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d in concurrent accept", c)
		}
	}
	if ok != 1 {
		t.Errorf("concurrent accept: %d succeeded, want exactly 1 (double-effect leak)", ok)
	}
	if conflict != 1 {
		t.Errorf("concurrent accept: %d conflicted, want exactly 1", conflict)
	}

	var trans int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM order_transition
		 WHERE order_id=$1 AND from_state='RESTAURANT_PENDING' AND to_state='PREPARING'`,
		orderID).Scan(&trans); err != nil {
		t.Fatalf("count transitions: %v", err)
	}
	if trans != 1 {
		t.Errorf("concurrent accept wrote %d PREPARING transitions, want exactly 1", trans)
	}
}

// TestIntegration_RejectOrder_IDOR_Returns404: a restaurant cannot reject another
// restaurant's order. The ownership predicate is in the SQL WHERE (restaurant_id
// = caller's), so the foreign order is invisible — 404, never a 403 that would
// confirm the order exists, and never a state mutation.
func TestIntegration_RejectOrder_IDOR_Returns404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")
	h := newHandler(pool)

	// otherAccountID is scoped to otherRestID; rejecting the primary's order → 404.
	req := httptest.NewRequest(http.MethodPost,
		fmt.Sprintf("/v1/restaurant/orders/%s/reject", orderID),
		strings.NewReader(`{"reason_code":"ITEM_UNAVAILABLE"}`))
	req = withPrincipal(req, principalWith(f.otherAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()
	h.RejectOrder(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("IDOR reject: status=%d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	// The order must be untouched — still RESTAURANT_PENDING, not REJECTED.
	var state string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read state: %v", err)
	}
	if state != "RESTAURANT_PENDING" {
		t.Errorf("foreign reject mutated the order: state=%q, want RESTAURANT_PENDING (IDOR write leak)", state)
	}
}
