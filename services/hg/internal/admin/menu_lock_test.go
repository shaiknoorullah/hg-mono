package admin

// The menu lock on the admin operations on a restaurant's behalf
// (https://github.com/shaiknoorullah/hg-mono/issues/256): while the restaurant is
// SUSPENDED or BANNED nobody changes its menu, admins included ("no even admins
// can't"), and a version waiting for review stays as it is, so deciding it is refused
// too. A DELISTED or LIVE restaurant's menu is edited as usual, and the review queue
// stays readable. The lock itself, and the race with a suspension, are pinned in
// internal/restaurant/menu_lock_test.go; the decision path takes the stronger lock,
// so it gets its own race test here.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant/menulocktest"
)

// adminMenuWriteCase is one admin menu write, sent through the real router.
type adminMenuWriteCase struct {
	name    string
	route   string // "METHOD pattern", as the router lists it
	success int
	path    func(d menuTestRestaurant) string
	body    func(d menuTestRestaurant) map[string]any
}

// adminMenuWrites lists every menu write route in this package. A menu write route
// without an entry here fails TestMenuLock_EveryAdminMenuWriteRouteHasACase.
var adminMenuWrites = []adminMenuWriteCase{
	{
		name:    "createMenuCategoryOnBehalf",
		route:   "POST /v1/admin/restaurants/{restaurantId}/menu/categories",
		success: http.StatusCreated,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/restaurants/" + d.restaurantID + "/menu/categories"
		},
		body: func(menuTestRestaurant) map[string]any {
			return map[string]any{"name": fmt.Sprintf("Lock test %d", time.Now().UnixNano())}
		},
	},
	{
		name:    "createMenuItemOnBehalf",
		route:   "POST /v1/admin/restaurants/{restaurantId}/menu/items",
		success: http.StatusCreated,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/restaurants/" + d.restaurantID + "/menu/items"
		},
		body: func(d menuTestRestaurant) map[string]any {
			return map[string]any{"category_id": d.categoryID, "name": "Halal Burger", "price_cents": 1500}
		},
	},
	{
		name:    "decideMenuVersion/APPROVE",
		route:   "POST /v1/admin/menu-reviews/{versionId}/decision",
		success: http.StatusOK,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/menu-reviews/" + d.versionID + "/decision"
		},
		body: func(menuTestRestaurant) map[string]any { return map[string]any{"decision": "APPROVE"} },
	},
	{
		name:    "decideMenuVersion/REJECT",
		route:   "POST /v1/admin/menu-reviews/{versionId}/decision",
		success: http.StatusOK,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/menu-reviews/" + d.versionID + "/decision"
		},
		body: func(menuTestRestaurant) map[string]any {
			return map[string]any{"decision": "REJECT", "reason_code": "MISLEADING_DESCRIPTION"}
		},
	},
	{
		// A price only: the seeded item has a version waiting for review, which a
		// claim-bearing edit would meet with 409 MENU_VERSION_PENDING.
		name:    "updateMenuItemOnBehalf",
		route:   "PATCH /v1/admin/restaurants/{restaurantId}/menu/items/{itemId}",
		success: http.StatusOK,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/restaurants/" + d.restaurantID + "/menu/items/" + d.menuItemID
		},
		body: func(menuTestRestaurant) map[string]any { return map[string]any{"price_cents": 1750} },
	},
	{
		name:    "deleteMenuItemOnBehalf",
		route:   "DELETE /v1/admin/restaurants/{restaurantId}/menu/items/{itemId}",
		success: http.StatusNoContent,
		path: func(d menuTestRestaurant) string {
			return "/v1/admin/restaurants/" + d.restaurantID + "/menu/items/" + d.menuItemID
		},
		body: func(menuTestRestaurant) map[string]any { return nil },
	},
}

// TestMenuLock_EveryAdminMenuWriteRouteHasACase is what stops an admin menu write added
// later from skipping the lock. It needs no database.
func TestMenuLock_EveryAdminMenuWriteRouteHasACase(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	Routes(r, &Handler{})

	covered := map[string]bool{}
	for _, c := range adminMenuWrites {
		covered[c.route] = true
	}
	routed := map[string]bool{}
	for _, route := range r.Routes() {
		method, pattern, _ := strings.Cut(route, " ")
		if method == http.MethodGet || !strings.Contains(pattern, "/menu") {
			continue
		}
		routed[route] = true
		if !covered[route] {
			t.Errorf("%s writes a restaurant's menu but has no case in adminMenuWrites: call "+
				"lockMenuOnBehalf first in its transaction, answer with "+
				"restaurant.RespondMenuLocked, and add the case", route)
		}
	}
	for route := range covered {
		if !routed[route] {
			t.Errorf("adminMenuWrites has %s, which is not a menu write route here", route)
		}
	}
}

// TestMenuLock_AdminRefusedWhileSuspendedOrBanned: for ADMIN and SUPER_ADMIN alike,
// every menu write on a suspended or banned restaurant's behalf is 403 MENU_LOCKED,
// and the menu, including the version waiting for review, is unchanged.
func TestMenuLock_AdminRefusedWhileSuspendedOrBanned(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)

	for _, role := range []httpx.Role{httpx.RoleAdmin, httpx.RoleSuperAdmin} {
		srv := buildAdminTestServer(t, pool, principalFor(t, pool, role))
		t.Cleanup(srv.Close)
		for _, state := range []string{"SUSPENDED", "BANNED"} {
			for _, c := range adminMenuWrites {
				t.Run(string(role)+"/"+state+"/"+c.name, func(t *testing.T) {
					d := seedMenuRestaurantFull(t, ctx, pool, sa)
					setRestaurantAccountState(t, pool, d.restaurantID, state)
					before := menulocktest.Fingerprint(t, pool, d.restaurantID)

					status, body := sendMenuWrite(t, srv, c, d)

					menulocktest.AssertLocked(t, status, []byte(body), state)
					if after := menulocktest.Fingerprint(t, pool, d.restaurantID); after != before {
						t.Errorf("a refused %s changed the menu", c.name)
					}
				})
			}
		}
	}
}

