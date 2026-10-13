package dispatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The rider's REST reads of an offer and of an assignment, field by field, at
// every stage (internal/riderview). The rider is the only role that holds
// offer.read and assignment.read (internal/auth/matrix.go), so the rider's
// view is the only one these return.
//
// The customer's data is planted adversarially: a phone number in the unit, a
// buzzer in full-width lookalike digits, a note with a newline and a phone, an
// item note with a Unicode line separator and a phone, and a second address
// line no view may read. Each view must carry none of it until the stage that
// releases the field, and then carry it whole, never trimmed.

// The seeded delivery address (seedFixture): 88 Harbour St, Toronto, at
// 43.6412,-79.381. Its area, rounded to about a kilometre, is 43.64,-79.38.
const (
	exactDropLat, exactDropLng = 43.6412, -79.381
	areaDropLat, areaDropLng   = 43.64, -79.38
)

// The adversarial values, each released only while the rider carries the
// food — except plantedLine2, which no view ever reads.
const (
	plantedUnit    = "Call 416-555-0123"
	plantedBuzzer  = "４１６５５５０１９９" // full-width digits: a phone number in lookalikes
	plantedSpecial = "Leave at door\nCall 416-555-0144"
	plantedNote    = "no onions text 647-555-0111"
	plantedLine2   = "c/o Jane 416-555-0177"
)

