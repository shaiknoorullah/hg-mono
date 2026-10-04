package admin

// Migration 00045, tried as the application role (appPool: SET ROLE hg_app, the
// API's own rights). The state columns are not the app's to write; the database
// functions are the only writers, and each holds its own gates. Every test below
// is one way in, tried and refused, or the one lawful way, shown to work.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// applyFn calls account_state_apply directly, as a path other than the service
// would, presenting token as the caller's access token.
func applyFn(subject, id, action, token, reason string) stmt {
	return q(`SELECT * FROM account_state_apply($1::account_subject_type, $2, $3::account_action, $4, $5,
	                                            'a direct call in a test', $6, '\x00', '{}', '{}')`,
		subject, id, action, token, reason, uuid.NewString())
}

// as is p's access token, the proof account_state_apply acts on.
func as(p httpx.Principal) string { return p.Credential() }

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

// TestNoViewReopensTheAppsWriteBlock: the column privileges make restaurant,
// rider_profile, account and session unwritable by the app role, but a view
// onto one of them runs with its owner's rights by default and so would hand
// that write straight back. The monitoring view halal_status_inconsistency
// (00009) SELECTs from restaurant and is auto-updatable; 00023 grants hg_app
// write on every table, views included. Through it the app role could delete a
// restaurant (deleting and recreating a banned one) or rewrite its key, none of
// it naming restaurant. 00045 closes it (security_invoker + no write grant).
// This holds the fix, and holds that this is still the only updatable view onto
// a guarded table, so a later one is caught here rather than in production.
func TestNoViewReopensTheAppsWriteBlock(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	restaurant := guardRestaurant(t, pool, "ACTIVE", "BANNED")
	// Make the restaurant visible in the view (a CERTIFIED badge with no valid
	// certificate), so the write below matches a real row rather than none.
	if _, err := pool.Exec(context.Background(),
		`UPDATE restaurant SET halal_status = 'CERTIFIED', halal_certificate_id = NULL WHERE id = $1`, restaurant); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, pool, `SELECT count(*)::int FROM halal_status_inconsistency WHERE restaurant_id = $1`, restaurant); n != 1 {
		t.Fatalf("the banned restaurant is not visible in halal_status_inconsistency (%d rows), the probe would hit nothing", n)
	}

	denied := func(what string, s stmt) {
		t.Helper()
		refused(t, what, direct(app, s), "42501", "permission denied")
	}
	denied("delete a restaurant through the view",
		q(`DELETE FROM halal_status_inconsistency WHERE restaurant_id = $1`, restaurant))
	denied("rewrite a restaurant's key through the view",
		q(`UPDATE halal_status_inconsistency SET restaurant_id = $2 WHERE restaurant_id = $1`, restaurant, uuid.NewString()))
	denied("repoint a restaurant's certificate through the view",
		q(`UPDATE halal_status_inconsistency SET halal_certificate_id = $2 WHERE restaurant_id = $1`, restaurant, uuid.NewString()))
	if got := stateOf(t, pool, "RESTAURANT", restaurant); got != "BANNED " {
		t.Errorf("restaurant is %q after the refusals, want BANNED", got)
	}
	// The view is still readable by the app role (security_invoker runs the read
	// with the app's own SELECT on the base tables, which it has).
	accepted(t, "read the view as the app role",
		direct(app, q(`SELECT 1 FROM halal_status_inconsistency WHERE restaurant_id = $1`, restaurant)))

	// No other updatable view onto a guarded table exists. 28 is the UPDATE,
	// INSERT and DELETE bits of pg_relation_is_updatable.
	leaks := scalar[int](t, pool, `
		SELECT count(*)::int
		  FROM pg_class v
		  JOIN pg_rewrite rw ON rw.ev_class = v.oid
		  JOIN pg_depend d ON d.objid = rw.oid
		                  AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> v.oid
		 WHERE v.relkind = 'v' AND v.relnamespace = 'public'::regnamespace
		   AND v.relname <> 'halal_status_inconsistency'
		   AND (pg_relation_is_updatable(v.oid, false) & 28) <> 0
		   AND d.refobjid IN ('restaurant'::regclass, 'rider_profile'::regclass,
		                      'account'::regclass, 'session'::regclass)
		   AND has_table_privilege('hg_app', v.oid, 'UPDATE,DELETE,INSERT')`)
	if leaks != 0 {
		t.Errorf("found %d other updatable view(s) the app role may write onto a guarded table; each needs security_invoker and no write grant", leaks)
	}
}

