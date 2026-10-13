package notify

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// QueueDefault is the single River queue this module uses. Splitting by
// priority is deliberately not done via separate queues (that would need
// separate worker pools to matter); DeliverArgs.Priority instead maps to the
// River job priority (1 highest .. 4 lowest) so CRITICAL notifications are
// fetched ahead of LOW ones on the same worker pool.
const QueueDefault = "notify"

// DeliverArgs is the one job kind this package enqueues: "go attempt delivery
// of this already-persisted notification." The job carries only the
// notification id and, for channels whose target cannot be resolved from the
// account (OTP being the motivating case), the raw per-channel payload needed
// to reach the user — see otp.go. Everything else the worker needs it reloads
// from Postgres, which is what makes the job safe to retry: replaying it
// re-reads current state rather than trusting a stale copy in job args.
type DeliverArgs struct {
	NotificationID uuid.UUID `json:"notification_id"`
	// Channels is the failover-ordered plan copied from New.Channels at
	// enqueue time (the worker does not need a second Postgres round trip to
	// learn it, and it is immutable for this notification's lifetime).
	Channels []Channel `json:"channels"`
	// Overrides carries explicit per-channel targets and/or bodies copied from
	// New.Overrides at enqueue time — notably the OTP phone number and the
	// real code text, which must never be written to notification.body
	// (contract: Notification.body "Never contains an OTP code").
	Overrides map[Channel]ChannelOverride `json:"overrides,omitempty"`
}

// Kind implements river.JobArgs.
func (DeliverArgs) Kind() string { return "notify_deliver" }

// InsertOpts implements river.JobArgsWithInsertOpts: priority maps from the
// notification's Priority, and the job is deduplicated by notification id so
// a caller that (mistakenly) enqueues the same already-queued notification
// twice gets one job, not two workers racing the same deliveries.
func (a DeliverArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueDefault,
		MaxAttempts: 12,
	}
}

// riverPriority maps our four-level Priority onto River's 1(highest)-4(lowest)
// job priority scale.
func riverPriority(p Priority) int {
	switch p {
	case PriorityCritical:
		return 1
	case PriorityHigh:
		return 2
	case PriorityLow:
		return 4
	default:
		return 3 // NORMAL
	}
}

// Inserter is the subset of *river.Client[pgx.Tx] Enqueuer needs, so tests can
// substitute a fake without a live Postgres + River worker pool.
type Inserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

// Enqueuer is the write side of the outbox: it puts a notification row and
// its delivery job in the caller's transaction atomically. This is the type
// callers outside this package (orders, payments, auth) hold.
type Enqueuer struct {
	repo   *Repo
	client Inserter
}

// NewEnqueuer builds an Enqueuer over a repo and a River inserter (normally
// the same *river.Client[pgx.Tx] the Client type in client.go constructs).
func NewEnqueuer(repo *Repo, client Inserter) *Enqueuer {
	return &Enqueuer{repo: repo, client: client}
}

// EnqueueResult is what Enqueue hands back: enough for a caller to log or
// correlate, and Queued=false when the call was an idempotent no-op (the
// dedupe key already existed, so nothing new landed in the outbox).
type EnqueueResult struct {
	NotificationID uuid.UUID
	Queued         bool
}

// Enqueue writes the notification row and, only if it is genuinely new (not a
// dedupe hit), a River delivery job — both via tx, so both commit or neither
// does. This is the method every other module calls from inside its own
// business transaction: accept the order, capture the payment, THEN
// enqueue.Enqueue(ctx, tx, ...) with the same tx, all one commit.
func (e *Enqueuer) Enqueue(ctx context.Context, tx pgx.Tx, n New) (EnqueueResult, error) {
	if len(n.Channels) == 0 {
		return EnqueueResult{}, fmt.Errorf("notify: Enqueue: New.Channels is empty")
	}
	id, isNew, err := e.repo.InsertNotification(ctx, tx, n)
	if err != nil {
		return EnqueueResult{}, err
	}
	if !isNew {
		return EnqueueResult{NotificationID: id, Queued: false}, nil
	}

	args := DeliverArgs{NotificationID: id, Channels: n.Channels, Overrides: n.Overrides}
	_, err = e.client.InsertTx(ctx, tx, args, &river.InsertOpts{
		Queue:    QueueDefault,
		Priority: riverPriority(n.Priority),
	})
	if err != nil {
		return EnqueueResult{}, fmt.Errorf("notify: enqueue delivery job for %s: %w", id, err)
	}
	if err := emitCreated(ctx, tx, id, n); err != nil {
		return EnqueueResult{}, err
	}
	return EnqueueResult{NotificationID: id, Queued: true}, nil
}

// emitCreated writes notification.created on the recipient's own account
// channel, in the enqueue's transaction, for a notification that lands in the
// in-app inbox (contracts/websocket.md section 4.6): an open app shows it
// without polling. A notification with no inbox row to find (a sign-in code,
// a link email) is not announced.
func emitCreated(ctx context.Context, tx pgx.Tx, id uuid.UUID, n New) error {
	if !slices.Contains(n.Channels, ChannelInApp) {
		return nil
	}
	ev := realtime.NotificationCreated{
		NotificationID: id.String(), Kind: string(n.Kind), Title: n.Title, Body: n.Body,
		CreatedAt: realtime.At(time.Now()),
	}
	if n.DeepLink != "" {
		link := n.DeepLink
		ev.DeepLink = &link
	}
	if err := realtime.EmitAccount(ctx, tx, n.AccountID.String(), ev); err != nil {
		return fmt.Errorf("notify: announce %s: %w", id, err)
	}
	return nil
}