// view is a value as the handler writes it. The bytes must decode with no
// key repeated at any level — a client that keeps the last of two keys and a
// check that reads the first would see different values — and the decoded
// document is returned.
func view(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := noRepeatedKeys(json.NewDecoder(bytes.NewReader(raw))); err != nil {
		t.Fatalf("the rider's view repeats a key: %v\n%s", err, raw)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// noRepeatedKeys reads one JSON value from dec and fails on any object that
// names a key twice.
func noRepeatedKeys(dec *json.Decoder) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch tok {
	case json.Delim('{'):
		seen := map[string]bool{}
		for dec.More() {
			k, err := dec.Token()
			if err != nil {
				return err
			}
			key := k.(string)
			if seen[key] {
				return errors.New("key " + key + " appears twice")
			}
			seen[key] = true
			if err := noRepeatedKeys(dec); err != nil {
				return err
			}
		}
		_, err = dec.Token()
		return err
	case json.Delim('['):
		for dec.More() {
			if err := noRepeatedKeys(dec); err != nil {
				return err
			}
		}
		_, err = dec.Token()
		return err
	}
	return nil
}

// TestNoRepeatedKeysCatchesARepeatedKey proves the check above has teeth.
func TestNoRepeatedKeysCatchesARepeatedKey(t *testing.T) {
	doc := `{"dropoff":{"latitude":43.64,"latitude":43.6412}}`
	if err := noRepeatedKeys(json.NewDecoder(strings.NewReader(doc))); err == nil || err == io.EOF {
		t.Fatalf("a repeated key passed: %v", err)
	}
}

// keysOf lists an object's keys, sorted.
func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// stringsIn lists every string in a decoded document, keys included.
func stringsIn(node any) []string {
	var out []string
	switch n := node.(type) {
	case string:
		out = append(out, n)
	case map[string]any:
		for k, v := range n {
			out = append(out, k)
			out = append(out, stringsIn(v)...)
		}
	case []any:
		for _, v := range n {
			out = append(out, stringsIn(v)...)
		}
	}
	return out
}

// carries reports which of the planted values, or any recognisable part of
// one, appear anywhere in a view.
func carries(doc map[string]any, planted ...string) []string {
	var found []string
	for _, s := range stringsIn(doc) {
		for _, p := range planted {
			for _, part := range []string{p, "416-555", "647-555", "４１６", "Jane", " "} {
				if strings.Contains(p, part) && strings.Contains(s, part) {
					found = append(found, part)
				}
			}
		}
	}
	return found
}

// plantCustomerData writes the adversarial values onto the order's address,
// order and one order line.
func plantCustomerData(t *testing.T, pool *pgxpool.Pool, orderID string) {
	t.Helper()
	var restaurantID string
	mustQuery(t, pool, `SELECT restaurant_id::text FROM "order" WHERE id = $1`, &restaurantID, orderID)
	mustExec(t, pool, `
UPDATE address SET unit = $2, buzzer = $3, line2 = $4
 WHERE id = (SELECT delivery_address_id FROM "order" WHERE id = $1)`, orderID, plantedUnit, plantedBuzzer, plantedLine2)
	mustExec(t, pool, `UPDATE "order" SET special_instructions = $2 WHERE id = $1`, orderID, plantedSpecial)
	var categoryID, itemID string
	mustQuery(t, pool, `INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`, &categoryID, restaurantID)
	mustQuery(t, pool, `INSERT INTO menu_item (restaurant_id, category_id, price_cents) VALUES ($1, $2, 1000) RETURNING id`,
		&itemID, restaurantID, categoryID)
	mustExec(t, pool, `
INSERT INTO order_line (order_id, line_no, menu_item_id, name_snapshot, quantity, base_price_cents,
                        variant_part_cents, addons_part_cents, line_unit_cents, line_total_cents,
                        special_request, tax_category)
VALUES ($1, 1, $2, 'Chicken karahi', 1, 1000, 1000, 0, 1000, 1000, $3, 'PREPARED_FOOD')`, orderID, itemID, plantedNote)
}

// TestCurrentOffer_ShowsOnlyTheDropoffArea: getCurrentOffer reaches every
// rider in a wave before any of them accepts. Its drop-off is the city and the
// area's point, with none of the customer's planted data, and each rider reads
// only their own offer.
func TestCurrentOffer_ShowsOnlyTheDropoffArea(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 2)
	plantCustomerData(t, pool, orderID)

	for _, o := range offers {
		offer, err := store.CurrentOffer(ctx, o.riderAccountID, time.Now().UTC())
		if err != nil || offer == nil {
			t.Fatalf("CurrentOffer = %v, %v; want the rider's offer", offer, err)
		}
		if offer.OfferID != o.offerID {
			t.Fatalf("CurrentOffer for %s returned offer %s, want the rider's own %s", o.riderAccountID, offer.OfferID, o.offerID)
		}
		got := view(t, offer)
		pickup, _ := got["pickup"].(map[string]any)
		dropoff, _ := got["dropoff"].(map[string]any)
		for _, c := range []struct {
			name string
			m    map[string]any
			want []string
		}{
			{"offer", got, []string{"distance_m", "dropoff", "earnings", "expires_at", "items_count", "offer_id",
				"order_id", "pickup", "server_time", "state", "wave"}},
			{"pickup", pickup, []string{"address_short", "latitude", "longitude", "restaurant_name"}},
			{"dropoff", dropoff, []string{"area", "latitude", "longitude"}},
		} {
			if !slices.Equal(keysOf(c.m), c.want) {
				t.Errorf("%s fields = %v, want exactly %v", c.name, keysOf(c.m), c.want)
			}
		}
		if dropoff["area"] != "Toronto" || dropoff["latitude"] != areaDropLat || dropoff["longitude"] != areaDropLng {
			t.Errorf("offer drop-off = %v, want Toronto at %v,%v, not the address's point %v,%v",
				dropoff, areaDropLat, areaDropLng, exactDropLat, exactDropLng)
		}
		if found := carries(got, plantedUnit, plantedBuzzer, plantedSpecial, plantedNote, plantedLine2); len(found) > 0 {
			t.Errorf("the offer carries the customer's planted data %q", found)
		}
	}
}

