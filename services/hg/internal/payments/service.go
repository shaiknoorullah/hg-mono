package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Service is the payments domain facade. HTTP handlers call it; it owns the
// Repo and the StripeClient and enforces the P-16..P-21 rules. It never reads an
// *http.Request and never trusts a client-supplied amount.
type Service struct {
	repo   *Repo
	stripe StripeClient
	cfg    config.Stripe
	log    *slog.Logger
	now    func() time.Time
}

// NewService builds the payments service.
func NewService(repo *Repo, sc StripeClient, cfg config.Stripe, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{repo: repo, stripe: sc, cfg: cfg, log: log, now: time.Now}
}

// DomainError carries an error code the handler maps to an HTTP status.
type DomainError struct {
	Code    string
	Status  int
	Message string
}

func (e *DomainError) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func domainErr(code string, status int, msg string) *DomainError {
	return &DomainError{Code: code, Status: status, Message: msg}
}

// ---------------------------------------------------------------------------
// Payment methods (C-24).
// ---------------------------------------------------------------------------

// ListPaymentMethods returns a customer's saved cards.
func (s *Service) ListPaymentMethods(ctx context.Context, accountID string) ([]PaymentMethodDTO, error) {
	return s.repo.ListPaymentMethods(ctx, accountID)
}

// CreateSetupIntent begins saving a card. It refuses at the C-24 cap of five.
func (s *Service) CreateSetupIntent(ctx context.Context, accountID, idempotencyKey string) (SetupIntentDTO, error) {
	if s.stripe == nil {
		return SetupIntentDTO{}, ErrStripeNotConfigured
	}
	n, err := s.repo.CountPaymentMethods(ctx, accountID)
	if err != nil {
		return SetupIntentDTO{}, err
	}
	if n >= MaxSavedCards {
		return SetupIntentDTO{}, domainErr(string(CodePaymentMethodLimit), 409,
			"You already have the maximum of five saved cards.")
	}
	customerID, err := s.repo.StripeCustomerID(ctx, accountID)
	if err != nil {
		return SetupIntentDTO{}, err
	}
	si, err := s.stripe.CreateSetupIntent(ctx, customerID, idempotencyKey)
	if err != nil {
		return SetupIntentDTO{}, err
	}
	return SetupIntentDTO{ClientSecret: si.ClientSecret}, nil
}

// DeletePaymentMethod soft-deletes a saved card, guarding in-use cards.
func (s *Service) DeletePaymentMethod(ctx context.Context, accountID, methodID string) error {
	owned, err := s.repo.PaymentMethodOwned(ctx, accountID, methodID)
	if err != nil {
		return err
	}
	if !owned {
		return domainErr(string(httpxNotFound), 404, "No such payment method.")
	}
	inUse, err := s.repo.PaymentMethodInUse(ctx, accountID, methodID)
	if err != nil {
		return err
	}
	if inUse {
		return domainErr(string(CodePaymentMethodInUse), 409,
			"This card backs an order that is still in progress and cannot be removed.")
	}
	return s.repo.SoftDeletePaymentMethod(ctx, accountID, methodID)
}

// SetDefaultPaymentMethod makes a card the account default.
func (s *Service) SetDefaultPaymentMethod(ctx context.Context, accountID, methodID string) (PaymentMethodDTO, error) {
	pm, err := s.repo.SetDefaultPaymentMethod(ctx, accountID, methodID)
	if errors.Is(err, ErrNotFound) {
		return PaymentMethodDTO{}, domainErr(string(httpxNotFound), 404, "No such payment method.")
	}
	return pm, err
}

// httpxNotFound mirrors the contract NOT_FOUND code without importing httpx here
// for a single constant; the handler translates it.
const httpxNotFound = "NOT_FOUND"

// ---------------------------------------------------------------------------
// Order payment state (P-16).
// ---------------------------------------------------------------------------

