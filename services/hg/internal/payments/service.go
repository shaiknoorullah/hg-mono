package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

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
	orders OrderHooks
}

// NewService builds the payments service.
func NewService(repo *Repo, sc StripeClient, cfg config.Stripe, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{repo: repo, stripe: sc, cfg: cfg, log: log, now: time.Now}
}

// OrderHooks is how a stored Stripe event moves an order. The orders module
// owns the order and its state machine; payments never writes "order"
// itself. The server wires it to the orders store (cmd/hg).
type OrderHooks interface {
	// PaymentAuthorised moves an order still waiting for its payment
	// (CREATED) to AUTHORIZED and on to RESTAURANT_PENDING, inside tx
	// (docs/spec/01-platform.md, "P-14 — Order lifecycle states and
	// transitions": created to authorised, then to restaurant pending). It
	// reports whether the order moved; an
	// order already past CREATED, or ended, is left as it is.
	PaymentAuthorised(ctx context.Context, tx pgx.Tx, orderID string) (bool, error)
}

// WithOrderHooks sets the hooks stored Stripe events move orders through.
// Without them an event still updates the payment, and the order is left to
// its own deadline.
func (s *Service) WithOrderHooks(h OrderHooks) *Service {
	s.orders = h
	return s
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
// the amount and liability split and records the request in REQUESTED, for a
// member of staff to review: a request moves no money, posts no ledger batch
// and is never sent to Stripe (docs/spec/02-customer.md, "C-37 — Refund
// requests and refund tracking": a request is created in REQUESTED, and at
// launch every one is human-reviewed, because approving them automatically
// without a fraud signal is an open cash tap). Until #318 nothing was sent, so
// a request written straight into AUTHORISED did no harm; now that approved
// refunds reach Stripe (refund_sender.go) it would pay out on the customer's
// word alone. Staff who decide a refund at once issue it through
// IssueAdminRefund, under their authority cap. The review of a request is
// #172.
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
	// It is computed now so the reviewer sees who would pay; the REFUND batch
	// is posted only when the refund is approved.
	itemNet := computed.AmountCents - computed.TaxCents
	split := ComputeLiabilitySplit(in.ReasonCode, computed.AmountCents, itemNet, money.RiderEarningsCents)

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
		State:           RefundRequested,
		RequestedBy:     requestedBy,
		DeadlineAction:  refundActionReview,
		Lines:           computed.Lines,
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

// scopeToKind maps the admin AdminRefundInput.scope onto the internal
// RefundKind. PARTIAL_ITEMS keeps its item semantics; PARTIAL_AMOUNT is only
// reachable for GOODWILL (guarded in the handler); FULL is a full refund. The
// FEES_ONLY kind has no scope of its own — an admin fee refund is expressed as
// a PARTIAL_AMOUNT with reason PLATFORM_ERROR is out of scope here; the three
// contract scopes map one-to-one onto the computed kinds.
func scopeToKind(scope RefundScope, reasonCode string) RefundKind {
	switch scope {
	case ScopeFull:
		return RefundFull
	case ScopePartialItems:
		return RefundPartialItems
	case ScopePartialAmount:
		if reasonCode == "GOODWILL" {
			return RefundGoodwill
		}
		// A non-goodwill PARTIAL_AMOUNT is a fees-only style computed refund.
		return RefundFeesOnly
	default:
		return RefundFull
	}
}

// operatorCap returns the trailing-24h authority cap for the highest role the
// operator holds. A SUPER_ADMIN is the terminal approver and is uncapped.
func operatorCap(roles []string) (cap int64, uncapped bool) {
	has := func(r string) bool {
		for _, x := range roles {
			if x == r {
				return true
			}
		}
		return false
	}
	switch {
	case has("SUPER_ADMIN"):
		return 0, true
	case has("ADMIN"):
		return CapAdminCents, false
	default:
		return CapSupportAgentCents, false
	}
}

// requiresApproval is the pure A-33 authority decision: does this refund need a
// second approver rather than immediate authorisation? A refund escalates when
// it would push the operator's trailing-24h issued total over their cap, or when
// it is a GOODWILL refund over the dual-approval threshold — regardless of the
// window, so the very first large goodwill of the day still gets a second pair
// of eyes. A SUPER_ADMIN (uncapped) still escalates a large goodwill, because
// the threshold is about the *nature* of the refund, not the operator's balance.
func requiresApproval(kind RefundKind, amount, issued24h, cap int64, uncapped bool) bool {
	if kind == RefundGoodwill && amount > GoodwillApprovalThresholdCents {
		return true
	}
	if uncapped {
		return false
	}
	return issued24h+amount > cap
}

// escalationRole returns the role that must approve an above-cap request by the
// given operator (one level up the authority ladder).
func escalationRole(roles []string) string {
	has := func(r string) bool {
		for _, x := range roles {
			if x == r {
				return true
			}
		}
		return false
	}
	if has("ADMIN") {
		return "SUPER_ADMIN"
	}
	return "ADMIN"
}

// IssueAdminRefund implements issueRefund (A-33 / P-18). It authorises under a
// rolling-24h cap BEFORE anything reaches Stripe. Amounts are server-computed
// for every scope except a GOODWILL PARTIAL_AMOUNT, which carries the sole
// allowlisted inbound amount (G-3). A request within the caller's cap is
// authorised: a balanced REFUND batch is posted and the refund enters AUTHORISED
// (201). A request above the caller's cap — or any GOODWILL over the dual-approval
// threshold — creates a PENDING_APPROVAL refund and escalates, returning the
// approval request (202); no refund is lost and no transfer is attempted.
//
// The returned bool reports whether an approval request (202) was created rather
// than an authorised refund (201).
func (s *Service) IssueAdminRefund(ctx context.Context, in AdminRefundInput, operatorID string, operatorRoles []string) (RefundDTO, RefundApprovalRequestDTO, bool, error) {
	var (
		zRefund   RefundDTO
		zApproval RefundApprovalRequestDTO
	)

	money, _, err := s.repo.GetOrderMoney(ctx, in.OrderID)
	if errors.Is(err, ErrNotFound) {
		return zRefund, zApproval, false, domainErr(httpxNotFound, 404, "No such order.")
	}
	if err != nil {
		return zRefund, zApproval, false, err
	}

	intent, err := s.repo.GetOrderIntent(ctx, in.OrderID)
	if errors.Is(err, ErrNotFound) {
		return zRefund, zApproval, false, domainErr(string(CodePaymentNotRefundable), 409, "This order has no payment.")
	}
	if err != nil {
		return zRefund, zApproval, false, err
	}
	if intent.AmountCapturedCents <= 0 {
		return zRefund, zApproval, false, domainErr(string(CodePaymentNotRefundable), 409,
			"This order was never captured; cancel it instead of refunding.")
	}

	kind := scopeToKind(in.Scope, in.ReasonCode)

	// Compute (or accept, for GOODWILL) the amount and split.
	prior, err := s.repo.PriorRefundedCents(ctx, nil, in.OrderID)
	if err != nil {
		return zRefund, zApproval, false, err
	}

	var (
		amount int64
		tax    int64
		lines  []RefundLineAmount
	)
	if kind == RefundGoodwill {
		// G-3: amount_cents is mandatory and is the only accepted amount here.
		amount = *in.AmountCents
		tax = 0
	} else {
		refLines := make([]RefundLineInput, 0, len(in.LineItems))
		for _, l := range in.LineItems {
			refLines = append(refLines, RefundLineInput{OrderLineNo: l.OrderLineNo, Quantity: l.Quantity})
		}
		orderLines, err := s.repo.GetOrderLines(ctx, in.OrderID)
		if err != nil {
			return zRefund, zApproval, false, err
		}
		computed, cerr := ComputeRefundAmount(money, kind, refLines, orderLines, prior)
		if cerr != nil {
			return zRefund, zApproval, false, domainErr("VALIDATION_FAILED", 422, cerr.Error())
		}
		amount = computed.AmountCents
		tax = computed.TaxCents
		lines = computed.Lines
	}

	if amount <= 0 {
		return zRefund, zApproval, false, domainErr("VALIDATION_FAILED", 422, "Refund amount must be positive.")
	}

	// I-18.1: an order's refunds may never exceed what was captured. This is
	// checked before the cap so an incoherent request fails fast, and again by
	// the deferred trigger at COMMIT.
	if prior+amount > intent.AmountCapturedCents {
		return zRefund, zApproval, false, domainErr(string(CodeRefundExceedsCaptured), 409,
			fmt.Sprintf("Refund of %d would exceed the captured %d (already refunded %d).",
				amount, intent.AmountCapturedCents, prior))
	}

	itemNet := amount - tax
	split := ComputeLiabilitySplit(in.ReasonCode, amount, itemNet, money.RiderEarningsCents)

	// Authority: sum the operator's trailing-24h issued refunds and add this one.
	cap, uncapped := operatorCap(operatorRoles)
	windowStart := s.now().Add(-24 * time.Hour)
	issued, err := s.repo.IssuedByOperatorSince(ctx, operatorID, windowStart)
	if err != nil {
		return zRefund, zApproval, false, err
	}
	note := in.ReasonText

	if requiresApproval(kind, amount, issued, cap, uncapped) {
		// Above authority: create a PENDING_APPROVAL refund (the approval request)
		// and escalate. No ledger batch is posted and no Stripe call is made — the
		// money only moves once an authorised approver acts (ApproveRefund). The
		// row keeps the role it was escalated to, which the approver must hold.
		required := escalationRole(operatorRoles)
		params := CreateRefundParams{
			OrderID:         in.OrderID,
			PaymentIntentID: intent.ID,
			Kind:            kind,
			Scope:           in.Scope,
			ReasonCode:      in.ReasonCode,
			Note:            note,
			AmountCents:     amount,
			TaxCents:        tax,
			Split:           split,
			State:           RefundPendingApproval,
			ApprovalStatus:  "PENDING",
			RequestedBy:     operatorID,
			RequiredRole:    required,
			DeadlineAction:  "await_refund_approval",
			Lines:           lines,
		}
		refundID, err := s.repo.CreateRefund(ctx, params)
		if err != nil {
			return zRefund, zApproval, false, err
		}
		return zRefund, RefundApprovalRequestDTO{
			ID:                  refundID,
			OrderID:             in.OrderID,
			ProposedAmountCents: amount,
			Currency:            intent.Currency,
			RequiredRole:        required,
			CaseID:              in.CaseID,
			Status:              "PENDING",
			RequestedAt:         tsFor(s.now()),
		}, true, nil
	}

	// Within authority: authorise immediately with a balanced REFUND batch.
	batch := BuildRefundBatch(money, split, amount,
		fmt.Sprintf("refund:%s:%d", in.OrderID, s.now().UnixNano()), "admin:"+operatorID)
	params := CreateRefundParams{
		OrderID:         in.OrderID,
		PaymentIntentID: intent.ID,
		Kind:            kind,
		Scope:           in.Scope,
		ReasonCode:      in.ReasonCode,
		Note:            note,
		AmountCents:     amount,
		TaxCents:        tax,
		Split:           split,
		State:           RefundAuthorised,
		ApprovalStatus:  "APPROVED",
		RequestedBy:     operatorID,
		ApprovedBy:      operatorID,
		DeadlineAction:  RefundActionSubmit,
		Lines:           lines,
		Ledger:          &batch,
		Money:           money,
	}
	refundID, err := s.repo.CreateRefund(ctx, params)
	if err != nil {
		return zRefund, zApproval, false, err
	}
	rr, err := s.repo.GetRefund(ctx, refundID)
	if err != nil {
		return zRefund, zApproval, false, err
	}
	return refundToDTO(rr), zApproval, false, nil
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
