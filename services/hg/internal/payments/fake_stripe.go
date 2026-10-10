package payments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"
)

// fakeStripe is a LOCAL-DEV-ONLY StripeClient that fabricates successful
// authorisations so an order can be placed end-to-end without real Stripe
// credentials; a few payment method ids make it fail instead
// (fake_stripe_switch.go). It never contacts Stripe. It is wired ONLY in local env when
// HG_STRIPE_SECRET_KEY is unset (see cmd/hg/main.go) and must never run in
// production — the config gate there is the guarantee.
type fakeStripe struct{}

// NewFakeStripe returns the dev fake payment client.
func NewFakeStripe() StripeClient { return fakeStripe{} }

func fakeID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// CreatePaymentIntent simulates a manual-capture authorisation: funds are held
// (requires_capture) for the full amount, as the real gateway would after the
// client confirms.
func (fakeStripe) CreatePaymentIntent(_ context.Context, in CreateIntentInput) (*StripeIntent, error) {
	if pi, ok, err := fakeIntent(in); ok {
		return pi, err
	}
	id := fakeID("pi_fake_")
	return &StripeIntent{
		ID:                    id,
		Status:                "requires_capture",
		AmountCents:           in.AmountCents,
		AmountCapturableCents: in.AmountCents,
		Currency:              in.Currency,
		ClientSecret:          id + "_secret",
		CardBrand:             "visa",
	}, nil
}

func (fakeStripe) CapturePaymentIntent(_ context.Context, id string, amount int64, _ string) (*StripeIntent, error) {
	return &StripeIntent{ID: id, Status: "succeeded", AmountCents: amount, AmountCapturableCents: 0, AmountReceivedCents: amount, Currency: "cad"}, nil
}

func (fakeStripe) CancelPaymentIntent(_ context.Context, id, _ string) (*StripeIntent, error) {
	return &StripeIntent{ID: id, Status: "canceled"}, nil
}

func (fakeStripe) GetPaymentIntent(_ context.Context, id string) (*StripeIntent, error) {
	return &StripeIntent{ID: id, Status: fakeStatus(id)}, nil
}

func (fakeStripe) CreateSetupIntent(_ context.Context, _, _ string) (*StripeSetupIntent, error) {
	id := fakeID("seti_fake_")
	return &StripeSetupIntent{ID: id, ClientSecret: id + "_secret"}, nil
}

func (fakeStripe) CreateRefund(_ context.Context, _ CreateRefundInput) (*StripeRefund, error) {
	return &StripeRefund{ID: fakeID("re_fake_"), Status: "succeeded"}, nil
}

func (fakeStripe) CreateConnectAccount(_ context.Context, _ CreateConnectInput) (*StripeAccount, error) {
	return &StripeAccount{ID: fakeID("acct_fake_"), ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}, nil
}

func (fakeStripe) CreateAccountLink(_ context.Context, _, _, _ string) (*StripeAccountLink, error) {
	return &StripeAccountLink{URL: "https://connect.local.fake/onboarding", ExpiresAt: time.Now().Add(time.Hour).Unix()}, nil
}

func (fakeStripe) GetConnectAccount(_ context.Context, id string) (*StripeAccount, error) {
	return &StripeAccount{ID: id, ChargesEnabled: true, PayoutsEnabled: true, DetailsSubmitted: true}, nil
}

func (fakeStripe) CreateTransfer(_ context.Context, _ CreateTransferInput) (*StripeTransfer, error) {
	return &StripeTransfer{ID: fakeID("tr_fake_")}, nil
}

// FindTransfer finds nothing: the fake keeps no transfers.
func (fakeStripe) FindTransfer(_ context.Context, _ string) (*StripeTransfer, error) {
	return nil, nil
}

// CreateBankPayout fabricates a bank payout on its way; no webhook will say it
// arrived, so a local payout stays TRANSFERRED.
func (fakeStripe) CreateBankPayout(_ context.Context, _ CreateBankPayoutInput) (*StripeBankPayout, error) {
	return &StripeBankPayout{ID: fakeID("po_fake_"), Status: "pending"}, nil
}

// FindBankPayout finds nothing: the fake keeps no bank payouts.
func (fakeStripe) FindBankPayout(_ context.Context, _, _ string, _ int, _ time.Time) (*StripeBankPayout, error) {
	return nil, nil
}

// VerifyWebhook is unsupported by the fake — there is no real signing secret.
func (fakeStripe) VerifyWebhook(_ []byte, _ string) (StripeEvent, error) {
	return StripeEvent{}, ErrStripeNotConfigured
}

// ListEventsSince returns nothing: the fake never emitted an event to replay.
func (fakeStripe) ListEventsSince(_ context.Context, _ time.Time) ([]StripeEvent, error) {
	return nil, nil
}
