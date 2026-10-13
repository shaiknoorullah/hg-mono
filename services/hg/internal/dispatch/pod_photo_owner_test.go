package dispatch

import (
	"context"
	"testing"
)

// A proof-of-delivery photo must be the delivering rider's own upload for this
// order. Another rider's photo, or the rider's photo from another order, is
// refused with the same 422 as a missing photo, and nothing is recorded
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func TestRecordPod_PhotoMustBeTheRidersOwnForThisOrder(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	orderID, offers := seedFixture(t, pool, 2)
	otherOrderID, _ := seedFixture(t, pool, 0)
	rider, otherRider := offers[0].riderAccountID, offers[1].riderAccountID

	var assignmentID string
	mustQuery(t, pool, `
INSERT INTO assignment (order_id, rider_account_id, state, required_pod_method)
VALUES ($1, $2, 'ARRIVED_AT_DROPOFF', 'PHOTO') RETURNING id`, &assignmentID, orderID, rider)

	var objects []string
	photo := func(uploader, forOrder string) string {
		var id string
		mustQuery(t, pool, `
INSERT INTO stored_object (bucket, object_key, purpose, owner_account_id, order_id,
                           content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-pod', 'pod-owner/'||uuid_generate_v7(), 'POD', $1, $2,
        'image/jpeg', 2048, sha256(random()::text::bytea), 'READY', $1, now())
RETURNING id`, &id, uploader, forOrder)
		objects = append(objects, id)
		return id
	}
	// Registered after seedFixture, so it runs first: the assignment and the
	// photos go before the order and the riders they reference.
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM assignment_transition WHERE assignment_id=$1`, assignmentID)
		_, _ = pool.Exec(c, `DELETE FROM assignment WHERE id=$1`, assignmentID)
		for _, id := range objects {
			_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
		}
	})

	store := NewStore(pool)
	for name, id := range map[string]string{
		"another rider's photo for this order":     photo(otherRider, orderID),
		"the rider's own photo from another order": photo(rider, otherOrderID),
	} {
		_, err := store.RecordPod(ctx, rider, assignmentID, PodInput{Method: "PHOTO", PhotoObjectID: &id})
		if se, ok := asServiceError(err); !ok || se.Status != 422 || se.Code != CodePodRequired {
			t.Errorf("%s: err=%v, want 422 POD_REQUIRED", name, err)
		}
		var recorded bool
		var podObject *string
		if err := pool.QueryRow(ctx, `SELECT pod_recorded, pod_object_id::text FROM assignment WHERE id=$1`,
			assignmentID).Scan(&recorded, &podObject); err != nil {
			t.Fatalf("read assignment: %v", err)
		}
		if recorded || podObject != nil {
			t.Fatalf("%s: proof recorded (pod_recorded=%v, pod_object_id=%v)", name, recorded, podObject)
		}
	}

	own := photo(rider, orderID)
	if _, err := store.RecordPod(ctx, rider, assignmentID, PodInput{Method: "PHOTO", PhotoObjectID: &own}); err != nil {
		t.Fatalf("the rider's own photo for this order: err=%v, want recorded", err)
	}
}
