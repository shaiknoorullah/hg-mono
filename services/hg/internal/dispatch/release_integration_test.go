package dispatch

import (
	"context"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// A rider whose assignment ends without a delivery stops holding the order, in
// the transaction that ended it: the dispatch row no longer names them,
// dispatch.unassigned is written on order:{id} (which makes the gateway
// re-check and unsubscribe them) and the order channel no longer lets them
// in. Before https://github.com/shaiknoorullah/hg-mono/issues/415 the row
// stayed ASSIGNED to them. Both ways an assignment ends early are checked:
// its own end (the platform cancels the assignment) and its order's
// cancellation.
func TestRelease_ARiderWhoseAssignmentEndedNoLongerHoldsTheOrder(t *testing.T) {
	pool := openPool(t)
	store := NewStore(pool)
	svc := NewService(store, &fakeLifecycle{})
	rt := realtime.NewStore(pool, "release-test")
	ctx := context.Background()

	for _, end := range []string{"the assignment is cancelled", "the order is cancelled"} {
		t.Run(end, func(t *testing.T) {
			orderID, offers := seedFixture(t, pool, 1)
			rider := offers[0].riderAccountID
			asnID, err := store.AcceptOffer(ctx, rider, offers[0].offerID, time.Now().UTC())
			if err != nil {
				t.Fatalf("AcceptOffer: %v", err)
			}
			allowed := func() bool {
				t.Helper()
				ch, _ := realtime.ParseChannel(realtime.OrderChannel(orderID))
				g, err := rt.AuthorizeSubscribe(ctx, rider, []string{"RIDER"}, ch)
				if err != nil {
					t.Fatalf("AuthorizeSubscribe: %v", err)
				}
				return g.Result == realtime.SubAllowed && g.Viewer == realtime.ViewRider
			}
			if !allowed() {
				t.Fatal("the assigned rider cannot read the order channel")
			}

			wantState := "SEARCHING" // the order is still waiting to be collected
			switch end {
			case "the assignment is cancelled":
				reason := "platform cancelled the assignment"
				if _, err := svc.Transition(ctx, rider, asnID, TransitionInput{
					ToState: "CANCELLED_BY_PLATFORM", OccurredAt: time.Now().UTC(), OverrideReason: &reason,
				}); err != nil {
					t.Fatalf("cancel the assignment: %v", err)
				}
			default:
				// What the orders module's cancel does: the order's row, then
				// this, in one transaction.
				wantState = "NO_RIDER_FOUND"
				tx, err := pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(ctx) //nolint:errcheck
				if _, err := tx.Exec(ctx, `
UPDATE "order" SET state = 'CANCELLED', cancel_reason = 'SUPPORT_CANCELLED', cancelled_at = now(),
                   deadline_at = NULL, deadline_action = NULL WHERE id = $1`, orderID); err != nil {
					t.Fatal(err)
				}
				if err := ReleaseCancelledOrderTx(ctx, tx, orderID); err != nil {
					t.Fatalf("ReleaseCancelledOrderTx: %v", err)
				}
				if err := tx.Commit(ctx); err != nil {
					t.Fatal(err)
				}
			}

			var state, asnState, availability string
			var named, terminated bool
			if err := pool.QueryRow(ctx, `
SELECT d.state::text, d.rider_account_id IS NOT NULL, a.state::text, a.terminated_at IS NOT NULL,
       rp.availability_state::text
  FROM dispatch d
  JOIN assignment a ON a.id = $2
  JOIN rider_profile rp ON rp.account_id = a.rider_account_id
 WHERE d.order_id = $1`, orderID, asnID).Scan(&state, &named, &asnState, &terminated, &availability); err != nil {
				t.Fatal(err)
			}
			if state != wantState || named {
				t.Errorf("dispatch %s, names the rider %t; want %s, naming nobody", state, named, wantState)
			}
			if asnState != "CANCELLED_BY_PLATFORM" || !terminated || availability == "ON_DELIVERY" {
				t.Errorf("assignment %s (ended %t), rider %s; want it ended and the rider free", asnState, terminated, availability)
			}
			if got := eventPayloads(t, pool, orderID, "dispatch.unassigned"); len(got) != 1 {
				t.Errorf("dispatch.unassigned events = %d, want 1", len(got))
			}
			if allowed() {
				t.Error("the rider can still read the order channel after the assignment ended")
			}
		})
	}
}
