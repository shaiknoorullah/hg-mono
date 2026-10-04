package admin

// Integration tests for the account actions: suspend, reinstate, delist,
// deactivate and ban a restaurant, a rider or a customer
// (https://github.com/shaiknoorullah/hg-mono/issues/253). Every legal and
// illegal transition is pinned without a database in internal/accountstate;
// these tests pin what only the database can show: the effects on live work,
// the two-person ban, the sessions a ban ends, and who may call the operations.
// They need HG_TEST_POSTGRES_DSN, like the rest of this package's integration
// tests.

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/session"
)

// ---- harness ----------------------------------------------------------------

// fakeRiverInserter queues nothing: the notification row is what the tests
// capture, and it is written in the action's own transaction.
type fakeRiverInserter struct{}

func (fakeRiverInserter) InsertTx(context.Context, pgx.Tx, river.JobArgs, *river.InsertOpts) (*rivertype.JobInsertResult, error) {
	return &rivertype.JobInsertResult{Job: &rivertype.JobRow{}}, nil
}

// recordingReleaser records which orders had their payment authorisation released.
type recordingReleaser struct {
	mu  sync.Mutex
	ids []string
}

func (r *recordingReleaser) Void(_ context.Context, orderID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ids = append(r.ids, orderID)
	return nil
}

func (r *recordingReleaser) released() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string{}, r.ids...)
}

// staff is a signed-in staff member: an account holding role, signed in with
// two-step sign-in unless amr says otherwise, with a live admin-web session and
// the access token signed for it, as the authentication middleware hands it on.
func staff(t *testing.T, pool *pgxpool.Pool, role httpx.Role, amr ...string) httpx.Principal {
	t.Helper()
	p := principalFor(t, pool, role)
	if len(amr) == 0 {
		amr = []string{"pwd+totp"}
	}
	p.AMR = amr
	p.SessionID, p = signIn(t, pool, p, amr[0], 15*time.Minute)
	return p
}

// testIssuer signs the tests' access tokens as the API does (internal/session).
var testIssuer = func() *session.Issuer {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return session.NewIssuer("test", priv, "hg-api")
}()

