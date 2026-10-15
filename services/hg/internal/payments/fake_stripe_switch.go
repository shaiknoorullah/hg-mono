package payments

import (
	"errors"
	"strings"
)

// The local fake payment client's switch (issues #680 and #676). By default
// the fake authorises every order at once. An order placed with one of these
// payment method ids instead shows a payment that goes wrong, so a declined
// card, an unpaid order and a failed capture can be seen without a Stripe
// test account.
//
// The switch lives on the fake only, and the server wires the fake only when
// HG_ENV is local and HG_STRIPE_SECRET_KEY is unset (cmd/hg/main.go). With a
// real key the ids reach Stripe, which knows no such payment method and
// refuses them like any other unknown id.
const (
	// FakeMethodDeclined: the card is declined when the order confirms it.
	// No intent is created, so the order fails (P-14 transition T2) with no
	// authorisation and no ledger batch.
	FakeMethodDeclined = "pm_fake_declined"
	// FakeMethodUnpaid: the intent is created but never confirmed. The order
	// stays CREATED under its 15-minute deadline, which then cancels it.
	FakeMethodUnpaid = "pm_fake_unpaid"
	// FakeMethodCaptureFails: the card is authorised as usual, and the
	// capture when the restaurant accepts fails.
	FakeMethodCaptureFails = "pm_fake_capture_fails"
)

// fakeUnpaidPrefix marks an intent the fake leaves unconfirmed. The fake
// keeps no state, so the intent id itself carries the outcome to later reads.
const (
	fakeUnpaidPrefix  = "pi_fake_unpaid_"
	fakeCapFailPrefix = "pi_fake_capfail_"
)

// ErrFakeCardDeclined is the fake's answer to FakeMethodDeclined, worded as
// Stripe's card_declined error.
var ErrFakeCardDeclined = errors.New("card_declined: your card was declined (local fake payment client)")

// ErrFakeCaptureFailed is the fake's answer to capturing a
// FakeMethodCaptureFails intent.
var ErrFakeCaptureFailed = errors.New("capture failed: the payment provider refused the capture (local fake payment client)")

// fakeIntent applies the switch to a new intent. ok is false when the
// payment method selects no special outcome.
func fakeIntent(in CreateIntentInput) (intent *StripeIntent, ok bool, err error) {
	switch in.PaymentMethodID {
	case FakeMethodDeclined:
		return nil, true, ErrFakeCardDeclined
	case FakeMethodUnpaid:
		id := fakeID(fakeUnpaidPrefix)
		return &StripeIntent{
			ID:           id,
			Status:       "requires_payment_method",
			AmountCents:  in.AmountCents,
			Currency:     in.Currency,
			ClientSecret: id + "_secret",
		}, true, nil
	case FakeMethodCaptureFails:
		id := fakeID(fakeCapFailPrefix)
		return &StripeIntent{
			ID:                    id,
			Status:                "requires_capture",
			AmountCents:           in.AmountCents,
			AmountCapturableCents: in.AmountCents,
			Currency:              in.Currency,
			ClientSecret:          id + "_secret",
			CardBrand:             "visa",
		}, true, nil
	}
	return nil, false, nil
}

// fakeCaptureFails reports whether the fake refuses to capture the intent.
func fakeCaptureFails(id string) bool {
	return strings.HasPrefix(id, fakeCapFailPrefix)
}

// fakeStatus is what the fake reports when an intent is read back.
func fakeStatus(id string) string {
	if strings.HasPrefix(id, fakeUnpaidPrefix) {
		return "requires_payment_method"
	}
	return "requires_capture"
}
