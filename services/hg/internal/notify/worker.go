package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/riverqueue/river"
)

// AccountTargets is what the worker needs to reach an account on channels
// whose target was not given explicitly at Enqueue time (New.Targets). This
// is the "generalized SMSSender seam" from the account/device side: notify
// does not own the account or device tables, so it asks for them through this
// interface instead of importing another module's package.
type AccountTargets struct {
	PhoneE164  string
	Email      string
	PushTokens []string // active device.expo_push_token rows for the notification's role_context
}

// AccountLookup resolves delivery targets for an account. The auth/catalog
// module that owns the account and device tables implements this; notify
// only depends on the interface (stubbed cross-module call, per this
// worktree's build rules).
type AccountLookup interface {
	ResolveTargets(ctx context.Context, accountID uuid.UUID, role RoleContext) (AccountTargets, error)
}

// NoAccountLookup is a zero-value AccountLookup for configurations that only
// ever supply explicit New.Targets (e.g. OTP-only deployments, or tests).
// Every call returns an empty AccountTargets and no error, so a channel
// without an explicit target simply resolves to "no target" and is recorded
// SUPPRESSED rather than the worker crashing.
type NoAccountLookup struct{}

func (NoAccountLookup) ResolveTargets(context.Context, uuid.UUID, RoleContext) (AccountTargets, error) {
	return AccountTargets{}, nil
}

// DeliveryWorker implements river.Worker[DeliverArgs]: given a persisted
// notification, attempt its channel plan in order with failover, recording
// one notification_delivery row per attempt. It never trusts job args for
// content — only for the notification id and the failover plan — so a job
// re-run after a crash re-reads the current row from Postgres.
type DeliveryWorker struct {
	river.WorkerDefaults[DeliverArgs]

	DB       DB
	Repo     *Repo
	Notifier *Notifier
	Accounts AccountLookup
	Log      *slog.Logger
}

// terminal delivery states that mean "this channel already succeeded" —
// checked before re-sending on a retried job, which is what keeps delivery
// idempotent across River's at-least-once retries.
func succeeded(s DeliveryState) bool {
	switch s {
	case DeliverySent, DeliveryDelivered, DeliveryAcked:
		return true
	default:
		return false
	}
}

