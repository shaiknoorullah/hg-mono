package restaurant_test

// The menu lock on the restaurant's own menu writes
// (https://github.com/shaiknoorullah/hg-mono/issues/256): while the restaurant is
// SUSPENDED or BANNED every menu write is refused with 403 MENU_LOCKED and writes
// nothing; a DELISTED or LIVE restaurant edits its menu as usual; reading the menu is
// never locked; and a write racing a suspension either commits before it or is
// refused, never after it. The admin operations on a restaurant's behalf have the same
// tests in internal/admin/menu_lock_test.go.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant/menulocktest"
)

// menuWriteCase is one restaurant menu write, called the way its route calls it.
type menuWriteCase struct {
	op      string // the contract operationId of the route
	route   string // "METHOD pattern", as the router lists it
	success int    // the status of an allowed write
	call    func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder
}

// restaurantMenuWrites lists every menu write route in this package. A menu write
// route without an entry here fails TestMenuLock_EveryMenuWriteRouteHasACase.
var restaurantMenuWrites = []menuWriteCase{
	{
		op: "createMenuCategory", route: "POST /v1/restaurant/menu/categories", success: http.StatusCreated,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			body := fmt.Sprintf(`{"name":"Lock test %d"}`, time.Now().UnixNano())
			req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/categories", strings.NewReader(body))
			return serveAsOwner(h.CreateMenuCategory, req, f)
		},
	},
	{
		// The fixture's category holds its item: a fresh empty one is deleted.
		op: "deleteMenuCategory", route: "DELETE /v1/restaurant/menu/categories/{categoryId}", success: http.StatusNoContent,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			id := f.emptyCategoryID
			req := httptest.NewRequest(http.MethodDelete, "/v1/restaurant/menu/categories/"+id, nil)
			return serveAsOwner(h.DeleteMenuCategory, withChiParam(req, "categoryId", id), f)
		},
	},
	{
		op: "createMenuItem", route: "POST /v1/restaurant/menu/items", success: http.StatusCreated,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			body := fmt.Sprintf(`{"name":"Lamb Karahi","category_id":%q,"price_cents":2100}`, f.categoryID)
			req := httptest.NewRequest(http.MethodPost, "/v1/restaurant/menu/items", strings.NewReader(body))
			return serveAsOwner(h.CreateMenuItem, req, f)
		},
	},
	{
		// A price and a description in one save: the description would go to menu
		// review.
		op: "updateMenuItem", route: "PATCH /v1/restaurant/menu/items/{itemId}", success: http.StatusOK,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			body := `{"price_cents":1900,"description":"Now with saffron rice."}`
			req := httptest.NewRequest(http.MethodPatch, "/v1/restaurant/menu/items/"+f.menuItemID, strings.NewReader(body))
			return serveAsOwner(h.UpdateMenuItem, withChiParam(req, "itemId", f.menuItemID), f)
		},
	},
	{
		op: "deleteMenuItem", route: "DELETE /v1/restaurant/menu/items/{itemId}", success: http.StatusNoContent,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			req := httptest.NewRequest(http.MethodDelete, "/v1/restaurant/menu/items/"+f.menuItemID, nil)
			return serveAsOwner(h.DeleteMenuItem, withChiParam(req, "itemId", f.menuItemID), f)
		},
	},
	{
		op: "setMenuItemAvailability", route: "PUT /v1/restaurant/menu/items/{itemId}/availability", success: http.StatusOK,
		call: func(h *restaurant.Handler, f fixtures) *httptest.ResponseRecorder {
			body := `{"availability_state":"OUT_OF_STOCK"}`
			req := httptest.NewRequest(http.MethodPut, "/v1/restaurant/menu/items/"+f.menuItemID+"/availability", strings.NewReader(body))
			return serveAsOwner(h.SetMenuItemAvailability, withChiParam(req, "itemId", f.menuItemID), f)
		},
	},
}

func serveAsOwner(handle http.HandlerFunc, req *http.Request, f fixtures) *httptest.ResponseRecorder {
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	rec := httptest.NewRecorder()
	handle(rec, req)
	return rec
}

