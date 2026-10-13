package notify

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// TestEnqueueAnnouncesInboxNotifications: a notification that lands in the
// in-app inbox is announced on its recipient's own account channel, in the
// enqueue's transaction, once however often it is enqueued; a sign-in code,
// which has no inbox row, is not (issue #376; contracts/websocket.md section
// 4.6, notification.created).
func TestEnqueueAnnouncesInboxNotifications(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	enq := NewEnqueuer(NewRepo(), riverInserter(t, pool))
	account := insertAccount(t, pool, "")

	enqueue := func(n New) EnqueueResult {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		res, err := enq.Enqueue(ctx, tx, n)
		if err != nil {
			t.Fatalf("enqueue: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		return res
	}
	n := testNew(account, "announce-once")
	n.DeepLink = "orders/123"
	first := enqueue(n)
	enqueue(n)
	enqueue(BuildOTP(OTPArgs{AccountID: account, PhoneE164: "+15555550100", Code: "123456", ChallengeKey: account.String()}))

	events := realtimetest.Events(t, pool, realtime.AccountChannel(account.String()))
	if !slices.Equal(realtimetest.Types(events), []string{"notification.created"}) {
		t.Fatalf("account channel = %v, want one notification.created", realtimetest.Types(events))
	}
	var created struct {
		NotificationID string  `json:"notification_id"`
		Kind           string  `json:"kind"`
		Title          string  `json:"title"`
		DeepLink       *string `json:"deep_link"`
	}
	if err := json.Unmarshal(events[0].Payload, &created); err != nil {
		t.Fatal(err)
	}
	if created.NotificationID != first.NotificationID.String() || created.Kind != string(KindOrderAccepted) ||
		created.Title != n.Title || created.DeepLink == nil || *created.DeepLink != n.DeepLink {
		t.Errorf("notification.created = %+v, want the enqueued notification", created)
	}
}