// signIn opens a live admin-web session for p signed in with amr, and returns its
// id and p carrying the access token signed for it (valid for ttl; negative is
// already expired). The session row carries the token's hash, as internal/auth
// writes it at sign-in (migration 00035).
func signIn(t *testing.T, pool *pgxpool.Pool, p httpx.Principal, amr string, ttl time.Duration) (string, httpx.Principal) {
	t.Helper()
	sid := uuid.NewString()
	roles := make([]string, 0, len(p.Roles))
	for _, r := range p.Roles {
		roles = append(roles, string(r))
	}
	tok, err := testIssuer.Issue(p.AccountID, sid, roles, []string{amr}, ttl)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client, refresh_hash, access_hash,
		                     idle_expires_at, absolute_expires_at)
		VALUES ($1, gen_random_uuid(), $2, $3::auth_method, '[]', 'admin-web', sha256(convert_to($4 || '.refresh', 'UTF8')),
		        sha256(convert_to($4, 'UTF8')), now() + interval '30 minutes', now() + interval '12 hours')`,
		sid, p.AccountID, amr, tok); err != nil {
		t.Fatalf("sign in: %v", err)
	}
	p.SessionID = sid
	return sid, p.WithCredential(tok)
}

// accountServer serves the admin routes as the given principal, with the real
// role matrix, the notification outbox and a recording payment releaser.
func accountServer(t *testing.T, pool *pgxpool.Pool, p httpx.Principal, rel *recordingReleaser) *httptest.Server {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: fixedPrincipalAuth{p}, Authorizer: auth.Matrix{}})
	h := NewHandler(NewRepo(pool), DefaultConfig()).
		WithAccountActions(nil, notify.NewEnqueuer(notify.NewRepo(), fakeRiverInserter{}), rel)
	Routes(router, h)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

type actionResult struct {
	status   int
	replayed bool
	data     map[string]any
	errCode  string
	details  map[string]any
}

// act posts one account action. key "" means a fresh Idempotency-Key.
func act(t *testing.T, srv *httptest.Server, subject, id, action, reason, key string) actionResult {
	t.Helper()
	if key == "" {
		key = uuid.NewString()
	}
	path := map[string]string{
		"RESTAURANT": "/v1/admin/restaurants/%s/account-actions",
		"RIDER":      "/v1/admin/riders/%s/account-actions",
		"CUSTOMER":   "/v1/admin/customers/%s/account-actions",
	}[subject]
	resp := doJSON(t, http.MethodPost, srv.URL+fmt.Sprintf(path, id), map[string]any{
		"action": action, "reason_code": reason,
		"reason_text": "Integration test: " + strings.ToLower(action) + " for " + reason,
	}, map[string]string{"Idempotency-Key": key})
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	out := actionResult{status: resp.StatusCode, replayed: resp.Header.Get("Idempotency-Replayed") == "true"}
	if d, ok := body["data"].(map[string]any); ok {
		out.data = d
	}
	if e, ok := body["error"].(map[string]any); ok {
		out.errCode, _ = e["code"].(string)
		out.details, _ = e["details"].(map[string]any)
	}
	return out
}

func mustStatus(t *testing.T, what string, got actionResult, status int, code string) {
	t.Helper()
	if got.status != status || got.errCode != code {
		t.Fatalf("%s: got %d %q (details %v), want %d %q", what, got.status, got.errCode, got.details, status, code)
	}
}

func ids(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func scalar[T any](t *testing.T, pool *pgxpool.Pool, q string, args ...any) T {
	t.Helper()
	var v T
	if err := pool.QueryRow(context.Background(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

// ---- seeds ------------------------------------------------------------------

// placeOrderAt places a real order at a restaurant for a fresh customer, then
// moves it to state, as seedOrderForAdmin does for its own restaurant.
func placeOrderAt(t *testing.T, pool *pgxpool.Pool, restaurantID, state string) string {
	t.Helper()
	ctx := context.Background()
	var accountID, addressID, itemID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status) VALUES ('ord-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE')
		RETURNING id`).Scan(&accountID); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, accountID).Scan(&addressID); err != nil {
		t.Fatalf("seed address: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM menu_item WHERE restaurant_id = $1 LIMIT 1`, restaurantID).Scan(&itemID); err != nil {
		t.Fatalf("find menu item: %v", err)
	}
	st := orders.NewStore(pool)
	cart, err := st.AddCartLine(ctx, accountID, restaurantID, orders.CartLineInput{MenuItemID: itemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("seed cart: %v", err)
	}
	q, err := st.CreateQuote(ctx, orders.QuoteRequest{AccountID: accountID, CartID: cart.ID, DeliveryAddressID: &addressID, Fulfilment: "DELIVERY"})
	if err != nil {
		t.Fatalf("seed quote: %v", err)
	}
	var fresh *orders.Quote
	o, err := st.CreateOrder(ctx, orders.OrderInput{AccountID: accountID, QuoteID: q.ID}, &fresh)
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}
	if state != "CREATED" {
		if _, err := pool.Exec(ctx, `
			UPDATE "order" SET state = $2, state_since = now(), deadline_at = now() + interval '30 minutes',
			                   deadline_action = 'EXPIRE_PAYMENT' WHERE id = $1`, o.OrderID, state); err != nil {
			t.Fatalf("force order state: %v", err)
		}
	}
	return o.OrderID
}

// restaurantOf returns the restaurant an order is at.
func restaurantOf(t *testing.T, pool *pgxpool.Pool, orderID string) string {
	return scalar[string](t, pool, `SELECT restaurant_id::text FROM "order" WHERE id = $1`, orderID)
}

