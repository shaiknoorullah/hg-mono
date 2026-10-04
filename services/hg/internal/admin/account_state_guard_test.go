package admin

// The account actions' gates hold for every path, not only the HTTP operations
// (the security review of https://github.com/shaiknoorullah/hg-mono/pull/335).
// Each test below is some other code path trying to change an account's state:
// a direct UPDATE, a history row it writes itself, a caller of the service that
// is not its HTTP handler, or a system principal reaching past its one job.
// Migration 00035 and ApplyAccountAction refuse them. They need
// HG_TEST_POSTGRES_DSN, like the rest of this package's integration tests.

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
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

// staffEvent is a history row a path writes itself, naming a staff actor.
func staffEvent(subject, id, action, from, to, reason, actor string) stmt {
	return q(`
INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
                                 reason_text, actor_account_id, idempotency_key, request_hash)
VALUES ($1::account_subject_type, $2, $3::account_action, $4, $5, $6, 'a direct write in a test', $7, $8, '\x00')`,
		subject, id, action, from, to, reason, actor, uuid.NewString())
}

// systemEvent is a history row naming a system principal.
func systemEvent(subject, id, action, from, to, reason, principal string) stmt {
	return q(`
INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
                                 reason_text, actor_kind, system_actor)
VALUES ($1::account_subject_type, $2, $3::account_action, $4, $5, $6, 'a system principal in a test', 'SYSTEM', $7)`,
		subject, id, action, from, to, reason, principal)
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
// 00035) is exactly accountstate.Transitions(), so the database refuses what the
// service refuses and nothing more.
func TestTheDatabaseHoldsTheServicesTransitions(t *testing.T) {
	pool := dialTestPool(t)
	rows, err := pool.Query(context.Background(), `
SELECT subject_type::text, action::text, from_state, to_state, principal, coalesce(reason_code, '')
  FROM account_state_rule`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var db []string
	for rows.Next() {
		var s, a, f, to, p, r string
		if err := rows.Scan(&s, &a, &f, &to, &p, &r); err != nil {
			t.Fatal(err)
		}
		db = append(db, strings.Join([]string{s, a, f, to, p, r}, " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	var code []string
	for _, tr := range accountstate.Transitions() {
		code = append(code, strings.Join([]string{string(tr.Subject), string(tr.Action), tr.From, tr.To,
			string(tr.Principal), tr.ReasonCode}, " "))
	}
	sort.Strings(db)
	sort.Strings(code)
	if strings.Join(db, "\n") != strings.Join(code, "\n") {
		t.Fatalf("account_state_rule differs from accountstate.Transitions():\n database:\n  %s\n code:\n  %s",
			strings.Join(db, "\n  "), strings.Join(code, "\n  "))
	}
}

// TestSiblingPathsCannotChangeARestaurantsState: a path other than the admin
// actions cannot list, suspend, ban or lift a ban on a restaurant, nor clear its
// delisting reasons, whether it writes the column alone or writes a history row
// its actor may not.
func TestSiblingPathsCannotChangeARestaurantsState(t *testing.T) {
	pool := dialTestPool(t)
	admin := staff(t, pool, httpx.RoleAdmin)
	super := staff(t, pool, httpx.RoleSuperAdmin)

	live := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	certify(t, pool, live, 300)
	refused(t, "ban a live restaurant with an UPDATE alone", direct(pool, setRestaurant(live, "BANNED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "suspend a live restaurant with an UPDATE alone", direct(pool, setRestaurant(live, "SUSPENDED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "a history row for a different change does not cover this one",
		direct(pool, staffEvent("RESTAURANT", live, "SUSPEND", "LIVE", "SUSPENDED", "OTHER", admin.AccountID),
			setRestaurant(live, "BANNED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "ban a live restaurant in one step, even as a super admin",
		direct(pool, setRestaurant(live, "BANNED"),
			staffEvent("RESTAURANT", live, "CONFIRM_BAN", "LIVE", "BANNED", "OTHER", super.AccountID)),
		"23514", "account_state_illegal_transition")

	suspended := guardRestaurant(t, pool, "ACTIVE", "SUSPENDED")
	refused(t, "confirm a ban nobody proposed",
		direct(pool, setRestaurant(suspended, "BANNED"),
			staffEvent("RESTAURANT", suspended, "CONFIRM_BAN", "SUSPENDED", "BANNED", "OTHER", super.AccountID)),
		"23514", "account_ban_needs_proposal")
	refused(t, "an admin confirms a ban",
		direct(pool, setRestaurant(suspended, "BANNED"),
			staffEvent("RESTAURANT", suspended, "CONFIRM_BAN", "SUSPENDED", "BANNED", "OTHER", admin.AccountID)),
		"42501", "account_state_actor_not_permitted")

	banned := guardRestaurant(t, pool, "ACTIVE", "BANNED")
	certify(t, pool, banned, 300)
	refused(t, "lift a ban with an UPDATE alone", direct(pool, setRestaurant(banned, "LIVE")),
		"23000", "account_state_change_unrecorded")
	refused(t, "an admin lifts a ban",
		direct(pool, setRestaurant(banned, "LIVE"),
			staffEvent("RESTAURANT", banned, "REINSTATE", "BANNED", "LIVE", "APPEAL_UPHELD", admin.AccountID)),
		"42501", "account_state_actor_not_permitted")
	customer := guardCustomer(t, pool)
	refused(t, "a customer writes the history row",
		direct(pool, setRestaurant(banned, "LIVE"),
			staffEvent("RESTAURANT", banned, "REINSTATE", "BANNED", "LIVE", "APPEAL_UPHELD", customer)),
		"42501", "account_state_actor_not_permitted")

	// Staff who also work for the restaurant do not judge it.
	ownSuper := staff(t, pool, httpx.RoleSuperAdmin)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`,
		ownSuper.AccountID, banned); err != nil {
		t.Fatal(err)
	}
	refused(t, "a super admin lifts the ban on their own restaurant",
		direct(pool, setRestaurant(banned, "LIVE"),
			staffEvent("RESTAURANT", banned, "REINSTATE", "BANNED", "LIVE", "APPEAL_UPHELD", ownSuper.AccountID)),
		"42501", "account_state_own_account")

	// Listing needs a current halal certificate, whoever lists.
	uncertified := guardRestaurant(t, pool, "ACTIVE", "DELISTED")
	refused(t, "list a restaurant with no current halal certificate",
		direct(pool, setRestaurant(uncertified, "LIVE"),
			staffEvent("RESTAURANT", uncertified, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", admin.AccountID)),
		"23514", "account_state_live_needs_halal_certificate")

	// A delisting reason is cleared only with a history row, or by the halal
	// certificate being current again.
	reasons := guardRestaurant(t, pool, "ACTIVE", "SUSPENDED")
	certify(t, pool, reasons, 300)
	bypass(t, pool, q(`UPDATE restaurant SET delist_reasons = '{NO_APPROVED_MENU,HALAL_CERTIFICATE_EXPIRED}' WHERE id = $1`, reasons))
	refused(t, "clear a delisting reason with an UPDATE alone",
		direct(pool, setRestaurant(reasons, "SUSPENDED", "HALAL_CERTIFICATE_EXPIRED")),
		"23000", "account_state_delist_reason_unrecorded")
	accepted(t, "the halal reason clears once the certificate is current",
		direct(pool, setRestaurant(reasons, "SUSPENDED", "NO_APPROVED_MENU")))
	accepted(t, "adding a reason only restricts",
		direct(pool, setRestaurant(reasons, "SUSPENDED", "NO_APPROVED_MENU", "DOCUMENT_EXPIRED")))
}

// TestSiblingPathsCannotChangeARidersOrACustomersState: the same for riders and
// customers, including an admin trying to lock a super admin out through the
// customer actions.
func TestSiblingPathsCannotChangeARidersOrACustomersState(t *testing.T) {
	pool := dialTestPool(t)
	admin := staff(t, pool, httpx.RoleAdmin)
	super := staff(t, pool, httpx.RoleSuperAdmin)

	rider := seedRider(t, pool, "OFFLINE")
	refused(t, "ban a rider with an UPDATE alone", direct(pool, setRider(rider, "BANNED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "suspend a rider with an UPDATE alone", direct(pool, setRider(rider, "SUSPENDED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "a rider suspends themself with a history row",
		direct(pool, setRider(rider, "SUSPENDED"),
			staffEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "LOW_PERFORMANCE", rider)),
		"42501", "account_state_actor_not_permitted")
	bypass(t, pool, setRider(rider, "BANNED"))
	refused(t, "lift a rider's ban with an UPDATE alone", direct(pool, setRider(rider, "ACTIVE")),
		"23000", "account_state_change_unrecorded")
	refused(t, "an admin lifts a rider's ban",
		direct(pool, setRider(rider, "ACTIVE"),
			staffEvent("RIDER", rider, "REINSTATE", "BANNED", "ACTIVE", "APPEAL_UPHELD", admin.AccountID)),
		"42501", "account_state_actor_not_permitted")
	refused(t, "a rider's ban cannot be lifted to anything but ACTIVE",
		direct(pool, setRider(rider, "SUSPENDED"),
			staffEvent("RIDER", rider, "REINSTATE", "BANNED", "SUSPENDED", "APPEAL_UPHELD", super.AccountID)),
		"23514", "account_state_illegal_transition")

	customer := guardCustomer(t, pool)
	refused(t, "ban a customer with an UPDATE alone", direct(pool, setCustomer(customer, "BANNED")),
		"23000", "account_state_change_unrecorded")
	refused(t, "suspend a customer with an UPDATE alone", direct(pool, setCustomer(customer, "SUSPENDED")),
		"23000", "account_state_change_unrecorded")
	bypass(t, pool, setCustomer(customer, "BANNED"))
	refused(t, "lift a customer's ban with an UPDATE alone", direct(pool, setCustomer(customer, "ACTIVE")),
		"23000", "account_state_change_unrecorded")
	refused(t, "an admin lifts a customer's ban",
		direct(pool, setCustomer(customer, "ACTIVE"),
			staffEvent("CUSTOMER", customer, "REINSTATE", "BANNED", "ACTIVE", "APPEAL_UPHELD", admin.AccountID)),
		"42501", "account_state_actor_not_permitted")
	refused(t, "an admin suspends a super admin as a customer",
		direct(pool, setCustomer(super.AccountID, "SUSPENDED"),
			staffEvent("CUSTOMER", super.AccountID, "SUSPEND", "ACTIVE", "SUSPENDED", "OTHER", admin.AccountID)),
		"42501", "account_state_staff_subject")
	refused(t, "a super admin suspends their own account",
		direct(pool, setCustomer(super.AccountID, "SUSPENDED"),
			staffEvent("CUSTOMER", super.AccountID, "SUSPEND", "ACTIVE", "SUSPENDED", "OTHER", super.AccountID)),
		"42501", "account_state_own_account")
	if s := scalar[string](t, pool, `SELECT status::text FROM account WHERE id = $1`, super.AccountID); s != "ACTIVE" {
		t.Errorf("the super admin's account is %s, want ACTIVE", s)
	}

	// A history row is written when it happens: a backdated one gets the
	// transaction's clock, so it cannot be slid into a ban proposal's window.
	other := guardCustomer(t, pool)
	accepted(t, "a lawful suspension", direct(pool, setCustomer(other, "SUSPENDED"),
		staffEvent("CUSTOMER", other, "SUSPEND", "ACTIVE", "SUSPENDED", "OTHER", admin.AccountID)))
	if err := direct(pool, q(`
INSERT INTO account_state_event (subject_type, subject_id, action, from_state, to_state, reason_code,
                                 reason_text, actor_account_id, idempotency_key, request_hash, created_at)
VALUES ('CUSTOMER', $1, 'PROPOSE_BAN', 'SUSPENDED', 'SUSPENDED', 'OTHER', 'backdated by eight days',
        $2, $3, '\x00', now() - interval '8 days')`, other, admin.AccountID, uuid.NewString())); err != nil {
		t.Fatal(err)
	}
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM account_state_event
		 WHERE subject_id = $1 AND action = 'PROPOSE_BAN' AND created_at > now() - interval '1 minute'`, other); n != 1 {
		t.Errorf("the backdated proposal kept its backdated time")
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

// TestSystemPrincipalsTakeOnlyTheirOwnTransitions: the halal expiry only delists
// a LIVE restaurant for a lapsed certificate (never suspends: the shape of
// https://github.com/shaiknoorullah/hg-mono/pull/274's optional suspension is
// refused), the renewal only lists a DELISTED one again with a current
// certificate, and completing onboarding only takes a restaurant out of PENDING.
func TestSystemPrincipalsTakeOnlyTheirOwnTransitions(t *testing.T) {
	pool := dialTestPool(t)
	const lapse = "HALAL_CERTIFICATE_EXPIRED"

	live := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	accepted(t, "the expiry delists a live restaurant",
		direct(pool, setRestaurant(live, "DELISTED", lapse),
			systemEvent("RESTAURANT", live, "DELIST", "LIVE", "DELISTED", lapse, "HALAL_EXPIRY")))
	if n := scalar[int](t, pool, `
		SELECT count(*)::int FROM account_state_event
		 WHERE subject_id = $1 AND actor_kind = 'SYSTEM' AND system_actor = 'HALAL_EXPIRY' AND actor_account_id IS NULL`, live); n != 1 {
		t.Errorf("history rows naming the expiry principal = %d, want 1", n)
	}
	refused(t, "the expiry suspends a delisted restaurant",
		direct(pool, setRestaurant(live, "SUSPENDED", lapse),
			systemEvent("RESTAURANT", live, "SUSPEND", "DELISTED", "SUSPENDED", "COMPLIANCE_THRESHOLD", "HALAL_EXPIRY")),
		"42501", "account_state_system_not_allowed")
	refused(t, "the expiry suspends with no history row",
		direct(pool, setRestaurant(live, "SUSPENDED", lapse)), "23000", "account_state_change_unrecorded")
	refused(t, "the expiry lists a restaurant",
		direct(pool, setRestaurant(live, "LIVE"),
			systemEvent("RESTAURANT", live, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", "HALAL_EXPIRY")),
		"42501", "account_state_system_not_allowed")
	other := guardRestaurant(t, pool, "ACTIVE", "LIVE")
	refused(t, "the expiry delists for a reason that is not its own",
		direct(pool, setRestaurant(other, "DELISTED", "NO_APPROVED_MENU"),
			systemEvent("RESTAURANT", other, "DELIST", "LIVE", "DELISTED", "NO_APPROVED_MENU", "HALAL_EXPIRY")),
		"42501", "account_state_system_not_allowed")
	rider := seedRider(t, pool, "OFFLINE")
	refused(t, "the expiry suspends a rider",
		direct(pool, setRider(rider, "SUSPENDED"),
			systemEvent("RIDER", rider, "SUSPEND", "ACTIVE", "SUSPENDED", "DOCUMENT_EXPIRED", "HALAL_EXPIRY")),
		"42501", "account_state_system_not_allowed")
	refused(t, "an unknown principal",
		direct(pool, setRestaurant(other, "DELISTED", lapse),
			systemEvent("RESTAURANT", other, "DELIST", "LIVE", "DELISTED", lapse, "NIGHTLY_CLEANUP")),
		"42501", "account_state_system_not_allowed")

	refused(t, "the renewal lists a restaurant whose certificate is not current",
		direct(pool, setRestaurant(live, "LIVE"),
			systemEvent("RESTAURANT", live, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", "HALAL_RENEWAL")),
		"23514", "account_state_live_needs_halal_certificate")
	certify(t, pool, live, 300)
	accepted(t, "the renewal lists a delisted restaurant once its certificate is current",
		direct(pool, setRestaurant(live, "LIVE"),
			systemEvent("RESTAURANT", live, "REINSTATE", "DELISTED", "LIVE", "ISSUE_RESOLVED", "HALAL_RENEWAL")))
	for _, from := range []string{"SUSPENDED", "BANNED", "DEACTIVATED"} {
		r := guardRestaurant(t, pool, "ACTIVE", from)
		certify(t, pool, r, 300)
		refused(t, "the renewal lifts "+from,
			direct(pool, setRestaurant(r, "LIVE"),
				systemEvent("RESTAURANT", r, "REINSTATE", from, "LIVE", "ISSUE_RESOLVED", "HALAL_RENEWAL")),
			"42501", "account_state_system_not_allowed")
	}

	// Onboarding: leaving PENDING only as onboarding completes, in the same row.
	pending := guardRestaurant(t, pool, "ACTIVE", "PENDING")
	certify(t, pool, pending, 300)
	refused(t, "list a pending restaurant without completing onboarding in the same update",
		direct(pool, setRestaurant(pending, "LIVE")), "23000", "account_state_change_unrecorded")
	suspended := guardRestaurant(t, pool, "MENU_PENDING", "SUSPENDED")
	certify(t, pool, suspended, 300)
	refused(t, "completing onboarding lifts a suspension",
		direct(pool, q(`UPDATE restaurant SET onboarding_state = 'ACTIVE', account_state = 'LIVE' WHERE id = $1`, suspended)),
		"23000", "account_state_change_unrecorded")
}

// TestCompletingOnboardingIsTheOnboardingPrincipal: RecomputeOnboarding lists a
// restaurant only with a current halal certificate, delists it otherwise, never
// lifts a penalty, and records the ONBOARDING principal in the audit log.
func TestCompletingOnboardingIsTheOnboardingPrincipal(t *testing.T) {
	pool := dialTestPool(t)
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
		tx, err := pool.Begin(ctx)
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