// TestMenuLock_EveryMenuWriteRouteHasACase is what stops a menu write added later
// from skipping the lock: every write route under /v1/restaurant/menu must have a
// case in restaurantMenuWrites, and so is called against a suspended and a banned
// restaurant below. It needs no database.
func TestMenuLock_EveryMenuWriteRouteHasACase(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "test"})
	restaurant.Routes(r, restaurant.NewHandler(nil, nil, nil))

	covered := map[string]string{}
	for _, c := range restaurantMenuWrites {
		covered[c.route] = c.op
	}
	routed := map[string]bool{}
	for _, route := range r.Routes() {
		method, pattern, _ := strings.Cut(route, " ")
		if method == http.MethodGet || !strings.Contains(pattern, "/menu") {
			continue
		}
		routed[route] = true
		if _, ok := covered[route]; !ok {
			t.Errorf("%s writes the menu but has no case in restaurantMenuWrites: call "+
				"restaurant.LockMenuForWrite first in its transaction, answer with "+
				"restaurant.RespondMenuLocked, and add the case", route)
		}
	}
	for route, op := range covered {
		if !routed[route] {
			t.Errorf("restaurantMenuWrites has %s (%s), which is not a menu write route here", op, route)
		}
	}
}

// TestMenuLock_RefusedWhileSuspendedOrBanned: every menu write is 403 MENU_LOCKED
// with the account state in details, and the menu is byte-for-byte unchanged.
func TestMenuLock_RefusedWhileSuspendedOrBanned(t *testing.T) {
	pool := testPool(t)
	h := newHandler(pool)

	for _, state := range []string{"SUSPENDED", "BANNED"} {
		for _, c := range restaurantMenuWrites {
			t.Run(state+"/"+c.op, func(t *testing.T) {
				f := seedFixtures(t, pool)
				setAccountState(t, pool, f.restaurantID, state)
				before := menulocktest.Fingerprint(t, pool, f.restaurantID)

				rec := c.call(h, f)

				assertMenuLocked(t, rec, state)
				if after := menulocktest.Fingerprint(t, pool, f.restaurantID); after != before {
					t.Errorf("a refused %s changed the menu", c.op)
				}
			})
		}
	}
}

// TestMenuLock_AllowedWhenDelistedOrLive: delisting is not a penalty, so a delisted
// restaurant (for example one whose certificate expired) still edits its menu.
func TestMenuLock_AllowedWhenDelistedOrLive(t *testing.T) {
	pool := testPool(t)
	h := newHandler(pool)

	for _, state := range []string{"DELISTED", "LIVE"} {
		for _, c := range restaurantMenuWrites {
			t.Run(state+"/"+c.op, func(t *testing.T) {
				f := seedFixtures(t, pool)
				setAccountState(t, pool, f.restaurantID, state)
				before := menulocktest.Fingerprint(t, pool, f.restaurantID)

				rec := c.call(h, f)

				if rec.Code != c.success {
					t.Fatalf("%s while %s: status=%d, want %d (body: %s)",
						c.op, state, rec.Code, c.success, rec.Body.String())
				}
				if after := menulocktest.Fingerprint(t, pool, f.restaurantID); after == before {
					t.Errorf("%s while %s answered %d but wrote nothing", c.op, state, rec.Code)
				}
			})
		}
	}
}

