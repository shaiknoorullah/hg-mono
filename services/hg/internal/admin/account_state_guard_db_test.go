package admin

// Migration 00035, tried as the application role (appPool: SET ROLE hg_app, the
// API's own rights). The state columns are not the app's to write; the database
// functions are the only writers, and each holds its own gates. Every test below
// is one way in, tried and refused, or the one lawful way, shown to work.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// bindActor names the account the transaction acts for, as ApplyAccountAction
// does before it calls account_state_apply.
func bindActor(actor string) stmt {
	return q(`SELECT set_config('hg.actor_id', $1, true)`, actor)
}

// applyFn calls account_state_apply directly, as a path other than the service
// would.
func applyFn(subject, id, action, actor, reason string) stmt {
	return q(`SELECT * FROM account_state_apply($1::account_subject_type, $2, $3::account_action, $4, $5,
	                                            'a direct call in a test', $6, '\x00', '{}', '{}')`,
		subject, id, action, actor, reason, uuid.NewString())
}

func stateOf(t *testing.T, pool *pgxpool.Pool, subject, id string) string {
	t.Helper()
	return scalar[string](t, pool, map[string]string{
		"RESTAURANT": `SELECT account_state::text || ' ' || array_to_string(delist_reasons, ',') FROM restaurant WHERE id = $1`,
		"RIDER":      `SELECT account_status::text FROM rider_profile WHERE account_id = $1`,
		"CUSTOMER":   `SELECT status::text FROM account WHERE id = $1`,
	}[subject], id)
}

