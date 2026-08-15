package notify

import (
	"context"
	"testing"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

// fakeJob builds a *river.Job[DeliverArgs] the way River would construct one
// for a worker, without going through a live worker pool — enough to call
// DeliveryWorker.Work directly and assert on its side effects.
func fakeJob(args DeliverArgs, attempt int) *river.Job[DeliverArgs] {
	return &river.Job[DeliverArgs]{
		JobRow: &rivertype.JobRow{
			ID:      1,
			Kind:    args.Kind(),
			Attempt: attempt,
			State:   rivertype.JobStateRunning,
		},
		Args: args,
	}
}

// TestWorkerFailsOverToTheNextChannel is the multi-channel/failover
// invariant: when the first channel in the plan fails, the worker tries the
// next one and succeeds, recording one FAILED row and one SENT row.
func TestWorkerFailsOverToTheNextChannel(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()

	account := insertAccount(t, pool, "+15550004441")
	n := New{
		AccountID: account, RoleContext: RoleCustomer, Kind: KindOrderAccepted,
		Title: "t", Body: "b", Priority: PriorityHigh,
		Channels: []Channel{ChannelPush, ChannelSMS, ChannelInApp},
	}
	id, ok, err := repo.InsertNotification(ctx, pool, n)
	if err != nil || !ok {
		t.Fatalf("insert notification: ok=%v err=%v", ok, err)
	}

	push := NewFailingFakeSender(nil)
	sms := NewFakeSender()
	notifier := NewNotifier().Register(ChannelPush, push).Register(ChannelSMS, sms)
	lookup := NewFakeAccountLookup()
	lookup.Set(account, AccountTargets{PhoneE164: "+15550004441", PushTokens: []string{"ExpoToken[abc]"}})

	w := &DeliveryWorker{DB: pool, Repo: repo, Notifier: notifier, Accounts: lookup}
	job := fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels}, 1)

	if err := w.Work(ctx, job); err != nil {
		t.Fatalf("Work: %v", err)
	}

	deliveries, err := repo.ListDeliveries(ctx, pool, id)
	if err != nil {
		t.Fatalf("list deliveries: %v", err)
	}
	byChannel := map[Channel]Delivery{}
	for _, d := range deliveries {
		byChannel[d.Channel] = d
	}
	if got := byChannel[ChannelPush].State; got != DeliveryFailed {
		t.Errorf("PUSH state = %s, want FAILED", got)
	}
	if got := byChannel[ChannelSMS].State; got != DeliverySent {
		t.Errorf("SMS state = %s, want SENT", got)
	}
	if got := byChannel[ChannelInApp].State; got != DeliveryDelivered {
		t.Errorf("INAPP state = %s, want DELIVERED", got)
	}
	if push.Count() != 1 {
		t.Errorf("push sender called %d times, want 1", push.Count())
	}
	if sms.Count() != 1 {
		t.Errorf("sms sender called %d times, want 1", sms.Count())
	}
}

// TestWorkerReturnsErrorWhenEveryChannelFails is the at-least-once half:
// River only retries a job that returns an error, so exhausting every
// channel must surface one.
func TestWorkerReturnsErrorWhenEveryChannelFails(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()

	account := insertAccount(t, pool, "+15550004442")
	n := New{
		AccountID: account, RoleContext: RoleCustomer, Kind: KindOrderAccepted,
		Title: "t", Body: "b", Priority: PriorityHigh,
		Channels: []Channel{ChannelPush, ChannelSMS},
	}
	id, ok, err := repo.InsertNotification(ctx, pool, n)
	if err != nil || !ok {
		t.Fatalf("insert notification: ok=%v err=%v", ok, err)
	}

	notifier := NewNotifier().
		Register(ChannelPush, NewFailingFakeSender(nil)).
		Register(ChannelSMS, NewFailingFakeSender(nil))
	lookup := NewFakeAccountLookup()
	lookup.Set(account, AccountTargets{PhoneE164: "+15550004442", PushTokens: []string{"ExpoToken[abc]"}})

	w := &DeliveryWorker{DB: pool, Repo: repo, Notifier: notifier, Accounts: lookup}
	job := fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels}, 1)

	if err := w.Work(ctx, job); err == nil {
		t.Fatal("Work returned nil, want an error so River retries the job (at-least-once)")
	}
}

// TestWorkerRetryIsIdempotentPerChannel simulates River redelivering a job
// (e.g. after a crash between success and job completion): a channel that
// already has a SENT delivery row must not be re-sent.
func TestWorkerRetryIsIdempotentPerChannel(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()
	repo := NewRepo()

	account := insertAccount(t, pool, "+15550004443")
	n := New{
		AccountID: account, RoleContext: RoleCustomer, Kind: KindOrderAccepted,
		Title: "t", Body: "b", Priority: PriorityHigh,
		Channels: []Channel{ChannelSMS, ChannelInApp},
	}
	id, ok, err := repo.InsertNotification(ctx, pool, n)
	if err != nil || !ok {
		t.Fatalf("insert notification: ok=%v err=%v", ok, err)
	}

	sms := NewFakeSender()
	notifier := NewNotifier().Register(ChannelSMS, sms)
	lookup := NewFakeAccountLookup()
	lookup.Set(account, AccountTargets{PhoneE164: "+15550004443"})

	w := &DeliveryWorker{DB: pool, Repo: repo, Notifier: notifier, Accounts: lookup}

	job1 := fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels}, 1)
	if err := w.Work(ctx, job1); err != nil {
		t.Fatalf("first Work: %v", err)
	}
	if sms.Count() != 1 {
		t.Fatalf("after first Work: sms called %d times, want 1", sms.Count())
	}

	// Simulate a redelivered job (River retried after e.g. a process crash
	// right after the provider call landed but before the job was marked
	// complete). The SMS channel already has a SENT row; it must be skipped.
	job2 := fakeJob(DeliverArgs{NotificationID: id, Channels: n.Channels}, 2)
	if err := w.Work(ctx, job2); err != nil {
		t.Fatalf("second Work: %v", err)
	}
	if sms.Count() != 1 {
		t.Errorf("after redelivered Work: sms called %d times, want still 1 (idempotent)", sms.Count())
	}
}
