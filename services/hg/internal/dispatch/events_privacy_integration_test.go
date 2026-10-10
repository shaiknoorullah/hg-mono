package dispatch

import (
	"context"
	"encoding/json"
	"math"
	"slices"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// The tests in this file pin what dispatch's realtime events may say about the
// people in an order (the push security review of
// https://github.com/shaiknoorullah/hg-mono/pull/378, personal data in
// dispatch/events.go):
//
//   - dispatch.offer reaches every rider in a wave before any of them accepts,
//     so the stored event and every role's copy carry the drop-off's
//     approximate area, never the delivery address's own coordinates;
//   - rider.location follows a rider only while they carry the order out: an
//     assignment that ends without a delivery, or an order cancelled under a
//     live assignment, stops it.

// cleanRiderChannel removes, after the test, what it wrote on the rider's own
// channel and the rider's position history. It runs before seedOnlineRider's
// cleanup, which deletes the rider's account.
func cleanRiderChannel(t *testing.T, pool *pgxpool.Pool, riderID string) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.Background()
		ch := realtime.RiderChannel(riderID)
		_, _ = pool.Exec(ctx, `DELETE FROM outbox_message WHERE channel = $1`, ch)
		_, _ = pool.Exec(ctx, `DELETE FROM realtime_event WHERE channel = $1`, ch)
		_, _ = pool.Exec(ctx, `DELETE FROM channel_cursor WHERE channel = $1`, ch)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position_history WHERE account_id = $1`, riderID)
	})
}

// fieldNames lists a decoded JSON object's keys, sorted.
func fieldNames(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TestOfferEvent_CarriesOnlyTheDropoffArea: a wave's dispatch.offer stores,
// and sends to each role that receives it, the drop-off rounded to about a
// kilometre, not the customer's address point, which a rider learns only by
// accepting (the owner's decision on the customer's address on a rider's
// offer,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01).
func TestOfferEvent_CarriesOnlyTheDropoffArea(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	svc := newClockedService(pool, newTestClock())
	o := seedRemoteReadyOrder(t, pool)
	rider := seedOnlineRider(t, pool, o.lng, o.lat)
	cleanRiderChannel(t, pool, rider)

	if res, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil || res.Offered != 1 {
		t.Fatalf("RunWave = %+v, %v; want one offer, to the rider at the restaurant", res, err)
	}
	var exactLat, exactLng float64
	if err := pool.QueryRow(ctx, `
SELECT ST_Y(a.location::geometry), ST_X(a.location::geometry)
  FROM "order" o JOIN address a ON a.id = o.delivery_address_id
 WHERE o.id = $1`, o.id).Scan(&exactLat, &exactLng); err != nil {
		t.Fatalf("read the delivery address: %v", err)
	}
	areaLat, areaLng := math.Round(exactLat*100)/100, math.Round(exactLng*100)/100
	if areaLat == exactLat && areaLng == exactLng {
		t.Fatalf("the seeded address %v,%v is already on the area grid, so the test would prove nothing", exactLat, exactLng)
	}

	var audience []string
	var payload []byte
	if err := pool.QueryRow(ctx, `
SELECT audience, payload FROM realtime_event WHERE channel = $1 AND type = 'dispatch.offer'`,
		realtime.RiderChannel(rider)).Scan(&audience, &payload); err != nil {
		t.Fatalf("read the rider's dispatch.offer: %v", err)
	}

	// The stored event — what the outbox publishes and the rider's channel
	// replays for 7 days — holds the area.
	var stored struct {
		Dropoff struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"dropoff"`
	}
	if err := json.Unmarshal(payload, &stored); err != nil {
		t.Fatal(err)
	}
	if stored.Dropoff.Lat != areaLat || stored.Dropoff.Lng != areaLng {
		t.Errorf("stored dispatch.offer drop-off = %v,%v, want the area %v,%v, not the address %v,%v",
			stored.Dropoff.Lat, stored.Dropoff.Lng, areaLat, areaLng, exactLat, exactLng)
	}

	// So does every role's copy, with exactly the contract's fields
	// (contracts/websocket.md section 4.5).
	receives := map[realtime.Viewer]bool{realtime.ViewRiderSelf: true, realtime.ViewSupport: true}
	top := []string{"distance_m", "dropoff", "earnings_cents", "est_duration_s", "expires_at", "items_count",
		"offer_id", "order_id", "pickup", "server_time", "tip_cents_estimate"}
	for _, v := range realtime.Viewers() {
		out, ok := realtime.Project("dispatch.offer", v, audience, payload)
		if ok != receives[v] {
			t.Errorf("%s: dispatch.offer projected %v, want %v", v, ok, receives[v])
			continue
		}
		if !ok {
			continue
		}
		var got map[string]any
		if err := json.Unmarshal(out, &got); err != nil {
			t.Fatalf("%s: %v", v, err)
		}
		dropoff, _ := got["dropoff"].(map[string]any)
		if !slices.Equal(fieldNames(got), top) || !slices.Equal(fieldNames(dropoff), []string{"area", "lat", "lng", "radius_m"}) {
			t.Errorf("%s: dispatch.offer = %v, want exactly the fields %v with a drop-off of area, lat, lng, radius_m", v, got, top)
		}
		if dropoff["lat"] != areaLat || dropoff["lng"] != areaLng {
			t.Errorf("%s: drop-off = %v,%v, want the area %v,%v", v, dropoff["lat"], dropoff["lng"], areaLat, areaLng)
		}
	}
}