// TestTheAppRoleCannotWriteAnAccountsState: as the application role, no UPDATE,
// INSERT or DELETE reaches a state column, whether alone, with other columns, in
// a CTE, across many rows, or through an upsert; every other column stays
// writable; and a banned account cannot be deleted and created again.
func TestTheAppRoleCannotWriteAnAccountsState(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	restaurant := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	rider, other := seedRider(t, pool, "OFFLINE"), seedRider(t, pool, "OFFLINE")
	customer := guardCustomer(t, pool)
	denied := func(what string, stmts ...stmt) {
		t.Helper()
		refused(t, what, direct(app, stmts...), "42501", "permission denied")
	}

	denied("ban a restaurant", setRestaurant(restaurant, "BANNED"))
	denied("clear a restaurant's delisting reasons", q(`UPDATE restaurant SET delist_reasons = '{}' WHERE id = $1`, restaurant))
	denied("suspend a restaurant along with another column",
		q(`UPDATE restaurant SET is_accepting_orders = false, account_state = 'SUSPENDED' WHERE id = $1`, restaurant))
	denied("ban a rider", setRider(rider, "BANNED"))
	denied("ban two riders in one statement",
		q(`UPDATE rider_profile SET account_status = 'BANNED' WHERE account_id IN ($1, $2)`, rider, other))
	denied("ban a customer", setCustomer(customer, "BANNED"))
	denied("rewrite a customer's status reason", q(`UPDATE account SET status_reason = 'OTHER' WHERE id = $1`, customer))
	denied("ban from a CTE",
		q(`WITH r AS (SELECT id FROM restaurant WHERE id = $1)
		   UPDATE restaurant SET account_state = 'BANNED' FROM r WHERE restaurant.id = r.id`, restaurant))
	denied("move a profile to another account",
		q(`UPDATE rider_profile SET account_id = $2 WHERE account_id = $1`, rider, customer))
	denied("delete a rider", q(`DELETE FROM rider_profile WHERE account_id = $1`, rider))
	denied("delete a restaurant", q(`DELETE FROM restaurant WHERE id = $1`, restaurant))
	denied("delete an account", q(`DELETE FROM account WHERE id = $1`, customer))
	denied("create a customer already banned",
		q(`INSERT INTO account (phone_e164, status) VALUES ('+16475550199', 'BANNED')`))
	denied("create a rider already active",
		q(`INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, account_status)
		   VALUES ($1, 'A', 'B', '1990-01-01', 'ACTIVE')`, customer))
	denied("upsert a restaurant's state",
		q(`INSERT INTO restaurant (id, slug, legal_name, display_name) VALUES ($1, 'upsert-'||md5(random()::text), 'X', 'X')
		   ON CONFLICT (id) DO UPDATE SET account_state = 'LIVE'`, restaurant))
	denied("write the history", q(`
		INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
		                                 reason_text, actor_kind, system_actor)
		VALUES ('RESTAURANT', $1, 'DELIST', 'LIVE', 'DELISTED', 'HALAL_CERTIFICATE_EXPIRED',
		        'posing as the expiry', 'SYSTEM', 'HALAL_EXPIRY')`, restaurant))
	denied("change the rules", q(`INSERT INTO account_state_rule VALUES ('RIDER', 'REINSTATE', 'BANNED', 'ACTIVE', 'ADMIN', 'x', NULL)`))
	if got := stateOf(t, pool, "RESTAURANT", restaurant); got != "LIVE " {
		t.Errorf("restaurant is %q after the refusals, want LIVE", got)
	}

	// Everything else stays the app's to write.
	accepted(t, "pause a restaurant", direct(app, q(`UPDATE restaurant SET is_accepting_orders = false WHERE id = $1`, restaurant)))
	accepted(t, "a rider goes offline", direct(app, q(`UPDATE rider_profile SET is_online = false WHERE account_id = $1`, rider)))
	accepted(t, "a customer's email", direct(app, q(`UPDATE account SET email = $2 WHERE id = $1`,
		customer, "guard-"+uuid.NewString()[:8]+"@hg.test")))
	accepted(t, "a new account starts in its default state",
		direct(app, q(`INSERT INTO account (email) VALUES ($1)`, "new-"+uuid.NewString()[:8]+"@hg.test")))

	// Every column but the state and the key is writable by the app, so a column a
	// later migration adds without account_state_grant_app_columns() is caught here.
	rows, err := pool.Query(context.Background(), `
		SELECT c.table_name, c.column_name,
		       has_column_privilege('hg_app', 'public.' || c.table_name, c.column_name, 'UPDATE'),
		       has_column_privilege('hg_app', 'public.' || c.table_name, c.column_name, 'INSERT')
		  FROM information_schema.columns c
		 WHERE c.table_schema = 'public' AND c.table_name IN ('restaurant', 'rider_profile', 'account')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	stateCol := map[string]bool{"restaurant.account_state": true, "restaurant.delist_reasons": true,
		"rider_profile.account_status": true, "account.status": true, "account.status_reason": true}
	keyCol := map[string]bool{"restaurant.id": true, "rider_profile.account_id": true, "account.id": true}
	for rows.Next() {
		var table, col string
		var upd, ins bool
		if err := rows.Scan(&table, &col, &upd, &ins); err != nil {
			t.Fatal(err)
		}
		name := table + "." + col
		if upd != (!stateCol[name] && !keyCol[name]) || ins != !stateCol[name] {
			t.Errorf("%s: hg_app may UPDATE %v, INSERT %v; want UPDATE %v, INSERT %v",
				name, upd, ins, !stateCol[name] && !keyCol[name], !stateCol[name])
		}
	}
}

// TestAStaffActionWorksOnlyThroughItsFunction: account_state_apply is the one
// writer of a staff action. It acts only for the account the transaction is bound
// to, only with that account's grants as they stand, and holds the two-person ban
// and the own-account rule itself; through it, each action works.
func TestAStaffActionWorksOnlyThroughItsFunction(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	admin, super, super2 := staff(t, pool, httpx.RoleAdmin), staff(t, pool, httpx.RoleSuperAdmin), staff(t, pool, httpx.RoleSuperAdmin)
	rider := seedRider(t, pool, "OFFLINE")

	refused(t, "with no account bound to the transaction",
		direct(app, applyFn("RIDER", rider, "SUSPEND", admin.AccountID, "LOW_PERFORMANCE")),
		"42501", "account_state_actor_unbound")
	refused(t, "naming an admin while bound to someone else",
		direct(app, bindActor(super.AccountID), applyFn("RIDER", rider, "SUSPEND", admin.AccountID, "LOW_PERFORMANCE")),
		"42501", "account_state_actor_unbound")
	customer := guardCustomer(t, pool)
	refused(t, "a customer acting",
		direct(app, bindActor(customer), applyFn("RIDER", rider, "SUSPEND", customer, "LOW_PERFORMANCE")),
		"42501", "account_state_actor_not_permitted")
	refused(t, "an admin on their own account",
		direct(app, bindActor(admin.AccountID), applyFn("CUSTOMER", admin.AccountID, "SUSPEND", admin.AccountID, "OTHER")),
		"42501", "account_state_own_account")
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, super.AccountID); err != nil {
		t.Fatal(err)
	}
	refused(t, "an admin suspends a super admin as a customer",
		direct(app, bindActor(admin.AccountID), applyFn("CUSTOMER", super.AccountID, "SUSPEND", admin.AccountID, "OTHER")),
		"42501", "account_state_staff_subject")

	// The lifecycle, each step through the function.
	for _, step := range []struct {
		actor, action, reason, want string
	}{
		{admin.AccountID, "SUSPEND", "LOW_PERFORMANCE", "SUSPENDED"},
		{admin.AccountID, "PROPOSE_BAN", "SAFETY_RISK", "SUSPENDED"},
		{super.AccountID, "CONFIRM_BAN", "SAFETY_RISK", "BANNED"},
		{super2.AccountID, "REINSTATE", "APPEAL_UPHELD", "ACTIVE"},
	} {
		accepted(t, step.action, direct(app, bindActor(step.actor), applyFn("RIDER", rider, step.action, step.actor, step.reason)))
		if got := stateOf(t, pool, "RIDER", rider); got != step.want {
			t.Errorf("after %s the rider is %s, want %s", step.action, got, step.want)
		}
	}
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM audit_event
		 WHERE subject_id = $1 AND action IN ('rider.suspend', 'rider.propose_ban', 'rider.confirm_ban', 'rider.unban')
		   AND actor_kind = 'ACCOUNT'`, rider); n != 4 {
		t.Errorf("audit rows for the four actions = %d, want 4", n)
	}
	if n := scalar[int](t, pool, `SELECT count(*)::int FROM account_state_event WHERE subject_id = $1 AND actor_kind = 'STAFF'`, rider); n != 4 {
		t.Errorf("history rows = %d, want 4", n)
	}

	// The gates the function holds itself.
	accepted(t, "propose again", direct(app, bindActor(admin.AccountID), applyFn("RIDER", rider, "PROPOSE_BAN", admin.AccountID, "SAFETY_RISK")))
	admin2 := staff(t, pool, httpx.RoleAdmin)
	refused(t, "a second admin confirms a ban",
		direct(app, bindActor(admin2.AccountID), applyFn("RIDER", rider, "CONFIRM_BAN", admin2.AccountID, "SAFETY_RISK")),
		"42501", "account_state_actor_not_permitted")
	proposer := staff(t, pool, httpx.RoleSuperAdmin)
	fresh := seedRider(t, pool, "OFFLINE")
	accepted(t, "a super admin proposes", direct(app, bindActor(proposer.AccountID), applyFn("RIDER", fresh, "PROPOSE_BAN", proposer.AccountID, "SAFETY_RISK")))
	refused(t, "the proposer confirms their own proposal",
		direct(app, bindActor(proposer.AccountID), applyFn("RIDER", fresh, "CONFIRM_BAN", proposer.AccountID, "SAFETY_RISK")),
		"23514", "account_ban_two_person")
	refused(t, "an illegal transition",
		direct(app, bindActor(super.AccountID), applyFn("RIDER", fresh, "DELIST", super.AccountID, "OTHER")),
		"23514", "account_state_illegal_transition")

	// A restaurant's listing is the function's decision, from its certificate.
	delisted := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	accepted(t, "delist", direct(app, bindActor(admin.AccountID), applyFn("RESTAURANT", delisted, "DELIST", admin.AccountID, "NO_APPROVED_MENU")))
	refused(t, "relist with no certificate",
		direct(app, bindActor(admin.AccountID), applyFn("RESTAURANT", delisted, "REINSTATE", admin.AccountID, "ISSUE_RESOLVED")),
		"23514", "account_state_halal_certificate_required")
	certify(t, pool, delisted, 300)
	accepted(t, "relist with a current certificate",
		direct(app, bindActor(admin.AccountID), applyFn("RESTAURANT", delisted, "REINSTATE", admin.AccountID, "ISSUE_RESOLVED")))
	if got := stateOf(t, pool, "RESTAURANT", delisted); got != "LIVE " {
		t.Errorf("relisted restaurant is %q, want LIVE with no reason", got)
	}
}

