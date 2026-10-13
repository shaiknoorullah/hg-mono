package admin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// headerAuthenticator takes the caller from two test headers, so a request can
// be made as any role while the real permission matrix (auth.Matrix) decides.
type headerAuthenticator struct{}

func (headerAuthenticator) Authenticate(_ context.Context, r *http.Request) (httpx.Principal, error) {
	acct, role := r.Header.Get("X-Test-Account-ID"), r.Header.Get("X-Test-Role")
	if acct == "" {
		return httpx.AnonymousPrincipal(), nil
	}
	return httpx.Principal{
		AccountID: acct,
		// The audit row stores the session id in a uuid column.
		SessionID: "00000000-0000-4000-8000-00000000a244",
		Roles:     []httpx.Role{httpx.Role(role)},
		AMR:       []string{"pwd+totp"},
	}, nil
}

// The platform-wide pause on new orders
// (https://github.com/shaiknoorullah/hg-mono/issues/244), from the staff side:
// every staff role can read it, only ADMIN and SUPER_ADMIN can change it,
// everyone else is refused with 403, and each change writes one audit row with
// its reason in the same transaction. Runs on a database of its own: pausing
// the shared test database would refuse other packages' orders.
func TestOrderingPause_RolesAndAudit(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testseed.FreshDatabase(t, "hg_admin_pause"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	account := func(role string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO account (email, status)
			VALUES ('pause-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, $2, 'GLOBAL')`, id, role); err != nil {
			t.Fatal(err)
		}
		return id
	}
	admin, superAdmin, support, customer := account("ADMIN"), account("SUPER_ADMIN"), account("SUPPORT_AGENT"), account("CUSTOMER")

	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: headerAuthenticator{}, Authorizer: auth.Matrix{}})
	Routes(router, NewHandler(NewRepo(pool), DefaultConfig()))
	if err := router.Verify(); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	type pauseView struct {
		Paused      bool    `json:"paused"`
		PausedSince *string `json:"paused_since"`
		Reason      *string `json:"reason"`
		ChangedBy   *string `json:"changed_by"`
	}
	call := func(method, accountID, role, body string) (int, string, pauseView) {
		t.Helper()
		var rd io.Reader
		if body != "" {
			rd = strings.NewReader(body)
		}
		req, err := http.NewRequest(method, srv.URL+"/v1/admin/ordering-pause", rd)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Test-Account-ID", accountID)
		req.Header.Set("X-Test-Role", role)
		req.Header.Set("Idempotency-Key", "pause-test-"+accountID)
		req.Header.Set("Content-Type", "application/json")
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var env struct {
			Data  pauseView `json:"data"`
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
			t.Fatalf("%s as %s: decode: %v", method, role, err)
		}
		return resp.StatusCode, env.Error.Code, env.Data
	}
	const pause = `{"paused": true, "reason": "Stripe is refusing authorisations during their incident"}`

	// A support agent reads it but cannot change it; a customer can do neither.
	if status, _, v := call(http.MethodGet, support, "SUPPORT_AGENT", ""); status != http.StatusOK || v.Paused {
		t.Fatalf("support agent GET = %d paused=%v, want 200 open", status, v.Paused)
	}
	for _, c := range []struct{ method, who, role, body string }{
		{http.MethodPut, support, "SUPPORT_AGENT", pause},
		{http.MethodPut, customer, "CUSTOMER", pause},
		{http.MethodGet, customer, "CUSTOMER", ""},
	} {
		if status, code, _ := call(c.method, c.who, c.role, c.body); status != http.StatusForbidden || code != "FORBIDDEN" {
			t.Errorf("%s as %s = %d %s, want 403 FORBIDDEN", c.method, c.role, status, code)
		}
	}

	// A body the contract refuses changes nothing.
	for _, body := range []string{`{"reason": "no paused field in this body at all"}`, `{"paused": true, "reason": "short"}`} {
		if status, code, _ := call(http.MethodPut, admin, "ADMIN", body); status != http.StatusUnprocessableEntity || code != "VALIDATION_FAILED" {
			t.Errorf("PUT %s = %d %s, want 422 VALIDATION_FAILED", body, status, code)
		}
	}

	// An admin pauses.
	status, _, v := call(http.MethodPut, admin, "ADMIN", pause)
	if status != http.StatusOK || !v.Paused || v.PausedSince == nil || v.ChangedBy == nil || *v.ChangedBy != admin {
		t.Fatalf("admin pause = %d %+v, want 200 paused since now, changed by the admin", status, v)
	}
	since := *v.PausedSince

	// A super admin re-states the pause with a new reason: it stays paused
	// from the same moment.
	status, _, v = call(http.MethodPut, superAdmin, "SUPER_ADMIN", `{"paused": true, "reason": "Still down; Stripe now expects a fix by 15:00"}`)
	if status != http.StatusOK || !v.Paused || v.PausedSince == nil || *v.PausedSince != since {
		t.Errorf("re-stated pause = %d %+v, want paused_since kept at %s", status, v, since)
	}

	// A super admin resumes.
	status, _, v = call(http.MethodPut, superAdmin, "SUPER_ADMIN", `{"paused": false, "reason": "Stripe incident resolved; test checkout passed"}`)
	if status != http.StatusOK || v.Paused || v.PausedSince != nil || v.ChangedBy == nil || *v.ChangedBy != superAdmin {
		t.Errorf("super admin resume = %d %+v, want 200 open, changed by the super admin", status, v)
	}

	// One audit row per change, with the actor, the reason and the switch
	// before and after; nothing for the refused calls.
	rows, err := pool.Query(ctx, `
		SELECT action, subject_type, actor_account_id::text, reason,
		       (before->>'paused')::boolean, (after->>'paused')::boolean
		  FROM audit_event
		 WHERE action LIKE 'ordering.%'
		 ORDER BY day, seq`)
	if err != nil {
		t.Fatal(err)
	}
	type auditRow struct {
		action, subject, actor, reason string
		before, after                  bool
	}
	var got []auditRow
	for rows.Next() {
		var a auditRow
		if err := rows.Scan(&a.action, &a.subject, &a.actor, &a.reason, &a.before, &a.after); err != nil {
			t.Fatal(err)
		}
		got = append(got, a)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []auditRow{
		{"ordering.pause", "PLATFORM", admin, "Stripe is refusing authorisations during their incident", false, true},
		{"ordering.pause", "PLATFORM", superAdmin, "Still down; Stripe now expects a fix by 15:00", true, true},
		{"ordering.resume", "PLATFORM", superAdmin, "Stripe incident resolved; test checkout passed", true, false},
	}
	if len(got) != len(want) {
		t.Fatalf("audit rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("audit row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
