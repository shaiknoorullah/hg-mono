package dispatch

import (
	"context"
	"testing"
	"time"
)

// The rider's assignment names the customer by first name and last initial,
// from the customer's own profile, so the rider greets the right person at
// the door and never learns the surname (contracts/openapi.yaml,
// customer_display_name). It used to read rider_profile, so a customer who is
// not also a rider was always "Customer"
// (https://github.com/shaiknoorullah/hg-mono/issues/420).
func TestAssignment_NamesTheCustomerByFirstNameAndLastInitial(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 1)
	rider := offers[0].riderAccountID
	asnID, err := store.AcceptOffer(ctx, rider, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	name := func() string {
		t.Helper()
		asn, err := store.LoadAssignment(ctx, rider, asnID)
		if err != nil {
			t.Fatalf("LoadAssignment: %v", err)
		}
		return asn.Dropoff.CustomerDisplayName
	}

	if got := name(); got != "Customer" {
		t.Errorf("no customer profile: name = %q, want %q", got, "Customer")
	}
	var customer string
	if err := pool.QueryRow(ctx, `SELECT account_id::text FROM "order" WHERE id = $1`, orderID).Scan(&customer); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO customer_profile (account_id, first_name, last_name) VALUES ($1, 'Ayesha', 'rahman')`, customer); err != nil {
		t.Fatalf("seed the customer's profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM customer_profile WHERE account_id = $1`, customer)
	})
	if got := name(); got != "Ayesha R." {
		t.Errorf("name = %q, want %q: first name and last initial, never the surname", got, "Ayesha R.")
	}
	if _, err := pool.Exec(ctx, `UPDATE customer_profile SET last_name = NULL WHERE account_id = $1`, customer); err != nil {
		t.Fatal(err)
	}
	if got := name(); got != "Ayesha" {
		t.Errorf("no last name: name = %q, want %q", got, "Ayesha")
	}
}
