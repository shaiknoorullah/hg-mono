package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	stripe "github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/account"
	"github.com/stripe/stripe-go/v79/accountlink"
	"github.com/stripe/stripe-go/v79/client"
	"github.com/stripe/stripe-go/v79/refund"
	"github.com/stripe/stripe-go/v79/setupintent"
	"github.com/stripe/stripe-go/v79/transfer"
	"github.com/stripe/stripe-go/v79/webhook"
)

// StripeClient is the whole surface of Stripe that this package depends on.
//
// It exists so the previous system's failure mode — fabricated `stripe_<nanoid>`
// identifiers and TODO'd refund calls — is structurally impossible: every method
// here is a real provider call in production, and every method here is mockable
// in a unit test. There is no in-package "fake Stripe" that returns invented ids;
// a test supplies a mock, and integration tests hit real test-mode Stripe.
//
// Every mutating call takes an idempotency key so a retry after a timeout
// produces exactly one Stripe object (I-17.1, I-18, I-19.4).
type StripeClient interface {
	// CreatePaymentIntent authorises funds with capture_method=manual (P-16).
	CreatePaymentIntent(ctx context.Context, in CreateIntentInput) (*StripeIntent, error)
	// CapturePaymentIntent captures a previously authorised intent, in full or
	// for a partial amount, when the restaurant accepts.
	CapturePaymentIntent(ctx context.Context, stripeIntentID string, amountToCapture int64, idempotencyKey string) (*StripeIntent, error)
	// CancelPaymentIntent voids an uncaptured authorisation on reject/timeout.
	CancelPaymentIntent(ctx context.Context, stripeIntentID, idempotencyKey string) (*StripeIntent, error)
	// GetPaymentIntent reads the current provider state.
	GetPaymentIntent(ctx context.Context, stripeIntentID string) (*StripeIntent, error)

	// CreateSetupIntent begins saving a card (C-24). The card never touches us.
	CreateSetupIntent(ctx context.Context, stripeCustomerID, idempotencyKey string) (*StripeSetupIntent, error)

	// CreateRefund refunds a captured charge (P-18), keyed by 'rf:'||refund_id.
	CreateRefund(ctx context.Context, in CreateRefundInput) (*StripeRefund, error)

	// CreateConnectAccount creates an Express connected account (P-19).
	CreateConnectAccount(ctx context.Context, in CreateConnectInput) (*StripeAccount, error)
	// CreateAccountLink mints a short-lived onboarding link (P-19).
	CreateAccountLink(ctx context.Context, stripeAccountID, returnURL, refreshURL string) (*StripeAccountLink, error)
	// GetConnectAccount reads capabilities and requirements.
	GetConnectAccount(ctx context.Context, stripeAccountID string) (*StripeAccount, error)

	// CreateTransfer moves platform balance to a connected account (P-19),
	// keyed by 'po:'||payout_id.
	CreateTransfer(ctx context.Context, in CreateTransferInput) (*StripeTransfer, error)
	// FindTransfer returns the transfer made in a transfer group, or nil when
	// there is none. A payout's transfer is in the group 'payout_'||payout_id,
	// so a retry after an attempt that may have reached Stripe (a timeout, a
	// crash) finds the first transfer instead of making a second one: Stripe
	// forgets an idempotency key after 24 hours, and the next weekly run is
	// days later.
	FindTransfer(ctx context.Context, transferGroup string) (*StripeTransfer, error)

	// VerifyWebhook checks the Stripe-Signature header against the signing
	// secret with a 300-second tolerance (P-17 / I-17.2) and returns the
	// verified event. It never parses meaning before verifying.
	VerifyWebhook(payload []byte, sigHeader string) (StripeEvent, error)

	// ListEventsSince lists every event Stripe created at or after since,
	// oldest first, for the on-demand catch-up after a failover or restore
	// (catchup.go). The events come from the API over our own key, so they
	// need no signature. Stripe keeps events for 30 days.
	ListEventsSince(ctx context.Context, since time.Time) ([]StripeEvent, error)
}

// CreateIntentInput authorises a charge on the platform account.
type CreateIntentInput struct {
	AmountCents     int64
	Currency        string
	CustomerID      string // stripe customer id, optional
	PaymentMethodID string // stripe payment method id, optional
	OffSession      bool   // true for POST_DELIVERY_TIP
	Confirm         bool
	IdempotencyKey  string
	OrderID         string // stored in metadata for reconciliation
	StatementDescr  string
}

