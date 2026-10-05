package notify

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

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
// notification, attempt its channel plan, recording one notification_delivery
// row per attempt. It never trusts job args for content — only for the
// notification id, the plan, and the per-channel overrides a row must not
// hold (an OTP text, a single-use link token) — so a job re-run after a crash
// re-reads the current row from Postgres.
//
// How the plan is walked:
//   - INAPP is always recorded: the row itself is the inbox (doc.go).
//   - EMAIL is always attempted on its own, never as a failover step: email
//     is the record for payouts, decisions and account security, sent
//     "regardless of socket state" (docs/spec/01-platform.md, "P-24 —
//     Notification router", fallback ladder).
//   - PUSH, SMS and REALTIME are a failover chain: they are tried in plan
//     order and the chain stops at the first that sends.
//
// A channel already SENT (or better) on an earlier run of the job is skipped,
// and the notification's lease (Repo.ClaimLease) keeps two runs of the same
// job from overlapping, so a notification is delivered once per channel even
// when River runs its job twice.
type DeliveryWorker struct {
	river.WorkerDefaults[DeliverArgs]

	DB       DB
	Repo     *Repo
	Notifier *Notifier
	Accounts AccountLookup
	// Emails renders the EMAIL channel. Nil sends the notification's title
	// and body as a plain-text email.
	Emails *EmailRenderer
	Log    *slog.Logger
	// LeaseOwner names this worker on the notification lease; it defaults to
	// a random id per worker.
	LeaseOwner string
	// LeaseTTL bounds how long a crashed worker's lease blocks a retry; it
	// defaults to two minutes, longer than every provider timeout.
	LeaseTTL time.Duration
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

// attemptResult is how one channel attempt ended.
type attemptResult int

const (
	attemptSent attemptResult = iota
	attemptSuppressed
	attemptFailed
)

// Work implements river.Worker[DeliverArgs].
func (w *DeliveryWorker) Work(ctx context.Context, job *river.Job[DeliverArgs]) error {
	log := w.Log
	if log == nil {
		log = slog.Default()
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

	owner := w.LeaseOwner
	if owner == "" {
		owner = "worker-" + uuid.NewString()
	}
	ttl := w.LeaseTTL
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	claimed, err := w.Repo.ClaimLease(ctx, w.DB, n.ID, owner, ttl)
	if err != nil {
		return fmt.Errorf("notify worker: %w", err)
	}
	if !claimed {
		// Another run of this job is delivering right now. Come back after
		// it has finished (or its lease has run out) instead of racing it.
		return river.JobSnooze(ttl)
	}
	defer func() {
		// A fresh context: the job's may already be cancelled, and a lease
		// left behind only delays a retry by ttl.
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := w.Repo.ReleaseLease(releaseCtx, w.DB, n.ID, owner); err != nil {
			log.Warn("notify worker: release lease", slog.String("notification_id", n.ID.String()), slog.String("error", err.Error()))
		}
	}()

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
		log.Warn("notify worker: account lookup failed, falling back to explicit targets",
			slog.String("notification_id", n.ID.String()), slog.String("error", lookupErr.Error()))
	}

	var (
		chainAttempted, chainSucceeded bool
		failures                       []error
	)
	for _, ch := range job.Args.Channels {
		if done[ch] {
			if ch != ChannelInApp && ch != ChannelEmail {
				chainSucceeded = true
			}
			continue
		}
		switch ch {
		case ChannelInApp:
			// The persisted notification row *is* the in-app delivery — see
			// doc.go: the inbox is the system of record. Record it settled.
			id, err := w.Repo.InsertDelivery(ctx, w.DB, Delivery{NotificationID: n.ID, Channel: ch, Target: n.AccountID.String()})
			if err != nil {
				return fmt.Errorf("notify worker: record inapp delivery: %w", err)
			}
			if err := w.Repo.SettleDelivery(ctx, w.DB, id, DeliveryDelivered, "", "", "", 1); err != nil {
				return fmt.Errorf("notify worker: settle inapp delivery: %w", err)
			}
		case ChannelEmail:
			res, err := w.attempt(ctx, log, n, ch, job.Args.Overrides[ch], targets, prior)
			if err != nil {
				return err
			}
			if res.result == attemptFailed {
				failures = append(failures, res.err)
			}
		default:
			if chainSucceeded {
				// An earlier channel in the failover chain already landed.
				continue
			}
			res, err := w.attempt(ctx, log, n, ch, job.Args.Overrides[ch], targets, prior)
			if err != nil {
				return err
			}
			switch res.result {
			case attemptSent:
				chainSucceeded = true
			case attemptFailed:
				chainAttempted = true
				failures = append(failures, res.err)
			}
		}
	}

	chainFailed := chainAttempted && !chainSucceeded
	emailFailed := false
	for _, f := range failures {
		if errors.Is(f, errEmailAttemptFailed) {
			emailFailed = true
		}
	}
	if !chainFailed && !emailFailed {
		return nil
	}
	err = fmt.Errorf("notify worker: delivery failed for %s: %w", n.ID, errors.Join(failures...))
	allPermanent := true
	for _, f := range failures {
		if !IsPermanent(f) {
			allPermanent = false
		}
	}
	if allPermanent {
		// Retrying cannot change a rejected address or a template that does
		// not render: stop now rather than eleven more times.
		return river.JobCancel(err)
	}
	// River retries the job with backoff; channels that already sent are
	// skipped on the next run.
	return err
}

// errEmailAttemptFailed marks a failed EMAIL attempt among a job's failures,
// so the job retries even though the failover chain may have succeeded.
var errEmailAttemptFailed = errors.New("email attempt failed")

type attemptOutcome struct {
	result attemptResult
	err    error
}

// attempt makes one delivery attempt on one channel and records it. The
// returned error is for the job (a database write failed); a provider failure
// is reported in the outcome and recorded on the delivery row.
func (w *DeliveryWorker) attempt(ctx context.Context, log *slog.Logger, n Notification, ch Channel,
	override ChannelOverride, targets AccountTargets, prior []Delivery) (attemptOutcome, error) {
	target := override.Target
	if target == "" {
		target = resolveTarget(ch, targets)
	}
	var badTarget error
	if ch == ChannelEmail && target != "" {
		// One parse, one canonical address for every later decision
		// (address.go): the allow-list and the provider see the same string.
		canonical, err := CanonicalEmail(target)
		if err != nil {
			badTarget = Permanent(err)
		} else {
			target = canonical
		}
	}
	attempt := 1
	for _, d := range prior {
		if d.Channel == ch && d.Attempts >= attempt {
			attempt = d.Attempts + 1
		}
	}
	deliveryID, err := w.Repo.InsertDelivery(ctx, w.DB, Delivery{
		NotificationID: n.ID, Channel: ch, Target: target, Provider: w.Notifier.Provider(ch),
	})
	if err != nil {
		return attemptOutcome{}, fmt.Errorf("notify worker: record delivery attempt: %w", err)
	}
	if target == "" {
		if err := w.Repo.SuppressDelivery(ctx, w.DB, deliveryID, "NO_TARGET", 0); err != nil {
			return attemptOutcome{}, fmt.Errorf("notify worker: %w", err)
		}
		return attemptOutcome{result: attemptSuppressed}, nil
	}

	msg := Message{Title: n.Title, Body: n.Body, DeepLink: n.DeepLink, Data: n.Data}
	if override.Body != "" {
		msg.Body = override.Body
	}
	msg.IdempotencyKey = n.ID.String() + ":" + string(ch)

	sendErr := badTarget
	var providerMsgID string
	if ch == ChannelEmail && sendErr == nil {
		var email RenderedEmail
		email, sendErr = w.renderEmail(n, override.LinkToken)
		if sendErr == nil {
			msg.Email = &email
		}
	}
	if sendErr == nil {
		providerMsgID, sendErr = w.Notifier.Send(ctx, ch, target, msg)
	}

	if reason, ok := suppressedReason(sendErr); ok {
		if err := w.Repo.SuppressDelivery(ctx, w.DB, deliveryID, reason, attempt); err != nil {
			return attemptOutcome{}, fmt.Errorf("notify worker: %w", err)
		}
		return attemptOutcome{result: attemptSuppressed}, nil
	}
	if sendErr != nil {
		_ = w.Repo.SettleDelivery(ctx, w.DB, deliveryID, DeliveryFailed, "", classifyError(sendErr), sendErr.Error(), attempt)
		log.Info("notify: channel attempt failed",
			slog.String("notification_id", n.ID.String()), slog.String("channel", string(ch)),
			slog.Int("attempt", attempt), slog.Bool("permanent", IsPermanent(sendErr)), slog.String("error", sendErr.Error()))
		if ch == ChannelEmail {
			sendErr = fmt.Errorf("%w: %w", errEmailAttemptFailed, sendErr)
		}
		return attemptOutcome{result: attemptFailed, err: sendErr}, nil
	}
	if err := w.Repo.SettleDelivery(ctx, w.DB, deliveryID, DeliverySent, providerMsgID, "", "", attempt); err != nil {
		return attemptOutcome{}, fmt.Errorf("notify worker: settle delivery: %w", err)
	}
	return attemptOutcome{result: attemptSent}, nil
}

// renderEmail renders the EMAIL channel's message. Without a renderer (a
// worker built for a test, or a process with no templates) the inbox title
// and body go out as a plain-text email.
func (w *DeliveryWorker) renderEmail(n Notification, linkToken string) (RenderedEmail, error) {
	if w.Emails == nil {
		if linkToken != "" {
			return RenderedEmail{}, Permanent(errors.New("notify: a link email needs the email renderer"))
		}
		return RenderedEmail{Subject: n.Title, Text: n.Body}, nil
	}
	return w.Emails.Render(n, linkToken)
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
	case IsPermanent(err):
		return "PROVIDER_REJECTED"
	default:
		return "PROVIDER_ERROR"
	}
}
