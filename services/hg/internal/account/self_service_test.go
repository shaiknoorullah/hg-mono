package account_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// A signed-in person's own account, end to end through the handler and a real
// store: their profile, their devices and their notification inbox, and never
// anyone else's (another account's id is a 404, never their data). Runs on a
// database of its own, on HG_TEST_POSTGRES_DSN's server or in a throwaway
// container, so the weekly coverage scan, which has no shared database, runs
// it too.
func TestSelfService_OwnAccountOnly(t *testing.T) {
	pool := testseed.MigratedDatabase(t, "hg_account_self")
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)
	me, other, rider := customerPrincipal(f.customerAccountID), customerPrincipal(f.otherAccountID), riderPrincipal(f.riderAccountID)

	call := func(handler http.HandlerFunc, p httpx.Principal, method, path, body string, params ...string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r = withPrincipal(r, p)
		for i := 0; i+1 < len(params); i += 2 {
			r = withChiParam(r, params[i], params[i+1])
		}
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}

	t.Run("profile", func(t *testing.T) {
		w := call(h.GetCustomerProfile, me, http.MethodGet, "/v1/me/profile", "")
		var got struct {
			Data struct {
				AccountID string  `json:"account_id"`
				FirstName *string `json:"first_name"`
			} `json:"data"`
		}
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil ||
			got.Data.AccountID != f.customerAccountID || got.Data.FirstName == nil || *got.Data.FirstName != "Test" {
			t.Fatalf("own profile: %d %s", w.Code, w.Body)
		}
		// A rider has no customer profile to read.
		if w := call(h.GetCustomerProfile, rider, http.MethodGet, "/v1/me/profile", ""); w.Code != http.StatusForbidden {
			t.Errorf("rider reading a customer profile: %d, want 403", w.Code)
		}
		// A customer whose profile row is gone gets 404, not someone else's.
		if w := call(h.GetCustomerProfile, customerPrincipal(f.riderAccountID), http.MethodGet, "/v1/me/profile", ""); w.Code != http.StatusNotFound {
			t.Errorf("no profile row: %d %s, want 404", w.Code, w.Body)
		}

		// Another account's email is refused; a new one is taken and must be
		// verified again.
		otherEmail := ""
		if err := pool.QueryRow(t.Context(), `SELECT email::text FROM account WHERE id = $1`, f.otherAccountID).Scan(&otherEmail); err != nil {
			t.Fatal(err)
		}
		if w := call(h.UpdateCustomerProfile, me, http.MethodPatch, "/v1/me/profile", `{"email":"`+otherEmail+`"}`); w.Code != http.StatusUnprocessableEntity || errCode(w.Body.Bytes()) != "EMAIL_IN_USE" {
			t.Errorf("taking another account's email: %d %s, want 422 EMAIL_IN_USE", w.Code, w.Body)
		}
		if _, err := pool.Exec(t.Context(), `UPDATE account SET email_verified_at = now() WHERE id = $1`, f.customerAccountID); err != nil {
			t.Fatal(err)
		}
		w = call(h.UpdateCustomerProfile, me, http.MethodPatch, "/v1/me/profile", `{"first_name":"Amina","email":"amina.new@test.local"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("update: %d %s", w.Code, w.Body)
		}
		var stillVerified bool
		if err := pool.QueryRow(t.Context(), `SELECT email_verified_at IS NOT NULL FROM account WHERE id = $1`, f.customerAccountID).Scan(&stillVerified); err != nil || stillVerified {
			t.Errorf("a changed email is still verified (err %v); it must be verified again", err)
		}
		// An avatar must be an upload: an id that names none is 404.
		if w := call(h.UpdateCustomerProfile, me, http.MethodPatch, "/v1/me/profile", `{"avatar_object_id":"01999999-9999-7999-8999-999999999999"}`); w.Code != http.StatusNotFound {
			t.Errorf("avatar naming no upload: %d %s, want 404", w.Code, w.Body)
		}
	})

	t.Run("devices", func(t *testing.T) {
		const body = `{"expo_push_token":"ExponentPushToken[self-service]","device_id":"pixel-8","platform":"android","role_context":"CUSTOMER"}`
		for range 2 { // re-registering the same device updates it
			if w := call(h.RegisterDevice, me, http.MethodPost, "/v1/devices", body); w.Code != http.StatusOK {
				t.Fatalf("register: %d %s", w.Code, w.Body)
			}
		}
		var live int
		if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM device WHERE account_id = $1 AND revoked_at IS NULL`, f.customerAccountID).Scan(&live); err != nil || live != 1 {
			t.Fatalf("%d live devices after registering one twice (err %v), want 1", live, err)
		}
		if w := call(h.UnregisterDevice, other, http.MethodDelete, "/v1/devices/pixel-8", "", "deviceId", "pixel-8"); w.Code != http.StatusNotFound {
			t.Errorf("another account removing my device: %d, want 404", w.Code)
		}
		if w := call(h.UnregisterDevice, me, http.MethodDelete, "/v1/devices/pixel-8", "", "deviceId", "pixel-8"); w.Code != http.StatusNoContent {
			t.Fatalf("remove own device: %d %s", w.Code, w.Body)
		}
		if w := call(h.UnregisterDevice, me, http.MethodDelete, "/v1/devices/pixel-8", "", "deviceId", "pixel-8"); w.Code != http.StatusNotFound {
			t.Errorf("removing it again: %d, want 404", w.Code)
		}
	})

	t.Run("notifications", func(t *testing.T) {
		list := func(p httpx.Principal, query string) (ids []string, next *string) {
			t.Helper()
			w := call(h.ListNotifications, p, http.MethodGet, "/v1/notifications"+query, "")
			var got struct {
				Data []struct {
					ID string `json:"id"`
				} `json:"data"`
				Meta struct {
					NextCursor *string `json:"next_cursor"`
				} `json:"meta"`
			}
			if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil {
				t.Fatalf("list %s: %d %s", query, w.Code, w.Body)
			}
			for _, n := range got.Data {
				ids = append(ids, n.ID)
			}
			return ids, got.Meta.NextCursor
		}
		// A second notification of mine, so the inbox pages.
		if _, err := pool.Exec(t.Context(), `
			INSERT INTO notification (account_id, role_context, kind, title, body, priority)
			VALUES ($1, 'CUSTOMER', 'ORDER_PLACED', 'Another', 'Another order.', 'NORMAL')`, f.customerAccountID); err != nil {
			t.Fatal(err)
		}
		first, next := list(me, "?limit=1")
		if len(first) != 1 || next == nil {
			t.Fatalf("first page: %v next=%v; want one and a cursor", first, next)
		}
		second, _ := list(me, "?limit=1&cursor="+*next)
		if len(second) != 1 || second[0] == first[0] {
			t.Fatalf("second page: %v after %v", second, first)
		}
		for _, id := range append(first, second...) {
			if id == f.otherNotifID {
				t.Fatal("my inbox listed another account's notification")
			}
		}

		if w := call(h.MarkNotificationRead, me, http.MethodPost, "/read", "", "notificationId", f.otherNotifID); w.Code != http.StatusNotFound {
			t.Errorf("marking another account's notification: %d, want 404", w.Code)
		}
		if w := call(h.MarkNotificationRead, me, http.MethodPost, "/read", "", "notificationId", f.notificationID); w.Code != http.StatusNoContent {
			t.Fatalf("mark own read: %d %s", w.Code, w.Body)
		}
		unread, _ := list(me, "?unread_only=true")
		for _, id := range unread {
			if id == f.notificationID {
				t.Error("a read notification is still listed as unread")
			}
		}
		if len(unread) != 1 {
			t.Errorf("unread = %v, want just the other one", unread)
		}
	})
}
