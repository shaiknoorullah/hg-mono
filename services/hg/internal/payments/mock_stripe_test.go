package payments

import (
	"context"
	"errors"
	"sync"
	"time"
)

// mockStripe is a test double for StripeClient. It never fabricates ids the way
// the previous system did in production — it exists only in tests, records every
// call, and returns whatever the test sets up. The real code path uses the live
// SDK; this proves the code drives Stripe correctly without a network.
type mockStripe struct {
	mu sync.Mutex

	// Programmable responses.
	CreateIntentFn  func(CreateIntentInput) (*StripeIntent, error)
	CaptureFn       func(id string, amount int64, key string) (*StripeIntent, error)
	CancelFn        func(id, key string) (*StripeIntent, error)
	GetIntentFn     func(id string) (*StripeIntent, error)
	SetupIntentFn   func(customerID, key string) (*StripeSetupIntent, error)
	RefundFn        func(CreateRefundInput) (*StripeRefund, error)
	ConnectFn       func(CreateConnectInput) (*StripeAccount, error)
	AccountLinkFn   func(id, ret, ref string) (*StripeAccountLink, error)
	GetConnectFn    func(id string) (*StripeAccount, error)
	TransferFn      func(CreateTransferInput) (*StripeTransfer, error)
	FindTransferFn  func(group string) (*StripeTransfer, error)
	BankPayoutFn    func(CreateBankPayoutInput) (*StripeBankPayout, error)
	FindBankPayFn   func(acct, payoutID string, attempt int) (*StripeBankPayout, error)
	VerifyWebhookFn func(payload []byte, sig string) (StripeEvent, error)
	ListEventsFn    func(since time.Time) ([]StripeEvent, error)

	// Recorded idempotency keys, to assert exactly-once behaviour.
	TransferKeys []string
	RefundKeys   []string
	IntentKeys   []string
}

func (m *mockStripe) CreatePaymentIntent(_ context.Context, in CreateIntentInput) (*StripeIntent, error) {
	m.mu.Lock()
	m.IntentKeys = append(m.IntentKeys, in.IdempotencyKey)
	m.mu.Unlock()
	if m.CreateIntentFn != nil {
		return m.CreateIntentFn(in)
	}
	return &StripeIntent{ID: "pi_test", Status: "requires_capture", AmountCapturableCents: in.AmountCents, Currency: in.Currency}, nil
}

func (m *mockStripe) CapturePaymentIntent(_ context.Context, id string, amount int64, key string) (*StripeIntent, error) {
	if m.CaptureFn != nil {
		return m.CaptureFn(id, amount, key)
	}
	return &StripeIntent{ID: id, Status: "succeeded", AmountReceivedCents: amount}, nil
}

func (m *mockStripe) CancelPaymentIntent(_ context.Context, id, key string) (*StripeIntent, error) {
	if m.CancelFn != nil {
		return m.CancelFn(id, key)
	}
	return &StripeIntent{ID: id, Status: "canceled"}, nil
}

func (m *mockStripe) GetPaymentIntent(_ context.Context, id string) (*StripeIntent, error) {
	if m.GetIntentFn != nil {
		return m.GetIntentFn(id)
	}
	return &StripeIntent{ID: id, Status: "requires_capture"}, nil
}

func (m *mockStripe) CreateSetupIntent(_ context.Context, customerID, key string) (*StripeSetupIntent, error) {
	if m.SetupIntentFn != nil {
		return m.SetupIntentFn(customerID, key)
	}
	return &StripeSetupIntent{ID: "seti_test", ClientSecret: "seti_test_secret"}, nil
}

func (m *mockStripe) CreateRefund(_ context.Context, in CreateRefundInput) (*StripeRefund, error) {
	m.mu.Lock()
	m.RefundKeys = append(m.RefundKeys, in.IdempotencyKey)
	m.mu.Unlock()
	if m.RefundFn != nil {
		return m.RefundFn(in)
	}
	return &StripeRefund{ID: "re_test", Status: "succeeded"}, nil
}

func (m *mockStripe) CreateConnectAccount(_ context.Context, in CreateConnectInput) (*StripeAccount, error) {
	if m.ConnectFn != nil {
		return m.ConnectFn(in)
	}
	return &StripeAccount{ID: "acct_test"}, nil
}

func (m *mockStripe) CreateAccountLink(_ context.Context, id, ret, ref string) (*StripeAccountLink, error) {
	if m.AccountLinkFn != nil {
		return m.AccountLinkFn(id, ret, ref)
	}
	return &StripeAccountLink{URL: "https://connect.stripe.test/x", ExpiresAt: 0}, nil
}

func (m *mockStripe) GetConnectAccount(_ context.Context, id string) (*StripeAccount, error) {
	if m.GetConnectFn != nil {
		return m.GetConnectFn(id)
	}
	return &StripeAccount{ID: id}, nil
}

func (m *mockStripe) CreateTransfer(_ context.Context, in CreateTransferInput) (*StripeTransfer, error) {
	m.mu.Lock()
	m.TransferKeys = append(m.TransferKeys, in.IdempotencyKey)
	m.mu.Unlock()
	if m.TransferFn != nil {
		return m.TransferFn(in)
	}
	return &StripeTransfer{ID: "tr_test"}, nil
}

func (m *mockStripe) FindTransfer(_ context.Context, group string) (*StripeTransfer, error) {
	if m.FindTransferFn != nil {
		return m.FindTransferFn(group)
	}
	return nil, nil
}

func (m *mockStripe) CreateBankPayout(_ context.Context, in CreateBankPayoutInput) (*StripeBankPayout, error) {
	if m.BankPayoutFn != nil {
		return m.BankPayoutFn(in)
	}
	return &StripeBankPayout{ID: "po_test", Status: "pending"}, nil
}

func (m *mockStripe) FindBankPayout(_ context.Context, acct, payoutID string, attempt int, _ time.Time) (*StripeBankPayout, error) {
	if m.FindBankPayFn != nil {
		return m.FindBankPayFn(acct, payoutID, attempt)
	}
	return nil, nil
}

func (m *mockStripe) VerifyWebhook(payload []byte, sig string) (StripeEvent, error) {
	if m.VerifyWebhookFn != nil {
		return m.VerifyWebhookFn(payload, sig)
	}
	return StripeEvent{}, errors.New("no webhook verifier set")
}

func (m *mockStripe) ListEventsSince(_ context.Context, since time.Time) ([]StripeEvent, error) {
	if m.ListEventsFn != nil {
		return m.ListEventsFn(since)
	}
	return nil, nil
}

var _ StripeClient = (*mockStripe)(nil)
