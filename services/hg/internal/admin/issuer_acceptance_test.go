package admin

// A halal certificate vouches for a restaurant only while its issuing body is
// accepted now. Withdrawing a body's acceptance takes the badge off the catalog
// and refuses orders in the same request; accepting it again restores both.
// Only a super admin signed in with an authenticator code can do either.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/346

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// issuerTestAuth reads the caller from test headers, so one server can act as
// any role: X-Test-Account, X-Test-Roles (comma-separated) and X-Test-AMR.
type issuerTestAuth struct{}

func (issuerTestAuth) Authenticate(_ context.Context, r *http.Request) (httpx.Principal, error) {
	acct := r.Header.Get("X-Test-Account")
	if acct == "" {
		return httpx.AnonymousPrincipal(), nil
	}
	p := httpx.Principal{AccountID: acct, SessionID: "00000000-0000-4000-8000-00000000346a"}
	for _, role := range strings.Split(r.Header.Get("X-Test-Roles"), ",") {
		p.Roles = append(p.Roles, httpx.Role(role))
	}
	if amr := r.Header.Get("X-Test-AMR"); amr != "" {
		p.AMR = []string{amr}
	}
	return p, nil
}

// issuerServer serves the admin and catalog routes with the production role
// matrix, and the admin repository wired to the real notification outbox.
func issuerServer(t *testing.T, pool *pgxpool.Pool) *httptest.Server {
	t.Helper()
	riverClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatalf("river client: %v", err)
	}
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: issuerTestAuth{}, Authorizer: auth.Matrix{}})
	Routes(router, NewHandler(NewRepo(pool).WithNotifier(notify.NewEnqueuer(notify.NewRepo(), riverClient)), DefaultConfig()))
	catalog.Routes(router, catalog.NewHandler(catalog.NewRepo(pool), nil, nil, nil))
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

type caller struct {
	account string
	roles   string
	amr     string
}

