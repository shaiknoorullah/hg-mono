package payments

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5"
)

// Reconcile on read. After the customer confirms the card in the app, the
// app reads GET /v1/orders/{orderId}/payment. While the stored payment is
// still before authorisation, that read asks Stripe for the PaymentIntent and
// asserts what Stripe says through the same transition a webhook takes
// (assertIntentAndOrder): an authorised intent moves the order from CREATED to
// RESTAURANT_PENDING, a decline records FAILED, a 3-D Secure challenge
// records REQUIRES_ACTION and re-issues the client secret.
//
// Webhooks stay the source of truth: this is a state assertion, never a
// delta, so a webhook that arrives before or after it finds the work done and
// changes nothing. It exists so an order advances on a laptop, where Stripe
// has no public URL to deliver webhooks to, and so a customer never waits on
// webhook latency to see their order placed.
//
// Spec: docs/spec/01-platform.md, "P-16 — Payments: authorise then capture"
// and "P-17 — Webhooks, idempotency and reconciliation".

// reconcileOnRead lists the stored payment states a read asks Stripe about:
// every state in which the customer may still be confirming a card. Once a
// payment is authorised, captured or cancelled, the read is answered from the
// database alone, so tracking an order never calls Stripe.
var reconcileOnRead = map[PaymentState]bool{
	StateRequiresPaymentMethod: true,
	StateRequiresConfirmation:  true,
	StateRequiresAction:        true,
	StateProcessing:            true,
	// A declined card can be retried on the same intent, and Stripe then
	// reports it authorised.
	StateFailed: true,
}

// reconcileIntentOnRead asserts Stripe's current view of the order's intent
// and reports what it read. Any failure is logged and the stored state
// stands: a read never fails because Stripe or the write did.
func (s *Service) reconcileIntentOnRead(ctx context.Context, i IntentRow) *StripeIntent {
	if s.stripe == nil || !reconcileOnRead[PaymentState(i.State)] || i.StripePaymentIntentID == "" {
		return nil
	}
	pi, err := s.stripe.GetPaymentIntent(ctx, i.StripePaymentIntentID)
	if err != nil {
		s.log.Warn("order payment: read from Stripe failed; answering the stored state",
			slog.String("order_id", i.OrderID), slog.String("error", err.Error()))
		return nil
	}
	if pi.ID != i.StripePaymentIntentID || !ourCurrency(pi.Currency) {
		// Not this payment, or not in CAD: assert nothing. The webhook path
		// refuses the same and pages; a read stays quiet.
		return nil
	}
	target, ok := stripeIntentTarget(pi.Status, pi.FailureCode != "")
	if !ok {
		return pi
	}
	var failure *intentFailure
	if target == StateFailed {
		failure = &intentFailure{Code: pi.FailureCode, DeclineCode: pi.DeclineCode, Message: pi.FailureMessage}
	}
	var eff effect
	err = s.repo.tx(ctx, func(tx pgx.Tx) error {
		var err error
		// Stripe's current view is as new as anything can be.
		eff, err = s.assertIntentAndOrder(ctx, tx, i.StripePaymentIntentID, target, pi.AmountReceivedCents, s.now(), failure)
		return err
	})
	if err != nil {
		s.log.Warn("order payment: reconcile on read failed; answering the stored state",
			slog.String("order_id", i.OrderID), slog.String("error", err.Error()))
		return pi
	}
	if eff.kind == effectApplied {
		s.log.Info("order payment: reconciled on read",
			slog.String("order_id", i.OrderID), slog.String("effect", eff.String()))
	}
	return pi
}
