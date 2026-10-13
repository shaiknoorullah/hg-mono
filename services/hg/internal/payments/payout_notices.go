package payments

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Payout notices: the partner is told when a payout is sent, held or fails,
// in the transaction that moves the payout, so the message exists if and only
// if the change committed (docs/spec/01-platform.md, "P-24 — Notification
// router: which event, which role, which channel", rows payout.paid,
// payout.failed and payouts_enabled=false; issue #248). Who hears and what
// they read is the notify module's (notify.EnqueuePayoutSent and its
// siblings): the restaurant's owners and managers, or the rider.
//
// With no outbox wired (a test that does not look at notifications) nothing
// is sent and the payout still moves: a missing message never stops money.

// WithOutbox sets where the payout notices this repo's payout transactions
// write go. Service.WithOutbox sets it too.
func (r *Repo) WithOutbox(o Outbox) *Repo {
	r.outbox = o
	return r
}

func payoutNoticeID(payoutID string) (uuid.UUID, error) {
	id, err := uuid.Parse(payoutID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("payout notice: payout id %q: %w", payoutID, err)
	}
	return id, nil
}

// notifyPayoutSent tells the payee a payout is PAID; bankPayoutID is the bank
// payout that paid it.
func notifyPayoutSent(ctx context.Context, tx pgx.Tx, o Outbox, payoutID, bankPayoutID string) error {
	if o == nil {
		return nil
	}
	id, err := payoutNoticeID(payoutID)
	if err != nil {
		return err
	}
	return notify.EnqueuePayoutSent(ctx, tx, o, id, bankPayoutID)
}

// notifyPayoutHeld tells the payee a payout is newly HELD.
func notifyPayoutHeld(ctx context.Context, tx pgx.Tx, o Outbox, payoutID string) error {
	if o == nil {
		return nil
	}
	id, err := payoutNoticeID(payoutID)
	if err != nil {
		return err
	}
	return notify.EnqueuePayoutHeld(ctx, tx, o, id)
}

// notifyPayoutFailed tells the payee a payout did not reach them. occurrence
// names this failure, so a retried transaction sends one message.
func notifyPayoutFailed(ctx context.Context, tx pgx.Tx, o Outbox, payoutID string, problem notify.PayoutProblem,
	occurrence string, nextRun time.Time) error {
	if o == nil {
		return nil
	}
	id, err := payoutNoticeID(payoutID)
	if err != nil {
		return err
	}
	return notify.EnqueuePayoutFailed(ctx, tx, o, id, problem, occurrence, nextRun)
}