func call(t *testing.T, srv *httptest.Server, c caller, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", fmt.Sprintf("issuer-test-%d", rand.Int64()))
	if c.account != "" {
		req.Header.Set("X-Test-Account", c.account)
		req.Header.Set("X-Test-Roles", c.roles)
		req.Header.Set("X-Test-AMR", c.amr)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

// issuerWorld is one issuing body, the restaurant it alone vouches for, and the
// people around them.
type issuerWorld struct {
	srv                          *httptest.Server
	pool                         *pgxpool.Pool
	superAdmin, customer         string
	bodyID, bodyName             string
	restaurantID                 string
	lat, lng                     float64
	owner, manager, frontOfHouse string
}

func newAccount(t *testing.T, pool *pgxpool.Pool, role, scopeType string, scopeID any) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
INSERT INTO account (email, status) VALUES ('i346-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4)`,
		id, role, scopeType, scopeID); err != nil {
		t.Fatalf("grant %s: %v", role, err)
	}
	return id
}

func newIssuingBody(t *testing.T, pool *pgxpool.Pool, superAdmin, status string) (id, name string) {
	t.Helper()
	name = fmt.Sprintf("Issuer Test Halal Authority %d", rand.Int64())
	if err := pool.QueryRow(context.Background(), `
INSERT INTO halal_issuing_body (name, country, status, decided_by, decided_at)
VALUES ($1, 'CA', $2, $3, now()) RETURNING id`, name, status, superAdmin).Scan(&id); err != nil {
		t.Fatalf("seed issuing body: %v", err)
	}
	return id, name
}

// newListedRestaurant is a LIVE restaurant at a spot of its own, far from every
// other test restaurant, so a 500 m discovery search finds it alone.
func newListedRestaurant(t *testing.T, pool *pgxpool.Pool) (id string, lat, lng float64) {
	t.Helper()
	lat, lng = 49.0+rand.Float64(), -88.0+rand.Float64()
	if err := pool.QueryRow(context.Background(), `
INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code, location,
                        onboarding_state, account_state, is_accepting_orders)
VALUES ('i346-'||substr(md5(random()::text),1,12), 'Issuer Test Co', 'Issuer Test Kitchen', 'ON',
        'Thunder Bay', '1 Red River Rd', 'P7B1A1', ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        'ACTIVE', 'LIVE', true)
RETURNING id`, lat, lng).Scan(&id); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	return id, lat, lng
}

func newIssuerWorld(t *testing.T, bodyStatus string) issuerWorld {
	t.Helper()
	pool := dialTestPool(t)
	w := issuerWorld{srv: issuerServer(t, pool), pool: pool}
	w.superAdmin = newAccount(t, pool, "SUPER_ADMIN", "GLOBAL", nil)
	w.customer = newAccount(t, pool, "CUSTOMER", "GLOBAL", nil)
	w.bodyID, w.bodyName = newIssuingBody(t, pool, w.superAdmin, bodyStatus)
	w.restaurantID, w.lat, w.lng = newListedRestaurant(t, pool)
	w.owner = newAccount(t, pool, "RESTAURANT_OWNER", "RESTAURANT", w.restaurantID)
	w.manager = newAccount(t, pool, "RESTAURANT_MANAGER", "RESTAURANT", w.restaurantID)
	w.frontOfHouse = newAccount(t, pool, "RESTAURANT_STAFF", "RESTAURANT", w.restaurantID)
	testseed.CertifyRestaurantBy(t, pool, w.restaurantID, w.bodyID, 300)
	return w
}

func (w issuerWorld) setBodyStatus(t *testing.T, c caller, status string) (int, map[string]any) {
	t.Helper()
	return call(t, w.srv, c, "POST", "/v1/admin/halal-issuing-bodies/"+w.bodyID+"/status", map[string]any{
		"status":        status,
		"justification": "The certifying body's own accreditation is under review by the regulator.",
	})
}

func (w issuerWorld) superAdminCaller() caller {
	return caller{account: w.superAdmin, roles: "SUPER_ADMIN", amr: "pwd+totp"}
}

// catalogView is what a customer sees of one restaurant.
type catalogView struct {
	detail, certification, menu int
	badge, certifiedBy          string
	inList                      bool
}

func (w issuerWorld) customerSees(t *testing.T, restaurantID string, lat, lng float64) catalogView {
	t.Helper()
	cust := caller{account: w.customer, roles: "CUSTOMER"}
	var v catalogView
	var detail map[string]any
	v.detail, detail = call(t, w.srv, cust, "GET", "/v1/restaurants/"+restaurantID, nil)
	if data, ok := detail["data"].(map[string]any); ok {
		if halal, ok := data["halal"].(map[string]any); ok {
			v.badge, _ = halal["display_state"].(string)
			v.certifiedBy, _ = halal["certifying_body_name"].(string)
		}
	}
	v.certification, _ = call(t, w.srv, cust, "GET", "/v1/restaurants/"+restaurantID+"/certification", nil)
	v.menu, _ = call(t, w.srv, cust, "GET", "/v1/restaurants/"+restaurantID+"/menu", nil)
	status, list := call(t, w.srv, cust, "GET",
		fmt.Sprintf("/v1/restaurants?latitude=%f&longitude=%f&max_distance_m=500", lat, lng), nil)
	if status != http.StatusOK {
		t.Fatalf("list restaurants: %d %v", status, list)
	}
	items, _ := list["data"].([]any)
	for _, it := range items {
		if card, ok := it.(map[string]any); ok && card["id"] == restaurantID {
			v.inList = true
		}
	}
	return v
}

// orderable runs the order path's own check (orders.LockOrderableRestaurant),
// the one adding a cart line, quoting, placing and accepting an order call.
func orderable(t *testing.T, pool *pgxpool.Pool, restaurantID string) error {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	return orders.LockOrderableRestaurant(ctx, tx, restaurantID)
}

type listingRow struct {
	state   string
	reasons []string
	halal   string
}

func readListing(t *testing.T, pool *pgxpool.Pool, restaurantID string) listingRow {
	t.Helper()
	var l listingRow
	if err := pool.QueryRow(context.Background(), `
SELECT account_state::text, delist_reasons, halal_status::text FROM restaurant WHERE id = $1`,
		restaurantID).Scan(&l.state, &l.reasons, &l.halal); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	return l
}

// notified lists the accounts that got a notification of kind about the
// restaurant.
func notified(t *testing.T, pool *pgxpool.Pool, restaurantID string, kind notify.Kind) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
SELECT account_id::text FROM notification WHERE data->>'restaurant_id' = $1 AND kind = $2 ORDER BY account_id`,
		restaurantID, string(kind))
	if err != nil {
		t.Fatalf("read notifications: %v", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("read notifications: %v", err)
	}
	return ids
}

func countRows(t *testing.T, pool *pgxpool.Pool, q string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestIntegrationWithdrawingAnIssuerTakesTheBadgeOffAndReacceptingRestoresIt(t *testing.T) {
	w := newIssuerWorld(t, "ACCEPTED")

	// A second restaurant holds a certificate from the same body and a current
	// one from a seeded body that stays accepted: it must not move.
	other, otherLat, otherLng := newListedRestaurant(t, w.pool)
	testseed.CertifyRestaurant(t, w.pool, other, 200)
	testseed.CertifyRestaurantBy(t, w.pool, other, w.bodyID, 300)

	if v := w.customerSees(t, w.restaurantID, w.lat, w.lng); v.detail != 200 || v.badge != "CERTIFIED" || !v.inList ||
		v.certification != 200 || v.certifiedBy != w.bodyName {
		t.Fatalf("before: customer sees %+v, want the restaurant listed with a CERTIFIED badge from %s", v, w.bodyName)
	}
	if err := orderable(t, w.pool, w.restaurantID); err != nil {
		t.Fatalf("before: order check: %v, want orderable", err)
	}

	// Withdraw the body's acceptance.
	if status, body := w.setBodyStatus(t, w.superAdminCaller(), "SUSPENDED"); status != http.StatusOK {
		t.Fatalf("withdraw: %d %v", status, body)
	}

	t.Run("the badge is gone from the catalog, the detail and the certification", func(t *testing.T) {
		v := w.customerSees(t, w.restaurantID, w.lat, w.lng)
		if v.detail != 404 || v.certification != 404 || v.menu != 404 || v.inList || v.badge != "" {
			t.Errorf("after withdrawal: customer sees %+v, want 404s, no badge and not in the list", v)
		}
	})
	t.Run("orders are refused", func(t *testing.T) {
		if err := orderable(t, w.pool, w.restaurantID); !errors.Is(err, orders.ErrRestaurantUnavailable) {
			t.Errorf("order check: %v, want ErrRestaurantUnavailable", err)
		}
	})
	t.Run("the restaurant is delisted, not locked, with the certificate's reason", func(t *testing.T) {
		l := readListing(t, w.pool, w.restaurantID)
		if l.state != "DELISTED" || !slices.Equal(l.reasons, []string{delistHalalUnverified}) || l.halal != "UNVERIFIED" {
			t.Errorf("restaurant row = %+v, want DELISTED [%s] UNVERIFIED", l, delistHalalUnverified)
		}
	})
	t.Run("owners and managers are told, front-of-house staff are not", func(t *testing.T) {
		got := notified(t, w.pool, w.restaurantID, KindHalalIssuerWithdrawn)
		want := []string{w.owner, w.manager}
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Errorf("notified %v, want the owner and the manager %v", got, want)
		}
	})
	t.Run("the delisting is audited against the super admin, and ops are alerted", func(t *testing.T) {
		if n := countRows(t, w.pool, `
SELECT count(*) FROM audit_event WHERE subject_type = 'RESTAURANT' AND subject_id = $1
   AND action = 'restaurant.delisted' AND reason_code = $2 AND actor_account_id = $3`,
			w.restaurantID, delistHalalUnverified, w.superAdmin); n != 1 {
			t.Errorf("%d delisting audit rows, want 1", n)
		}
		if n := countRows(t, w.pool, `
SELECT count(*) FROM realtime_event WHERE channel = 'admin:ops' AND type = 'admin.alert'
   AND payload->>'subject_id' = $1 AND payload->>'kind' = $2`, w.restaurantID, alertKindIssuerStatus); n != 1 {
			t.Errorf("%d ops alerts, want 1", n)
		}
	})
	t.Run("a restaurant another accepted body vouches for stays listed", func(t *testing.T) {
		v := w.customerSees(t, other, otherLat, otherLng)
		if v.detail != 200 || !v.inList || v.badge != "CERTIFIED" || v.certifiedBy == w.bodyName {
			t.Errorf("other restaurant: customer sees %+v, want it listed on the other body's certificate", v)
		}
		if l := readListing(t, w.pool, other); l.state != "LIVE" || len(l.reasons) != 0 {
			t.Errorf("other restaurant row = %+v, want LIVE with no reasons", l)
		}
		if n := len(notified(t, w.pool, other, KindHalalIssuerWithdrawn)); n != 0 {
			t.Errorf("%d notifications to a restaurant whose listing did not change", n)
		}
	})

	// Accept the body again.
	if status, body := w.setBodyStatus(t, w.superAdminCaller(), "ACCEPTED"); status != http.StatusOK {
		t.Fatalf("re-accept: %d %v", status, body)
	}
	t.Run("re-acceptance restores the listing, the badge and orders", func(t *testing.T) {
		v := w.customerSees(t, w.restaurantID, w.lat, w.lng)
		if v.detail != 200 || v.badge != "CERTIFIED" || !v.inList || v.certification != 200 || v.menu != 200 {
			t.Errorf("after re-acceptance: customer sees %+v, want it listed with a CERTIFIED badge", v)
		}
		if err := orderable(t, w.pool, w.restaurantID); err != nil {
			t.Errorf("order check: %v, want orderable", err)
		}
		if l := readListing(t, w.pool, w.restaurantID); l.state != "LIVE" || len(l.reasons) != 0 || l.halal != "CERTIFIED" {
			t.Errorf("restaurant row = %+v, want LIVE, no reasons, CERTIFIED", l)
		}
		if got := notified(t, w.pool, w.restaurantID, KindHalalIssuerReaccepted); len(got) != 2 {
			t.Errorf("notified %v about the relisting, want the owner and the manager", got)
		}
		if n := countRows(t, w.pool, `
SELECT count(*) FROM audit_event WHERE subject_type = 'RESTAURANT' AND subject_id = $1
   AND action = 'restaurant.relisted' AND actor_account_id = $2`, w.restaurantID, w.superAdmin); n != 1 {
			t.Errorf("%d relisting audit rows, want 1", n)
		}
	})

	// The same decision sent again changes nothing and tells nobody twice.
	before := countRows(t, w.pool, `SELECT count(*) FROM notification WHERE data->>'restaurant_id' = $1`, w.restaurantID)
	if status, _ := w.setBodyStatus(t, w.superAdminCaller(), "ACCEPTED"); status != http.StatusOK {
		t.Fatalf("re-accept again: %d", status)
	}
	if after := countRows(t, w.pool, `SELECT count(*) FROM notification WHERE data->>'restaurant_id' = $1`,
		w.restaurantID); after != before {
		t.Errorf("an unchanged status wrote %d more notifications", after-before)
	}
}

// An order in flight holds the restaurant row FOR SHARE until it commits
// (orders.LockOrderableRestaurant). The withdrawal locks the row FOR UPDATE, so
// it waits for that order and then delists, rather than delisting between the
// order's check and its commit (https://github.com/shaiknoorullah/hg-mono/issues/328).
func TestIntegrationWithdrawalWaitsForAnOrderHoldingTheRestaurant(t *testing.T) {
	w := newIssuerWorld(t, "ACCEPTED")
	ctx := context.Background()

	orderTx, err := w.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = orderTx.Rollback(ctx) }()
	if err := orders.LockOrderableRestaurant(ctx, orderTx, w.restaurantID); err != nil {
		t.Fatalf("order check: %v, want orderable", err)
	}

	done := make(chan int, 1)
	go func() {
		status, _ := w.setBodyStatus(t, w.superAdminCaller(), "RETIRED")
		done <- status
	}()
	select {
	case status := <-done:
		t.Fatalf("the withdrawal finished (%d) while an order held the restaurant", status)
	case <-time.After(500 * time.Millisecond):
	}
	if err := orderTx.Commit(ctx); err != nil {
		t.Fatalf("commit the order: %v", err)
	}
	select {
	case status := <-done:
		if status != http.StatusOK {
			t.Fatalf("withdraw: %d", status)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the withdrawal did not finish after the order committed")
	}
	if l := readListing(t, w.pool, w.restaurantID); l.state != "DELISTED" || l.halal != "UNVERIFIED" {
		t.Errorf("restaurant row = %+v, want DELISTED and UNVERIFIED", l)
	}
	if err := orderable(t, w.pool, w.restaurantID); !errors.Is(err, orders.ErrRestaurantUnavailable) {
		t.Errorf("order check after the withdrawal: %v, want ErrRestaurantUnavailable", err)
	}
}

func TestIntegrationOnlyASuperAdminWithAnAuthenticatorCodeChangesAnIssuer(t *testing.T) {
	w := newIssuerWorld(t, "ACCEPTED")
	admin := newAccount(t, w.pool, "ADMIN", "GLOBAL", nil)
	support := newAccount(t, w.pool, "SUPPORT_AGENT", "GLOBAL", nil)

	for _, tc := range []struct {
		name   string
		caller caller
		want   int
		code   string
	}{
		{"anonymous", caller{}, http.StatusUnauthorized, ""},
		{"customer", caller{account: w.customer, roles: "CUSTOMER", amr: "otp"}, http.StatusForbidden, ""},
		{"restaurant owner", caller{account: w.owner, roles: "RESTAURANT_OWNER", amr: "pwd"}, http.StatusForbidden, ""},
		{"support agent", caller{account: support, roles: "SUPPORT_AGENT", amr: "pwd+totp"}, http.StatusForbidden, ""},
		{"admin", caller{account: admin, roles: "ADMIN", amr: "pwd+totp"}, http.StatusForbidden, ""},
		{"super admin without an authenticator code", caller{account: w.superAdmin, roles: "SUPER_ADMIN", amr: "pwd"},
			http.StatusForbidden, string(CodeMFARequired)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := w.setBodyStatus(t, tc.caller, "SUSPENDED")
			if status != tc.want {
				t.Fatalf("withdraw as %s: %d %v, want %d", tc.name, status, body, tc.want)
			}
			if tc.code != "" {
				if e, _ := body["error"].(map[string]any); e == nil || e["code"] != tc.code {
					t.Errorf("error = %v, want code %s", body["error"], tc.code)
				}
			}
		})
	}

	var status string
	if err := w.pool.QueryRow(context.Background(), `SELECT status::text FROM halal_issuing_body WHERE id = $1`,
		w.bodyID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "ACCEPTED" {
		t.Errorf("body status = %s after refused attempts, want ACCEPTED", status)
	}
	if v := w.customerSees(t, w.restaurantID, w.lat, w.lng); v.detail != 200 || v.badge != "CERTIFIED" || !v.inList {
		t.Errorf("after refused attempts: customer sees %+v, want the restaurant still listed", v)
	}
}

func TestIntegrationACertificateFromABodyNeverAcceptedGivesNoBadge(t *testing.T) {
	w := newIssuerWorld(t, "PROPOSED")

	if l := readListing(t, w.pool, w.restaurantID); l.halal != "UNVERIFIED" {
		t.Errorf("stored halal status = %s, want UNVERIFIED for a certificate from a body never accepted", l.halal)
	}
	if v := w.customerSees(t, w.restaurantID, w.lat, w.lng); v.detail != 404 || v.inList || v.badge != "" || v.certification != 404 {
		t.Errorf("customer sees %+v, want no badge anywhere", v)
	}
	if err := orderable(t, w.pool, w.restaurantID); !errors.Is(err, orders.ErrRestaurantUnavailable) {
		t.Errorf("order check: %v, want ErrRestaurantUnavailable", err)
	}

	// Even a stored row that claims CERTIFIED for that certificate shows nothing:
	// the catalog reads the state as of now, never the stored one alone.
	if _, err := w.pool.Exec(context.Background(), `
UPDATE restaurant r SET halal_status = 'CERTIFIED', halal_certificate_id = hc.id
  FROM halal_certificate hc WHERE hc.restaurant_id = r.id AND r.id = $1`, w.restaurantID); err != nil {
		t.Fatalf("make the stored row stale: %v", err)
	}
	if v := w.customerSees(t, w.restaurantID, w.lat, w.lng); v.detail != 404 || v.inList || v.badge != "" || v.certification != 404 {
		t.Errorf("with a stale stored CERTIFIED: customer sees %+v, want no badge anywhere", v)
	}
}

func TestIssuerListing(t *testing.T) {
	const unv, exp = delistHalalUnverified, delistHalalExpired
	for _, tc := range []struct {
		name        string
		from        string
		reasons     []string
		stored, now string
		canGoLive   bool
		to          string
		toReasons   []string
	}{
		{"listed, no certificate counts", "LIVE", nil, "UNVERIFIED", "UNVERIFIED", true, "DELISTED", []string{unv}},
		{"listed, stale stored badge", "LIVE", nil, "CERTIFIED", "UNVERIFIED", true, "DELISTED", []string{unv}},
		{"listed, the certificate that counts has lapsed", "LIVE", nil, "CERTIFIED", "EXPIRED", true, "DELISTED", []string{exp}},
		{"listed, no answer", "LIVE", nil, "", "", true, "DELISTED", []string{unv}},
		{"listed, still vouched for", "LIVE", nil, "CERTIFIED", "EXPIRING_SOON", true, "LIVE", []string{}},
		{"delisted for the certificate, vouched for again", "DELISTED", []string{unv}, "CERTIFIED", "CERTIFIED", true, "LIVE", []string{}},
		{"delisted for the lapse, vouched for again", "DELISTED", []string{exp}, "EXPIRING_SOON", "EXPIRING_SOON", true, "LIVE", []string{}},
		{"delisted for a menu as well", "DELISTED", []string{unv, "NO_APPROVED_MENU"}, "CERTIFIED", "CERTIFIED", true, "DELISTED", []string{"NO_APPROVED_MENU"}},
		{"delisted by an admin, not for the certificate", "DELISTED", []string{}, "CERTIFIED", "CERTIFIED", true, "DELISTED", []string{}},
		{"delisted, onboarding not finished", "DELISTED", []string{unv}, "CERTIFIED", "CERTIFIED", false, "DELISTED", []string{}},
		{"delisted, still not vouched for", "DELISTED", []string{exp}, "UNVERIFIED", "UNVERIFIED", true, "DELISTED", []string{exp, unv}},
		{"suspended keeps its state", "SUSPENDED", nil, "UNVERIFIED", "UNVERIFIED", true, "SUSPENDED", []string{}},
		{"pending keeps its state", "PENDING", nil, "UNVERIFIED", "UNVERIFIED", true, "PENDING", []string{}},
		{"banned keeps its state when vouched for", "BANNED", nil, "CERTIFIED", "CERTIFIED", true, "BANNED", []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			to, reasons := issuerListing(tc.from, tc.reasons, tc.stored, tc.now, tc.canGoLive)
			if to != tc.to || !slices.Equal(reasons, tc.toReasons) {
				t.Errorf("issuerListing = %s %v, want %s %v", to, reasons, tc.to, tc.toReasons)
			}
		})
	}
}