// CreateRefundInput refunds a captured charge.
type CreateRefundInput struct {
	StripePaymentIntentID string
	AmountCents           int64
	Reason                string
	IdempotencyKey        string
	RefundID              string // stored in metadata
}

// CreateConnectInput creates a CA Express connected account.
type CreateConnectInput struct {
	Email          string
	OwnerType      string // 'RESTAURANT' | 'RIDER'
	OwnerID        string
	IdempotencyKey string
}

// CreateTransferInput moves platform balance to a connected account.
type CreateTransferInput struct {
	AmountCents     int64
	Currency        string
	DestinationAcct string
	IdempotencyKey  string
	PayoutID        string
	TransferGroup   string
}

// StripeIntent is the subset of a PaymentIntent the ledger and state machine need.
type StripeIntent struct {
	ID                    string
	Status                string // stripe status, e.g. requires_capture
	AmountCents           int64
	AmountCapturableCents int64
	AmountReceivedCents   int64
	Currency              string
	ClientSecret          string
	CardBrand             string
	CardLast4             string
	CardCountry           string
	Wallet                string
	FailureCode           string
	FailureMessage        string
	DeclineCode           string
}

// StripeSetupIntent is a SetupIntent client secret.
type StripeSetupIntent struct {
	ID           string
	ClientSecret string
}

// StripeRefund is the subset of a Refund we persist.
type StripeRefund struct {
	ID     string
	Status string // pending | succeeded | failed | canceled | requires_action
}

// StripeAccount is the subset of a connected account we persist.
type StripeAccount struct {
	ID               string
	ChargesEnabled   bool
	PayoutsEnabled   bool
	DetailsSubmitted bool
	DisabledReason   string
	CurrentlyDue     []string
	EventuallyDue    []string
	PastDue          []string
	Deadline         *int64
}

// StripeAccountLink is a hosted-onboarding URL with an expiry.
type StripeAccountLink struct {
	URL       string
	ExpiresAt int64
}

// StripeTransfer is the subset of a Transfer we persist.
type StripeTransfer struct {
	ID string
}

// StripeEvent is a verified webhook event.
type StripeEvent struct {
	ID         string
	Type       string
	APIVersion string
	LiveMode   bool
	Created    int64
	RawPayload []byte
	// Data is the raw JSON of event.data.object, parsed lazily by handlers.
	DataObject []byte
}

// ErrStripeNotConfigured is returned by the no-op client for any call.
var ErrStripeNotConfigured = errors.New("stripe is not configured (HG_STRIPE_SECRET_KEY unset)")

// liveStripe is the production StripeClient backed by the Stripe Go SDK.
type liveStripe struct {
	api           *client.API
	webhookSecret string
}

// NewLiveStripe builds a StripeClient from a test- or live-mode secret key.
func NewLiveStripe(secretKey, webhookSecret string) StripeClient {
	sc := &client.API{}
	sc.Init(secretKey, nil)
	return &liveStripe{api: sc, webhookSecret: webhookSecret}
}

func (s *liveStripe) CreatePaymentIntent(ctx context.Context, in CreateIntentInput) (*StripeIntent, error) {
	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(in.AmountCents),
		Currency:      stripe.String(in.Currency),
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
	}
	params.Context = ctx
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}
	if in.CustomerID != "" {
		params.Customer = stripe.String(in.CustomerID)
	}
	if in.PaymentMethodID != "" {
		params.PaymentMethod = stripe.String(in.PaymentMethodID)
	}
	if in.OffSession {
		params.OffSession = stripe.Bool(true)
	}
	if in.Confirm {
		params.Confirm = stripe.Bool(true)
	}
	if in.OrderID != "" {
		params.AddMetadata("order_id", in.OrderID)
	}
	if in.StatementDescr != "" {
		params.StatementDescriptorSuffix = stripe.String(in.StatementDescr)
	}
	pi, err := s.api.PaymentIntents.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create payment intent: %w", err)
	}
	return intentFrom(pi), nil
}

func (s *liveStripe) CapturePaymentIntent(ctx context.Context, id string, amount int64, key string) (*StripeIntent, error) {
	params := &stripe.PaymentIntentCaptureParams{}
	params.Context = ctx
	if amount > 0 {
		params.AmountToCapture = stripe.Int64(amount)
	}
	if key != "" {
		params.SetIdempotencyKey(key)
	}
	pi, err := s.api.PaymentIntents.Capture(id, params)
	if err != nil {
		return nil, fmt.Errorf("stripe capture payment intent: %w", err)
	}
	return intentFrom(pi), nil
}