// TestAssignment_ReleasesTheDropoffByStage walks one assignment from accept to
// its end and reads it at each stage. Accepted: the address line and the exact
// point, none of the planted data. Carrying the food: also the unit, buzzer,
// special instructions and item note, each exactly as stored. Over: the city
// and the area only. The second address line is never read, and another rider
// reads nothing.
func TestAssignment_ReleasesTheDropoffByStage(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	svc := NewService(store, &fakeLifecycle{})
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 2)
	rider, other := offers[0].riderAccountID, offers[1].riderAccountID
	plantCustomerData(t, pool, orderID)

	asnID, err := store.AcceptOffer(ctx, rider, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}
	step := func(to string) {
		t.Helper()
		reason := "test step"
		if _, err := svc.Transition(ctx, rider, asnID, TransitionInput{
			ToState: to, PickupCode: pickupCodeFor(to), OccurredAt: time.Now().UTC(), OverrideReason: &reason,
		}); err != nil {
			t.Fatalf("assignment to %s: %v", to, err)
		}
	}
	fields := map[string][]string{
		"assignment": {"arrived_dropoff_at", "arrived_pickup_at", "assigned_at", "billable_distance_m",
			"delivered_at", "dropoff", "earnings", "handover_method", "id", "items", "order_code", "order_id",
			"payment_status", "picked_up_at", "pickup", "pickup_wait_seconds", "pod_recorded",
			"required_pod_method", "state", "tracking_health"},
		"pickup": {"address", "latitude", "longitude", "order_state", "phone_alias", "pickup_notes", "restaurant_name"},
		"dropoff": {"address", "buzzer", "customer_display_name", "delivery_instructions", "latitude", "longitude",
			"phone_alias", "special_instructions", "unit"},
		"item": {"addon_names", "allergen_tags", "name", "note", "quantity", "variant_name"},
	}
	read := func(stage string) (doc, dropoff, item map[string]any) {
		t.Helper()
		asn, err := store.LoadAssignment(ctx, rider, asnID)
		if err != nil {
			t.Fatalf("LoadAssignment %s: %v", stage, err)
		}
		doc = view(t, asn)
		pickup, _ := doc["pickup"].(map[string]any)
		dropoff, _ = doc["dropoff"].(map[string]any)
		items, _ := doc["items"].([]any)
		if len(items) != 1 {
			t.Fatalf("%s: items = %v, want the one line", stage, items)
		}
		item, _ = items[0].(map[string]any)
		for name, m := range map[string]map[string]any{"assignment": doc, "pickup": pickup, "dropoff": dropoff, "item": item} {
			if !slices.Equal(keysOf(m), fields[name]) {
				t.Errorf("%s: %s fields = %v, want exactly %v", stage, name, keysOf(m), fields[name])
			}
		}
		for _, s := range stringsIn(doc) {
			if strings.Contains(s, "Jane") || strings.Contains(s, "0177") {
				t.Errorf("%s: the view carries the address's second line in %q, which no view reads", stage, s)
			}
		}
		return doc, dropoff, item
	}
	notYet := func(stage string, doc, dropoff, item map[string]any) {
		t.Helper()
		if dropoff["unit"] != nil || dropoff["buzzer"] != nil || dropoff["special_instructions"] != nil ||
			dropoff["phone_alias"] != nil || item["note"] != nil {
			t.Errorf("%s: drop-off %v, item %v; want no unit, buzzer, instructions, phone or note yet", stage, dropoff, item)
		}
		if found := carries(doc, plantedUnit, plantedBuzzer, plantedSpecial, plantedNote); len(found) > 0 {
			t.Errorf("%s: the view carries the customer's planted data %q", stage, found)
		}
	}

	// Accepted, on the way to the restaurant and at it.
	for _, to := range []string{"", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP"} {
		stage := "accepted"
		if to != "" {
			step(to)
			stage = to
		}
		doc, dropoff, item := read(stage)
		if dropoff["address"] != "88 Harbour St, Toronto" ||
			dropoff["latitude"] != exactDropLat || dropoff["longitude"] != exactDropLng {
			t.Errorf("%s: drop-off = %v, want the address line and the exact point", stage, dropoff)
		}
		notYet(stage, doc, dropoff, item)
	}

	// Another rider, even one offered the same order, reads nothing.
	if _, err := store.LoadAssignment(ctx, other, asnID); !errors.Is(err, errAssignmentNotFound) {
		t.Errorf("another rider's LoadAssignment = %v, want not found", err)
	}

	// Carrying the food: the door details, each exactly as stored.
	step("PICKED_UP")
	_, dropoff, item := read("picked up")
	if dropoff["unit"] != plantedUnit || dropoff["buzzer"] != plantedBuzzer ||
		dropoff["special_instructions"] != plantedSpecial || item["note"] != plantedNote {
		t.Errorf("picked up: drop-off %v, item %v; want the unit, buzzer, instructions and note exactly as stored", dropoff, item)
	}

	// Over: the city and the area only.
	step("CANCELLED_BY_PLATFORM")
	doc, dropoff, item := read("over")
	if dropoff["address"] != "Toronto" || dropoff["latitude"] != areaDropLat || dropoff["longitude"] != areaDropLng {
		t.Errorf("over: drop-off = %v, want Toronto at %v,%v", dropoff, areaDropLat, areaDropLng)
	}
	if found := carries(doc, "88 Harbour"); len(found) > 0 || strings.Contains(dropoff["address"].(string), "Harbour") {
		t.Errorf("over: the view still carries the street address: %v", dropoff)
	}
	notYet("over", doc, dropoff, item)
}
