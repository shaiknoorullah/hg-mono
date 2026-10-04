package admin

// The account actions' gates hold for every path, not only the HTTP operations
// (the security reviews of https://github.com/shaiknoorullah/hg-mono/pull/335).
// Migration 00045 makes the state columns unwritable by the application role
// and its database functions the only writers; account_state_guard_db_test.go
// tries every other way in as that role. This file holds the shared harness and
// the tests of the service and of onboarding. They need HG_TEST_POSTGRES_DSN,
// like the rest of this package's integration tests.

import (
	"context"
	"errors"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// ---- harness ----------------------------------------------------------------

type stmt struct {
	sql  string
	args []any
}

func q(sql string, args ...any) stmt { return stmt{sql, args} }

// direct runs statements in one transaction, as another code path would, and
// returns what the database says, at a statement or at commit (the state guards
// are deferred to commit).
func direct(pool *pgxpool.Pool, stmts ...stmt) error {
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s.sql, s.args...); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// bypass puts an account in a state with every trigger off
// (session_replication_role = replica, which only a superuser may set): the way a
// test reaches a state, or a backdated history row, that no lawful path reaches
// in one step. The application never connects as a superuser.
func bypass(t *testing.T, pool *pgxpool.Pool, stmts ...stmt) {
	t.Helper()
	all := append([]stmt{q(`SET LOCAL session_replication_role = replica`)}, stmts...)
	if err := direct(pool, all...); err != nil {
		t.Fatalf("fixture: %v", err)
	}
}

// refused asserts the database refused a path with the given SQLSTATE and a
// message naming the rule.
func refused(t *testing.T, what string, err error, code, rule string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Errorf("%s: err = %v, want the database to refuse it (%s %s)", what, err, code, rule)
		return
	}
	if pgErr.Code != code || !strings.Contains(pgErr.Message, rule) {
		t.Errorf("%s: refused with %s %q, want %s %s", what, pgErr.Code, pgErr.Message, code, rule)
	}
}

func accepted(t *testing.T, what string, err error) {
	t.Helper()
	if err != nil {
		t.Errorf("%s: %v, want it accepted", what, err)
	}
}