func (s *liveStripe) CancelPaymentIntent(ctx context.Context, id, key string) (*StripeIntent, error) {
	params := &stripe.PaymentIntentCancelParams{}
	params.Context = ctx
	if key != "" {
		params.SetIdempotencyKey(key)
	}
	pi, err := s.api.PaymentIntents.Cancel(id, params)
	if err != nil {
		return nil, fmt.Errorf("stripe cancel payment intent: %w", err)
	}
	return intentFrom(pi), nil
}

func (s *liveStripe) GetPaymentIntent(ctx context.Context, id string) (*StripeIntent, error) {
	params := &stripe.PaymentIntentParams{}
	params.Context = ctx
	pi, err := s.api.PaymentIntents.Get(id, params)
	if err != nil {
		return nil, fmt.Errorf("stripe get payment intent: %w", err)
	}
	return intentFrom(pi), nil
}

func (s *liveStripe) CreateSetupIntent(ctx context.Context, customerID, key string) (*StripeSetupIntent, error) {
	params := &stripe.SetupIntentParams{
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
	}
	params.Context = ctx
	if customerID != "" {
		params.Customer = stripe.String(customerID)
	}
	if key != "" {
		params.SetIdempotencyKey(key)
	}
	si, err := setupintent.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create setup intent: %w", err)
	}
	return &StripeSetupIntent{ID: si.ID, ClientSecret: si.ClientSecret}, nil
}

func (s *liveStripe) CreateRefund(ctx context.Context, in CreateRefundInput) (*StripeRefund, error) {
	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(in.StripePaymentIntentID),
	}
	params.Context = ctx
	if in.AmountCents > 0 {
		params.Amount = stripe.Int64(in.AmountCents)
	}
	if in.Reason != "" {
		params.Reason = stripe.String(in.Reason)
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}
	if in.RefundID != "" {
		params.AddMetadata("refund_id", in.RefundID)
	}
	rf, err := refund.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create refund: %w", err)
	}
	return &StripeRefund{ID: rf.ID, Status: string(rf.Status)}, nil
}

func (s *liveStripe) CreateConnectAccount(ctx context.Context, in CreateConnectInput) (*StripeAccount, error) {
	params := &stripe.AccountParams{
		Type:    stripe.String(string(stripe.AccountTypeExpress)),
		Country: stripe.String("CA"),
		Capabilities: &stripe.AccountCapabilitiesParams{
			Transfers: &stripe.AccountCapabilitiesTransfersParams{Requested: stripe.Bool(true)},
		},
		Settings: &stripe.AccountSettingsParams{
			Payouts: &stripe.AccountSettingsPayoutsParams{
				Schedule: &stripe.AccountSettingsPayoutsScheduleParams{
					Interval: stripe.String("manual"),
				},
			},
		},
	}
	params.Context = ctx
	if in.Email != "" {
		params.Email = stripe.String(in.Email)
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}
	params.AddMetadata("owner_type", in.OwnerType)
	params.AddMetadata("owner_id", in.OwnerID)
	acct, err := account.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create connect account: %w", err)
	}
	return accountFrom(acct), nil
}

func (s *liveStripe) CreateAccountLink(ctx context.Context, acctID, returnURL, refreshURL string) (*StripeAccountLink, error) {
	params := &stripe.AccountLinkParams{
		Account:    stripe.String(acctID),
		ReturnURL:  stripe.String(returnURL),
		RefreshURL: stripe.String(refreshURL),
		Type:       stripe.String("account_onboarding"),
	}
	params.Context = ctx
	link, err := accountlink.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create account link: %w", err)
	}
	return &StripeAccountLink{URL: link.URL, ExpiresAt: link.ExpiresAt}, nil
}

func (s *liveStripe) GetConnectAccount(ctx context.Context, acctID string) (*StripeAccount, error) {
	params := &stripe.AccountParams{}
	params.Context = ctx
	acct, err := account.GetByID(acctID, params)
	if err != nil {
		return nil, fmt.Errorf("stripe get connect account: %w", err)
	}
	return accountFrom(acct), nil
}

func (s *liveStripe) CreateTransfer(ctx context.Context, in CreateTransferInput) (*StripeTransfer, error) {
	params := &stripe.TransferParams{
		Amount:      stripe.Int64(in.AmountCents),
		Currency:    stripe.String(in.Currency),
		Destination: stripe.String(in.DestinationAcct),
	}
	params.Context = ctx
	if in.TransferGroup != "" {
		params.TransferGroup = stripe.String(in.TransferGroup)
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}
	if in.PayoutID != "" {
		params.AddMetadata("payout_id", in.PayoutID)
	}
	tr, err := transfer.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe create transfer: %w", err)
	}
	return &StripeTransfer{ID: tr.ID}, nil
}

