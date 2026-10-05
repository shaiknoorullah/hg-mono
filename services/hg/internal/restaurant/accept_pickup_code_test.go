package restaurant_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestIntegration_AcceptOrder_MintsOnePickupCode: accepting a delivery order
// moves it to PREPARING through the orders module's one transition function,
// whose PREPARING hook mints the pickup code. Accept itself mints nothing, so
// the code is written exactly once, and the restaurant sees that code.
func TestIntegration_AcceptOrder_MintsOnePickupCode(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID, "RESTAURANT_PENDING", "now() + interval '3 minutes'")

	// Count every statement that writes this order's pickup code. A trigger
	// "UPDATE OF pickup_code_enc" fires whenever the column is assigned, even
	// to the value it already holds, so a second mint is counted although
	// minting keeps the first code.
	suffix := strings.ReplaceAll(orderID, "-", "")
	table, fn, trg := "pickup_mints_"+suffix, "count_pickup_mint_"+suffix, "count_pickup_mint_"+suffix
	for _, sql := range []string{
		fmt.Sprintf(`CREATE TABLE %s (n int NOT NULL)`, table),
		fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
			  IF NEW.id = '%s'::uuid THEN INSERT INTO %s VALUES (1); END IF;
			  RETURN NEW;
			END $$`, fn, orderID, table),
		fmt.Sprintf(`CREATE TRIGGER %s BEFORE UPDATE OF pickup_code_enc ON "order"
			FOR EACH ROW EXECUTE FUNCTION %s()`, trg, fn),
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("install the mint counter: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP TRIGGER IF EXISTS %s ON "order"`, trg))
		_, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP FUNCTION IF EXISTS %s()`, fn))
		_, _ = pool.Exec(context.Background(), fmt.Sprintf(`DROP TABLE IF EXISTS %s`, table))
	})

	rec := acceptOnce(t, newHandler(pool), orderID, f.ownerAccountID, httpx.RoleRestaurantOwner)
	if rec.Code != http.StatusOK {
		t.Fatalf("accept: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			State      string  `json:"state"`
			PickupCode *string `json:"pickup_code"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode accept response: %v", err)
	}
	if body.Data.State != "PREPARING" {
		t.Fatalf("state=%q after accept, want PREPARING", body.Data.State)
	}

	var mints int
	if err := pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s`, table)).Scan(&mints); err != nil {
		t.Fatalf("count mints: %v", err)
	}
	if mints != 1 {
		t.Errorf("accept wrote the pickup code %d times, want exactly 1", mints)
	}

	var pickupEnc, deliveryEnc []byte
	if err := pool.QueryRow(ctx, `SELECT pickup_code_enc, delivery_code_enc FROM "order" WHERE id = $1`,
		orderID).Scan(&pickupEnc, &deliveryEnc); err != nil {
		t.Fatalf("read codes: %v", err)
	}
	if pickupEnc == nil {
		t.Fatal("no pickup code after accept → PREPARING")
	}
	if deliveryEnc != nil {
		t.Error("a delivery code exists before pickup")
	}
	stored := handover.Reveal(orderID, handover.Pickup, pickupEnc)
	if stored == nil || !handover.WellFormed(*stored) {
		t.Fatalf("the stored pickup code does not open to four digits: %v", stored)
	}
	if body.Data.PickupCode == nil || *body.Data.PickupCode != *stored {
		t.Errorf("the restaurant was shown %v, want the stored code", body.Data.PickupCode)
	}
}
