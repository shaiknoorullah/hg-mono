package payments

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler serves the payments, refunds, connect, earnings and payout operations.
type Handler struct {
	svc       *Service
	envIsLive bool
}

// NewHandler builds the payments HTTP handler.
func NewHandler(svc *Service, cfg *config.Config) *Handler {
	return &Handler{svc: svc, envIsLive: cfg.Env == config.EnvProduction}
}

// isPrivileged reports whether the caller is support/admin, who may read any
// customer's payment or refund.
func isPrivileged(p httpx.Principal) bool {
	return p.HasRole(httpx.RoleSupportAgent) || p.HasRole(httpx.RoleAdmin) || p.HasRole(httpx.RoleSuperAdmin)
}

// fail maps a service error to the contract error envelope.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	var de *DomainError
	if errors.As(err, &de) {
		status := de.Status
		if status == 0 {
			status = http.StatusBadRequest
		}
		httpx.Fail(w, r, status, httpx.ErrorCode(de.Code), de.Message, nil)
		return
	}
	if errors.Is(err, ErrStripeNotConfigured) {
		httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeServiceUnavailable,
			"The payment provider is not configured.", nil)
		return
	}
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
		"The server failed to process this request.", nil)
}

// decodeJSON reads a JSON body, rejecting unknown fields so a client cannot
// smuggle a price-shaped field (G-3).
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

// ---------------------------------------------------------------------------
// Payment methods.
// ---------------------------------------------------------------------------

// ListPaymentMethods implements GET /v1/payment-methods.
func (h *Handler) ListPaymentMethods(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	methods, err := h.svc.ListPaymentMethods(r.Context(), p.AccountID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	total := int64(len(methods))
	httpx.RespondList(w, r, http.StatusOK, methods, httpx.Meta{HasMore: false, Total: &total})
}

// CreateSetupIntent implements POST /v1/payment-methods/setup-intent.
func (h *Handler) CreateSetupIntent(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	key, _ := httpx.IdempotencyKeyFrom(r.Context())
	si, err := h.svc.CreateSetupIntent(r.Context(), p.AccountID, key)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, si)
}

// DeletePaymentMethod implements DELETE /v1/payment-methods/{paymentMethodId}.
func (h *Handler) DeletePaymentMethod(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "paymentMethodId")
	if err := h.svc.DeletePaymentMethod(r.Context(), p.AccountID, id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetDefaultPaymentMethod implements POST /v1/payment-methods/{paymentMethodId}/default.
func (h *Handler) SetDefaultPaymentMethod(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "paymentMethodId")
	pm, err := h.svc.SetDefaultPaymentMethod(r.Context(), p.AccountID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, pm)
}

// ---------------------------------------------------------------------------
// Order payment.
// ---------------------------------------------------------------------------

// GetOrderPayment implements GET /v1/orders/{orderId}/payment.
func (h *Handler) GetOrderPayment(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	orderID := chi.URLParam(r, "orderId")
	dto, err := h.svc.GetOrderPayment(r.Context(), orderID, p.AccountID, isPrivileged(p))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, dto)
}

// ---------------------------------------------------------------------------
// Refunds.
// ---------------------------------------------------------------------------

// CreateRefund implements POST /v1/refunds.
func (h *Handler) CreateRefund(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	body, idem, err := readIdempotentBody(r, "/v1/refunds")
	if err != nil {
		invalidBody(w, r, err)
		return
	}
	var in RefundInput
	if err := decodeStrict(body, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is not valid.", []httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return
	}
	if in.OrderID == "" || in.Kind == "" || in.ReasonCode == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"order_id, kind and reason_code are required.", nil)
		return
	}
	// A non-admin customer may only refund their own order.
	if !isPrivileged(p) {
		owned, err := h.svc.repo.OrderOwnedBy(r.Context(), in.OrderID, p.AccountID)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		if !owned {
			httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such order.", nil)
			return
		}
	}
	out, err := h.svc.RequestRefundOnce(r.Context(), in, p.AccountID, idem)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeOutcome(w, r, out)
}

// ListRefunds implements GET /v1/refunds.
func (h *Handler) ListRefunds(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	q := r.URL.Query()
	f := ListRefundsFilter{
		OrderID: q.Get("order_id"),
		Limit:   atoiDefault(q.Get("limit"), 20),
		AfterID: q.Get("cursor"),
	}
	if states := q.Get("state"); states != "" {
		f.States = strings.Split(states, ",")
	}
	if !isPrivileged(p) {
		f.AccountID = p.AccountID
	}
	refunds, err := h.svc.ListRefunds(r.Context(), f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	meta := httpx.Meta{HasMore: len(refunds) == f.Limit}
	if len(refunds) > 0 && meta.HasMore {
		meta.NextCursor = &refunds[len(refunds)-1].ID
	}
	httpx.RespondList(w, r, http.StatusOK, refunds, meta)
}

// GetRefund implements GET /v1/refunds/{refundId}.
func (h *Handler) GetRefund(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "refundId")
	dto, err := h.svc.GetRefund(r.Context(), id, p.AccountID, isPrivileged(p))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, dto)
}