// TestMenuLock_OwnMenuReadableWhileSuspended: the lock refuses changes, never reads.
func TestMenuLock_OwnMenuReadableWhileSuspended(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	setAccountState(t, pool, f.restaurantID, "SUSPENDED")

	req := httptest.NewRequest(http.MethodGet, "/v1/restaurant/menu", nil)
	rec := serveAsOwner(h.GetOwnMenu, req, f)

	if rec.Code != http.StatusOK {
		t.Fatalf("getOwnMenu while suspended: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), f.menuItemID) {
		t.Errorf("getOwnMenu while suspended does not show the seeded item %s", f.menuItemID)
	}
}

// TestMenuLock_SuspensionCommittingDuringAWrite_WriteRefused: the suspension holds the
// restaurant row when the save arrives. The save waits for it, reads SUSPENDED once it
// commits, and is refused: it is never written after the suspension.
func TestMenuLock_SuspensionCommittingDuringAWrite_WriteRefused(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()
	before := menulocktest.Fingerprint(t, pool, f.restaurantID)

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
		`UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, f.restaurantID); err != nil {
		t.Fatalf("suspend: %v", err)
	}

	var update menuWriteCase
	for _, c := range restaurantMenuWrites {
		if c.op == "updateMenuItem" {
			update = c
		}
	}
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- update.call(h, f) }()

	menulocktest.WaitForLockWaiter(t, pool, suspenderPID)
	if err := suspension.Commit(ctx); err != nil {
		t.Fatalf("commit suspension: %v", err)
	}

	select {
	case rec := <-done:
		assertMenuLocked(t, rec, "SUSPENDED")
	case <-time.After(10 * time.Second):
		t.Fatal("the save never finished after the suspension committed")
	}
	if after := menulocktest.Fingerprint(t, pool, f.restaurantID); after != before {
		t.Error("a save that waited for a suspension changed the menu after it")
	}
}

// TestMenuLock_WriteHoldingTheLock_CommitsBeforeTheSuspension: the save took the
// lock first. The suspension waits for it, so the save commits before the
// suspension does, and the next save is refused.
func TestMenuLock_WriteHoldingTheLock_CommitsBeforeTheSuspension(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	write, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin write: %v", err)
	}
	defer write.Rollback(ctx) //nolint:errcheck
	if err := restaurant.LockMenuForWrite(ctx, write, f.restaurantID); err != nil {
		t.Fatalf("LockMenuForWrite on a restaurant that is not suspended: %v", err)
	}
	var writerPID int
	if err := write.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&writerPID); err != nil {
		t.Fatalf("writer pid: %v", err)
	}

	suspended := make(chan error, 1)
	go func() {
		_, err := pool.Exec(ctx,
			`UPDATE restaurant SET account_state = 'SUSPENDED' WHERE id = $1`, f.restaurantID)
		suspended <- err
	}()

	menulocktest.WaitForLockWaiter(t, pool, writerPID)
	select {
	case err := <-suspended:
		t.Fatalf("the suspension committed while a menu write held the lock (err=%v)", err)
	default:
	}
	var categoryID string
	if err := write.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Written before the suspension')
		RETURNING id::text`, f.restaurantID).Scan(&categoryID); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := write.Commit(ctx); err != nil {
		t.Fatalf("commit write: %v", err)
	}

	select {
	case err := <-suspended:
		if err != nil {
			t.Fatalf("suspend: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the suspension never finished after the write committed")
	}
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM menu_category WHERE id = $1)`, categoryID).Scan(&exists); err != nil || !exists {
		t.Fatalf("the write that held the lock is missing (exists=%v, err=%v)", exists, err)
	}

	// The next save meets the suspension.
	assertMenuLocked(t, restaurantMenuWrites[0].call(h, f), "SUSPENDED")
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// setAccountState moves the restaurant to state the way an admin action would leave
// it. LIVE needs the columns its CHECK constraints ask for.
func setAccountState(t *testing.T, pool *pgxpool.Pool, restaurantID, state string) {
	t.Helper()
	q := `UPDATE restaurant SET account_state = $2::restaurant_account_state WHERE id = $1`
	if state == "LIVE" {
		q = `UPDATE restaurant SET account_state = 'LIVE', onboarding_state = 'ACTIVE',
		            province = 'ON', city = 'Toronto',
		            location = ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography
		      WHERE id = $1 AND $2 = 'LIVE'`
	}
	if _, err := pool.Exec(context.Background(), q, restaurantID, state); err != nil {
		t.Fatalf("set account_state %s: %v", state, err)
	}
}

// assertMenuLocked fails the test unless rec is 403 MENU_LOCKED for state.
func assertMenuLocked(t *testing.T, rec *httptest.ResponseRecorder, state string) {
	t.Helper()
	menulocktest.AssertLocked(t, rec.Code, rec.Body.Bytes(), state)
}
