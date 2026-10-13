package restaurant_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// TestIntegration_AcceptOrder_AfterClosing: the order path refuses a restaurant
// that is not open now (orders/open_now.go), but only for a new order. An order
// placed inside the hours keeps its full response window and can still be
// accepted after the restaurant closed, paused, turned its toggle off or lost
// its order screen (R-22 rule 3 and acceptance criterion 4 in
// docs/spec/03-restaurant.md).
// https://github.com/shaiknoorullah/hg-mono/issues/648
func TestIntegration_AcceptOrder_AfterClosing(t *testing.T) {
	pool := testPool(t)
	f := seedOrderableFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	// Closed every way at once: no hours today, a closed override, paused,
	// toggle off and an order screen last seen 10 minutes ago.
	ctx := context.Background()
	for _, q := range []string{
		`DELETE FROM restaurant_hours WHERE restaurant_id = $1`,
		`INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed)
		 SELECT r.id, (now() AT TIME ZONE r.timezone)::date, true FROM restaurant r WHERE r.id = $1`,
		`UPDATE restaurant SET is_accepting_orders = false, pause_until = now() + interval '1 hour',
		        last_heartbeat_at = now() - interval '10 minutes' WHERE id = $1`,
	} {
		if _, err := pool.Exec(ctx, q, f.restaurantID); err != nil {
			t.Fatalf("close the restaurant: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM restaurant_hours_override WHERE restaurant_id = $1`, f.restaurantID)
	})

	pay := &fakePayActions{}
	h := restaurant.NewHandler(restaurant.NewRepo(pool), nil, pay)
	req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/orders/"+orderID+"/accept", strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()
	h.AcceptOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("accept after closing: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id = $1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if state != "PREPARING" {
		t.Errorf("order state = %s, want PREPARING", state)
	}
}
