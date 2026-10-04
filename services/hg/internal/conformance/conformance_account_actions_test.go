package conformance

// Contract conformance for the account actions: applyRestaurantAccountAction,
// applyRiderAccountAction and applyCustomerAccountAction
// (https://github.com/shaiknoorullah/hg-mono/issues/253). Each request body is
// proven contract-valid, then the live response, success and refusal alike, is
// validated against contracts/openapi.yaml.

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func aaSeedAdmin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('aa-admin-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("aaSeedAdmin: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'ADMIN', 'GLOBAL')`, id); err != nil {
		t.Fatalf("aaSeedAdmin role: %v", err)
	}
	return id
}

func aaSeedLiveRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code, location,
                        onboarding_state, account_state, is_accepting_orders)
VALUES ('aa-'||substr(md5(random()::text),1,10), 'AA Kitchen Inc.', 'AA Kitchen', 'ON', 'Toronto',
        '1 King St', 'M5J0C3', ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
        'ACTIVE', 'LIVE', true)
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("aaSeedLiveRestaurant: %v", err)
	}
	return id
}

func aaSeedCustomer(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (phone_e164, status)
VALUES ('+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'), 'ACTIVE')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("aaSeedCustomer: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO account_role (account_id, role, scope_type) VALUES ($1, 'CUSTOMER', 'GLOBAL')`, id); err != nil {
		t.Fatalf("aaSeedCustomer role: %v", err)
	}
	return id
}

// aaAction proves the request contract-valid, issues it, and validates the
// response against the contract at the expected status.
func aaAction(t *testing.T, h *Harness, path, actor, role, action, reason string, want int) {
	t.Helper()
	rq := Request{
		Method: "POST", Path: path, AccountID: actor, Roles: []string{role},
		IdemKey: fmt.Sprintf("aa-%s-%d", action, time.Now().UnixNano()),
		Body: map[string]any{
			"action": action, "reason_code": reason,
			"reason_text": "Conformance probe: " + action + " with " + reason + ".",
		},
	}
	opID, err := ValidateRequest(t, h.Spec, h.Build(t, rq))
	h.MarkCovered(opID)
	if err != nil {
		t.Fatalf("%s %s body not contract-valid (fix the test): %v", path, action, err)
	}
	h.CheckResponse(t, rq, want)
}

func TestConformance_AccountActions(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	ctx := context.Background()

	admin := aaSeedAdmin(t, ctx, pool)
	super := arwSeedSuperAdmin(t, ctx, pool)

	restaurant := "/v1/admin/restaurants/" + aaSeedLiveRestaurant(t, ctx, pool) + "/account-actions"
	aaAction(t, h, restaurant, admin, roleAdmin, "SUSPEND", "COMPLIANCE_THRESHOLD", http.StatusOK)
	aaAction(t, h, restaurant, admin, roleAdmin, "PROPOSE_BAN", "REPEATED_VIOLATIONS", http.StatusOK)
	aaAction(t, h, restaurant, super, roleSuperAdmin, "CONFIRM_BAN", "REPEATED_VIOLATIONS", http.StatusOK)
	// No halal certificate: a reinstated restaurant comes back DELISTED, and
	// relisting it is refused until a current certificate is verified.
	aaAction(t, h, restaurant, super, roleSuperAdmin, "REINSTATE", "APPEAL_UPHELD", http.StatusOK)
	aaAction(t, h, restaurant, admin, roleAdmin, "REINSTATE", "ISSUE_RESOLVED", http.StatusConflict)

	rider := "/v1/admin/riders/" + arwSeedActiveRider(t, ctx, pool) + "/account-actions"
	aaAction(t, h, rider, admin, roleAdmin, "SUSPEND", "LOW_PERFORMANCE", http.StatusOK)
	aaAction(t, h, rider, admin, roleAdmin, "SUSPEND", "LOW_PERFORMANCE", http.StatusConflict)
	aaAction(t, h, rider, admin, roleAdmin, "REINSTATE", "ISSUE_RESOLVED", http.StatusOK)

	customer := "/v1/admin/customers/" + aaSeedCustomer(t, ctx, pool) + "/account-actions"
	aaAction(t, h, customer, admin, roleAdmin, "SUSPEND", "FAKE_REVIEWS", http.StatusOK)
	aaAction(t, h, customer, admin, roleAdmin, "REINSTATE", "ISSUE_RESOLVED", http.StatusOK)
}
