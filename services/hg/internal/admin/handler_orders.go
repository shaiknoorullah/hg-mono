package admin

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// ListOrdersAdmin implements listOrdersAdmin (A-38).
// GET /v1/admin/orders
// Roles: SUPPORT_AGENT, ADMIN, SUPER_ADMIN — enforced by the Policy in routes.go.
// No ownership filter: staff see all orders.
func (h *Handler) ListOrdersAdmin(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)
	stateFilter := r.URL.Query().Get("state")

	// Cursor: encode as placed_at + id (dual-column keyset).
	var cursorTime *time.Time
	var cursorID *string
	if rawCursor := r.URL.Query().Get("cursor"); rawCursor != "" {
		ct, cid, ok := decodeTimeCursor(r)
		if !ok {
			fieldFail(w, r, "cursor", "malformed cursor")
			return
		}
		cursorTime = ct
		cursorID = cid
	}

	rows, err := h.ordersRepo.ListOrders(r.Context(), stateFilter, limit, cursorTime, cursorID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	out := make([]adminOrderSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, adminOrderSummary{
			ID:    row.ID,
			Code:  row.Code,
			State: row.State,
			Restaurant: adminOrderRestaurant{
				ID:   row.RestaurantID,
				Name: row.RestaurantName,
			},
			TotalCents: row.TotalCents,
			Currency:   row.Currency,
			PlacedAt:   httpx.Timestamp(row.PlacedAt),
		})
	}

	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		meta.NextCursor = ptr(encodeTimeCursor(last.PlacedAt, last.ID))
	}
	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// GetOrderAdmin implements getOrderAdmin (A-38).