// TestAStaffActionWorksOnlyThroughItsFunction: account_state_apply is the one
// writer of a staff action. It acts only as the account whose live session the
// access token proves, only with that account's grants as they stand, and holds
// the two-person ban and the own-account rule itself; through it, each action
// works.
func TestAStaffActionWorksOnlyThroughItsFunction(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	admin, super, super2 := staff(t, pool, httpx.RoleAdmin), staff(t, pool, httpx.RoleSuperAdmin), staff(t, pool, httpx.RoleSuperAdmin)
	rider := seedRider(t, pool, "OFFLINE")

	refused(t, "with no access token",
		direct(app, applyFn("RIDER", rider, "SUSPEND", "", "LOW_PERFORMANCE")),
		"42501", "account_state_session_required")
	customer := guardCustomer(t, pool)
	_, customerToken := signIn(t, pool, httpx.Principal{AccountID: customer, Roles: []httpx.Role{httpx.RoleCustomer}},
		"pwd+totp", 15*time.Minute)
	refused(t, "a customer acting",
		direct(app, applyFn("RIDER", rider, "SUSPEND", as(customerToken), "LOW_PERFORMANCE")),
		"42501", "account_state_actor_not_permitted")
	refused(t, "an admin on their own account",
		direct(app, applyFn("CUSTOMER", admin.AccountID, "SUSPEND", as(admin), "OTHER")),
		"42501", "account_state_own_account")
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, super.AccountID); err != nil {
		t.Fatal(err)
	}
	refused(t, "an admin suspends a super admin as a customer",
		direct(app, applyFn("CUSTOMER", super.AccountID, "SUSPEND", as(admin), "OTHER")),
		"42501", "account_state_staff_subject")

	// The lifecycle, each step through the function.
	for _, step := range []struct {
		actor                httpx.Principal
		action, reason, want string
	}{
		{admin, "SUSPEND", "LOW_PERFORMANCE", "SUSPENDED"},
		{admin, "PROPOSE_BAN", "SAFETY_RISK", "SUSPENDED"},
		{super, "CONFIRM_BAN", "SAFETY_RISK", "BANNED"},
		{super2, "REINSTATE", "APPEAL_UPHELD", "ACTIVE"},
	} {
		accepted(t, step.action, direct(app, applyFn("RIDER", rider, step.action, as(step.actor), step.reason)))
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
	accepted(t, "propose again", direct(app, applyFn("RIDER", rider, "PROPOSE_BAN", as(admin), "SAFETY_RISK")))
	admin2 := staff(t, pool, httpx.RoleAdmin)
	refused(t, "a second admin confirms a ban",
		direct(app, applyFn("RIDER", rider, "CONFIRM_BAN", as(admin2), "SAFETY_RISK")),
		"42501", "account_state_actor_not_permitted")
	proposer := staff(t, pool, httpx.RoleSuperAdmin)
	fresh := seedRider(t, pool, "OFFLINE")
	accepted(t, "a super admin proposes", direct(app, applyFn("RIDER", fresh, "PROPOSE_BAN", as(proposer), "SAFETY_RISK")))
	refused(t, "the proposer confirms their own proposal",
		direct(app, applyFn("RIDER", fresh, "CONFIRM_BAN", as(proposer), "SAFETY_RISK")),
		"23514", "account_ban_two_person")
	refused(t, "an illegal transition",
		direct(app, applyFn("RIDER", fresh, "DELIST", as(super), "OTHER")),
		"23514", "account_state_illegal_transition")

	// A restaurant's listing is the function's decision, from its certificate.
	delisted := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	accepted(t, "delist", direct(app, applyFn("RESTAURANT", delisted, "DELIST", as(admin), "NO_APPROVED_MENU")))
	refused(t, "relist with no certificate",
		direct(app, applyFn("RESTAURANT", delisted, "REINSTATE", as(admin), "ISSUE_RESOLVED")),
		"23514", "account_state_halal_certificate_required")
	certify(t, pool, delisted, 300)
	accepted(t, "relist with a current certificate",
		direct(app, applyFn("RESTAURANT", delisted, "REINSTATE", as(admin), "ISSUE_RESOLVED")))
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
	suspendAs := func(actor httpx.Principal) error {
		rider := seedRider(t, pool, "OFFLINE")
		return direct(app, applyFn("RIDER", rider, "SUSPEND", as(actor), "LOW_PERFORMANCE"))
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}

	revoked := staff(t, pool, httpx.RoleAdmin)
	accepted(t, "an admin with a live grant", suspendAs(revoked))
	exec(`UPDATE account_role SET revoked_at = now() WHERE account_id = $1`, revoked.AccountID)
	refused(t, "an admin whose grant was revoked", suspendAs(revoked), "42501", "account_state_actor_not_permitted")

	future := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account_role SET granted_at = now() + interval '1 day' WHERE account_id = $1`, future.AccountID)
	refused(t, "an admin whose grant starts tomorrow", suspendAs(future), "42501", "account_state_actor_not_permitted")

	deleted := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account SET deleted_at = now() WHERE id = $1`, deleted.AccountID)
	refused(t, "an admin whose account was deleted", suspendAs(deleted), "42501", "account_state_actor_not_permitted")

	suspended := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account SET status = 'SUSPENDED' WHERE id = $1`, suspended.AccountID)
	refused(t, "an admin whose own account is suspended", suspendAs(suspended), "42501", "account_state_actor_not_permitted")

	scoped := guardCustomer(t, pool)
	exec(`INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'ADMIN', 'RESTAURANT', $2)`,
		scoped, guardRestaurant(t, pool, "ACTIVE", "LIVE"))
	_, scopedAdmin := signIn(t, pool, httpx.Principal{AccountID: scoped, Roles: []httpx.Role{httpx.RoleAdmin}},
		"pwd+totp", 15*time.Minute)
	refused(t, "an ADMIN grant scoped to one restaurant", suspendAs(scopedAdmin), "42501", "account_state_actor_not_permitted")

	// A grant the token does not carry (granted after sign-in, or filtered out
	// when the session was signed in) does not count until the next token.
	later := principalFor(t, pool, httpx.RoleAdmin)
	later.Roles = []httpx.Role{httpx.RoleCustomer}
	_, later = signIn(t, pool, later, "pwd+totp", 15*time.Minute)
	refused(t, "an admin whose token does not carry the grant", suspendAs(later), "42501", "account_state_actor_not_permitted")

	// A suspended or deactivated staff member's grants do not count.
	for _, status := range []string{"SUSPENDED", "DEACTIVATED"} {
		member := staff(t, pool, httpx.RoleAdmin)
		staffProfile(t, pool, member.AccountID, status, "")
		refused(t, "a "+strings.ToLower(status)+" staff member", suspendAs(member), "42501", "account_state_actor_not_permitted")
	}

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
		account_subject_type, uuid, account_action, text, text, text, text, bytea, jsonb, jsonb)
		RETURNS TABLE (event_id uuid, from_state text, to_state text, delist_reasons text[], sessions_revoked int, created_at timestamptz)
		LANGUAGE sql AS $$ SELECT NULL::uuid, '', '', '{}'::text[], 0, now() $$`))
	denied("call a helper", q(`SELECT account_state_system_write($1, 'HALAL_EXPIRY', 'LIVE', 'BANNED', '{}', '{}', NULL, NULL, 'x', 'x')`, uuid.NewString()))
	denied("grant itself the state columns", q(`SELECT account_state_grant_app_columns()`))
	denied("switch every trigger off", q(`SET LOCAL session_replication_role = replica`))
	denied("drop the ban guard", q(`DROP TRIGGER account_state_event_ban_two_person ON account_state_event`))

	// Temporary tables named like the sessions, the grants, the rules and the
	// history change nothing: a customer still cannot act, the app cannot make up
	// a token, and a lone super admin still cannot ban.
	customer, rider := guardCustomer(t, pool), seedRider(t, pool, "OFFLINE")
	_, signedIn := signIn(t, pool, httpx.Principal{AccountID: customer, Roles: []httpx.Role{httpx.RoleCustomer}},
		"pwd+totp", 15*time.Minute)
	refused(t, "a customer forges a SUPER_ADMIN grant and an open rule in temporary tables",
		direct(app,
			q(`CREATE TEMP TABLE account_role ON COMMIT DROP AS SELECT * FROM public.account_role WHERE false`),
			q(`INSERT INTO account_role (id, account_id, role, scope_type, granted_at, created_at, updated_at)
			   VALUES (gen_random_uuid(), $1, 'SUPER_ADMIN', 'GLOBAL', now() - interval '1 day', now(), now())`, customer),
			q(`CREATE TEMP TABLE account_state_rule (subject_type text, action text, from_state text, to_state text,
			                                         principal text, permission text, reason_code text) ON COMMIT DROP`),
			q(`INSERT INTO account_state_rule VALUES ('RIDER', 'SUSPEND', 'ACTIVE', 'SUSPENDED', 'ADMIN', 'rider.suspend', NULL)`),
			applyFn("RIDER", rider, "SUSPEND", as(signedIn), "LOW_PERFORMANCE")),
		"42501", "account_state_actor_not_permitted")
	refused(t, "the app forges an admin's session in a temporary table",
		direct(app,
			q(`CREATE TEMP TABLE session ON COMMIT DROP AS SELECT * FROM public.session WHERE false`),
			q(`INSERT INTO session SELECT * FROM public.session WHERE id = $1`, admin.SessionID),
			q(`UPDATE session SET access_hash = sha256(convert_to('a token the app made up', 'UTF8'))`),
			applyFn("RIDER", rider, "SUSPEND", "a token the app made up", "LOW_PERFORMANCE")),
		"42501", "account_state_session_required")
	super := staff(t, pool, httpx.RoleSuperAdmin)
	accepted(t, "suspend", direct(app, applyFn("RIDER", rider, "SUSPEND", as(admin), "LOW_PERFORMANCE")))
	refused(t, "a super admin forges a second person's proposal in a temporary history",
		direct(app,
			q(`CREATE TEMP TABLE account_state_event ON COMMIT DROP AS SELECT * FROM public.account_state_event WHERE false`),
			q(`INSERT INTO account_state_event (id, subject_type, subject_id, action, from_state, to_state, reason_code,
			                                   reason_text, actor_account_id, created_at, in_flight, delist_reasons,
			                                   sessions_revoked, actor_kind)
			   VALUES (gen_random_uuid(), 'RIDER', $1, 'PROPOSE_BAN', 'SUSPENDED', 'SUSPENDED', 'SAFETY_RISK',
			           'a proposal nobody made', gen_random_uuid(), now(), '{}', '{}', 0, 'STAFF')`, rider),
			applyFn("RIDER", rider, "CONFIRM_BAN", as(super), "SAFETY_RISK")),
		"23514", "account_ban_needs_proposal")
	if got := stateOf(t, pool, "RIDER", rider); got != "SUSPENDED" {
		t.Errorf("rider is %s, want SUSPENDED", got)
	}
}

