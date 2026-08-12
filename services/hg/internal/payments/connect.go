package payments

import (
	"context"
	"errors"
	"time"
)

// Stripe Connect onboarding (P-19). Express connected accounts, country CA,
// transfers-only capability, manual payout schedule so the platform controls
// timing. The partner must be admin-approved first; that check is the caller's
// (the onboarding module passes approved=true).

// CreateConnectAccount creates the Express account and stores connect_account.
// It is idempotent on (owner_type, owner_id): a second call returns the existing
// account rather than creating a duplicate at Stripe.
func (s *Service) CreateConnectAccount(ctx context.Context, ownerType, ownerID, email string, approved bool, idempotencyKey string) (ConnectStatusDTO, error) {
	if s.stripe == nil {
		return ConnectStatusDTO{}, ErrStripeNotConfigured
	}
	if !approved {
		return ConnectStatusDTO{}, domainErr(string(CodeStepNotAvailable), 409,
			"The partner must be approved before creating a payout account.")
	}
	if existing, err := s.repo.GetConnectAccount(ctx, ownerType, ownerID); err == nil {
		return s.connectStatusFrom(existing), nil
	} else if !errors.Is(err, ErrNotFound) {
		return ConnectStatusDTO{}, err
	}

	acct, err := s.stripe.CreateConnectAccount(ctx, CreateConnectInput{
		Email:          email,
		OwnerType:      ownerType,
		OwnerID:        ownerID,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return ConnectStatusDTO{}, err
	}
	if err := s.repo.InsertConnectAccount(ctx, ownerType, ownerID, acct); err != nil {
		return ConnectStatusDTO{}, err
	}
	row, err := s.repo.GetConnectAccount(ctx, ownerType, ownerID)
	if err != nil {
		return ConnectStatusDTO{}, err
	}
	return s.connectStatusFrom(row), nil
}

func (s *Service) connectStatusFrom(c ConnectRow) ConnectStatusDTO {
	return ConnectStatusDTO{
		StripeAccountID:  strPtr(c.StripeAccountID),
		ChargesEnabled:   c.ChargesEnabled,
		PayoutsEnabled:   c.PayoutsEnabled,
		DetailsSubmitted: c.DetailsSubmitted,
		Requirements: ConnectRequirementsDTO{
			CurrentlyDue:   nonNil(c.CurrentlyDue),
			EventuallyDue:  nonNil(c.EventuallyDue),
			PastDue:        nonNil(c.PastDue),
			DisabledReason: c.DisabledReason,
		},
		PayoutInterval: c.PayoutInterval,
	}
}

// CreateOnboardingLink mints a fresh Stripe AccountLink. The return and refresh
// URLs are server-generated from configuration; the client cannot supply them
// (P-19). A partner with no account yet gets STEP_NOT_AVAILABLE.
func (s *Service) CreateOnboardingLink(ctx context.Context, ownerType, ownerID string) (ConnectOnboardingLinkDTO, error) {
	if s.stripe == nil {
		return ConnectOnboardingLinkDTO{}, ErrStripeNotConfigured
	}
	c, err := s.repo.GetConnectAccount(ctx, ownerType, ownerID)
	if errors.Is(err, ErrNotFound) {
		return ConnectOnboardingLinkDTO{}, domainErr(string(CodeStepNotAvailable), 409,
			"Create the payout account before requesting an onboarding link.")
	}
	if err != nil {
		return ConnectOnboardingLinkDTO{}, err
	}
	returnURL := s.cfg.ConnectReturnURL
	refreshURL := s.cfg.ConnectRefreshURL
	if returnURL == "" || refreshURL == "" {
		return ConnectOnboardingLinkDTO{}, domainErr(string(CodeStepNotAvailable), 409,
			"Connect onboarding URLs are not configured.")
	}
	link, err := s.stripe.CreateAccountLink(ctx, c.StripeAccountID, returnURL, refreshURL)
	if err != nil {
		return ConnectOnboardingLinkDTO{}, err
	}
	return ConnectOnboardingLinkDTO{
		URL:       link.URL,
		ExpiresAt: tsFor(time.Unix(link.ExpiresAt, 0).UTC()),
	}, nil
}