// IssueRefund implements POST /v1/admin/refunds (issueRefund). A-33 / P-18.
//
// The authority check runs before anything reaches Stripe: within the caller's
// rolling-24h cap the refund is authorised (201 Refund); above it, an approval
// request is created and the case escalated (202 RefundApprovalRequest) — the
// customer's request is never lost. amount_cents is accepted ONLY for a GOODWILL
// PARTIAL_AMOUNT (G-3); anywhere else it is 422 UNKNOWN_FIELD.
func (h *Handler) IssueRefund(w http.ResponseWriter, r *http.Request) {
	body, idem, err := readIdempotentBody(r, "/v1/admin/refunds")
	if err != nil {
		invalidBody(w, r, err)
		return
	}
	var in AdminRefundInput
	if err := decodeStrict(body, &in); err != nil {
		invalidBody(w, r, err)
		return
	}
	// Required fields (AdminRefundInput.required).
	if in.OrderID == "" || in.Scope == "" || in.ReasonCode == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"order_id, scope and reason_code are required.", nil)
		return
	}
	if n := len(in.ReasonText); n < 10 || n > 1000 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"reason_text must be 10–1000 characters.",
			[]httpx.FieldError{{Field: "reason_text", Code: "length", Message: "must be 10–1000 characters"}})
		return
	}
	// G-3: amount_cents is the single staff-side inbound monetary field, allowed
	// solely with scope PARTIAL_AMOUNT and reason_code GOODWILL. Any other use of
	// it is a 422 UNKNOWN_FIELD — the field is treated as if it does not exist.
	goodwill := in.Scope == ScopePartialAmount && in.ReasonCode == "GOODWILL"
	if in.AmountCents != nil && !goodwill {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.ErrorCode(CodeUnknownField),
			"amount_cents is accepted only for a GOODWILL PARTIAL_AMOUNT refund.",
			[]httpx.FieldError{{Field: "amount_cents", Code: "unknown", Message: "not accepted for this scope/reason"}})
		return
	}
	if goodwill {
		if in.AmountCents == nil || *in.AmountCents <= 0 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"amount_cents is required and must be positive for a GOODWILL refund.", nil)
			return
		}
	}
	// PARTIAL_ITEMS must carry line_items.
	if in.Scope == ScopePartialItems && len(in.LineItems) == 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"line_items are required for a PARTIAL_ITEMS refund.", nil)
		return
	}

	// Within the caller's cap: the authorised refund, 201. Above it: the
	// approval request, 202 Accepted. A replay: the first answer.
	out, err := h.svc.IssueAdminRefund(r.Context(), in, StaffFrom(r), idem)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeOutcome(w, r, out)
}

// ---------------------------------------------------------------------------
// Stripe webhook (public, signature-verified).
// ---------------------------------------------------------------------------

// ReceiveStripeWebhook implements POST /v1/webhooks/stripe. It reads the raw
// body (the signature is over the raw bytes), verifies, and store-then-process
// acknowledges within the request (P-17).
func (h *Handler) ReceiveStripeWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed, "Unreadable body.", nil)
		return
	}
	sig := r.Header.Get("Stripe-Signature")
	res, err := h.svc.ReceiveWebhook(r.Context(), payload, sig, h.envIsLive)
	if err != nil {
		var de *DomainError
		if errors.As(err, &de) {
			// A signature or livemode failure is a 400; the body is not logged.
			httpx.Fail(w, r, de.Status, httpx.ErrorCode(de.Code), de.Message, nil)
			return
		}
		h.fail(w, r, err)
		return
	}
	// AcknowledgementResponse: {"data": {"acknowledged": true}}. Duplicate and
	// first delivery both answer 200 (acceptance 1).
	httpx.Respond(w, r, http.StatusOK, AcknowledgementDTO{Acknowledged: res.Acknowledged})
}

// ---------------------------------------------------------------------------
// Connect.
// ---------------------------------------------------------------------------

// ownerFromPrincipal resolves the (owner_type, owner_id) a partner principal
// acts as. Riders act as RIDER/account_id; restaurant staff act as RESTAURANT,
// but the restaurant id is resolved from the session by the restaurant module —
// here we fall back to the account id, which the auth sibling will refine.
func ownerFromPrincipal(p httpx.Principal) (string, string) {
	if p.HasRole(httpx.RoleRider) {
		return "RIDER", p.AccountID
	}
	return "RESTAURANT", p.AccountID
}