// appPool connects as the application role (hg_app), with exactly the rights
// the API has in production, rather than as the migrations' owner the other
// tests use.
func appPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("skipping integration test: HG_TEST_POSTGRES_DSN is not set")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.AfterConnect = func(ctx context.Context, c *pgx.Conn) error {
		_, err := c.Exec(ctx, `SET ROLE hg_app`)
		return err
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func setRestaurant(id, state string, reasons ...string) stmt {
	if reasons == nil {
		reasons = []string{}
	}
	return q(`UPDATE restaurant SET account_state = $2::restaurant_account_state, delist_reasons = $3 WHERE id = $1`, id, state, reasons)
}

func setRider(id, state string) stmt {
	return q(`UPDATE rider_profile SET account_status = $2::rider_account_status WHERE account_id = $1`, id, state)
}

func setCustomer(id, state string) stmt {
	return q(`UPDATE account SET status = $2::account_status WHERE id = $1`, id, state)
}

// guardRestaurant is a restaurant that finished onboarding, in the given state.
func guardRestaurant(t *testing.T, pool *pgxpool.Pool, onboarding, state string) string {
	t.Helper()
	return scalar[string](t, pool, `
INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code, location,
                        onboarding_state, account_state)
VALUES ('guard-'||substr(md5(random()::text),1,10), 'Guard Kitchen Inc.', 'Guard Kitchen', 'ON', 'Toronto',
        '1 King St', 'M5J0C3', ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
        $1::restaurant_onboarding_state, $2::restaurant_account_state)
RETURNING id::text`, onboarding, state)
}

func guardCustomer(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := scalar[string](t, pool, `
INSERT INTO account (phone_e164, status)
VALUES ('+1647'||lpad((floor(random()*9000000)+1000000)::bigint::text, 7, '0'), 'ACTIVE') RETURNING id::text`)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

// ---- tests ------------------------------------------------------------------

// TestTheDatabaseHoldsTheServicesTransitions: account_state_rule (migration
// 00045) is exactly accountstate.Transitions(), so the database refuses what the
// service refuses and nothing more.
func TestTheDatabaseHoldsTheServicesTransitions(t *testing.T) {
	pool := dialTestPool(t)
	rows, err := pool.Query(context.Background(), `
SELECT subject_type::text, action::text, from_state, to_state, principal, permission, coalesce(reason_code, '')
  FROM account_state_rule`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var db []string
	for rows.Next() {
		var s, a, f, to, p, perm, r string
		if err := rows.Scan(&s, &a, &f, &to, &p, &perm, &r); err != nil {
			t.Fatal(err)
		}
		db = append(db, strings.Join([]string{s, a, f, to, p, perm, r}, " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	var code []string
	for _, tr := range accountstate.Transitions() {
		code = append(code, strings.Join([]string{string(tr.Subject), string(tr.Action), tr.From, tr.To,
			string(tr.Principal), tr.Permission, tr.ReasonCode}, " "))
	}
	sort.Strings(db)
	sort.Strings(code)
	if strings.Join(db, "\n") != strings.Join(code, "\n") {
		t.Fatalf("account_state_rule differs from accountstate.Transitions():\n database:\n  %s\n code:\n  %s",
			strings.Join(db, "\n  "), strings.Join(code, "\n  "))
	}
}

// TestTheServiceHoldsTheCallerGatesItself: ApplyAccountAction refuses a caller
// that is not an admin or a super admin signed in with two-step sign-in, an
// admin confirming a ban, and anyone acting on their own account, even when it
// is called without the HTTP handler in front of it.
func TestTheServiceHoldsTheCallerGatesItself(t *testing.T) {
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	ctx := context.Background()
	deps := accountActionDeps{orders: nil}
	customer := guardCustomer(t, pool)
	in := func(p httpx.Principal, subject accountstate.Subject, id string, a accountstate.Action, reason string) accountActionInput {
		return accountActionInput{
			Subject: subject, SubjectID: id, Action: a, ReasonCode: reason,
			ReasonText: "called from another path in a test", IdemKey: uuid.NewString(),
			Principal: p, Actor: auditActor{staffID: p.AccountID},
		}
	}

	support := staff(t, pool, httpx.RoleSupportAgent)
	var perm permissionError
	if _, err := repo.ApplyAccountAction(ctx, deps, in(support, accountstate.Customer, customer, accountstate.Suspend, "OTHER")); !errors.As(err, &perm) {
		t.Errorf("a support agent: err = %v, want a permission error", err)
	}
	noTOTP := staff(t, pool, httpx.RoleAdmin, "pwd")
	if _, err := repo.ApplyAccountAction(ctx, deps, in(noTOTP, accountstate.Customer, customer, accountstate.Suspend, "OTHER")); !errors.Is(err, errMFARequired) {
		t.Errorf("an admin without two-step sign-in: err = %v, want errMFARequired", err)
	}
	admin := staff(t, pool, httpx.RoleAdmin)
	impersonated := in(admin, accountstate.Customer, customer, accountstate.Suspend, "OTHER")
	impersonated.Actor.staffID = uuid.NewString()
	if _, err := repo.ApplyAccountAction(ctx, deps, impersonated); err == nil {
		t.Errorf("recording somebody else as the actor was accepted")
	}
	if _, err := repo.ApplyAccountAction(ctx, deps, in(admin, accountstate.Customer, admin.AccountID, accountstate.Suspend, "OTHER")); !errors.Is(err, errActOnOwnAccount) {
		t.Errorf("an admin on their own account: err = %v, want errActOnOwnAccount", err)
	}

	if _, err := repo.ApplyAccountAction(ctx, deps, in(admin, accountstate.Customer, customer, accountstate.ProposeBan, "OTHER")); err != nil {
		t.Fatalf("an admin proposes a ban: %v", err)
	}
	other := staff(t, pool, httpx.RoleAdmin)
	if _, err := repo.ApplyAccountAction(ctx, deps, in(other, accountstate.Customer, customer, accountstate.ConfirmBan, "OTHER")); !errors.As(err, &perm) || perm.permission != "customer.confirm_ban" {
		t.Errorf("an admin confirms a ban: err = %v, want the customer.confirm_ban permission error", err)
	}
	if s := scalar[string](t, pool, `SELECT status::text FROM account WHERE id = $1`, customer); s != "SUSPENDED" {
		t.Errorf("customer is %s after the refusals, want SUSPENDED (proposed, not banned)", s)
	}
}

// TestCompletingOnboardingIsTheOnboardingPrincipal: RecomputeOnboarding lists a
// restaurant only with a current halal certificate, delists it otherwise, never
// lifts a penalty, and records the ONBOARDING principal in the audit log.
func TestCompletingOnboardingIsTheOnboardingPrincipal(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t) // the API's own rights: onboarding works without the owner's
	ctx := context.Background()
	reviewer := staff(t, pool, httpx.RoleAdmin)
	ready := func(state string, certDays *int) string {
		id := guardRestaurant(t, pool, "MENU_PENDING", state)
		for _, s := range []string{
			`INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
			 VALUES ('RESTAURANT', $1, 'acct_guard_'||substr(md5(random()::text),1,10), true, true)`,
			`INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at) VALUES ($1, 1, '09:00', '21:00')`,
		} {
			if _, err := pool.Exec(ctx, s, id); err != nil {
				t.Fatal(err)
			}
		}
		menuFor(t, pool, id, reviewer.AccountID)
		if certDays != nil {
			certify(t, pool, id, *certDays)
		}
		return id
	}
	recompute := func(id string) (string, string, string) {
		t.Helper()
		tx, err := app.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if err := restaurant.RecomputeOnboarding(ctx, tx, id); err != nil {
			t.Fatalf("recompute: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		return scalar[string](t, pool, `SELECT onboarding_state::text FROM restaurant WHERE id = $1`, id),
			scalar[string](t, pool, `SELECT account_state::text FROM restaurant WHERE id = $1`, id),
			scalar[string](t, pool, `SELECT array_to_string(delist_reasons, ',') FROM restaurant WHERE id = $1`, id)
	}
	days := func(n int) *int { return &n }

	current := ready("PENDING", days(300))
	if o, a, r := recompute(current); o != "ACTIVE" || a != "LIVE" || r != "" {
		t.Errorf("current certificate: %s/%s [%s], want ACTIVE/LIVE []", o, a, r)
	}
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM audit_event
		 WHERE subject_id = $1 AND action = 'restaurant.listed' AND actor_kind = 'SYSTEM'
		   AND actor_account_id IS NULL AND actor_roles = '["SYSTEM:ONBOARDING"]'::jsonb`, current); n != 1 {
		t.Errorf("audit rows naming the onboarding principal = %d, want 1", n)
	}
	lapsed := ready("PENDING", days(-2))
	if o, a, r := recompute(lapsed); o != "ACTIVE" || a != "DELISTED" || r != "HALAL_CERTIFICATE_EXPIRED" {
		t.Errorf("lapsed certificate: %s/%s [%s], want ACTIVE/DELISTED [HALAL_CERTIFICATE_EXPIRED]", o, a, r)
	}
	none := ready("PENDING", nil)
	if o, a, r := recompute(none); o != "ACTIVE" || a != "DELISTED" || r != "HALAL_CERTIFICATE_UNVERIFIED" {
		t.Errorf("no certificate: %s/%s [%s], want ACTIVE/DELISTED [HALAL_CERTIFICATE_UNVERIFIED]", o, a, r)
	}
	punished := ready("SUSPENDED", days(300))
	if o, a, _ := recompute(punished); o != "ACTIVE" || a != "SUSPENDED" {
		t.Errorf("suspended restaurant completing onboarding: %s/%s, want ACTIVE/SUSPENDED", o, a)
	}

	// The app role can call the onboarding principal but not steer it: with a gate
	// unmet it refuses, and the app cannot write the account state itself.
	unready := guardRestaurant(t, pool, "MENU_PENDING", "PENDING")
	certify(t, pool, unready, 300)
	refused(t, "complete onboarding with the gates unmet",
		direct(app, q(`SELECT * FROM account_state_complete_onboarding($1)`, unready)),
		"23514", "account_state_onboarding_incomplete")
	refused(t, "the app takes a restaurant out of PENDING itself, shaped like onboarding",
		direct(app, q(`UPDATE restaurant SET onboarding_state = 'ACTIVE', account_state = 'LIVE' WHERE id = $1`, unready)),
		"42501", "permission denied")
}

// menuFor gives a restaurant one live, approved menu item, which onboarding needs
// before it completes.
func menuFor(t *testing.T, pool *pgxpool.Pool, restaurantID, reviewer string) {
	t.Helper()
	ctx := context.Background()
	var cat, item, version string
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`,
		restaurantID).Scan(&cat); err != nil {
		t.Fatalf("menu category: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		VALUES ($1, $2, 1200, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		restaurantID, cat).Scan(&item); err != nil {
		t.Fatalf("menu item: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item_version (menu_item_id, restaurant_id, version, name, review_status, reviewed_by, reviewed_at)
		VALUES ($1, $2, 1, 'Guard Plate', 'APPROVED', $3, now()) RETURNING id`,
		item, restaurantID, reviewer).Scan(&version); err != nil {
		t.Fatalf("menu version: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE menu_item SET live_version_id = $2 WHERE id = $1`, item, version); err != nil {
		t.Fatalf("menu live version: %v", err)
	}
}
