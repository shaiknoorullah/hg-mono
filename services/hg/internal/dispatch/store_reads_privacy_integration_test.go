package dispatch

import (
	"context"
	"encoding/json"
	"slices"
	"sort"
	"testing"
	"time"
)

// The rider's REST reads of an offer and of an assignment, field by field. The
// rider is the only role that holds offer.read and assignment.read
// (internal/auth/matrix.go), so the rider's view is the only one these return.
// The owner decided a rider sees the drop-off's approximate area before
// accepting and the full address once accepted (the customer's address on a
// rider's offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01);
// once the assignment is over, the rider's history goes back to street level
// (contracts/websocket.md section 5).

// asJSON is a value as the handler writes it: its JSON, decoded generically.
func asJSON(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
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

// The seeded delivery address (seedFixture): 88 Harbour St, Toronto, at
// 43.6412,-79.381. Its area, rounded to about a kilometre, is 43.64,-79.38.
const (
	exactDropLat, exactDropLng = 43.6412, -79.381
	areaDropLat, areaDropLng   = 43.64, -79.38
)

// TestCurrentOffer_ShowsOnlyTheDropoffArea: getCurrentOffer reaches every
// rider in a wave before any of them accepts, so its drop-off is the area's
// name and a point rounded to about a kilometre, never the address's own.
func TestCurrentOffer_ShowsOnlyTheDropoffArea(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	ctx := context.Background()
	_, offers := seedFixture(t, pool, 2)

	for _, o := range offers {
		offer, err := store.CurrentOffer(ctx, o.riderAccountID, time.Now().UTC())
		if err != nil || offer == nil {
			t.Fatalf("CurrentOffer = %v, %v; want the rider's offer", offer, err)
		}
		if offer.OfferID != o.offerID {
			t.Fatalf("CurrentOffer for %s returned offer %s, want the rider's own %s", o.riderAccountID, offer.OfferID, o.offerID)
		}
		got := asJSON(t, offer)
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
	}
}

// TestAssignment_FullAddressWhileLiveThenStreetLevel: getAssignment gives the
// rider who accepted the full address, unit, buzzer, exact point and special
// instructions while the assignment is live, gives another rider nothing, and
// once the assignment is over keeps only the street without its number and
// the area's point in the rider's history.
func TestAssignment_FullAddressWhileLiveThenStreetLevel(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	svc := NewService(store, &fakeLifecycle{})
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 2)
	rider, other := offers[0].riderAccountID, offers[1].riderAccountID
	mustExec(t, pool, `
UPDATE address SET unit = '4211', buzzer = '4211'
 WHERE id = (SELECT delivery_address_id FROM "order" WHERE id = $1)`, orderID)
	mustExec(t, pool, `UPDATE "order" SET special_instructions = 'Leave it on the mat' WHERE id = $1`, orderID)

	asnID, err := store.AcceptOffer(ctx, rider, offers[0].offerID, time.Now().UTC())
	if err != nil {
		t.Fatalf("AcceptOffer: %v", err)
	}

	fields := map[string][]string{
		"assignment": {"arrived_dropoff_at", "arrived_pickup_at", "assigned_at", "billable_distance_m",
			"delivered_at", "dropoff", "earnings", "handover_method", "id", "items", "order_code", "order_id",
			"payment_status", "picked_up_at", "pickup", "pickup_wait_seconds", "pod_recorded",
			"required_pod_method", "state", "tracking_health"},
		"pickup": {"address", "latitude", "longitude", "order_state", "phone_alias", "pickup_notes", "restaurant_name"},
		"dropoff": {"address", "buzzer", "customer_display_name", "delivery_instructions", "latitude", "longitude",
			"phone_alias", "special_instructions", "unit"},
	}
	read := func(when string) map[string]any {
		t.Helper()
		asn, err := store.LoadAssignment(ctx, rider, asnID)
		if err != nil {
			t.Fatalf("LoadAssignment %s: %v", when, err)
		}
		got := asJSON(t, asn)
		pickup, _ := got["pickup"].(map[string]any)
		dropoff, _ := got["dropoff"].(map[string]any)
		for name, m := range map[string]map[string]any{"assignment": got, "pickup": pickup, "dropoff": dropoff} {
			if !slices.Equal(keysOf(m), fields[name]) {
				t.Errorf("%s: %s fields = %v, want exactly %v", when, name, keysOf(m), fields[name])
			}
		}
		return dropoff
	}

	live := read("while live")
	if live["address"] != "88 Harbour St, Toronto" || live["unit"] != "4211" || live["buzzer"] != "4211" ||
		live["latitude"] != exactDropLat || live["longitude"] != exactDropLng ||
		live["special_instructions"] != "Leave it on the mat" || live["phone_alias"] != nil {
		t.Errorf("live drop-off = %v, want the full address, unit, buzzer, exact point and instructions, and no raw phone", live)
	}

	// Another rider, even one offered the same order, reads nothing.
	if _, err := store.LoadAssignment(ctx, other, asnID); err != errAssignmentNotFound {
		t.Errorf("another rider's LoadAssignment = %v, want not found", err)
	}

	reason := "platform cancelled the assignment"
	if _, err := svc.Transition(ctx, rider, asnID, TransitionInput{
		ToState: "CANCELLED_BY_PLATFORM", OccurredAt: time.Now().UTC(), OverrideReason: &reason,
	}); err != nil {
		t.Fatalf("end the assignment: %v", err)
	}

	over := read("once over")
	if over["address"] != "Harbour St, Toronto" || over["unit"] != nil || over["buzzer"] != nil ||
		over["latitude"] != areaDropLat || over["longitude"] != areaDropLng ||
		over["special_instructions"] != nil || over["phone_alias"] != nil {
		t.Errorf("drop-off once over = %v, want the street without its number and the area's point %v,%v, nothing else",
			over, areaDropLat, areaDropLng)
	}
}