// GetOrderPayment reports the authoritative payment state for an order. It
// re-issues the client_secret only while the intent still requires an action.
func (s *Service) GetOrderPayment(ctx context.Context, orderID, accountID string, isPrivileged bool) (OrderPaymentDTO, error) {
	if !isPrivileged {
		owned, err := s.repo.OrderOwnedBy(ctx, orderID, accountID)
		if err != nil {
			return OrderPaymentDTO{}, err
		}
		if !owned {
			return OrderPaymentDTO{}, domainErr(httpxNotFound, 404, "No such order.")
		}
	}
	i, err := s.repo.GetOrderIntent(ctx, orderID)
	if errors.Is(err, ErrNotFound) {
		return OrderPaymentDTO{}, domainErr(httpxNotFound, 404, "No payment for this order.")
	}
	if err != nil {
		return OrderPaymentDTO{}, err
	}
	dto := OrderPaymentDTO{
		OrderID:               i.OrderID,
		State:                 i.State,
		Kind:                  i.Kind,
		AmountAuthorizedCents: i.AmountAuthorizedCents,
		AmountCapturedCents:   i.AmountCapturedCents,
		AmountRefundedCents:   i.AmountRefundedCents,
		Currency:              i.Currency,
		CardBrand:             strPtr(i.CardBrand),
		CardLast4:             strPtr(i.CardLast4),
		Wallet:                strPtr(i.Wallet),
		FailureCode:           strPtr(i.FailureCode),
		DeclineCode:           strPtr(i.DeclineCode),
		AuthorizedAt:          tsPtr(i.AuthorizedAt),
		CapturedAt:            tsPtr(i.CapturedAt),
	}
	// Re-issue the client secret only while a challenge is outstanding, by
	// reading it live from Stripe (P-16: resume a 3-D Secure challenge).
	if PaymentState(i.State) == StateRequiresAction && s.stripe != nil {
		if pi, err := s.stripe.GetPaymentIntent(ctx, i.StripePaymentIntentID); err == nil {
			dto.ClientSecret = strPtr(pi.ClientSecret)
		}
	}
	return dto, nil
}

// ---------------------------------------------------------------------------
// Refunds (P-18).
// ---------------------------------------------------------------------------

// RequestRefund handles POST /v1/refunds for the non-GOODWILL kinds. It computes
// the amount and liability split, writes the refund and its balanced ledger
// batch in one transaction (transactional compensation), and returns the refund.
// The Stripe Refund.create call is performed by the deadline runner from the
// AUTHORISED state so a slow or failing provider never rolls back the ledger.
func (s *Service) RequestRefund(ctx context.Context, in RefundInput, requestedBy string) (RefundDTO, error) {
	if in.Kind == RefundGoodwill {
		// GOODWILL carries an amount and is admin-only; it is not created here.
		return RefundDTO{}, domainErr(string(CodePaymentNotRefundable), 422,
			"GOODWILL refunds are issued through the admin endpoint.")
	}

	money, _, err := s.repo.GetOrderMoney(ctx, in.OrderID)
	if errors.Is(err, ErrNotFound) {
		return RefundDTO{}, domainErr(httpxNotFound, 404, "No such order.")
	}
	if err != nil {
		return RefundDTO{}, err
	}

	intent, err := s.repo.GetOrderIntent(ctx, in.OrderID)
	if errors.Is(err, ErrNotFound) {
		return RefundDTO{}, domainErr(string(CodePaymentNotRefundable), 409, "This order has no captured payment.")
	}
	if err != nil {
		return RefundDTO{}, err
	}
	// A refund is only meaningful post-capture (P-18 / I-18.5). Pre-capture is a
	// void via cancelOrder, a different path entirely.
	if intent.AmountCapturedCents <= 0 {
		return RefundDTO{}, domainErr(string(CodePaymentNotRefundable), 409,
			"This order was never captured; cancel it instead of refunding.")
	}

	lines, err := s.repo.GetOrderLines(ctx, in.OrderID)
	if err != nil {
		return RefundDTO{}, err
	}
	prior, err := s.repo.PriorRefundedCents(ctx, nil, in.OrderID)
	if err != nil {
		return RefundDTO{}, err
	}

	computed, err := ComputeRefundAmount(money, in.Kind, in.Lines, lines, prior)
	if err != nil {
		return RefundDTO{}, domainErr("VALIDATION_FAILED", 422, err.Error())
	}

	// I-18.1: the sum of an order's refunds may never exceed what was captured.
	if prior+computed.AmountCents > intent.AmountCapturedCents {
		return RefundDTO{}, domainErr(string(CodeRefundExceedsCaptured), 409,
			fmt.Sprintf("Refund of %d would exceed the captured %d (already refunded %d).",
				computed.AmountCents, intent.AmountCapturedCents, prior))
	}

	// Liability split: item-fault reasons charge the restaurant its item net.
	itemNet := computed.AmountCents - computed.TaxCents
	split := ComputeLiabilitySplit(in.ReasonCode, computed.AmountCents, itemNet, money.RiderEarningsCents)

	// The refund enters AUTHORISED with a balanced REFUND ledger batch already
	// posted: the money movement is a database fact before Stripe is called.
	batch := BuildRefundBatch(money, split, computed.AmountCents,
		fmt.Sprintf("refund:%s:%d", in.OrderID, s.now().UnixNano()), "system:refund")

	params := CreateRefundParams{
		OrderID:         in.OrderID,
		PaymentIntentID: intent.ID,
		Kind:            in.Kind,
		Scope:           computed.Scope,
		ReasonCode:      in.ReasonCode,
		Note:            in.Note,
		AmountCents:     computed.AmountCents,
		TaxCents:        computed.TaxCents,
		Split:           split,
		State:           RefundAuthorised,
		RequestedBy:     requestedBy,
		DeadlineAction:  "submit_refund_to_stripe",
		Lines:           computed.Lines,
		Ledger:          &batch,
		Money:           money,
	}
	refundID, err := s.repo.CreateRefund(ctx, params)
	if err != nil {
		return RefundDTO{}, err
	}

	rr, err := s.repo.GetRefund(ctx, refundID)
	if err != nil {
		return RefundDTO{}, err
	}
	return refundToDTO(rr), nil
}

