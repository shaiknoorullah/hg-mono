package dispatch

import (
	"context"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// An approved rider (PAYOUT_PENDING) must become ACTIVE when Stripe reports
// payouts_enabled, and must then be able to go online. Before this fix nothing
// ever moved a rider to ACTIVE, so no approved rider could work.
func TestApprovedRiderBecomesActiveAndCanGoOnline(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()

	var acct string
	mustQuery(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164SQL+`) RETURNING id`, &acct)
	mustExec(t, pool, `
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, approved_at)
VALUES ($1, 'R', 'R', '1990-01-01', 'PAYOUT_PENDING', 'ACTIVE', now())`, acct)
	stripeID := "acct_it_" + acct
	mustExec(t, pool, `
INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, payouts_enabled, details_submitted)
VALUES ('RIDER', $1, $2, false, false)`, acct, stripeID)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM rider_availability_event WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM connect_account WHERE owner_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, acct)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acct)
	})

	state := func() string {
		var s string
		mustQuery(t, pool, `SELECT onboarding_state::text FROM rider_profile WHERE account_id=$1`, &s, acct)
		return s
	}

	repo := payments.NewRepo(pool)
	if err := repo.UpdateConnectFromStripe(ctx, &payments.StripeAccount{ID: stripeID, DetailsSubmitted: true}); err != nil {
		t.Fatal(err)
	}
	if s := state(); s != "PAYOUT_PENDING" {
		t.Fatalf("payouts disabled: state = %s, want PAYOUT_PENDING", s)
	}
	if err := repo.UpdateConnectFromStripe(ctx, &payments.StripeAccount{ID: stripeID, ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}); err != nil {
		t.Fatal(err)
	}
	if s := state(); s != "ACTIVE" {
		t.Fatalf("payouts enabled: state = %s, want ACTIVE", s)
	}

	lat, lng, acc := 43.6817, -79.3403, 10.0
	av, err := NewService(NewStore(pool), nil).SetAvailability(ctx, acct, true, &lat, &lng, &acc, nil)
	if err != nil {
		t.Fatalf("go online: %v", err)
	}
	if av.AvailabilityState != "ONLINE_IDLE" {
		t.Fatalf("availability = %s, want ONLINE_IDLE", av.AvailabilityState)
	}
}
