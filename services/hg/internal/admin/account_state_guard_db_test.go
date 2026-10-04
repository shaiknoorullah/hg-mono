package admin

// The second security review of migration 00035
// (https://github.com/shaiknoorullah/hg-mono/pull/335): each test below is one
// way the database guard could have been weak, tried and refused. Most run as the
// application role (appPool), with exactly the rights the API has in production.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestAHistoryRowAuthorisesOneChangeInItsOwnTransaction: a change needs a history
// row of its own transaction, for its own subject, from state, to state and (for a
// restaurant) delisting reasons, that no other change has used; a weaker row of
// another kind cannot stand in for it; and the transaction and the clock on a row
// are the database's, not the writer's.
func TestAHistoryRowAuthorisesOneChangeInItsOwnTransaction(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	admin := staff(t, pool, httpx.RoleAdmin)

	rider := seedRider(t, pool, "OFFLINE")
	refused(t, "one suspension row used for two suspensions",
		direct(app,
			staffEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", admin.AccountID),
			setRider(rider, "SUSPENDED"),
			staffEvent("RIDER", rider, "REINSTATE", "SUSPENDED", "ACTIVE", "ISSUE_RESOLVED", admin.AccountID),
			setRider(rider, "ACTIVE"),
			setRider(rider, "SUSPENDED")),
		"23000", "account_state_change_unrecorded")

	accepted(t, "a history row committed on its own, changing nothing",
		direct(app, staffEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", admin.AccountID)))
	refused(t, "another transaction's history row",
		direct(app, setRider(rider, "SUSPENDED")), "23000", "account_state_change_unrecorded")

	other := seedRider(t, pool, "OFFLINE")
	refused(t, "a history row for another rider",
		direct(app, staffEvent("RIDER", other, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", admin.AccountID),
			setRider(rider, "SUSPENDED")),
		"23000", "account_state_change_unrecorded")

	// The row's transaction and time are stamped by the database.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var stamped, mine bool
	if err := tx.QueryRow(ctx, `
		WITH e AS (
		  INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
		                                   reason_text, actor_account_id, idempotency_key, request_hash,
		                                   xact_id, created_at)
		  VALUES ('RIDER', $1, 'SUSPEND', 'ACTIVE', 'SUSPENDED', 'OTHER', 'claims another transaction',
		          $2, $3, '\x00', '1'::xid8, now() - interval '30 days')
		  RETURNING xact_id, created_at)
		SELECT xact_id = pg_current_xact_id(), created_at = now() FROM e`,
		other, admin.AccountID, uuid.NewString()).Scan(&mine, &stamped); err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback(ctx)
	if !mine || !stamped {
		t.Errorf("a row's own transaction id and clock: kept the writer's (transaction %v, clock %v)", !mine, !stamped)
	}

	// A weaker row of another kind cannot clear a delisting reason: only a
	// reinstatement does, and only with the reasons it records.
	delisted := guardRestaurant(t, pool, "ACTIVE", "DELISTED")
	bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU}' WHERE id = $1`, delisted))
	refused(t, "a suspension clears a delisting reason",
		direct(app, setRestaurant(delisted, "SUSPENDED"),
			staffEvent("RESTAURANT", delisted, "SUSPEND", "DELISTED", "SUSPENDED", "OTHER", admin.AccountID)),
		"23000", "account_state_delist_reason_unrecorded")
	suspended := guardRestaurant(t, pool, "ACTIVE", "SUSPENDED")
	bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU}' WHERE id = $1`, suspended))
	refused(t, "a ban proposal clears a delisting reason",
		direct(app, setRestaurant(suspended, "SUSPENDED"),
			staffEvent("RESTAURANT", suspended, "PROPOSE_BAN", "SUSPENDED", "SUSPENDED", "OTHER", admin.AccountID)),
		"23000", "account_state_delist_reason_unrecorded")
	certify(t, pool, delisted, 300)
	refused(t, "a reinstatement row that records other reasons than the change leaves",
		direct(app, setRestaurant(delisted, "LIVE"),
			staffEvent("RESTAURANT", delisted, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", admin.AccountID, "NO_APPROVED_MENU")),
		"23000", "account_state_change_unrecorded")
	accepted(t, "a reinstatement row that records exactly the change",
		direct(app, setRestaurant(delisted, "LIVE"),
			staffEvent("RESTAURANT", delisted, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", admin.AccountID)))
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM account_state_change c JOIN account_state_event e ON e.id = c.event_id
		 WHERE c.subject_id = $1 AND c.to_state = 'LIVE' AND e.action = 'REINSTATE'`, delisted); n != 1 {
		t.Errorf("recorded changes using the reinstatement = %d, want 1", n)
	}
}

// TestTheActorsGrantIsReadNow: the database decides who the actor is from the
// grants as they stand, never from the request: a revoked, future, scoped or
// orphaned grant fails, and so does a principal the service is told is a super
// admin when the grants say otherwise.
func TestTheActorsGrantIsReadNow(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	suspendAs := func(actor string) error {
		rider := seedRider(t, pool, "OFFLINE")
		return direct(app,
			staffEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", actor),
			setRider(rider, "SUSPENDED"))
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
	refused(t, "an admin whose grant was revoked", suspendAs(revoked.AccountID),
		"42501", "account_state_actor_not_permitted")

	future := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account_role SET granted_at = now() + interval '1 day' WHERE account_id = $1`, future.AccountID)
	refused(t, "an admin whose grant starts tomorrow", suspendAs(future.AccountID),
		"42501", "account_state_actor_not_permitted")

	deleted := staff(t, pool, httpx.RoleAdmin)
	exec(`UPDATE account SET deleted_at = now() WHERE id = $1`, deleted.AccountID)
	refused(t, "an admin whose account was deleted", suspendAs(deleted.AccountID),
		"42501", "account_state_actor_not_permitted")

	suspendedStaff := staff(t, pool, httpx.RoleAdmin)
	bypass(t, pool, setCustomer(suspendedStaff.AccountID, "SUSPENDED"))
	refused(t, "an admin whose own account is suspended", suspendAs(suspendedStaff.AccountID),
		"42501", "account_state_actor_not_permitted")

	scoped := guardCustomer(t, pool)
	somewhere := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	exec(`INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'ADMIN', 'RESTAURANT', $2)`,
		scoped, somewhere)
	refused(t, "an ADMIN grant scoped to one restaurant", suspendAs(scoped),
		"42501", "account_state_actor_not_permitted")

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
	if s := scalar[string](t, pool, `SELECT status::text FROM account WHERE id = $1`, customer); s != "SUSPENDED" {
		t.Errorf("customer is %s, want SUSPENDED (the ban was not confirmed)", s)
	}
}

// TestTheAppRoleCannotChangeTheGuards: the rules, the record of changes and the
// guard functions belong to the migrations' owner. The app role cannot write
// them, replace them, switch them off, call them, or shadow the tables they read
// with temporary ones; and a lawful action still works with its rights.
func TestTheAppRoleCannotChangeTheGuards(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()

	denied := func(what, sql string, args ...any) {
		t.Helper()
		err := direct(app, q(sql, args...))
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Errorf("%s: err = %v, want permission denied (42501)", what, err)
		}
	}
	denied("add a rule", `INSERT INTO account_state_rule VALUES ('RIDER', 'REINSTATE', 'BANNED', 'ACTIVE', 'ADMIN', NULL)`)
	denied("change a rule", `UPDATE account_state_rule SET principal = 'ADMIN' WHERE principal = 'SUPER_ADMIN'`)
	denied("delete a rule", `DELETE FROM account_state_rule WHERE principal = 'SUPER_ADMIN'`)
	denied("read the record of changes", `SELECT count(*) FROM account_state_change`)
	denied("write the record of changes", `
		INSERT INTO account_state_change (subject_type, subject_id, from_state, to_state, principal, xact_id)
		VALUES ('RESTAURANT', gen_random_uuid(), 'PENDING', 'LIVE', 'SYSTEM:ONBOARDING', pg_current_xact_id())`)
	denied("replace the history guard", `
		CREATE OR REPLACE FUNCTION account_state_event_guard_actor() RETURNS trigger
		LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`)
	denied("drop a state guard", `DROP TRIGGER restaurant_account_state_owned ON restaurant`)
	denied("switch a state guard off", `ALTER TABLE rider_profile DISABLE TRIGGER rider_account_status_owned`)
	denied("switch every trigger off", `SET LOCAL session_replication_role = replica`)
	denied("use a history row directly", `SELECT account_state_use_event('RIDER', gen_random_uuid(), 'ACTIVE', 'SUSPENDED', NULL)`)
	denied("truncate the history", `TRUNCATE account_state_event`)

	// Every guard pins search_path; the ones that write as the owner are SECURITY
	// DEFINER; the app may execute only the onboarding function and the owner lookup.
	rows, err := pool.Query(ctx, `
		SELECT p.proname, p.prosecdef,
		       coalesce(array_to_string(p.proconfig, ','), ''),
		       has_function_privilege('hg_app', p.oid, 'EXECUTE')
		  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		 WHERE n.nspname = 'public'
		   AND (p.proname LIKE 'account_state%' OR p.proname IN
		        ('restaurant_account_state_guard', 'rider_account_status_guard', 'account_status_guard'))`)
	if err != nil {
		t.Fatal(err)
	}
	definer := map[string]bool{"account_state_use_event": true, "restaurant_account_state_guard": true,
		"rider_account_status_guard": true, "account_status_guard": true,
		"account_state_reinsert_guard": true, "account_state_complete_onboarding": true}
	executable := map[string]bool{"account_state_complete_onboarding": true, "account_state_owner": true}
	seen := 0
	for rows.Next() {
		var name, config string
		var secdef, exec bool
		if err := rows.Scan(&name, &secdef, &config, &exec); err != nil {
			t.Fatal(err)
		}
		seen++
		if !strings.Contains(config, "search_path=public, pg_temp") {
			t.Errorf("%s does not pin search_path (config %q)", name, config)
		}
		if secdef != definer[name] {
			t.Errorf("%s: SECURITY DEFINER = %v, want %v", name, secdef, definer[name])
		}
		if exec != executable[name] {
			t.Errorf("%s: hg_app may execute = %v, want %v", name, exec, executable[name])
		}
	}
	rows.Close()
	if seen < 11 {
		t.Errorf("found %d guard functions, want at least 11", seen)
	}

	// A temporary table named like the grants, the rules or the history changes
	// nothing: the guards read the real ones.
	customer := guardCustomer(t, pool)
	rider := seedRider(t, pool, "OFFLINE")
	refused(t, "a customer forges an ADMIN grant in a temporary table",
		direct(app,
			q(`CREATE TEMP TABLE account_role (account_id uuid, role text, scope_type text, scope_id uuid,
			                                   revoked_at timestamptz, granted_at timestamptz) ON COMMIT DROP`),
			q(`INSERT INTO account_role VALUES ($1, 'SUPER_ADMIN', 'GLOBAL', NULL, NULL, now() - interval '1 day')`, customer),
			staffEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", customer),
			setRider(rider, "SUSPENDED")),
		"42501", "account_state_actor_not_permitted")
	super := staff(t, pool, httpx.RoleSuperAdmin)
	bypass(t, pool, setRider(rider, "SUSPENDED"))
	refused(t, "a super admin forges a second person's ban proposal in a temporary table",
		direct(app,
			q(`CREATE TEMP TABLE account_state_event ON COMMIT DROP AS
			     SELECT * FROM public.account_state_event WHERE false`),
			q(`INSERT INTO account_state_event (id, subject_type, subject_id, action, from_state, to_state, reason_code,
			                                   reason_text, actor_account_id, created_at, in_flight, delist_reasons, sessions_revoked, actor_kind)
			   VALUES (gen_random_uuid(), 'RIDER', $1, 'PROPOSE_BAN', 'SUSPENDED', 'SUSPENDED', 'SAFETY_RISK',
			           'a proposal nobody made', gen_random_uuid(), now(), '{}', '{}', 0, 'STAFF')`, rider),
			q(`INSERT INTO public.account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
			                                          reason_text, actor_account_id, idempotency_key, request_hash)
			   VALUES ('RIDER', $1, 'CONFIRM_BAN', 'SUSPENDED', 'BANNED', 'SAFETY_RISK', 'confirming alone',
			           $2, $3, '\x00')`, rider, super.AccountID, uuid.NewString()),
			setRider(rider, "BANNED")),
		"23514", "account_ban_needs_proposal")

	// With exactly those rights, the lawful path works end to end.
	repo := NewRepo(app)
	admin := staff(t, pool, httpx.RoleAdmin)
	act := func(p httpx.Principal, a accountstate.Action, reason string) {
		t.Helper()
		if _, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
			Subject: accountstate.Rider, SubjectID: rider, Action: a, ReasonCode: reason,
			ReasonText: "the lawful path as the app role", IdemKey: uuid.NewString(),
			Principal: p, Actor: auditActor{staffID: p.AccountID},
		}); err != nil {
			t.Fatalf("%s as the app role: %v", a, err)
		}
	}
	act(admin, accountstate.Reinstate, "ISSUE_RESOLVED")
	act(admin, accountstate.ProposeBan, "SAFETY_RISK")
	act(super, accountstate.ConfirmBan, "SAFETY_RISK")
	act(super, accountstate.Reinstate, "APPEAL_UPHELD")
	if s := scalar[string](t, pool, `SELECT account_status::text FROM rider_profile WHERE account_id = $1`, rider); s != "ACTIVE" {
		t.Errorf("rider is %s after a ban and its lifting, want ACTIVE", s)
	}
}

// TestTheAppRoleCannotPoseAsASystemPrincipal: a system principal's history row is
// written only by the migrations' owner (a system path reaches it through an
// owner-defined function that decides the change from the data), so the app role
// cannot delist or relist as the halal principals; and even the owner's renewal
// clears only the certificate's own reason.
func TestTheAppRoleCannotPoseAsASystemPrincipal(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	const lapse = "HALAL_CERTIFICATE_EXPIRED"

	live := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, live, 300)
	refused(t, "the app delists as the halal expiry",
		direct(app, setRestaurant(live, "DELISTED", lapse),
			systemEvent("RESTAURANT", live, "DELIST", "LIVE", "DELISTED", lapse, "HALAL_EXPIRY", lapse)),
		"42501", "account_state_system_actor_forged")

	menu := guardRestaurant(t, pool, "ACTIVE", "DELISTED")
	certify(t, pool, menu, 300)
	bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU}' WHERE id = $1`, menu))
	refused(t, "the app relists as the halal renewal",
		direct(app, setRestaurant(menu, "LIVE"),
			systemEvent("RESTAURANT", menu, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", "HALAL_RENEWAL")),
		"42501", "account_state_system_actor_forged")
	refused(t, "the renewal relists a restaurant delisted for something else",
		direct(pool, setRestaurant(menu, "LIVE"),
			systemEvent("RESTAURANT", menu, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", "HALAL_RENEWAL")),
		"23000", "account_state_delist_reason_unrecorded")
	if s := scalar[string](t, pool, `SELECT account_state::text FROM restaurant WHERE id = $1`, menu); s != "DELISTED" {
		t.Errorf("restaurant is %s, want DELISTED", s)
	}
}

// TestOneStatementCannotSlipAChangePastTheGuard: changing the state and the
// delisting reasons together, writing the history in a CTE, or changing two
// accounts in one UPDATE are each checked change by change.
func TestOneStatementCannotSlipAChangePastTheGuard(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	admin := staff(t, pool, httpx.RoleAdmin)

	r := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, r, 300)
	refused(t, "a CTE writes a suspension row and bans",
		direct(app, q(`
			WITH e AS (
			  INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
			                                   reason_text, actor_account_id, idempotency_key, request_hash)
			  VALUES ('RESTAURANT', $1, 'SUSPEND', 'LIVE', 'SUSPENDED', 'OTHER', 'suspend in a CTE, then ban',
			          $2, $3, '\x00')
			  RETURNING subject_id)
			UPDATE restaurant SET account_state = 'BANNED' FROM e WHERE restaurant.id = e.subject_id`,
			r, admin.AccountID, uuid.NewString())),
		"23000", "account_state_change_unrecorded")
	refused(t, "a delisting row that does not record the reason the change adds",
		direct(app, q(`UPDATE restaurant SET account_state = 'DELISTED', delist_reasons = '{OTHER}' WHERE id = $1`, r),
			staffEvent("RESTAURANT", r, "DELIST", "LIVE", "DELISTED", "OTHER", admin.AccountID)),
		"23000", "account_state_change_unrecorded")
	refused(t, "a listed restaurant gains a delisting reason without being delisted",
		direct(app, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU}' WHERE id = $1`, r)),
		"23514", "account_state_live_with_delist_reasons")
	accepted(t, "a CTE that writes the history for exactly its change",
		direct(app, q(`
			WITH e AS (
			  INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
			                                   reason_text, actor_account_id, idempotency_key, request_hash, delist_reasons)
			  VALUES ('RESTAURANT', $1, 'DELIST', 'LIVE', 'DELISTED', 'OTHER', 'delisting in a CTE',
			          $2, $3, '\x00', '{OTHER}')
			  RETURNING subject_id)
			UPDATE restaurant SET account_state = 'DELISTED', delist_reasons = '{OTHER}' FROM e WHERE restaurant.id = e.subject_id`,
			r, admin.AccountID, uuid.NewString())))

	a, b := seedRider(t, pool, "OFFLINE"), seedRider(t, pool, "OFFLINE")
	refused(t, "one UPDATE suspends two riders with one history row",
		direct(app,
			staffEvent("RIDER", a, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", admin.AccountID),
			q(`UPDATE rider_profile SET account_status = 'SUSPENDED' WHERE account_id IN ($1, $2)`, a, b)),
		"23000", "account_state_change_unrecorded")
}

// TestARemovedAccountComesBackInItsState: deleting a banned rider's profile and
// inserting a fresh one does not lift the ban, and a profile cannot be moved to
// another account.
func TestARemovedAccountComesBackInItsState(t *testing.T) {
	pool := dialTestPool(t)
	app := appPool(t)
	ctx := context.Background()
	repo := NewRepo(app)
	admin, super := staff(t, pool, httpx.RoleAdmin), staff(t, pool, httpx.RoleSuperAdmin)
	rider := seedRider(t, pool, "OFFLINE")
	for _, step := range []struct {
		p httpx.Principal
		a accountstate.Action
	}{{admin, accountstate.ProposeBan}, {super, accountstate.ConfirmBan}} {
		if _, err := repo.ApplyAccountAction(ctx, accountActionDeps{}, accountActionInput{
			Subject: accountstate.Rider, SubjectID: rider, Action: step.a, ReasonCode: "SAFETY_RISK",
			ReasonText: "banned, then deleted and re-created", IdemKey: uuid.NewString(),
			Principal: step.p, Actor: auditActor{staffID: step.p.AccountID},
		}); err != nil {
			t.Fatalf("%s: %v", step.a, err)
		}
	}
	insert := func(status string) stmt {
		return q(`
			INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state,
			                           account_status, approved_at, availability_state, is_online)
			VALUES ($1, 'Bilal', 'Khan', '1995-04-02', 'ACTIVE', $2::rider_account_status, now(), 'OFFLINE', false)`,
			rider, status)
	}
	refused(t, "delete a banned rider and create them again, active",
		direct(app, q(`DELETE FROM rider_profile WHERE account_id = $1`, rider), insert("ACTIVE")),
		"23000", "account_state_reinsert")
	accepted(t, "created again, still banned",
		direct(app, q(`DELETE FROM rider_profile WHERE account_id = $1`, rider), insert("BANNED")))

	elsewhere := guardCustomer(t, pool)
	refused(t, "move a banned profile to another account",
		direct(app, q(`UPDATE rider_profile SET account_id = $2 WHERE account_id = $1`, rider, elsewhere)),
		"23000", "account_state_subject_key_changed")
}