// TestTheActorsGrantIsReadNow: the function decides who may act from the grants
// as they stand: a revoked, future, scoped or orphaned grant fails, and so does a
// principal the service is told is a super admin when the grants say admin.
func TestTheActorsGrantIsReadNow(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	suspendAs := func(actor string) error {
		rider := seedRider(t, pool, "OFFLINE")
		return direct(app, bindActor(actor), applyFn("RIDER", rider, "SUSPEND", actor, "LOW_PERFORMANCE"))
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}

	revoked := staff(t, pool, httpx.RoleAdmin)
	accepted(t, "an admin with a live grant", suspendAs(revoked.AccountID))
	exec(`UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, revoked.AccountID)
	refused(t, "an admin whose grant was revoked", suspendAs(revoked.AccountID), "42501", "account_state_actor_not_permitted")

	future := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account_role SET granted_at = now() + interval '1 day' WHERE account_id = $1`, future.AccountID)
	refused(t, "an admin whose grant starts tomorrow", suspendAs(future.AccountID), "42501", "account_state_actor_not_permitted")

	deleted := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account SET deleted_at = now() WHERE id = $1`, deleted.AccountID)
	refused(t, "an admin whose account was deleted", suspendAs(deleted.AccountID), "42501", "account_state_actor_not_permitted")

	suspended := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account SET status = 'SUSPENDED' WHERE id = $1`, suspended.AccountID)
	refused(t, "an admin whose own account is suspended", suspendAs(suspended.AccountID), "42501", "account_state_actor_not_permitted")

	scoped := guardCustomer(t, pool)
	exec(`INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'ADMIN', 'RESTAURANT', $2)`,
		scoped, guardRestaurant(t, pool, "ACTIVE", "LIVE"))
	refused(t, "an ADMIN grant scoped to one restaurant", suspendAs(scoped), "42501", "account_state_actor_not_permitted")

	// The service is told the caller is a super admin; the grants say admin.
	posing := staff(t, pool, httpx.RoleAdmin)
	posing.Roles = []httpx.Role{httpx.RoleSuperAdmin}
	proposer := staff(t, pool, httpx.RoleAdmin)
	customer := guardCustomer(t, pool)
	repo := NewRepo(app)
	in := func(p httpx.Principal, a accountstate.Action) accountActionInput {
		return accountActionInput{
			Subject: accountstate.Customer, SubjectID: customer, Action: a, ReasonCode: "OTHER",
			ReasonText: "a principal that says more than its grants", IdemKey: uuid.NewString(),
			Principal: p, Actor: auditActor{staffID: p.AccountID},
		}
	}
	if _, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, in(proposer, accountstate.ProposeBan)); err != nil {
		t.Fatalf("propose: %v", err)
	}
	_, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, in(posing, accountstate.ConfirmBan))
	refused(t, "confirm a ban as a principal claiming super admin", err, "42501", "account_state_actor_not_permitted")
	if got := stateOf(t, pool, "CUSTOMER", customer); got != "SUSPENDED" {
		t.Errorf("customer is %s, want SUSPENDED (the ban was not confirmed)", got)
	}
}

