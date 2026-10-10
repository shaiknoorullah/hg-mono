package dispatch

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
)

// TestSupportConfirmTxTakesItsPreconditionsFromTheRow pins that the support
// override's assignment step (overrideHandoverCode,
// https://github.com/shaiknoorullah/hg-mono/issues/310) moves an assignment
// only when the row itself is waiting on that handover: this order's live
// assignment, at the counter for the pickup, at the door of a met handover for
// the delivery. A LiveAssignment that says otherwise, stale or forged, moves
// nothing.
func TestSupportConfirmTxTakesItsPreconditionsFromTheRow(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	now := time.Now().UTC()
	orderID, offers := seedFixture(t, pool, 2)
	rider, other := offers[0], offers[1]
	asnID, err := NewStore(pool).AcceptOffer(ctx, rider.riderAccountID, rider.offerID, now)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	var support string
	mustQuery(t, pool, `INSERT INTO account (email, status) VALUES ('st-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`, &support)

	confirm := func(order string, a *LiveAssignment, kind handover.Kind) error {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if err := SupportConfirmTx(ctx, tx, order, a, kind, "SUPPORT", support, "Code locked; the kitchen confirmed the handover.", now); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	state := func() (string, bool) {
		t.Helper()
		var s string
		var pod bool
		mustQuery(t, pool, `SELECT state::text FROM assignment WHERE id = $1`, &s, asnID)
		mustQuery(t, pool, `SELECT pod_recorded FROM assignment WHERE id = $1`, &pod, asnID)
		return s, pod
	}

	// The rider has not reached the counter; the struct says they have, and
	// names another rider.
	forged := &LiveAssignment{ID: asnID, RiderAccountID: other.riderAccountID, State: "ARRIVED_AT_PICKUP", RequiredPodMethod: "OTP"}
	if err := confirm(orderID, forged, handover.Pickup); !errors.Is(err, ErrNotAwaitingHandover) {
		t.Errorf("pickup confirmed for a rider who is not at the counter: err = %v, want ErrNotAwaitingHandover", err)
	}
	if s, _ := state(); s != "ASSIGNED" {
		t.Fatalf("a refused pickup moved the assignment to %s", s)
	}

	// At the counter, but the override names another order.
	mustExec(t, pool, `UPDATE assignment SET state = 'ARRIVED_AT_PICKUP', arrived_pickup_at = now() WHERE id = $1`, asnID)
	otherOrder, _ := seedFixture(t, pool, 0)
	if err := confirm(otherOrder, forged, handover.Pickup); !errors.Is(err, ErrNotAwaitingHandover) {
		t.Errorf("pickup confirmed through another order: err = %v, want ErrNotAwaitingHandover", err)
	}

	// At the door of an unattended drop-off (a photo is the proof), while the
	// struct claims a met handover.
	mustExec(t, pool, `UPDATE assignment SET state = 'ARRIVED_AT_DROPOFF', arrived_dropoff_at = now() WHERE id = $1`, asnID)
	forged.State = "ARRIVED_AT_DROPOFF"
	if err := confirm(orderID, forged, handover.Delivery); !errors.Is(err, ErrNotAwaitingHandover) {
		t.Errorf("delivery confirmed at a photo drop-off: err = %v, want ErrNotAwaitingHandover", err)
	}
	if s, pod := state(); s != "ARRIVED_AT_DROPOFF" || pod {
		t.Fatalf("a refused delivery left the assignment %s with pod_recorded = %v", s, pod)
	}

	// At the door of a met handover the override goes through, and puts the
	// rider on the row back online, not the one the struct named.
	mustExec(t, pool, `UPDATE assignment SET required_pod_method = 'OTP' WHERE id = $1`, asnID)
	mustExec(t, pool, `UPDATE rider_profile SET availability_state = 'ON_DELIVERY' WHERE account_id = $1`, other.riderAccountID)
	if err := confirm(orderID, forged, handover.Delivery); err != nil {
		t.Fatalf("delivery at a met handover's door: %v", err)
	}
	if s, pod := state(); s != "DELIVERED" || !pod {
		t.Fatalf("after the override: assignment %s, pod_recorded = %v", s, pod)
	}
	var mine, theirs string
	mustQuery(t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id = $1`, &mine, rider.riderAccountID)
	mustQuery(t, pool, `SELECT availability_state::text FROM rider_profile WHERE account_id = $1`, &theirs, other.riderAccountID)
	if mine != "ONLINE_IDLE" || theirs != "ON_DELIVERY" {
		t.Errorf("availability: the assignment's rider %s (want ONLINE_IDLE), the rider the struct named %s (want ON_DELIVERY, untouched)", mine, theirs)
	}

	// And it cannot happen twice.
	if err := confirm(orderID, forged, handover.Delivery); !errors.Is(err, ErrNotAwaitingHandover) {
		t.Errorf("second delivery override: err = %v, want ErrNotAwaitingHandover", err)
	}
}