// TestTheServiceActsAsTheSessionsAccount: through ApplyAccountAction, with the
// app's rights, the database acts as the account whose session the caller's
// access token proves; a call recording someone else is refused before the
// database, and a principal carrying another admin's token cannot act as itself.
func TestTheServiceActsAsTheSessionsAccount(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	admin := staff(t, pool, httpx.RoleAdmin)
	other := staff(t, pool, httpx.RoleAdmin)
	customer := guardCustomer(t, pool)
	repo := NewRepo(app)
	in := func(p httpx.Principal, actor string, a accountstate.Action, reason string) accountActionInput {
		return accountActionInput{
			Subject: accountstate.Customer, SubjectID: customer, Action: a, ReasonCode: reason,
			ReasonText: "through the service in a test", IdemKey: uuid.NewString(),
			Principal: p, Actor: auditActor{staffID: actor},
		}
	}

	row, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, in(admin, admin.AccountID, accountstate.Suspend, "OTHER"))
	if err != nil {
		t.Fatalf("suspend through the service: %v", err)
	}
	if row.ToState != "SUSPENDED" || row.ActorAccountID != admin.AccountID {
		t.Errorf("suspend: to %s by %s, want SUSPENDED by %s", row.ToState, row.ActorAccountID, admin.AccountID)
	}
	if n := scalar[int](t, pool, `SELECT count(*)::int FROM account_state_event WHERE id = $1 AND actor_account_id = $2`,
		row.ID, admin.AccountID); n != 1 {
		t.Errorf("the history does not name the session's account as the actor")
	}
	if _, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, in(admin, other.AccountID, accountstate.Reinstate, "ISSUE_RESOLVED")); err == nil {
		t.Errorf("the service acted as an account other than its caller")
	}
	// A principal that names one admin but carries another's token acts as the
	// token's account: the own-restaurant rule holds for the token's owner even
	// though the service checked it for the named admin.
	owned := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type, scope_id)
	                             VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`, admin.AccountID, owned); err != nil {
		t.Fatal(err)
	}
	borrowed := other.WithCredential(admin.Credential())
	_, err = repo.ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
		Subject: accountstate.Restaurant, SubjectID: owned, Action: accountstate.Suspend, ReasonCode: "OTHER",
		ReasonText: "an admin's own restaurant under a borrowed token", IdemKey: uuid.NewString(),
		Principal: borrowed, Actor: auditActor{staffID: other.AccountID},
	})
	refused(t, "a principal carrying another admin's token, on that admin's own restaurant", err, "42501", "account_state_own_account")
	if got := stateOf(t, pool, "RESTAURANT", owned); got != "LIVE " {
		t.Errorf("the restaurant is %q, want LIVE", got)
	}
}

// TestAnActionRidesOnTheActorsLiveTwoStepSession: account_state_apply hashes the
// access token it is given and acts only for the live session signed in with
// two-step sign-in that the token was issued for. What the application role can
// read (a session's id, its stored hashes) or write (a revocation) does not make
// a token, and one injected query cannot act as an admin.
func TestAnActionRidesOnTheActorsLiveTwoStepSession(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	admin := staff(t, pool, httpx.RoleAdmin)
	noProof := func(what string, token string) {
		t.Helper()
		rider := seedRider(t, pool, "OFFLINE")
		refused(t, what, direct(app, applyFn("RIDER", rider, "SUSPEND", token, "LOW_PERFORMANCE")),
			"42501", "account_state_session_required")
		if got := stateOf(t, pool, "RIDER", rider); got != "ACTIVE" {
			t.Errorf("%s: the rider is %s, want ACTIVE", what, got)
		}
	}

	noProof("no token", "")
	refused(t, "a NULL token", direct(app, q(`SELECT * FROM account_state_apply('RIDER', $1, 'SUSPEND', NULL,
		'LOW_PERFORMANCE', 'a NULL token in a test', $2, '\x00', '{}', '{}')`, seedRider(t, pool, "OFFLINE"), uuid.NewString())),
		"42501", "account_state_session_required")
	noProof("a string the app made up", "not issued by anyone")
	noProof("the session's id", admin.SessionID)
	noProof("the session's stored token hash", scalar[string](t, pool,
		`SELECT encode(access_hash, 'hex') FROM session WHERE id = $1`, admin.SessionID))
	// A token the app signs itself, naming the admin's live session, account,
	// roles and two-step sign-in: the database does not check signatures, but this
	// token is not the one whose hash the session carries.
	forged, err := testIssuer.Issue(admin.AccountID, admin.SessionID, []string{"ADMIN"}, []string{"pwd+totp"}, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	noProof("a token the app made for an admin's live session", forged)
	noProof("an admin signed in with a password only", as(staff(t, pool, httpx.RoleAdmin, "pwd")))
	noProof("an admin signed in by phone", as(staff(t, pool, httpx.RoleAdmin, "otp")))
	_, expired := signIn(t, pool, principalFor(t, pool, httpx.RoleAdmin), "pwd+totp", -time.Minute)
	noProof("an expired token", as(expired))

	revoked := staff(t, pool, httpx.RoleAdmin)
	accepted(t, "the app may end a session", direct(app,
		q(`UPDATE session SET revoked_at = now(), revoke_reason = 'signed_out' WHERE id = $1`, revoked.SessionID)))
	noProof("a revoked session", as(revoked))
	idle := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE session SET idle_expires_at = now() - interval '1 second' WHERE id = $1`, idle.SessionID)
	noProof("an idle session", as(idle))
	spent := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE session SET absolute_expires_at = now() - interval '1 second' WHERE id = $1`, spent.SessionID)
	noProof("a session past its absolute expiry", as(spent))

	// A token whose hash sits on a session it does not name (only an owner could
	// write such a row) proves nothing.
	misfiled := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE session SET access_hash = NULL WHERE id = $1`, misfiled.SessionID)
	exec(`INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client, refresh_hash, access_hash,
	                           idle_expires_at, absolute_expires_at)
	      VALUES (gen_random_uuid(), gen_random_uuid(), $1, 'pwd+totp', '[]', 'admin-web', sha256(convert_to($2 || 'r', 'UTF8')),
	              sha256(convert_to($2, 'UTF8')), now() + interval '30 minutes', now() + interval '12 hours')`,
		misfiled.AccountID, as(misfiled))
	noProof("a token on a session it does not name", as(misfiled))

	// One injected query can call the function but cannot turn what it reads into
	// a token: it has the session's id and hashes, never the token.
	rider := seedRider(t, pool, "OFFLINE")
	refused(t, "one injected query reads an admin's session and acts with it", direct(app, q(`
		SELECT a.* FROM (SELECT s.id::text AS sid, encode(s.access_hash, 'escape') AS hash, encode(s.refresh_hash, 'hex') AS refresh
		                   FROM session s WHERE s.id = $1) s,
		       LATERAL account_state_apply('RIDER', $2, 'SUSPEND', s.hash, 'LOW_PERFORMANCE',
		                                   'injected into a read query', 'inject-'||s.sid, '\x00', '{}', '{}') a`,
		admin.SessionID, rider)), "42501", "account_state_session_required")

	// With the admin's own token, it works, and the audit row names the proven
	// session, not the one the caller claims.
	accepted(t, "the admin's own live token", direct(app, q(`
		SELECT * FROM account_state_apply('RIDER', $1, 'SUSPEND', $2, 'LOW_PERFORMANCE', 'with a live two-step session',
		                                  $3, '\x00', '{}', jsonb_build_object('session_id', $4::text))`,
		rider, as(admin), uuid.NewString(), revoked.SessionID)))
	if got := scalar[string](t, pool, `
		SELECT coalesce(session_id::text, '') FROM audit_event WHERE subject_id = $1 AND action = 'rider.suspend'`, rider); got != admin.SessionID {
		t.Errorf("the audit row names session %q, want the proven session %s", got, admin.SessionID)
	}
}