// TestSystemFunctionsMakeOnlyTheirOwnChange: the system principals' functions
// take no actor and no action, and decide from the data; none of them can
// suspend, ban, lift a penalty or touch a rider or a customer.
func TestSystemFunctionsMakeOnlyTheirOwnChange(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	call := func(fn, id string, extra ...any) error {
		args := append([]any{id}, extra...)
		place := "$1"
		if len(extra) > 0 {
			place = "$1, $2"
		}
		return direct(app, q(fmt.Sprintf(`SELECT * FROM %s(%s)`, fn, place), args...))
	}
	state := func(id string) string { return stateOf(t, pool, "RESTAURANT", id) }

	// The expiry: a lapsed certificate delists a LIVE restaurant; a suspended or
	// banned one keeps its state and gains the reason; a current one is untouched.
	live := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, live, 300)
	accepted(t, "expiry with a current certificate", call("account_state_halal_expiry", live))
	if got := state(live); got != "LIVE " {
		t.Errorf("current certificate: %q, want LIVE untouched", got)
	}
	lapsed := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, lapsed, -2)
	accepted(t, "expiry of a lapsed certificate", call("account_state_halal_expiry", lapsed))
	if got := state(lapsed); got != "DELISTED HALAL_CERTIFICATE_EXPIRED" {
		t.Errorf("lapsed: %q, want DELISTED HALAL_CERTIFICATE_EXPIRED", got)
	}
	for _, from := range []string{"SUSPENDED", "BANNED", "DEACTIVATED", "PENDING"} {
		r := guardRestaurant(t, pool, "ACTIVE", from)
		certify(t, pool, r, -2)
		accepted(t, "expiry of a "+from+" restaurant", call("account_state_halal_expiry", r))
		if got := state(r); got != from+" HALAL_CERTIFICATE_EXPIRED" {
			t.Errorf("expiry on %s: %q, want the state kept and the reason recorded", from, got)
		}
	}

	// The renewal: a current certificate clears the lapse and lists a DELISTED
	// restaurant with no other reason; never one with another reason, never out of
	// a penalty.
	certify(t, pool, lapsed, 300)
	accepted(t, "renewal", call("account_state_halal_renewal", lapsed))
	if got := state(lapsed); got != "LIVE " {
		t.Errorf("renewed: %q, want LIVE", got)
	}
	menu := guardRestaurant(t, pool, "ACTIVE", "DELISTED")
	certify(t, pool, menu, 300)
	bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU,HALAL_CERTIFICATE_EXPIRED}' WHERE id = $1`, menu))
	accepted(t, "renewal of a restaurant delisted for something else too", call("account_state_halal_renewal", menu))
	if got := state(menu); got != "DELISTED NO_APPROVED_MENU" {
		t.Errorf("renewal with another reason: %q, want DELISTED NO_APPROVED_MENU", got)
	}
	for _, from := range []string{"SUSPENDED", "BANNED", "DEACTIVATED"} {
		r := guardRestaurant(t, pool, "ACTIVE", from)
		certify(t, pool, r, 300)
		bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{HALAL_CERTIFICATE_EXPIRED}' WHERE id = $1`, r))
		accepted(t, "renewal of a "+from+" restaurant", call("account_state_halal_renewal", r))
		if got := state(r); got != from+" " {
			t.Errorf("renewal on %s: %q, want the lapse cleared and the state kept", from, got)
		}
	}

	// The certifying body: withdrawn, it delists a LIVE restaurant no current
	// certificate from an accepted body vouches for; given back, it lists it
	// again; nothing else moves.
	issued := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, issued, 300)
	accepted(t, "withdrawn while a current certificate still vouches", call("account_state_issuer_listing", issued, false))
	if got := state(issued); got != "LIVE " {
		t.Errorf("still vouched for: %q, want LIVE", got)
	}
	bypass(t, pool, q(`UPDATE halal_issuing_body SET status = 'SUSPENDED'
	                    WHERE id IN (SELECT issuing_body_id FROM halal_certificate WHERE restaurant_id = $1)`, issued))
	accepted(t, "given back while the body is still withdrawn", call("account_state_issuer_listing", issued, true))
	if got := state(issued); got != "LIVE " {
		t.Errorf("accepted while nothing vouches: %q, want LIVE untouched (no relisting from here)", got)
	}
	accepted(t, "withdrawn", call("account_state_issuer_listing", issued, false))
	if got := state(issued); got != "DELISTED HALAL_CERTIFICATE_UNVERIFIED" {
		t.Errorf("withdrawn: %q, want DELISTED HALAL_CERTIFICATE_UNVERIFIED", got)
	}
	accepted(t, "withdrawn again, before it is given back", call("account_state_issuer_listing", issued, true))
	if got := state(issued); got != "DELISTED HALAL_CERTIFICATE_UNVERIFIED" {
		t.Errorf("accepted while nothing vouches: %q, want it kept delisted", got)
	}
	bypass(t, pool, q(`UPDATE halal_issuing_body SET status = 'ACCEPTED'
	                    WHERE id IN (SELECT issuing_body_id FROM halal_certificate WHERE restaurant_id = $1)`, issued))
	accepted(t, "given back", call("account_state_issuer_listing", issued, true))
	if got := state(issued); got != "LIVE " {
		t.Errorf("given back: %q, want LIVE", got)
	}
	for _, from := range []string{"SUSPENDED", "BANNED", "PENDING"} {
		r := guardRestaurant(t, pool, "ACTIVE", from)
		accepted(t, "withdrawn on a "+from+" restaurant", call("account_state_issuer_listing", r, false))
		if got := state(r); got != from+" " {
			t.Errorf("issuer on %s: %q, want untouched", from, got)
		}
	}
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM account_state_event
		 WHERE subject_id = $1 AND actor_kind = 'SYSTEM' AND system_actor = 'HALAL_ISSUER'`, issued); n != 2 {
		t.Errorf("history rows naming the issuer principal = %d, want 2 (one delisting, one relisting)", n)
	}

	// None of them takes a rider or a customer.
	rider, customer := seedRider(t, pool, "OFFLINE"), guardCustomer(t, pool)
	for _, fn := range []string{"account_state_halal_expiry", "account_state_halal_renewal", "account_state_complete_onboarding"} {
		refused(t, fn+" on a rider", call(fn, rider), "P0002", "account_state_subject_not_found")
		refused(t, fn+" on a customer", call(fn, customer), "P0002", "account_state_subject_not_found")
	}
	refused(t, "the issuer on a rider", call("account_state_issuer_listing", rider, false), "P0002", "account_state_subject_not_found")
}

// TestTheGuardsBelongToTheOwner: every function is the migrations' role's, pins
// its search_path and names its tables, so a temporary table changes nothing; the
// app may execute the five writers and nothing else, and cannot replace them.
func TestTheGuardsBelongToTheOwner(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	admin := staff(t, pool, httpx.RoleAdmin)

	rows, err := pool.Query(ctx, `
		SELECT p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''),
		       has_function_privilege('hg_app', p.oid, 'EXECUTE'), has_function_privilege('public', p.oid, 'EXECUTE')
		  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		 WHERE n.nspname = 'public' AND p.proname LIKE 'account_state%'`)
	if err != nil {
		t.Fatal(err)
	}
	writers := map[string]bool{"account_state_apply": true, "account_state_complete_onboarding": true,
		"account_state_halal_expiry": true, "account_state_halal_renewal": true, "account_state_issuer_listing": true}
	seen := 0
	for rows.Next() {
		var name, config string
		var secdef, appExec, publicExec bool
		if err := rows.Scan(&name, &secdef, &config, &appExec, &publicExec); err != nil {
			t.Fatal(err)
		}
		seen++
		if config != "search_path=pg_catalog, public, pg_temp" {
			t.Errorf("%s: search_path config %q, want pg_catalog, public, pg_temp", name, config)
		}
		if secdef != writers[name] {
			t.Errorf("%s: SECURITY DEFINER = %v, want %v", name, secdef, writers[name])
		}
		if appExec != writers[name] || publicExec {
			t.Errorf("%s: hg_app may execute %v, PUBLIC %v; want %v and false", name, appExec, publicExec, writers[name])
		}
	}
	rows.Close()
	if seen != 11 {
		t.Errorf("found %d account_state functions, want 11", seen)
	}

	denied := func(what string, stmts ...stmt) {
		t.Helper()
		refused(t, what, direct(app, stmts...), "42501", "")
	}
	denied("replace a writer", q(`CREATE OR REPLACE FUNCTION account_state_apply(
		account_subject_type, uuid, account_action, uuid, text, text, text, bytea, jsonb, jsonb)
		RETURNS TABLE (event_id uuid, from_state text, to_state text, delist_reasons text[], sessions_revoked int, created_at timestamptz)
		LANGUAGE sql AS $$ SELECT NULL::uuid, '', '', '{}'::text[], 0, now() $$`))
	denied("call a helper", q(`SELECT account_state_system_write($1, 'HALAL_EXPIRY', 'LIVE', 'BANNED', '{}', '{}', NULL, NULL, 'x', 'x')`, uuid.NewString()))
	denied("grant itself the state columns", q(`SELECT account_state_grant_app_columns()`))
	denied("switch every trigger off", q(`SET LOCAL session_replication_role = replica`))
	denied("drop the ban guard", q(`DROP TRIGGER account_state_event_ban_two_person ON account_state_event`))

	// Temporary tables named like the grants, the rules and the history change
	// nothing: a customer still cannot act, and a lone super admin still cannot ban.
	customer, rider := guardCustomer(t, pool), seedRider(t, pool, "OFFLINE")
	refused(t, "a customer forges a SUPER_ADMIN grant and an open rule in temporary tables",
		direct(app,
			q(`CREATE TEMP TABLE account_role ON COMMIT DROP AS SELECT * FROM public.account_role WHERE false`),
			q(`INSERT INTO account_role (id, account_id, role, scope_type, granted_at, created_at, updated_at)
			   VALUES (gen_random_uuid(), $1, 'SUPER_ADMIN', 'GLOBAL', now() - interval '1 day', now(), now())`, customer),
			q(`CREATE TEMP TABLE account_state_rule (subject_type text, action text, from_state text, to_state text,
			                                         principal text, permission text, reason_code text) ON COMMIT DROP`),
			q(`INSERT INTO account_state_rule VALUES ('RIDER', 'SUSPEND', 'ACTIVE', 'SUSPENDED', 'ADMIN', 'rider.suspend', NULL)`),
			bindActor(customer), applyFn("RIDER", rider, "SUSPEND", customer, "LOW_PERFORMANCE")),
		"42501", "account_state_actor_not_permitted")
	super := staff(t, pool, httpx.RoleSuperAdmin)
	accepted(t, "suspend", direct(app, bindActor(admin.AccountID), applyFn("RIDER", rider, "SUSPEND", admin.AccountID, "LOW_PERFORMANCE")))
	refused(t, "a super admin forges a second person's proposal in a temporary history",
		direct(app,
			q(`CREATE TEMP TABLE account_state_event ON COMMIT DROP AS SELECT * FROM public.account_state_event WHERE false`),
			q(`INSERT INTO account_state_event (id, subject_type, subject_id, action, from_state, to_state, reason_code,
			                                   reason_text, actor_account_id, created_at, in_flight, delist_reasons,
			                                   sessions_revoked, actor_kind)
			   VALUES (gen_random_uuid(), 'RIDER', $1, 'PROPOSE_BAN', 'SUSPENDED', 'SUSPENDED', 'SAFETY_RISK',
			           'a proposal nobody made', gen_random_uuid(), now(), '{}', '{}', 0, 'STAFF')`, rider),
			bindActor(super.AccountID), applyFn("RIDER", rider, "CONFIRM_BAN", super.AccountID, "SAFETY_RISK")),
		"23514", "account_ban_needs_proposal")
	if got := stateOf(t, pool, "RIDER", rider); got != "SUSPENDED" {
		t.Errorf("rider is %s, want SUSPENDED", got)
	}
}

// TestTheServiceActsOnlyAsItsCaller: through ApplyAccountAction, with the app's
// rights, the action binds the caller as the actor; a call naming someone else
// is refused before the database, and the database refuses a call whose bound
// account differs from the actor it is given.
func TestTheServiceActsOnlyAsItsCaller(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	admin := staff(t, pool, httpx.RoleAdmin)
	other := staff(t, pool, httpx.RoleAdmin)
	customer := guardCustomer(t, pool)
	repo := NewRepo(app)

	row, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
		Subject: accountstate.Customer, SubjectID: customer, Action: accountstate.Suspend, ReasonCode: "OTHER",
		ReasonText: "suspended through the service", IdemKey: uuid.NewString(),
		Principal: admin, Actor: auditActor{staffID: admin.AccountID},
	})
	if err != nil {
		t.Fatalf("suspend through the service: %v", err)
	}
	if row.ToState != "SUSPENDED" || row.ActorAccountID != admin.AccountID {
		t.Errorf("suspend: to %s by %s, want SUSPENDED by %s", row.ToState, row.ActorAccountID, admin.AccountID)
	}
	if _, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
		Subject: accountstate.Customer, SubjectID: customer, Action: accountstate.Reinstate, ReasonCode: "ISSUE_RESOLVED",
		ReasonText: "naming another admin", IdemKey: uuid.NewString(),
		Principal: admin, Actor: auditActor{staffID: other.AccountID},
	}); err == nil {
		t.Errorf("the service acted as an account other than its caller")
	}
	refused(t, "bound to one admin, acting as another",
		direct(app, bindActor(admin.AccountID), applyFn("CUSTOMER", customer, "REINSTATE", other.AccountID, "ISSUE_RESOLVED")),
		"42501", "account_state_actor_unbound")
	var pgErr *pgconn.PgError
	if err := direct(app, bindActor(other.AccountID), applyFn("CUSTOMER", customer, "REINSTATE", other.AccountID, "ISSUE_RESOLVED")); err != nil {
		if errors.As(err, &pgErr) && strings.Contains(pgErr.Message, "account_state_actor") {
			t.Errorf("a consistently bound admin was refused: %v", err)
		} else {
			t.Errorf("reinstate: %v", err)
		}
	}
}