// GET /v1/admin/orders/{orderId}
// Roles: SUPPORT_AGENT, ADMIN, SUPER_ADMIN.
// No account filter: admin always sees any order (IDOR: missing order → 404).
func (h *Handler) GetOrderAdmin(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")

	// reveal_pii requires a justification (query param or header). If reveal_pii
	// is true but no justification is provided, return 422.
	revealPII := r.URL.Query().Get("reveal_pii") == "true"
	if revealPII {
		justification := r.URL.Query().Get("justification")
		if justification == "" {
			fieldFail(w, r, "justification",
				"justification is required when reveal_pii=true (audit requirement A-38)")
			return
		}
	}

	row, err := h.ordersRepo.GetOrder(r.Context(), orderID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"No such order.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}

	out := buildAdminOrderView(row, revealPII)
	httpx.Respond(w, r, http.StatusOK, out)
}

// CancelOrderAdmin implements cancelOrderAdmin (A-38).
// POST /v1/admin/orders/{orderId}/cancel
// Roles: SUPPORT_AGENT, ADMIN, SUPER_ADMIN.
// MONEY class — requires Idempotency-Key (enforced by middleware via Policy.Idempotent).
//
// Actor rules (spec A-38):
//   - SUPPORT_AGENT may cancel pre-acceptance only (CREATED, AUTHORIZED, RESTAURANT_PENDING).
//   - ADMIN / SUPER_ADMIN may cancel any cancellable state (T11: PREPARING→CANCELLED).
func (h *Handler) CancelOrderAdmin(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")

	var in cancelOrderAdminInput
	if !decodeJSON(w, r, &in) {
		return
	}

	// Required field validation.
	if in.ReasonCode == "" || in.ReasonText == "" || in.CaseID == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
			"reason_code, reason_text and case_id are required.", nil)
		return
	}
	if len([]rune(in.ReasonText)) < 10 {
		fieldFail(w, r, "reason_text", "reason_text must be at least 10 characters")
		return
	}

	// Determine the actor's privilege level from the principal.
	p := httpx.PrincipalFrom(r.Context())
	isAdminOrAbove := p.HasRole(httpx.RoleAdmin) || p.HasRole(httpx.RoleSuperAdmin)

	// For SUPPORT_AGENT: pre-acceptance only. We check the order's current state.
	if !isAdminOrAbove {
		// Load the order just to check state; don't reveal existence on auth fail.
		row, err := h.ordersRepo.GetOrder(r.Context(), orderID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
				return
			}
			h.failInternal(w, r, err)
			return
		}
		// Pre-acceptance states: CREATED, AUTHORIZED, RESTAURANT_PENDING.
		preAcceptance := row.State == "CREATED" || row.State == "AUTHORIZED" || row.State == "RESTAURANT_PENDING"
		if !preAcceptance {
			httpx.Fail(w, r, http.StatusForbidden, CodeForbidden,
				"Support agents may cancel pre-acceptance orders only; escalate to an admin for post-acceptance cancellation.",
				nil)
			return
		}
	}

	actor := actorFrom(r)
	result, err := h.ordersRepo.CancelOrder(r.Context(), actor, orderID, "SUPPORT_CANCELLED", in)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
			return
		}
		var illegalErr *orders.IllegalTransitionError
		if errors.As(err, &illegalErr) {
			httpx.Fail(w, r, http.StatusConflict, CodeIllegalTransition,
				"The order cannot be cancelled in its current state.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}

	out := buildAdminOrderView(result, false)
	httpx.Respond(w, r, http.StatusOK, out)
}

// buildAdminOrderView converts an adminOrderRow to the wire adminOrderView.
func buildAdminOrderView(row *adminOrderRow, piiRevealed bool) adminOrderView {
	lines := make([]adminOrderLine, 0, len(row.Lines))
	for _, l := range row.Lines {
		lines = append(lines, adminOrderLine{
			LineNo:         l.LineNo,
			MenuItemID:     l.MenuItemID,
			Name:           l.Name,
			VariantName:    l.VariantName,
			Quantity:       l.Quantity,
			SpecialRequest: l.SpecialRequest,
			UnitPriceCents: l.UnitPriceCents,
			LineTotalCents: l.LineTotalCents,
			Currency:       l.Currency,
		})
	}

	timeline := make([]adminTransitionEntry, 0, len(row.Transitions))
	for _, t := range row.Transitions {
		timeline = append(timeline, adminTransitionEntry{
			FromState: t.FromState,
			ToState:   t.ToState,
			ActorKind: t.ActorKind,
			Reason:    t.Reason,
			At:        httpx.Timestamp(t.OccurredAt),
		})
	}

	// Payment: project the real payment_intent when present; otherwise a valid
	// zero-amount OrderPayment (all six required fields present).
	var payment adminOrderPayment
	if row.Payment != nil {
		p := row.Payment
		payment = adminOrderPayment{
			OrderID:               row.ID,
			State:                 p.State,
			Kind:                  p.Kind,
			AmountAuthorizedCents: p.AmountAuthorizedCents,
			AmountCapturedCents:   p.AmountCapturedCents,
			AmountRefundedCents:   p.AmountRefundedCents,
			Currency:              p.Currency,
			CardBrand:             p.CardBrand,
			CardLast4:             p.CardLast4,
			Wallet:                p.Wallet,
			FailureCode:           p.FailureCode,
			DeclineCode:           p.DeclineCode,
			AuthorizedAt:          tsPtr(p.AuthorizedAt),
			CapturedAt:            tsPtr(p.CapturedAt),
		}
	} else {
		payment = adminOrderPayment{
			OrderID:               row.ID,
			State:                 "REQUIRES_PAYMENT_METHOD",
			AmountAuthorizedCents: 0,
			AmountCapturedCents:   0,
			AmountRefundedCents:   0,
			Currency:              row.Currency,
		}
	}

	refunds := make([]adminRefund, 0, len(row.Refunds))
	for _, rf := range row.Refunds {
		refunds = append(refunds, adminRefund{
			ID:          rf.ID,
			OrderID:     row.ID,
			Kind:        rf.Kind,
			Scope:       rf.Scope,
			ReasonCode:  rf.ReasonCode,
			AmountCents: rf.AmountCents,
			TaxCents:    rf.TaxCents,
			Currency:    rf.Currency,
			State:       rf.State,
			Note:        rf.Note,
			RequestedAt: httpx.Timestamp(rf.RequestedAt),
			SettledAt:   tsPtr(rf.SettledAt),
		})
	}

	return adminOrderView{
		ID:    row.ID,
		Code:  row.Code,
		State: row.State,
		Restaurant: adminOrderRestaurant{
			ID:   row.RestaurantID,
			Name: row.RestaurantName,
		},
		Lines: lines,
		Money: adminOrderMoney{
			SubtotalCents:    row.SubtotalCents,
			DiscountCents:    row.DiscountCents,
			DeliveryFeeCents: row.DeliveryFeeCents,
			ServiceFeeCents:  row.ServiceFeeCents,
			TaxTotalCents:    row.TaxTotalCents,
			TipCents:         row.TipCents,
			TotalCents:       row.TotalCents,
			Currency:         row.Currency,
		},
		InternalMoney: adminOrderInternalMoney{
			CommissionCents:    row.CommissionCents,
			RestaurantNetCents: row.RestaurantNetCents,
			RiderEarningsCents: row.RiderEarningsCents,
			PlatformGrossCents: row.PlatformGrossCents,
			Currency:           row.Currency,
		},
		Timeline:     timeline,
		Payment:      payment,
		Refunds:      refunds,
		CancelReason: row.CancelReason,
		RejectReason: row.RejectReason,
		PlacedAt:     httpx.Timestamp(row.PlacedAt),
		AcceptedAt:   tsPtr(row.AcceptedAt),
		PiiRevealed:  piiRevealed,
	}
}
