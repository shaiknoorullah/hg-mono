package payments

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// A restaurant owner's payout account is keyed by the restaurant, not by the
// owner's account: RecomputeOnboarding and the payout run both look the
// restaurant up by that id. Keyed by the account, every restaurant's
// createConnectAccount failed and no restaurant could finish onboarding
// (docs/spec/03-restaurant.md, "R-11").
func TestCreateConnectAccount_RestaurantOwnerKeysTheRestaurant(t *testing.T) {
	db := payoutTestDB(t)
	ctx := context.Background()

	owner := seedRider(t, db) // a plain account; the grant below makes it the owner
	rid := uuid.NewString()
	mustExec(t, db, `INSERT INTO restaurant (id, slug, legal_name, display_name, onboarding_state)
		VALUES ($1, $2, 'Test Co', 'Test Kitchen', 'PAYOUT_PENDING')`, rid, "test-"+rid)
	mustExec(t, db, `INSERT INTO account_role (account_id, role, scope_type, scope_id)
		VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`, owner, rid)

	stripe := &mockStripe{ConnectFn: func(in CreateConnectInput) (*StripeAccount, error) {
		return &StripeAccount{ID: "acct_" + in.OwnerID[:8], DetailsSubmitted: true, PayoutsEnabled: true}, nil
	}}
	h := &Handler{svc: NewService(NewRepo(db), stripe, config.Stripe{}, nil)}

	call := func(accountID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/connect/account", nil)
		rctx := httpx.WithPrincipalForTest(req.Context(), httpx.Principal{
			AccountID: accountID, Roles: []httpx.Role{httpx.RoleRestaurantOwner}})
		rctx = httpx.WithIdempotencyKeyForTest(rctx, "connect-"+accountID)
		rec := httptest.NewRecorder()
		h.CreateConnectAccount(rec, req.WithContext(rctx))
		return rec
	}

	if rec := call(owner); rec.Code != http.StatusCreated {
		t.Fatalf("owner createConnectAccount = %d %s, want 201", rec.Code, rec.Body.String())
	}
	var ownerID, state string
	if err := db.QueryRow(ctx, `SELECT owner_id::text FROM connect_account WHERE owner_type = 'RESTAURANT'
		AND stripe_account_id = $1`, "acct_"+rid[:8]).Scan(&ownerID); err != nil {
		t.Fatalf("no connect_account keyed by the restaurant: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT onboarding_state::text FROM restaurant WHERE id = $1`, rid).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if ownerID != rid || state != "MENU_PENDING" {
		t.Fatalf("owner_id=%s state=%s; want the restaurant id %s and MENU_PENDING", ownerID, state, rid)
	}

	// Restaurant staff with no restaurant grant have no payout account to make.
	if rec := call(seedRider(t, db)); rec.Code != http.StatusNotFound {
		t.Fatalf("ungranted staff createConnectAccount = %d, want 404", rec.Code)
	}
}