// TestTheAppCannotRewriteASession: the application role may rotate and end a
// session, and nothing else: not whose it is, how it was signed in, when it
// expires, the roles it carries or its token hashes.
func TestTheAppCannotRewriteASession(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	admin, other := staff(t, pool, httpx.RoleAdmin, "pwd"), staff(t, pool, httpx.RoleSuperAdmin)
	for what, set := range map[string]string{
		"upgrade a password sign-in to two-step": `amr = 'pwd+totp'`,
		"move a session to another account":      `account_id = '` + other.AccountID + `'`,
		"put a token of its own on a session":    `access_hash = sha256(convert_to('mine', 'UTF8'))`,
		"swap the refresh hash":                  `refresh_hash = sha256(convert_to('mine', 'UTF8'))`,
		"extend a session":                       `absolute_expires_at = now() + interval '1 year'`,
		"keep a session from idling out":         `idle_expires_at = now() + interval '1 year'`,
		"add roles to a session":                 `roles_snapshot = '[{"Role": "SUPER_ADMIN"}]'`,
		"change a session's surface":             `client = 'admin-web'`,
	} {
		refused(t, what, direct(app, q(`UPDATE session SET `+set+` WHERE id = $1`, admin.SessionID)), "42501", "permission denied")
	}
	accepted(t, "rotate", direct(app,
		q(`UPDATE session SET rotated_at = now(), last_used_at = now() WHERE id = $1`, admin.SessionID)))
	accepted(t, "end", direct(app,
		q(`UPDATE session SET revoked_at = now(), revoke_reason = 'signed_out' WHERE id = $1`, admin.SessionID)))

	allowed := map[string]bool{"rotated_at": true, "rotated_to": true, "last_used_at": true, "revoked_at": true, "revoke_reason": true}
	rows, err := pool.Query(context.Background(), `
		SELECT column_name, has_column_privilege('hg_app', 'public.session', column_name, 'UPDATE')
		  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'session'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var col string
		var upd bool
		if err := rows.Scan(&col, &upd); err != nil {
			t.Fatal(err)
		}
		if upd != allowed[col] {
			t.Errorf("session.%s: hg_app may UPDATE %v, want %v", col, upd, allowed[col])
		}
	}
}

// TestABanNeedsTwoIndependentPeople: the confirmation of a ban must come from a
// second person, not a second account of the proposer's: neither made the other
// staff, and the confirmer was a super admin before the ban was proposed.
func TestABanNeedsTwoIndependentPeople(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	independent := staff(t, pool, httpx.RoleSuperAdmin)
	propose := func(by httpx.Principal) string {
		t.Helper()
		rider := seedRider(t, pool, "OFFLINE")
		accepted(t, "propose", direct(app, applyFn("RIDER", rider, "PROPOSE_BAN", as(by), "SAFETY_RISK")))
		return rider
	}
	notIndependent := func(what string, rider string, by httpx.Principal) {
		t.Helper()
		refused(t, what, direct(app, applyFn("RIDER", rider, "CONFIRM_BAN", as(by), "SAFETY_RISK")),
			"23514", "account_ban_two_person")
		if got := stateOf(t, pool, "RIDER", rider); got != "SUSPENDED" {
			t.Errorf("%s: the rider is %s, want SUSPENDED", what, got)
		}
	}

	// A super admin who made the confirming super admin staff.
	maker := staff(t, pool, httpx.RoleSuperAdmin)
	made := staff(t, pool, httpx.RoleSuperAdmin)
	exec(`UPDATE account_role SET granted_by = $2 WHERE account_id = $1`, made.AccountID, maker.AccountID)
	notIndependent("confirmed by a super admin the proposer made staff", propose(maker), made)
	// An admin made staff by the confirming super admin.
	puppet := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account_role SET granted_by = $2 WHERE account_id = $1`, puppet.AccountID, maker.AccountID)
	notIndependent("proposed by an admin the confirmer made staff", propose(puppet), maker)
	// A staff profile created by the proposer.
	profiled := staff(t, pool, httpx.RoleSuperAdmin)
	staffProfile(t, pool, profiled.AccountID, "ACTIVE", independent.AccountID)
	notIndependent("confirmed by a super admin whose staff profile the proposer created", propose(independent), profiled)
	// A super admin made after the proposal.
	early := staff(t, pool, httpx.RoleAdmin)
	rider := propose(early)
	late := staff(t, pool, httpx.RoleSuperAdmin)
	notIndependent("confirmed by a super admin made after the proposal", rider, late)

	accepted(t, "confirmed by an independent super admin of longer standing",
		direct(app, applyFn("RIDER", rider, "CONFIRM_BAN", as(independent), "SAFETY_RISK")))
	if got := stateOf(t, pool, "RIDER", rider); got != "BANNED" {
		t.Errorf("rider is %s, want BANNED", got)
	}
}