// CreateConnectAccount implements POST /v1/connect/account.
func (h *Handler) CreateConnectAccount(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	ownerType, ownerID := ownerFromPrincipal(p)
	key, _ := httpx.IdempotencyKeyFrom(r.Context())
	// Approval is enforced by the onboarding module before this route is
	// reachable; the guard already restricted the roles. Pass approved=true.
	dto, err := h.svc.CreateConnectAccount(r.Context(), ownerType, ownerID, "", true, key)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, dto)
}

// CreateOnboardingLink implements POST /v1/connect/onboarding-link.
func (h *Handler) CreateOnboardingLink(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	ownerType, ownerID := ownerFromPrincipal(p)
	dto, err := h.svc.CreateOnboardingLink(r.Context(), ownerType, ownerID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, dto)
}

// GetConnectStatus implements GET /v1/connect/status.
func (h *Handler) GetConnectStatus(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	ownerType, ownerID := ownerFromPrincipal(p)
	dto, err := h.svc.GetConnectStatus(r.Context(), ownerType, ownerID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, dto)
}

// ---------------------------------------------------------------------------
// Earnings & payouts.
// ---------------------------------------------------------------------------

// GetRiderEarningsSummary implements GET /v1/riders/me/earnings/summary.
func (h *Handler) GetRiderEarningsSummary(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	q := r.URL.Query()
	period := q.Get("period")
	if period == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "period is required.", nil)
		return
	}
	from, to := earningsWindow(period, q.Get("from"), q.Get("to"))
	dto, err := h.svc.EarningsSummary(r.Context(), p.AccountID, period, "America/Toronto", from, to)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, dto)
}

// ListRiderEarningEntries implements GET /v1/riders/me/earnings/entries.
func (h *Handler) ListRiderEarningEntries(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	q := r.URL.Query()
	f := ListEarningEntriesFilter{
		AccountID: p.AccountID,
		Limit:     atoiDefault(q.Get("limit"), 20),
		AfterID:   q.Get("cursor"),
	}
	if t := q.Get("type"); t != "" {
		f.Types = strings.Split(t, ",")
	}
	entries, err := h.svc.ListEarningEntries(r.Context(), f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	meta := httpx.Meta{HasMore: len(entries) == f.Limit}
	if len(entries) > 0 && meta.HasMore {
		meta.NextCursor = &entries[len(entries)-1].ID
	}
	httpx.RespondList(w, r, http.StatusOK, entries, meta)
}

// ListRiderPayouts implements GET /v1/riders/me/payouts.
func (h *Handler) ListRiderPayouts(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	h.listPayouts(w, r, "RIDER", p.AccountID)
}

// ListRestaurantPayouts implements GET /v1/restaurant/payouts.
func (h *Handler) ListRestaurantPayouts(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	_, ownerID := ownerFromPrincipal(p)
	h.listPayouts(w, r, "RESTAURANT", ownerID)
}

func (h *Handler) listPayouts(w http.ResponseWriter, r *http.Request, ownerType, ownerID string) {
	q := r.URL.Query()
	f := ListPayoutsFilter{
		OwnerType: ownerType,
		OwnerID:   ownerID,
		Limit:     atoiDefault(q.Get("limit"), 20),
		AfterID:   q.Get("cursor"),
	}
	payouts, err := h.svc.ListPayouts(r.Context(), f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	meta := httpx.Meta{HasMore: len(payouts) == f.Limit}
	if len(payouts) > 0 && meta.HasMore {
		meta.NextCursor = &payouts[len(payouts)-1].ID
	}
	httpx.RespondList(w, r, http.StatusOK, payouts, meta)
}

// GetRiderPayout implements GET /v1/riders/me/payouts/{payoutId}.
func (h *Handler) GetRiderPayout(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "payoutId")
	dto, err := h.svc.GetPayoutDetail(r.Context(), "RIDER", p.AccountID, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, dto)
}

// atoiDefault parses n or returns def.
func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// earningsWindow computes a [from, to) window for the summary from the query
// params, defaulting to a sensible span per period ending now.
func earningsWindow(period, fromStr, toStr string) (time.Time, time.Time) {
	now := time.Now().UTC()
	to := now
	if toStr != "" {
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			to = t.AddDate(0, 0, 1)
		}
	}
	var from time.Time
	switch period {
	case "DAY":
		from = to.AddDate(0, 0, -7)
	case "MONTH":
		from = to.AddDate(0, -12, 0)
	default: // WEEK
		from = to.AddDate(0, 0, -7*8)
	}
	if fromStr != "" {
		if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			from = t
		}
	}
	return from, to
}
