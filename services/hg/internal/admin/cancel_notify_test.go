package admin

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// recordingNotifier stands in for the orders.EventEmitter cmd/hg/main.go wires
// (it enqueues the customer's notification in the transition's transaction).
// It records each state it is told about, and whether that transaction was
// still open, i.e. the notification would commit with the cancel.
type recordingNotifier struct {
	mu     sync.Mutex
	states map[string][]string
}

func (n *recordingNotifier) EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	var one int
	if err := tx.QueryRow(ctx, `SELECT 1`).Scan(&one); err != nil {
		return fmt.Errorf("notifier called outside the cancel's transaction: %w", err)
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.states[orderID] = append(n.states[orderID], newState)
	return nil
}

// TestCancelOrderAdmin_EmitsEventAndNotifies: a support or admin cancel writes
// the order.state_changed event for CANCELLED and hands the change to the
// orders module's notifier, the one main.go wires, in the cancel's transaction
// (https://github.com/shaiknoorullah/hg-mono/issues/352).
func TestCancelOrderAdmin_EmitsEventAndNotifies(t *testing.T) {
	pool := dialTestPool(t)
	for _, c := range []struct {
		role  httpx.Role
		state string
	}{
		{httpx.RoleSupportAgent, "CREATED"},
		{httpx.RoleAdmin, "RESTAURANT_PENDING"},
	} {
		t.Run(string(c.role), func(t *testing.T) {
			orderID, _ := seedOrderForAdmin(t, pool, c.state)
			rec := &recordingNotifier{states: map[string][]string{}}

			router := httpx.NewRouter(httpx.Options{
				Env:           "local",
				Authenticator: fixedPrincipalAuth{principalFor(t, pool, c.role)},
				Authorizer:    auth.Matrix{},
			})
			Routes(router, NewHandler(NewRepo(pool).WithOrdersStore(orders.NewStore(pool, rec)), DefaultConfig()))
			srv := httptest.NewServer(router)
			defer srv.Close()

			resp := doJSON(t, http.MethodPost,
				fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
				map[string]any{
					"reason_code": "SUPPORT_CANCELLED",
					"reason_text": "Customer asked support to cancel the order.",
					"case_id":     "00000000-0000-0000-0000-000000000099",
				},
				map[string]string{"Idempotency-Key": "test-idem-key-cancel-notifies-" + orderID},
			)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("cancel: want 200, got %d — %v", resp.StatusCode, decodeBody(t, resp))
			}

			if got := rec.states[orderID]; len(got) != 1 || got[0] != "CANCELLED" {
				t.Errorf("notifier saw %v, want [CANCELLED]", got)
			}
			var n int
			if err := pool.QueryRow(context.Background(), `
				SELECT count(*) FROM realtime_event
				 WHERE channel = $1 AND type = 'order.state_changed' AND payload->>'to' = 'CANCELLED'`,
				"order:"+orderID).Scan(&n); err != nil {
				t.Fatalf("read realtime_event: %v", err)
			}
			if n != 1 {
				t.Errorf("order.state_changed CANCELLED events = %d, want 1", n)
			}
		})
	}
}
