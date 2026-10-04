package restaurant_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// TestRestaurantStaffInvitesSendNothing: restaurant accounts are owner-only at
// launch (docs/decisions/README.md, "Staff accounts"), so inviting restaurant
// staff creates the account and nothing else: no token, no notification, no
// email. And if anyone wires the auth inviter to it later, the inviter refuses
// an account that is not a HalalGoes admin staff invitation.
func TestRestaurantStaffInvitesSendNothing(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	f := seedFixtures(t, pool)

	email := "cook-" + uuid.NewString()[:8] + "@halalgoes.test"
	row, err := restaurant.NewRepo(pool).CreateStaff(ctx, f.ownerAccountID, []string{"RESTAURANT_OWNER"},
		f.restaurantID, restaurant.StaffInput{Email: email, FullName: "Kitchen Cook"})
	if err != nil {
		t.Fatalf("CreateStaff: %v", err)
	}

	var notifications, tokens int
	if err := pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM notification WHERE account_id = $1),
		       (SELECT count(*) FROM credential_token WHERE account_id = $1)`, row.ID).
		Scan(&notifications, &tokens); err != nil {
		t.Fatal(err)
	}
	if notifications != 0 || tokens != 0 {
		t.Fatalf("restaurant staff invite queued %d notifications and %d tokens, want none", notifications, tokens)
	}

	svc := auth.NewService(auth.NewStore(pool), auth.NewRateLimiter(nil, nil), nil, nil, nil, nil, nil)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	err = svc.InviteStaff(ctx, tx, notify.StaffInvitation{AccountID: uuid.MustParse(row.ID), PlatformRole: "RESTAURANT_STAFF"})
	if !errors.Is(err, notify.ErrNotInvitable) {
		t.Fatalf("inviting a restaurant staff account: err = %v, want notify.ErrNotInvitable", err)
	}
}
