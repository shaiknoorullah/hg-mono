// Package menulocktest holds the Postgres helpers the menu lock's tests share
// (https://github.com/shaiknoorullah/hg-mono/issues/256). The restaurant's own
// menu writes are tested in internal/restaurant and the admin's writes on a
// restaurant's behalf in internal/admin, against the same lock, so both read the
// menu, wait for a lock and check a refusal through this one copy. Only tests
// import it.
package menulocktest

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Fingerprint digests every menu row of the restaurant (its categories, items and
// item versions), so a test can say the menu did or did not change without naming
// each column.
func Fingerprint(t testing.TB, pool *pgxpool.Pool, restaurantID string) string {
	t.Helper()
	var digest string
	if err := pool.QueryRow(context.Background(), `
		SELECT md5(
		  coalesce((SELECT string_agg(row_to_json(c)::text, ',' ORDER BY c.id) FROM menu_category c WHERE c.restaurant_id = $1), '') || '|' ||
		  coalesce((SELECT string_agg(row_to_json(i)::text, ',' ORDER BY i.id) FROM menu_item i WHERE i.restaurant_id = $1), '') || '|' ||
		  coalesce((SELECT string_agg(row_to_json(v)::text, ',' ORDER BY v.id) FROM menu_item_version v WHERE v.restaurant_id = $1), ''))`,
		restaurantID).Scan(&digest); err != nil {
		t.Fatalf("menu fingerprint: %v", err)
	}
	return digest
}

// WaitForLockWaiter waits until some backend is waiting on a lock the backend pid
// holds, which is how a race test knows the second party has reached the lock. It
// fails the test if nothing waits within 10 seconds.
func WaitForLockWaiter(t testing.TB, pool *pgxpool.Pool, pid int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := pool.QueryRow(context.Background(),
			`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY (pg_blocking_pids(pid)))`,
			pid).Scan(&blocked); err != nil {
			t.Fatalf("pg_blocking_pids: %v", err)
		}
		if blocked {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("nothing ever waited on backend %d's lock", pid)
}

// AssertLocked fails the test unless the response (its status and body) is the menu
// lock's refusal: 403 MENU_LOCKED with state as details.account_state.
func AssertLocked(t testing.TB, status int, body []byte, state string) {
	t.Helper()
	if status != http.StatusForbidden {
		t.Fatalf("status=%d, want 403 MENU_LOCKED (body: %s)", status, body)
	}
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				AccountState string `json:"account_state"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode error envelope: %v (body: %s)", err, body)
	}
	if env.Error.Code != "MENU_LOCKED" {
		t.Errorf("code=%q, want MENU_LOCKED", env.Error.Code)
	}
	if env.Error.Details.AccountState != state {
		t.Errorf("details.account_state=%q, want %q", env.Error.Details.AccountState, state)
	}
}