// grantRestaurantRole gives a fresh account a role at a restaurant.
func grantRestaurantRole(t *testing.T, pool *pgxpool.Pool, restaurantID, role string) string {
	t.Helper()
	id := scalar[string](t, pool, `
		INSERT INTO account (email, status) VALUES ('rs-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE')
		RETURNING id::text`)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, $2, 'RESTAURANT', $3)`,
		id, role, restaurantID); err != nil {
		t.Fatalf("grant %s: %v", role, err)
	}
	return id
}

// certify gives a restaurant an admin-verified halal certificate whose last valid
// day is expiresInDays from today, through the real chain: an accepted issuing
// body, an approved document, all seven checks passed. (The same steps as
// testseed.CertifyRestaurant in https://github.com/shaiknoorullah/hg-mono/pull/298.)
func certify(t *testing.T, pool *pgxpool.Pool, restaurantID string, expiresInDays int) string {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var reviewer, body, object, doc, cert string
	steps := []struct {
		dst  *string
		sql  string
		args []any
	}{
		{&reviewer, `INSERT INTO account (email, status) VALUES ('rev-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`, nil},
		{&body, `INSERT INTO halal_issuing_body (name, country, status, decided_by, decided_at)
		         VALUES ('Test Halal Body '||substr(md5(random()::text),1,8), 'CA', 'ACCEPTED', $1, now()) RETURNING id`, []any{&reviewer}},
		{&object, `INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		           VALUES ('hg-kyc', 'test/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 2048,
		                   decode(repeat('c3', 32), 'hex'), 'READY', $1, now()) RETURNING id`, []any{&reviewer}},
		{&doc, `INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
		                                  halal_issuing_body_id, state, reviewed_by, reviewed_at)
		        VALUES ('RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, $3, 'APPROVED', $4, now()) RETURNING id`,
			[]any{restaurantID, &object, &body, &reviewer}},
		{&cert, `INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
		                                        certified_legal_name, certified_address, scope, issued_on, expires_on,
		                                        status, checklist_version, verified_by, verified_at)
		         VALUES ($1, $2, 'TEST-'||md5(random()::text), $3, 'Test Co', '1 King St Toronto', 'WHOLE_ESTABLISHMENT',
		                 current_date + $4::int - 365, current_date + $4::int, 'APPROVED', 1, $5, now()) RETURNING id`,
			[]any{restaurantID, &doc, &body, expiresInDays, &reviewer}},
	}
	for _, s := range steps {
		args := make([]any, len(s.args))
		for i, a := range s.args {
			if p, ok := a.(*string); ok {
				args[i] = *p
			} else {
				args[i] = a
			}
		}
		if err := tx.QueryRow(ctx, s.sql, args...).Scan(s.dst); err != nil {
			t.Fatalf("certify: %v", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
		SELECT $1, k::halal_check_key, 'PASS', 'PASS', k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'), $2, now()
		  FROM unnest(ARRAY['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH',
		                    'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED']) AS k`, cert, reviewer); err != nil {
		t.Fatalf("certify checks: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("certify commit: %v", err)
	}
	return cert
}

// seedRider makes an approved, onboarded rider who is online.
func seedRider(t *testing.T, pool *pgxpool.Pool, availability string) string {
	t.Helper()
	ctx := context.Background()
	id := scalar[string](t, pool, `
		INSERT INTO account (phone_e164, status)
		VALUES ('+1416'||lpad((floor(random()*9000000)+1000000)::bigint::text, 7, '0'), 'ACTIVE') RETURNING id::text`)
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'RIDER', 'GLOBAL')`, id); err != nil {
		t.Fatalf("rider role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state,
		                           account_status, approved_at, availability_state, is_online)
		VALUES ($1, 'Bilal', 'Khan', '1995-04-02', 'ACTIVE', 'ACTIVE', now(), $2, $3)`,
		id, availability, availability != "OFFLINE"); err != nil {
		t.Fatalf("rider profile: %v", err)
	}
	return id
}

func pendingOffer(t *testing.T, pool *pgxpool.Pool, orderID, riderID string) string {
	return scalar[string](t, pool, `
		INSERT INTO dispatch_offer (order_id, rider_account_id, wave, distance_m, earnings_cents, expires_at)
		VALUES ($1, $2, 1, 900, 650, now() + interval '30 seconds') RETURNING id::text`, orderID, riderID)
}

func liveSessions(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	return scalar[int](t, pool, `SELECT count(*)::int FROM session WHERE account_id = $1 AND revoked_at IS NULL`, accountID)
}

func addSession(t *testing.T, pool *pgxpool.Pool, accountID, amr string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO session (family_id, account_id, amr, roles_snapshot, client, refresh_hash, idle_expires_at, absolute_expires_at)
		VALUES (uuid_generate_v7(), $1, $2::auth_method, '[]'::jsonb, 'customer-app', decode(md5(random()::text), 'hex'),
		        now() + interval '1 day', now() + interval '30 days')`, accountID, amr); err != nil {
		t.Fatalf("seed session: %v", err)
	}
}

func notificationKinds(t *testing.T, pool *pgxpool.Pool, accountID string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT kind FROM notification WHERE account_id = $1 ORDER BY created_at, id`, accountID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		out = append(out, k)
	}
	return out
}

// ---- tests ------------------------------------------------------------------

// TestSuspendedRestaurantTakesNoOrdersAndItsMenuLocks: an admin suspends a live
// restaurant. Its unaccepted order is cancelled and released, its accepted order
// finishes, no new order can be priced, its menu is locked, its owner gets a
// notice, and the action is audited and recorded with what happened to each
// order (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change).
func TestSuspendedRestaurantTakesNoOrdersAndItsMenuLocks(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	preparing, _ := seedOrderForAdmin(t, pool, "PREPARING")
	restaurant := restaurantOf(t, pool, preparing)
	pending := placeOrderAt(t, pool, restaurant, "RESTAURANT_PENDING")
	owner := grantRestaurantRole(t, pool, restaurant, "RESTAURANT_OWNER")
	rel := &recordingReleaser{}
	admin := staff(t, pool, httpx.RoleAdmin)
	srv := accountServer(t, pool, admin, rel)

	got := act(t, srv, "RESTAURANT", restaurant, "SUSPEND", "COMPLIANCE_THRESHOLD", "")
	mustStatus(t, "suspend", got, 200, "")
	if got.data["to_state"] != "SUSPENDED" || got.data["menu_locked"] != true {
		t.Fatalf("suspend: to %v, menu_locked %v; want SUSPENDED, true", got.data["to_state"], got.data["menu_locked"])
	}
	inFlight := got.data["in_flight"].(map[string]any)
	if c := ids(inFlight["cancelled_order_ids"]); len(c) != 1 || c[0] != pending {
		t.Errorf("cancelled %v, want only the unaccepted order %s", c, pending)
	}
	if c := ids(inFlight["continuing_order_ids"]); len(c) != 1 || c[0] != preparing {
		t.Errorf("continuing %v, want the accepted order %s", c, preparing)
	}
	if r := rel.released(); len(r) != 1 || r[0] != pending {
		t.Errorf("released authorisations %v, want %s", r, pending)
	}
	if s := scalar[string](t, pool, `SELECT state::text||'/'||coalesce(cancel_reason::text,'') FROM "order" WHERE id=$1`, pending); s != "CANCELLED/RESTAURANT_CLOSED" {
		t.Errorf("unaccepted order is %s, want CANCELLED/RESTAURANT_CLOSED", s)
	}
	if s := scalar[string](t, pool, `SELECT state::text FROM "order" WHERE id=$1`, preparing); s != "PREPARING" {
		t.Errorf("accepted order is %s, want it left PREPARING to finish", s)
	}

	// No new order: pricing a cart at the suspended restaurant is refused.
	var item string
	_ = pool.QueryRow(ctx, `SELECT id FROM menu_item WHERE restaurant_id=$1 LIMIT 1`, restaurant).Scan(&item)
	b := seedOrderBasics(t, pool)
	st := orders.NewStore(pool)
	if cart, err := st.AddCartLine(ctx, b.accountID, restaurant, orders.CartLineInput{MenuItemID: item, Quantity: 1}, false); err == nil {
		if _, err := st.CreateQuote(ctx, orders.QuoteRequest{AccountID: b.accountID, CartID: cart.ID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY"}); !errors.Is(err, orders.ErrRestaurantClosed) {
			t.Errorf("quote at a suspended restaurant: err = %v, want ErrRestaurantClosed", err)
		}
	}

	// The menu lock follows the stored state (enforced on each write by #256).
	state := scalar[string](t, pool, `SELECT account_state::text FROM restaurant WHERE id=$1`, restaurant)
	if !accountstate.MenuLocked(state) {
		t.Errorf("menu of a %s restaurant is not locked", state)
	}

	if k := notificationKinds(t, pool, owner); len(k) != 1 || k[0] != string(notify.KindAccountSuspended) {
		t.Errorf("owner notices %v, want one ACCOUNT_SUSPENDED", k)
	}
	if n := scalar[int](t, pool, `SELECT count(*)::int FROM audit_event WHERE action='restaurant.suspend' AND subject_id=$1 AND actor_account_id=$2`,
		restaurant, admin.AccountID); n != 1 {
		t.Errorf("audit rows for the suspension = %d, want 1", n)
	}

	// Delisting is not possible from SUSPENDED, and the refusal names what is.
	got = act(t, srv, "RESTAURANT", restaurant, "DELIST", "NO_APPROVED_MENU", "")
	mustStatus(t, "delist a suspended restaurant", got, 409, "ILLEGAL_STATE_TRANSITION")
	if a := fmt.Sprint(got.details["allowed_actions"]); a != "[REINSTATE PROPOSE_BAN]" {
		t.Errorf("allowed actions %s, want [REINSTATE PROPOSE_BAN]", a)
	}
}

// TestHalalIntegritySuspensionRefundsTheFoodBeingPrepared: suspending for halal
// integrity cancels and fully refunds an order still being prepared, at the
// restaurant's cost, and the customer is made whole in the ledger.
func TestHalalIntegritySuspensionRefundsTheFoodBeingPrepared(t *testing.T) {
	pool := dialTestPool(t)
	preparing, captured := seedCapturedPreparingOrder(t, pool)
	restaurant := restaurantOf(t, pool, preparing)
	srv := accountServer(t, pool, staff(t, pool, httpx.RoleAdmin), &recordingReleaser{})

	got := act(t, srv, "RESTAURANT", restaurant, "SUSPEND", "HALAL_INTEGRITY", "")
	mustStatus(t, "suspend for halal integrity", got, 200, "")
	if r := ids(got.data["in_flight"].(map[string]any)["refunded_order_ids"]); len(r) != 1 || r[0] != preparing {
		t.Fatalf("refunded %v, want %s", r, preparing)
	}
	if s := scalar[string](t, pool, `SELECT state::text FROM "order" WHERE id=$1`, preparing); s != "CANCELLED" {
		t.Errorf("order is %s, want CANCELLED", s)
	}
	reason := scalar[string](t, pool, `SELECT reason_code::text||'/'||amount_cents FROM refund WHERE order_id=$1`, preparing)
	if reason != fmt.Sprintf("HALAL_INTEGRITY/%d", captured) {
		t.Errorf("refund = %s, want HALAL_INTEGRITY/%d (the full amount)", reason, captured)
	}
	if net := orderCustomerNet(t, pool, preparing); net != 0 {
		t.Errorf("customer net after the refund = %d, want 0", net)
	}
}

// TestReinstatingNeedsACurrentHalalCertificate: a delisted restaurant is relisted
// only with an admin-verified certificate that has not expired, and a suspended
// one whose certificate lapsed comes back DELISTED, never LIVE.
func TestReinstatingNeedsACurrentHalalCertificate(t *testing.T) {
	pool := dialTestPool(t)
	order, _ := seedOrderForAdmin(t, pool, "COMPLETED")
	restaurant := restaurantOf(t, pool, order)
	srv := accountServer(t, pool, staff(t, pool, httpx.RoleAdmin), &recordingReleaser{})

	got := act(t, srv, "RESTAURANT", restaurant, "DELIST", "NO_APPROVED_MENU", "")
	mustStatus(t, "delist", got, 200, "")
	if got.data["menu_locked"] != false {
		t.Errorf("a delisted restaurant's menu_locked = %v, want false", got.data["menu_locked"])
	}

	got = act(t, srv, "RESTAURANT", restaurant, "REINSTATE", "ISSUE_RESOLVED", "")
	mustStatus(t, "relist with no certificate", got, 409, "HALAL_CERTIFICATE_REQUIRED")

	certify(t, pool, restaurant, -2)
	got = act(t, srv, "RESTAURANT", restaurant, "REINSTATE", "ISSUE_RESOLVED", "")
	mustStatus(t, "relist with an expired certificate", got, 409, "HALAL_CERTIFICATE_REQUIRED")
	if got.details["halal_status"] != "EXPIRED" {
		t.Errorf("halal_status %v, want EXPIRED", got.details["halal_status"])
	}

	cert := certify(t, pool, restaurant, 300)
	got = act(t, srv, "RESTAURANT", restaurant, "REINSTATE", "ISSUE_RESOLVED", "")
	mustStatus(t, "relist with a current certificate", got, 200, "")
	if got.data["to_state"] != "LIVE" || len(got.data["delist_reasons"].([]any)) != 0 {
		t.Fatalf("relisted to %v with reasons %v, want LIVE and none", got.data["to_state"], got.data["delist_reasons"])
	}

	// Suspended, then the certificate lapses: reinstating returns it to DELISTED.
	mustStatus(t, "suspend", act(t, srv, "RESTAURANT", restaurant, "SUSPEND", "OTHER", ""), 200, "")
	if _, err := pool.Exec(context.Background(), `UPDATE halal_certificate SET expires_on = current_date - 2 WHERE id = $1`, cert); err != nil {
		t.Fatal(err)
	}
	got = act(t, srv, "RESTAURANT", restaurant, "REINSTATE", "ISSUE_RESOLVED", "")
	mustStatus(t, "reinstate after the lapse", got, 200, "")
	if got.data["to_state"] != "DELISTED" || fmt.Sprint(got.data["delist_reasons"]) != "[HALAL_CERTIFICATE_EXPIRED]" {
		t.Errorf("reinstated to %v %v, want DELISTED [HALAL_CERTIFICATE_EXPIRED]", got.data["to_state"], got.data["delist_reasons"])
	}
}

// TestRiderSuspendedMidDeliveryFinishesItAndIsReinstated is the issue's "done
// when": an admin suspends a rider carrying an order. The delivery continues,
// offers stop at once (the waiting one is withdrawn and a new one cannot be
// accepted), the rider goes offline after the delivery; reinstating sends the
// notice that they can go online again.
func TestRiderSuspendedMidDeliveryFinishesItAndIsReinstated(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	rider := seedRider(t, pool, "ON_DELIVERY")
	carrying, _ := seedOrderForAdmin(t, pool, "PICKED_UP")
	if _, err := pool.Exec(ctx, `
		INSERT INTO dispatch (order_id, state, rider_account_id, assigned_at, deadline_at, deadline_action)
		VALUES ($1, 'CARRYING', $2, now(), now() + interval '20 minutes', 'DELIVERY_OVERDUE')`, carrying, rider); err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}
	waiting, _ := seedOrderForAdmin(t, pool, "READY_FOR_PICKUP")
	offer := pendingOffer(t, pool, waiting, rider)
	srv := accountServer(t, pool, staff(t, pool, httpx.RoleAdmin), &recordingReleaser{})

	got := act(t, srv, "RIDER", rider, "SUSPEND", "INCIDENT_UNDER_INVESTIGATION", "")
	mustStatus(t, "suspend rider", got, 200, "")
	inFlight := got.data["in_flight"].(map[string]any)
	if w := ids(inFlight["withdrawn_offer_ids"]); len(w) != 1 || w[0] != offer {
		t.Errorf("withdrawn offers %v, want %s", w, offer)
	}
	if c := ids(inFlight["continuing_order_ids"]); len(c) != 1 || c[0] != carrying {
		t.Errorf("continuing %v, want the delivery %s", c, carrying)
	}
	if s := scalar[string](t, pool, `SELECT state::text FROM dispatch_offer WHERE id=$1`, offer); s != "WITHDRAWN" {
		t.Errorf("offer is %s, want WITHDRAWN", s)
	}
	if s := scalar[string](t, pool, `SELECT state::text FROM dispatch WHERE order_id=$1`, carrying); s != "CARRYING" {
		t.Errorf("delivery is %s, want it left CARRYING to finish", s)
	}
	if s := scalar[string](t, pool, `SELECT account_status::text||'/'||availability_state::text||'/'||go_offline_after_delivery FROM rider_profile WHERE account_id=$1`, rider); s != "SUSPENDED/ON_DELIVERY/true" {
		t.Errorf("rider is %s, want SUSPENDED/ON_DELIVERY/true", s)
	}

	// An offer a dispatch wave made at the same moment cannot be accepted.
	another, _ := seedOrderForAdmin(t, pool, "READY_FOR_PICKUP")
	late := pendingOffer(t, pool, another, rider)
	if _, err := dispatch.NewStore(pool).AcceptOffer(ctx, rider, late, time.Now()); err == nil || !strings.HasPrefix(err.Error(), "ACCOUNT_NOT_ACTIVE") {
		t.Errorf("accepting an offer while suspended: err = %v, want ACCOUNT_NOT_ACTIVE", err)
	}

	got = act(t, srv, "RIDER", rider, "REINSTATE", "ISSUE_RESOLVED", "")
	mustStatus(t, "reinstate rider", got, 200, "")
	if got.data["to_state"] != "ACTIVE" {
		t.Errorf("reinstated to %v, want ACTIVE", got.data["to_state"])
	}
	kinds := notificationKinds(t, pool, rider)
	if fmt.Sprint(kinds) != "[ACCOUNT_SUSPENDED ACCOUNT_REINSTATED]" {
		t.Errorf("rider notices %v, want [ACCOUNT_SUSPENDED ACCOUNT_REINSTATED]", kinds)
	}
	if title := scalar[string](t, pool, `SELECT title FROM notification WHERE account_id=$1 AND kind='ACCOUNT_REINSTATED'`, rider); title != "You can go online again" {
		t.Errorf("reinstatement notice %q", title)
	}
}

// TestABanNeedsTwoPeopleAndEndsEverySession: an admin proposes a ban; only a
// different super admin confirms it, within 7 days; the ban ends every session
// and the banned rider holds no rider role at the next sign-in. A customer's ban
// waits for their accepted orders. Only a super admin lifts a ban.
func TestABanNeedsTwoPeopleAndEndsEverySession(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	admin := staff(t, pool, httpx.RoleAdmin)
	super1 := staff(t, pool, httpx.RoleSuperAdmin)
	super2 := staff(t, pool, httpx.RoleSuperAdmin)
	rel := &recordingReleaser{}
	asAdmin, asSuper1, asSuper2 := accountServer(t, pool, admin, rel), accountServer(t, pool, super1, rel), accountServer(t, pool, super2, rel)

	rider := seedRider(t, pool, "ONLINE_IDLE")
	addSession(t, pool, rider, "otp")
	addSession(t, pool, rider, "otp")

	got := act(t, asSuper1, "RIDER", rider, "PROPOSE_BAN", "ACCOUNT_SHARING", "")
	mustStatus(t, "propose ban", got, 200, "")
	if got.data["to_state"] != "SUSPENDED" || got.data["ban_proposal"] == nil || got.data["sessions_revoked"] != float64(0) {
		t.Fatalf("proposal: %v", got.data)
	}
	if s := scalar[string](t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id=$1`, rider); s != "OFFLINE" {
		t.Errorf("an idle rider whose ban is proposed is %s, want OFFLINE", s)
	}
	mustStatus(t, "an admin confirms", act(t, asAdmin, "RIDER", rider, "CONFIRM_BAN", "ACCOUNT_SHARING", ""), 403, "FORBIDDEN_PERMISSION")
	mustStatus(t, "the proposer confirms", act(t, asSuper1, "RIDER", rider, "CONFIRM_BAN", "ACCOUNT_SHARING", ""), 403, "SELF_APPROVAL_FORBIDDEN")

	got = act(t, asSuper2, "RIDER", rider, "CONFIRM_BAN", "ACCOUNT_SHARING", "")
	mustStatus(t, "a second super admin confirms", got, 200, "")
	if got.data["to_state"] != "BANNED" || got.data["sessions_revoked"] != float64(2) || liveSessions(t, pool, rider) != 0 {
		t.Fatalf("ban: to %v, sessions_revoked %v, live sessions %d; want BANNED, 2, 0",
			got.data["to_state"], got.data["sessions_revoked"], liveSessions(t, pool, rider))
	}
	roles, err := auth.NewStore(pool).RolesFor(ctx, rider)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range roles {
		if g.Role == "RIDER" {
			t.Error("a banned rider is still granted the rider role at sign-in")
		}
	}
	mustStatus(t, "an admin lifts a ban", act(t, asAdmin, "RIDER", rider, "REINSTATE", "APPEAL_UPHELD", ""), 403, "FORBIDDEN_PERMISSION")
	mustStatus(t, "a super admin lifts a ban", act(t, asSuper1, "RIDER", rider, "REINSTATE", "APPEAL_UPHELD", ""), 200, "")

	// The database holds the two-person rule too: a proposer's own confirmation
	// is refused even written directly.
	other := seedRider(t, pool, "OFFLINE")
	mustStatus(t, "propose", act(t, asSuper1, "RIDER", other, "PROPOSE_BAN", "SAFETY_RISK", ""), 200, "")
	_, err = pool.Exec(ctx, `
		INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
		                                 reason_text, actor_account_id, idempotency_key, request_hash)
		VALUES ('RIDER', $1, 'CONFIRM_BAN', 'SUSPENDED', 'BANNED', 'SAFETY_RISK', 'confirming my own proposal',
		        $2, $3, '\x00')`, other, super1.AccountID, uuid.NewString())
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Errorf("a proposer's own confirmation written directly: err = %v, want a check violation", err)
	}

	// A proposal lapses after 7 days: confirming it then is refused. The database
	// stamps history with the transaction's clock (migration 00035), so the
	// eight-day-old proposal is a fixture written with the triggers off.
	stale := seedRider(t, pool, "OFFLINE")
	bypass(t, pool,
		setRider(stale, "SUSPENDED"),
		q(`
		INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
		                                 reason_text, actor_account_id, idempotency_key, request_hash, created_at)
		VALUES ('RIDER', $1, 'PROPOSE_BAN', 'SUSPENDED', 'SUSPENDED', 'SAFETY_RISK', 'proposed and never confirmed',
		        $2, $3, '\x00', now() - interval '8 days')`, stale, admin.AccountID, uuid.NewString()))
	mustStatus(t, "confirm a lapsed proposal", act(t, asSuper2, "RIDER", stale, "CONFIRM_BAN", "SAFETY_RISK", ""), 409, "ILLEGAL_STATE_TRANSITION")

	// A customer's ban waits for an accepted order to finish.
	order, customer := seedOrderForAdmin(t, pool, "PREPARING")
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, customer); err != nil {
		t.Fatal(err)
	}
	addSession(t, pool, customer, "otp")
	mustStatus(t, "propose a customer ban", act(t, asAdmin, "CUSTOMER", customer, "PROPOSE_BAN", "ABUSIVE_CONDUCT_TO_RIDER", ""), 200, "")
	if s := scalar[string](t, pool, `SELECT status::text FROM account WHERE id=$1`, customer); s != "SUSPENDED" {
		t.Errorf("customer status after a ban proposal = %s, want SUSPENDED", s)
	}
	got = act(t, asSuper1, "CUSTOMER", customer, "CONFIRM_BAN", "ABUSIVE_CONDUCT_TO_RIDER", "")
	mustStatus(t, "confirm with an order being prepared", got, 409, "IN_FLIGHT_ORDERS_PRESENT")
	if fmt.Sprint(got.details["order_ids"]) != "["+order+"]" {
		t.Errorf("order_ids %v, want [%s]", got.details["order_ids"], order)
	}
	if _, err := pool.Exec(ctx, `UPDATE "order" SET state='COMPLETED', deadline_at=NULL, deadline_action=NULL WHERE id=$1`, order); err != nil {
		t.Fatal(err)
	}
	got = act(t, asSuper1, "CUSTOMER", customer, "CONFIRM_BAN", "ABUSIVE_CONDUCT_TO_RIDER", "")
	mustStatus(t, "confirm once the order finished", got, 200, "")
	if got.data["sessions_revoked"] != float64(1) || liveSessions(t, pool, customer) != 0 {
		t.Errorf("customer ban ended %v sessions, %d still live; want 1 and 0", got.data["sessions_revoked"], liveSessions(t, pool, customer))
	}
}