func (s *liveStripe) FindTransfer(ctx context.Context, transferGroup string) (*StripeTransfer, error) {
	params := &stripe.TransferListParams{TransferGroup: stripe.String(transferGroup)}
	params.Context = ctx
	params.Limit = stripe.Int64(1)
	it := s.api.Transfers.List(params)
	if it.Next() {
		return &StripeTransfer{ID: it.Transfer().ID}, nil
	}
	if err := it.Err(); err != nil {
		return nil, fmt.Errorf("stripe find transfer: %w", err)
	}
	return nil, nil
}

func (s *liveStripe) VerifyWebhook(payload []byte, sig string) (StripeEvent, error) {
	ev, err := webhook.ConstructEvent(payload, sig, s.webhookSecret)
	if err != nil {
		return StripeEvent{}, fmt.Errorf("webhook signature verification failed: %w", err)
	}
	return eventFrom(&ev, payload), nil
}

func (s *liveStripe) ListEventsSince(ctx context.Context, since time.Time) ([]StripeEvent, error) {
	params := &stripe.EventListParams{
		CreatedRange: &stripe.RangeQueryParams{GreaterThanOrEqual: since.Unix()},
	}
	params.Context = ctx
	params.Limit = stripe.Int64(100) // page size; the iterator follows every page
	it := s.api.Events.List(params)
	var out []StripeEvent
	for it.Next() {
		ev := it.Event()
		// A listed event is the same JSON a webhook delivers; re-encoding it
		// gives the stored payload the shape ProcessStoredEvent parses.
		raw, err := json.Marshal(ev)
		if err != nil {
			return nil, fmt.Errorf("stripe list events: encode %s: %w", ev.ID, err)
		}
		out = append(out, eventFrom(ev, raw))
	}
	if err := it.Err(); err != nil {
		return nil, fmt.Errorf("stripe list events: %w", err)
	}
	// Stripe lists newest first. Replay oldest first, so each event lands on
	// the state the one before it left.
	slices.Reverse(out)
	return out, nil
}

func eventFrom(ev *stripe.Event, raw []byte) StripeEvent {
	out := StripeEvent{
		ID:         ev.ID,
		Type:       string(ev.Type),
		APIVersion: ev.APIVersion,
		LiveMode:   ev.Livemode,
		Created:    ev.Created,
		RawPayload: raw,
	}
	if ev.Data != nil {
		out.DataObject = ev.Data.Raw
	}
	return out
}

func intentFrom(pi *stripe.PaymentIntent) *StripeIntent {
	out := &StripeIntent{
		ID:                    pi.ID,
		Status:                string(pi.Status),
		AmountCents:           pi.Amount,
		AmountCapturableCents: pi.AmountCapturable,
		AmountReceivedCents:   pi.AmountReceived,
		Currency:              string(pi.Currency),
		ClientSecret:          pi.ClientSecret,
	}
	if pi.LastPaymentError != nil {
		out.FailureCode = string(pi.LastPaymentError.Code)
		out.FailureMessage = pi.LastPaymentError.Msg
		out.DeclineCode = string(pi.LastPaymentError.DeclineCode)
	}
	if ch := pi.LatestCharge; ch != nil && ch.PaymentMethodDetails != nil && ch.PaymentMethodDetails.Card != nil {
		card := ch.PaymentMethodDetails.Card
		out.CardBrand = string(card.Brand)
		out.CardLast4 = card.Last4
		out.CardCountry = card.Country
		if card.Wallet != nil {
			out.Wallet = string(card.Wallet.Type)
		}
	}
	return out
}

func accountFrom(acct *stripe.Account) *StripeAccount {
	out := &StripeAccount{
		ID:               acct.ID,
		ChargesEnabled:   acct.ChargesEnabled,
		PayoutsEnabled:   acct.PayoutsEnabled,
		DetailsSubmitted: acct.DetailsSubmitted,
	}
	if acct.Requirements != nil {
		out.CurrentlyDue = acct.Requirements.CurrentlyDue
		out.EventuallyDue = acct.Requirements.EventuallyDue
		out.PastDue = acct.Requirements.PastDue
		out.DisabledReason = string(acct.Requirements.DisabledReason)
		if acct.Requirements.CurrentDeadline != 0 {
			d := acct.Requirements.CurrentDeadline
			out.Deadline = &d
		}
	}
	return out
}
