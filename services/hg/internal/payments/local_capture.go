package payments

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// The local capture ledger (issue #676). In production the CAPTURE ledger
// batch is posted when Stripe's payment_intent.succeeded event is applied
// (webhooks.go, recordSucceeded), not by Capture. The local fake payment
// client sends no events, so on a laptop no capture was ever in the ledger:
// restaurants earned nothing and a payout run had nothing to pay. With the
// fake, Capture now applies the succeeded state itself, through the same
// assertion a stored event takes, so the batch is the one the webhook would
// post, keyed by the order, and is posted at most once.

// WithLocalCaptureLedger makes Capture record the capture's ledger batch
// itself. The server sets it only with the local fake payment client
// (cmd/hg/main.go), never with a Stripe key.
func (s *Service) WithLocalCaptureLedger() *Service {
	s.localCaptureLedger = true
	return s
}

// recordLocalCapture applies a captured intent as its succeeded event would.
func (s *Service) recordLocalCapture(ctx context.Context, pi *StripeIntent) error {
	return s.repo.tx(ctx, func(tx pgx.Tx) error {
		eff, err := s.assertIntentState(ctx, tx, pi.ID, StateSucceeded, pi.AmountReceivedCents, s.now(), nil)
		if err != nil {
			return err
		}
		if eff.kind == effectMismatch {
			return fmt.Errorf("local capture of %s not recorded: %s", pi.ID, eff.label)
		}
		return nil
	})
}