// GetRefund reads one refund, enforcing customer ownership unless privileged.
func (s *Service) GetRefund(ctx context.Context, id, accountID string, isPrivileged bool) (RefundDTO, error) {
	rr, err := s.repo.GetRefund(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return RefundDTO{}, domainErr(httpxNotFound, 404, "No such refund.")
	}
	if err != nil {
		return RefundDTO{}, err
	}
	if !isPrivileged {
		owned, err := s.repo.OrderOwnedBy(ctx, rr.OrderID, accountID)
		if err != nil {
			return RefundDTO{}, err
		}
		if !owned {
			return RefundDTO{}, domainErr(httpxNotFound, 404, "No such refund.")
		}
	}
	return refundToDTO(rr), nil
}

// ListRefunds returns refunds visible to the caller.
func (s *Service) ListRefunds(ctx context.Context, f ListRefundsFilter) ([]RefundDTO, error) {
	rows, err := s.repo.ListRefunds(ctx, f)
	if err != nil {
		return nil, err
	}
	out := make([]RefundDTO, 0, len(rows))
	for _, rr := range rows {
		out = append(out, refundToDTO(rr))
	}
	return out, nil
}

func refundToDTO(rr RefundRow) RefundDTO {
	dto := RefundDTO{
		ID:          rr.ID,
		OrderID:     rr.OrderID,
		Kind:        rr.Kind,
		Scope:       strPtr(rr.Scope),
		ReasonCode:  rr.ReasonCode,
		AmountCents: rr.AmountCents,
		TaxCents:    rr.TaxCents,
		Currency:    rr.Currency,
		State:       rr.State,
		LiabilitySplit: &RefundLiabilitySplitDTO{
			PlatformCents:   rr.PlatformAbsorb,
			RestaurantCents: rr.RestaurantCB,
			RiderCents:      rr.RiderCB,
		},
		Note:           strPtr(rr.Note),
		RequestedAt:    tsFor(rr.RequestedAt),
		SettledAt:      tsPtr(rr.SettledAt),
		FailureMessage: strPtr(rr.FailureMessage),
	}
	return dto
}

// tsFor renders a non-nullable timestamp.
func tsFor(t time.Time) string {
	s := tsPtr(&t)
	return *s
}