// TestOnlyAdminsSignedInWithTwoStepsCanActAndARetryActsOnce: everyone but admins
// and super admins is refused (deny by default, then the service checks again),
// an admin session without two-step sign-in is refused, and a retry with the
// same Idempotency-Key returns the first result without acting twice.
func TestOnlyAdminsSignedInWithTwoStepsCanActAndARetryActsOnce(t *testing.T) {
	pool := dialTestPool(t)
	order, customer := seedOrderForAdmin(t, pool, "COMPLETED")
	restaurant := restaurantOf(t, pool, order)
	if _, err := pool.Exec(context.Background(), `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, customer); err != nil {
		t.Fatal(err)
	}
	rider := seedRider(t, pool, "OFFLINE")
	targets := []struct{ subject, id, reason string }{
		{"RESTAURANT", restaurant, "COMPLIANCE_THRESHOLD"}, {"RIDER", rider, "LOW_PERFORMANCE"}, {"CUSTOMER", customer, "FAKE_REVIEWS"},
	}

	for _, role := range []httpx.Role{httpx.RoleCustomer, httpx.RoleRider, httpx.RoleRestaurantOwner, httpx.RoleSupportAgent} {
		p := httpx.Principal{AccountID: uuid.NewString(), Roles: []httpx.Role{role}, AMR: []string{"pwd+totp"}}
		srv := accountServer(t, pool, p, &recordingReleaser{})
		for _, tg := range targets {
			if got := act(t, srv, tg.subject, tg.id, "SUSPEND", tg.reason, ""); got.status != 403 {
				t.Errorf("%s suspending a %s: %d %s, want 403", role, tg.subject, got.status, got.errCode)
			}
		}
	}
	anon := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: httpx.AnonymousAuthenticator{}, Authorizer: auth.Matrix{}})
	Routes(anon, NewHandler(NewRepo(pool), DefaultConfig()))
	anonSrv := httptest.NewServer(anon)
	defer anonSrv.Close()
	if got := act(t, anonSrv, "RIDER", rider, "SUSPEND", "LOW_PERFORMANCE", ""); got.status != 401 {
		t.Errorf("anonymous: %d, want 401", got.status)
	}
	noTOTP := accountServer(t, pool, staff(t, pool, httpx.RoleAdmin, "pwd"), &recordingReleaser{})
	mustStatus(t, "admin without two-step sign-in", act(t, noTOTP, "RIDER", rider, "SUSPEND", "LOW_PERFORMANCE", ""), 403, "MFA_REQUIRED")
	for _, tg := range targets {
		if s := map[string]string{
			"RESTAURANT": scalar[string](t, pool, `SELECT account_state::text FROM restaurant WHERE id=$1`, restaurant),
			"RIDER":      scalar[string](t, pool, `SELECT account_status::text FROM rider_profile WHERE account_id=$1`, rider),
			"CUSTOMER":   scalar[string](t, pool, `SELECT status::text FROM account WHERE id=$1`, customer),
		}[tg.subject]; s == "SUSPENDED" {
			t.Errorf("a refused caller suspended the %s", tg.subject)
		}
	}

	admin := staff(t, pool, httpx.RoleAdmin)
	srv := accountServer(t, pool, admin, &recordingReleaser{})
	key := uuid.NewString()
	first := act(t, srv, "RIDER", rider, "SUSPEND", "LOW_PERFORMANCE", key)
	again := act(t, srv, "RIDER", rider, "SUSPEND", "LOW_PERFORMANCE", key)
	mustStatus(t, "first", first, 200, "")
	mustStatus(t, "retry", again, 200, "")
	if !again.replayed || again.data["id"] != first.data["id"] {
		t.Errorf("retry: replayed %v, id %v; want true and the first id %v", again.replayed, again.data["id"], first.data["id"])
	}
	if n := scalar[int](t, pool, `SELECT count(*)::int FROM account_state_event WHERE subject_id=$1`, rider); n != 1 {
		t.Errorf("history rows after a retry = %d, want 1", n)
	}
	mustStatus(t, "same key, different request", act(t, srv, "RIDER", rider, "REINSTATE", "ISSUE_RESOLVED", key), 409, "IDEMPOTENCY_KEY_REUSE")
	mustStatus(t, "acting on your own account", act(t, srv, "CUSTOMER", admin.AccountID, "SUSPEND", "OTHER", ""), 403, "FORBIDDEN_PERMISSION")
}