// TestRiderLocation_StopsWhenTheRiderNoLongerCarriesTheOrder: rider.location
// reaches an order's customer and restaurant while the rider carries it out,
// and stops when that ends without a delivery. The order's dispatch row moves
// on only at delivery, so a rider whose assignment was cancelled, or whose
// order was cancelled, would otherwise go on streaming their position to that
// customer and restaurant, through every later job.
func TestRiderLocation_StopsWhenTheRiderNoLongerCarriesTheOrder(t *testing.T) {
	for _, end := range []string{"the platform cancels the assignment", "the order is cancelled"} {
		t.Run(end, func(t *testing.T) {
			pool := openPool(t)
			ctx := context.Background()
			clk := newTestClock()
			svc := newClockedService(pool, clk)
			o := seedRemoteReadyOrder(t, pool)
			rider := seedOnlineRider(t, pool, o.lng, o.lat)
			cleanRiderChannel(t, pool, rider)

			if res, err := svc.RunWave(ctx, o.id, 1, 3000); err != nil || res.Offered != 1 {
				t.Fatalf("RunWave = %+v, %v; want one offer", res, err)
			}
			var offerID string
			mustQuery(t, pool, `SELECT id::text FROM dispatch_offer WHERE order_id = $1 AND rider_account_id = $2`,
				&offerID, o.id, rider)
			asn, err := svc.AcceptOffer(ctx, rider, offerID)
			if err != nil {
				t.Fatalf("AcceptOffer: %v", err)
			}
			report := func() int {
				t.Helper()
				accuracy := 5.0
				if _, err := svc.IngestPositions(ctx, rider, []PositionPoint{{
					Lat: o.lat, Lng: o.lng, AccuracyM: &accuracy, RecordedAt: clk.Now(),
				}}); err != nil {
					t.Fatalf("IngestPositions: %v", err)
				}
				return len(eventPayloads(t, pool, o.id, "rider.location"))
			}

			// While the rider holds the order, a fix reaches its channel.
			if n := report(); n != 1 {
				t.Fatalf("rider.location events while the rider holds the order = %d, want 1", n)
			}

			switch end {
			case "the platform cancels the assignment":
				reason := "platform cancelled the assignment"
				if _, err := svc.Transition(ctx, rider, asn.ID, TransitionInput{
					ToState: "CANCELLED_BY_PLATFORM", OccurredAt: clk.Now(), OverrideReason: &reason,
				}); err != nil {
					t.Fatalf("cancel the assignment: %v", err)
				}
			default:
				// What the orders module writes for a support cancel. Dispatch
				// never cancels an order, so the test writes the row.
				mustExec(t, pool, `
UPDATE "order" SET state = 'CANCELLED', cancel_reason = 'SUPPORT_CANCELLED', cancelled_at = now(),
                   deadline_at = NULL, deadline_action = NULL
 WHERE id = $1`, o.id)
			}
			// The assignment's own end releases the row (#415); the order's
			// cancel above is written straight to the row, past the orders
			// module's cancel hook, so its row still names the rider and the
			// live-assignment check is what stops the fix.
			if d := readDispatch(t, pool, o.id); end == "the platform cancels the assignment" && d.state == "ASSIGNED" {
				t.Fatalf("dispatch = %+v; an assignment that ended must not leave the row ASSIGNED", d)
			}

			// Remove the earlier event, so the 5-second throttle cannot be what
			// stops the next one.
			mustExec(t, pool, `
DELETE FROM outbox_message WHERE realtime_event_id IN (
  SELECT id FROM realtime_event WHERE order_id = $1 AND type = 'rider.location')`, o.id)
			mustExec(t, pool, `DELETE FROM realtime_event WHERE order_id = $1 AND type = 'rider.location'`, o.id)

			if n := report(); n != 0 {
				t.Fatalf("after %s, a position report sent %d rider.location events to the order's customer and restaurant, want none", end, n)
			}
		})
	}
}