// Work implements river.Worker[DeliverArgs].
func (w *DeliveryWorker) Work(ctx context.Context, job *river.Job[DeliverArgs]) error {
	if w.Log == nil {
		w.Log = slog.Default()
	}
	accounts := w.Accounts
	if accounts == nil {
		accounts = NoAccountLookup{}
	}

	n, err := w.Repo.GetNotification(ctx, w.DB, job.Args.NotificationID)
	if err != nil {
		// The notification row must exist because Enqueue writes it in the
		// same transaction as the job (doc.go). A missing row here means data
		// was deleted out from under the outbox, which is a bug elsewhere,
		// not a transient failure — do not retry forever.
		return fmt.Errorf("notify worker: %w", err)
	}
	if n.DismissedAt != nil {
		return nil // withdrawn since enqueue; nothing to deliver.
	}

	prior, err := w.Repo.ListDeliveries(ctx, w.DB, n.ID)
	if err != nil {
		return fmt.Errorf("notify worker: load prior deliveries: %w", err)
	}
	done := make(map[Channel]bool, len(prior))
	for _, d := range prior {
		if succeeded(d.State) {
			done[d.Channel] = true
		}
	}

	targets, lookupErr := accounts.ResolveTargets(ctx, n.AccountID, n.RoleContext)
	if lookupErr != nil {
		w.Log.Warn("notify worker: account lookup failed, falling back to explicit targets",
			slog.String("notification_id", n.ID.String()), slog.String("error", lookupErr.Error()))
	}

	msg := Message{Title: n.Title, Body: n.Body, DeepLink: n.DeepLink, Data: n.Data}

	var anyExternalAttempted, anySucceeded, externalSucceeded bool
	var lastErr error

	for _, ch := range job.Args.Channels {
		if done[ch] {
			anySucceeded = true
			if ch != ChannelInApp {
				externalSucceeded = true
			}
			continue
		}
		if ch == ChannelInApp {
			// The persisted notification row *is* the in-app delivery — see
			// doc.go: the inbox is the system of record. Record it settled.
			id, err := w.Repo.InsertDelivery(ctx, w.DB, Delivery{NotificationID: n.ID, Channel: ch, Target: n.AccountID.String()})
			if err != nil {
				return fmt.Errorf("notify worker: record inapp delivery: %w", err)
			}
			if err := w.Repo.SettleDelivery(ctx, w.DB, id, DeliveryDelivered, "", "", "", 1); err != nil {
				return fmt.Errorf("notify worker: settle inapp delivery: %w", err)
			}
			anySucceeded = true
			continue
		}

		if externalSucceeded {
			// Failover already landed on an earlier channel in the plan;
			// don't also fire the remaining external channels (INAPP above
			// is the only channel attempted unconditionally).
			continue
		}

		override := job.Args.Overrides[ch]
		target := override.Target
		if target == "" {
			target = resolveTarget(ch, targets)
		}
		if target == "" {
			id, err := w.Repo.InsertDelivery(ctx, w.DB, Delivery{NotificationID: n.ID, Channel: ch, Target: ""})
			if err == nil {
				_ = w.Repo.SettleDelivery(ctx, w.DB, id, DeliverySuppressed, "", "NO_TARGET", "no delivery target resolved for channel", 0)
			}
			continue
		}

		anyExternalAttempted = true
		attempt := 1
		for _, d := range prior {
			if d.Channel == ch {
				attempt = d.Attempts + 1
			}
		}

		deliveryID, err := w.Repo.InsertDelivery(ctx, w.DB, Delivery{NotificationID: n.ID, Channel: ch, Target: target})
		if err != nil {
			return fmt.Errorf("notify worker: record delivery attempt: %w", err)
		}

		chMsg := msg
		if override.Body != "" {
			chMsg.Body = override.Body
		}
		chMsg.IdempotencyKey = n.ID.String() + ":" + string(ch)
		providerMsgID, sendErr := w.Notifier.Send(ctx, ch, target, chMsg)
		if sendErr != nil {
			lastErr = sendErr
			_ = w.Repo.SettleDelivery(ctx, w.DB, deliveryID, DeliveryFailed, "", classifyError(sendErr), sendErr.Error(), attempt)
			w.Log.Info("notify: channel attempt failed, trying next in plan",
				slog.String("notification_id", n.ID.String()), slog.String("channel", string(ch)),
				slog.Int("attempt", attempt), slog.String("error", sendErr.Error()))
			continue
		}
		if err := w.Repo.SettleDelivery(ctx, w.DB, deliveryID, DeliverySent, providerMsgID, "", "", attempt); err != nil {
			return fmt.Errorf("notify worker: settle delivery: %w", err)
		}
		anySucceeded = true
		externalSucceeded = true // failover stops trying further external channels
	}

	if anyExternalAttempted && !externalSucceeded {
		if lastErr != nil {
			return fmt.Errorf("notify worker: every channel in the plan failed for %s: %w", n.ID, lastErr)
		}
		return fmt.Errorf("notify worker: every channel in the plan failed for %s", n.ID)
	}
	if !anyExternalAttempted && !anySucceeded {
		// Every channel resolved to no target (e.g. account has no verified
		// phone and no device). This is not a transient failure — retrying
		// will not produce a target — so the job completes without having
		// reached the user; the INAPP row (if planned) already recorded it.
		w.Log.Warn("notify worker: no channel had a deliverable target",
			slog.String("notification_id", n.ID.String()))
	}
	return nil
}

func resolveTarget(ch Channel, t AccountTargets) string {
	switch ch {
	case ChannelSMS:
		return t.PhoneE164
	case ChannelEmail:
		return t.Email
	case ChannelPush:
		if len(t.PushTokens) > 0 {
			return t.PushTokens[0]
		}
		return ""
	default:
		return ""
	}
}

// classifyError gives notification_delivery.error_code a short, stable value
// instead of a raw error string that would differ per provider.
func classifyError(err error) string {
	switch {
	case errors.Is(err, ErrChannelNotConfigured):
		return "CHANNEL_NOT_CONFIGURED"
	case err == nil:
		return ""
	default:
		return "PROVIDER_ERROR"
	}
}