// TestMenuLock_AdminAllowedWhenDelistedOrLive: a delisted restaurant's menu stays
// editable, by admins as by the restaurant.
func TestMenuLock_AdminAllowedWhenDelistedOrLive(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	srv := buildAdminTestServer(t, pool, principalFor(t, pool, httpx.RoleAdmin))
	t.Cleanup(srv.Close)

	for _, state := range []string{"DELISTED", "LIVE"} {
		for _, c := range adminMenuWrites {
			t.Run(state+"/"+c.name, func(t *testing.T) {
				d := seedMenuRestaurantFull(t, ctx, pool, sa)
				setRestaurantAccountState(t, pool, d.restaurantID, state)
				before := menulocktest.Fingerprint(t, pool, d.restaurantID)

				status, body := sendMenuWrite(t, srv, c, d)

				if status != c.success {
					t.Fatalf("%s while %s: status=%d, want %d (body: %s)", c.name, state, status, c.success, body)
				}
				if after := menulocktest.Fingerprint(t, pool, d.restaurantID); after == before {
					t.Errorf("%s while %s answered %d but wrote nothing", c.name, state, status)
				}
			})
		}
	}
}

// TestMenuLock_ReviewQueueReadableWhileSuspended: the lock refuses changes, never
// reads. A suspended restaurant's pending version stays in the queue.
func TestMenuLock_ReviewQueueReadableWhileSuspended(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	d := seedMenuRestaurantFull(t, ctx, pool, sa)
	setRestaurantAccountState(t, pool, d.restaurantID, "SUSPENDED")
	srv := buildAdminTestServer(t, pool, principalFor(t, pool, httpx.RoleAdmin))
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/v1/admin/menu-reviews?restaurant_id=" + d.restaurantID)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listMenuReviewQueue while suspended: status=%d, want 200 (body: %s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), d.versionID) {
		t.Errorf("the suspended restaurant's pending version %s is missing from the queue: %s", d.versionID, body)
	}
}

// TestMenuLock_SuspensionCommittingDuringAnApproval_ApprovalRefused: an approval that
// arrives while a suspension holds the restaurant row waits for it, then is refused;
// the version is never approved after the suspension. Approval takes the row
// FOR UPDATE (restaurant.LockMenuForWriteExclusive), so it has its own test.
func TestMenuLock_SuspensionCommittingDuringAnApproval_ApprovalRefused(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	sa := seedSuperAdmin(t, ctx, pool)
	d := seedMenuRestaurantFull(t, ctx, pool, sa)
	srv := buildAdminTestServer(t, pool, principalFor(t, pool, httpx.RoleAdmin))
	t.Cleanup(srv.Close)
	before := menulocktest.Fingerprint(t, pool, d.restaurantID)

	suspension, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin suspension: %v", err)
	}
	defer suspension.Rollback(ctx) //nolint:errcheck
	var suspenderPID int
	if err := suspension.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&suspenderPID); err != nil {
		t.Fatalf("suspender pid: %v", err)
	}
	if _, err := suspension.Exec(ctx,
		`UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, d.restaurantID); err != nil {
		t.Fatalf("suspend: %v", err)
	}

	type result struct {
		status int
		body   string
	}
	done := make(chan result, 1)
	go func() {
		status, body := sendMenuWrite(t, srv, adminMenuWrites[2], d) // APPROVE
		done <- result{status, body}
	}()

	menulocktest.WaitForLockWaiter(t, pool, suspenderPID)
	if err := suspension.Commit(ctx); err != nil {
		t.Fatalf("commit suspension: %v", err)
	}

	select {
	case res := <-done:
		menulocktest.AssertLocked(t, res.status, []byte(res.body), "SUSPENDED")
	case <-time.After(10 * time.Second):
		t.Fatal("the approval never finished after the suspension committed")
	}
	if after := menulocktest.Fingerprint(t, pool, d.restaurantID); after != before {
		t.Error("an approval that waited for a suspension changed the menu after it")
	}
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func sendMenuWrite(t *testing.T, srv *httptest.Server, c adminMenuWriteCase, d menuTestRestaurant) (int, string) {
	t.Helper()
	b, _ := json.Marshal(c.body(d))
	method, _, _ := strings.Cut(c.route, " ")
	req, _ := http.NewRequest(method, srv.URL+c.path(d), bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("menu-lock-%d", time.Now().UnixNano()))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Errorf("request: %v", err)
		return 0, ""
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

// setRestaurantAccountState moves a seeded LIVE restaurant to state the way an admin
// action would leave it.
func setRestaurantAccountState(t *testing.T, pool *pgxpool.Pool, restaurantID, state string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE restaurant SET account_state = $2::restaurant_account_state WHERE id = $1`,
		restaurantID, state); err != nil {
		t.Fatalf("set account_state %s: %v", state, err)
	}
}
