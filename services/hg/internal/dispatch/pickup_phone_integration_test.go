package dispatch

import (
	"context"
	"strings"
	"testing"
	"time"
)

// The rider's assignment never carries the restaurant's own number:
// pickup.phone_alias is a proxy number and "the restaurant's real line is
// never sent to the rider" (contracts/openapi.yaml). There is no proxy
// service yet, so the field is empty, as the customer's is
// (https://github.com/shaiknoorullah/hg-mono/issues/419).
func TestAssignment_NeverSendsTheRestaurantsOwnNumber(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 1)
	const restaurantLine = "+14165550188"
	if _, err := pool.Exec(ctx, `
		UPDATE restaurant SET public_phone_e164 = $2
		 WHERE id = (SELECT restaurant_id FROM "order" WHERE id = $1)`, orderID, restaurantLine); err != nil {
		t.Fatalf("give the restaurant a number: %v", err)
	}
	asnID, err := store.AcceptOffer(ctx, offers[0].riderAccountID, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	asn, err := store.LoadAssignment(ctx, offers[0].riderAccountID, asnID)
	if err != nil {
		t.Fatalf("LoadAssignment: %v", err)
	}
	if asn.Pickup.PhoneAlias != nil {
		t.Errorf("pickup.phone_alias = %q, want none until a proxy number exists", *asn.Pickup.PhoneAlias)
	}
	for _, s := range stringsIn(view(t, asn)) {
		if strings.Contains(s, "5550188") {
			t.Errorf("the rider's assignment carries the restaurant's own number in %q", s)
		}
	}
}
