package admin

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// TestOverrideHandoverStoreProvesTheActorAndTheState calls the store behind
// overrideHandoverCode directly, with no handler or role middleware in front
// (https://github.com/shaiknoorullah/hg-mono/issues/310). The store must refuse
// on its own: an actor it cannot prove from Postgres (whatever roles the
// caller's auditActor claims), a party to the order, and an order or an
// assignment that is not waiting on that handover. A permitted override
// records the proven actor, their live roles and the reason, and cannot be
// applied twice.
func TestOverrideHandoverStoreProvesTheActorAndTheState(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	repo := NewOrdersRepo(pool)

	orderID, customerID := seedOrderForAdmin(t, pool, "READY_FOR_PICKUP")
	rider := hoStoreAccount(t, pool)
	var asnID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assignment (order_id, rider_account_id, state, required_pod_method, arrived_pickup_at)
		VALUES ($1, $2, 'ARRIVED_AT_PICKUP', 'OTP', now()) RETURNING id`, orderID, rider).Scan(&asnID); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM assignment_transition WHERE assignment_id = $1`, asnID)
	})

	in := handoverOverrideInput{
		Handover: "PICKUP",
		Reason:   "Code locked after 5 tries; the kitchen confirmed they handed the bag over.",
		CaseID:   "dfac740c-a07b-42bd-ad21-c0279fb83b13",
	}
	// Every caller claims SUPER_ADMIN in the auditActor the handler would
	// build from the token; the store must not believe it.
	claim := func(id string) auditActor {
		return auditActor{staffID: id, roles: []string{"SUPER_ADMIN"}, requestID: "store-handover-test"}
	}
	key := func() string { return fmt.Sprintf("store-handover-%d", time.Now().UnixNano()) }
	unchanged := func(what string) {
		t.Helper()
		var orderState, asnState string
		var records int
		_ = pool.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id = $1`, orderID).Scan(&orderState)
		_ = pool.QueryRow(ctx, `SELECT state::text FROM assignment WHERE id = $1`, asnID).Scan(&asnState)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM handover_override WHERE order_id = $1`, orderID).Scan(&records)
		if orderState != "READY_FOR_PICKUP" || asnState != "ARRIVED_AT_PICKUP" || records != 0 {
			t.Fatalf("%s changed something: order %s, assignment %s, %d override records", what, orderState, asnState, records)
		}
	}

	// Actors the store cannot prove, and parties to the order.
	noGrant := hoStoreAccount(t, pool)
	suspended := hoStoreStaff(t, pool, hoStoreAccount(t, pool), "SUPPORT_AGENT", "SUSPENDED")
	customerAdmin := hoStoreStaff(t, pool, customerID, "ADMIN", "ACTIVE")
	riderSupport := hoStoreStaff(t, pool, rider, "SUPPORT_AGENT", "ACTIVE")
	for _, c := range []struct {
		name  string
		actor auditActor
		want  error
	}{
		{"no actor at all", claim(""), errStaffNotActive},
		{"an account with no staff grant", claim(noGrant), errStaffRoleRevoked},
		{"a suspended support agent", claim(suspended), errStaffNotActive},
		{"the order's customer, also an admin", claim(customerAdmin), errPartyToOrder},
		{"the order's rider, also support", claim(riderSupport), errPartyToOrder},
	} {
		_, _, err := repo.OverrideHandover(ctx, c.actor, orderID, handover.Pickup, in, key())
		if !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", c.name, err, c.want)
		}
		unchanged(c.name)
	}

	// States the override does not apply to.
	support := hoStoreStaff(t, pool, hoStoreAccount(t, pool), "SUPPORT_AGENT", "ACTIVE")
	var illegal *orders.IllegalTransitionError
	deliveryIn := in
	deliveryIn.Handover = "DELIVERY"
	if _, _, err := repo.OverrideHandover(ctx, claim(support), orderID, handover.Delivery, deliveryIn, key()); !errors.As(err, &illegal) {
		t.Errorf("a delivery override of an order not yet picked up: err = %v, want IllegalTransitionError", err)
	}
	unchanged("a delivery override of an order not yet picked up")
	if _, err := pool.Exec(ctx, `UPDATE assignment SET state = 'EN_ROUTE_TO_PICKUP' WHERE id = $1`, asnID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.OverrideHandover(ctx, claim(support), orderID, handover.Pickup, in, key()); !errors.As(err, &illegal) {
		t.Errorf("a pickup override with the rider not at the counter: err = %v, want IllegalTransitionError", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE assignment SET state = 'ARRIVED_AT_PICKUP' WHERE id = $1`, asnID); err != nil {
		t.Fatal(err)
	}
	unchanged("a pickup override with the rider not at the counter")

	// A permitted override records the proven actor, their live roles (not the
	// claimed SUPER_ADMIN) and the reason, in the same transaction.
	rec, replayed, err := repo.OverrideHandover(ctx, claim(support), orderID, handover.Pickup, in, key())
	if err != nil || replayed {
		t.Fatalf("override by active support: err = %v, replayed = %v", err, replayed)
	}
	if rec.ActorKind != "SUPPORT" || rec.ActorAccountID != support || rec.Reason != in.Reason || rec.OrderState != "PICKED_UP" {
		t.Errorf("override record = %+v, want SUPPORT by %s with the reason", rec, support)
	}
	var auditActorID, auditRoles, auditReason string
	if err := pool.QueryRow(ctx, `
		SELECT actor_account_id::text, actor_roles::text, reason FROM audit_event
		 WHERE action = 'order.handover_override' AND subject_id = $1`, orderID).Scan(&auditActorID, &auditRoles, &auditReason); err != nil {
		t.Fatalf("read the audit row: %v", err)
	}
	if auditActorID != support || auditRoles != `["SUPPORT_AGENT"]` || auditReason != in.Reason {
		t.Errorf("audit row: actor %s roles %s reason %q, want %s, [\"SUPPORT_AGENT\"], the reason", auditActorID, auditRoles, auditReason, support)
	}

	// Not twice.
	if _, _, err := repo.OverrideHandover(ctx, claim(support), orderID, handover.Pickup, in, key()); !errors.As(err, &illegal) {
		t.Errorf("a second pickup override: err = %v, want IllegalTransitionError", err)
	}
	var records int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM handover_override WHERE order_id = $1`, orderID).Scan(&records)
	if records != 1 {
		t.Errorf("%d override records after a second override, want 1", records)
	}
}

// hoStoreAccount seeds an active account that signs in with an email.
func hoStoreAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO account (email, status)
		VALUES ('ho-store-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	return id
}

// hoStoreStaff gives accountID a live global grant of role and a staff_profile
// in status, and removes both when the test ends.
func hoStoreStaff(t *testing.T, pool *pgxpool.Pool, accountID, role, status string) string {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE account SET email = COALESCE(email, 'ho-store-'||substr(md5(random()::text),1,10)||'@hg.test') WHERE id = $1`, accountID); err != nil {
		t.Fatalf("staff email: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, $2::role_name, 'GLOBAL')`, accountID, role); err != nil {
		t.Fatalf("staff grant: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO staff_profile (account_id, full_name, status) VALUES ($1, 'Store Test Staff', $2::staff_status)`, accountID, status); err != nil {
		t.Fatalf("staff profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM staff_profile WHERE account_id = $1`, accountID)
		_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id = $1 AND role = $2::role_name`, accountID, role)
	})
	return accountID
}