// staffProfile gives a staff account a profile in status, created by createdBy
// (none when ""), removed when the test ends so the staff list stays as it was.
func staffProfile(t *testing.T, pool *pgxpool.Pool, accountID, status, createdBy string) {
	t.Helper()
	var by any
	if createdBy != "" {
		by = createdBy
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO staff_profile (account_id, full_name, status, created_by) VALUES ($1, 'Staff Member', $2::staff_status, $3)`,
		accountID, status, by); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM staff_profile WHERE account_id = $1`, accountID)
	})
}

// TestAStaffAccountIsNotARider: a rider's ban ends every session of the account,
// so a staff account with a rider profile is refused as a rider, as it is as a
// customer, in the database and in the service.
func TestAStaffAccountIsNotARider(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	admin, super := staff(t, pool, httpx.RoleAdmin), staff(t, pool, httpx.RoleSuperAdmin)
	if _, err := pool.Exec(ctx, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status, approved_at)
		VALUES ($1, 'Staff', 'Rider', '1990-01-01', 'ACTIVE', 'ACTIVE', now())`, super.AccountID); err != nil {
		t.Fatal(err)
	}
	refused(t, "an admin suspends a super admin as a rider",
		direct(app, applyFn("RIDER", super.AccountID, "SUSPEND", as(admin), "LOW_PERFORMANCE")),
		"42501", "account_state_staff_subject")
	_, err := NewRepo(app).ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
		Subject: accountstate.Rider, SubjectID: super.AccountID, Action: accountstate.Suspend, ReasonCode: "LOW_PERFORMANCE",
		ReasonText: "a staff account as a rider", IdemKey: uuid.NewString(),
		Principal: admin, Actor: auditActor{staffID: admin.AccountID},
	})
	if !errors.Is(err, errStaffAccount) {
		t.Errorf("the service: err = %v, want errStaffAccount", err)
	}
	if got := stateOf(t, pool, "RIDER", super.AccountID); got != "ACTIVE" {
		t.Errorf("the staff rider is %s, want ACTIVE", got)
	}
	if n := liveSessions(t, pool, super.AccountID); n != 1 {
		t.Errorf("the super admin has %d live sessions, want 1", n)
	}
}
