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

	// A malformed order id can never name a real order. Answer 404 (never a
	// 500 that leaks a database uuid-cast error, and never a distinct code that
	// would let a caller distinguish "bad shape" from "not found").
	if !isUUID(orderID) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
		return
	}

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

	// A malformed order id is a 404, not a 500 (see GetOrderAdmin). We check it
	// before touching the body so an invalid id never reaches a uuid-typed query.
	if !isUUID(orderID) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
		return
	}

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
	// reason_code is a closed enum (OrderCancellationReasonCode). An unknown
	// value is a 422 — never silently accepted and never rewritten to a default.
	if !validCancellationReasonCode[in.ReasonCode] {
		fieldFail(w, r, "reason_code", "reason_code is not a valid OrderCancellationReasonCode")
		return
	}
	// refund_kind, when present, is a closed enum (RefundKind) applied only
	// post-capture. Reject an out-of-enum value rather than ignore it.
	if in.RefundKind != nil && !validRefundKind[*in.RefundKind] {
		fieldFail(w, r, "refund_kind", "refund_kind is not a valid RefundKind")
		return
	}
	// contract: reason_text minLength 10, maxLength 1000.
	if n := len([]rune(in.ReasonText)); n < 10 || n > 1000 {
		fieldFail(w, r, "reason_text", "reason_text must be between 10 and 1000 characters")
		return
	}
	// case_id is format:uuid; reject a non-UUID rather than write a bad audit link.
	if !isUUID(in.CaseID) {
		fieldFail(w, r, "case_id", "case_id must be a UUID")
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
	// The order.cancel_reason column is written from the caller's reason_code
	// verbatim (it is a validated OrderCancellationReasonCode). We never
	// substitute a hard-coded value, which would corrupt the audit record.
	result, err := h.ordersRepo.CancelOrder(r.Context(), actor, orderID, in.ReasonCode, in)
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

// validCancellationReasonCode is the OrderCancellationReasonCode enum
// (contracts/openapi.yaml) — kept in lock-step with the DB
// order_cancellation_reason_code enum so a value that passes here never trips a
// database CHECK at write time.
var validCancellationReasonCode = map[string]bool{
	"CUSTOMER_CANCELLED": true, "RESTAURANT_TIMEOUT": true, "RESTAURANT_CLOSED": true,
	"ITEM_UNAVAILABLE": true, "CAPTURE_FAILED": true, "PAYMENT_EXPIRED": true,
	"PREP_OVERDUE": true, "NO_RIDER_FOUND": true, "SUPPORT_CANCELLED": true,
	"FRAUD_SUSPECTED": true, "PLATFORM_ERROR": true,
}

// validRefundKind is the RefundKind enum (contracts/openapi.yaml).
var validRefundKind = map[string]bool{
	"FULL": true, "PARTIAL_ITEMS": true, "FEES_ONLY": true, "GOODWILL": true,
}

// isUUID reports whether s is a canonical 8-4-4-4-12 hex UUID. It is deliberately
// permissive on version/variant bits (any hex) but strict on shape.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// nonNil makes a missing list an empty one: the contract's arrays are
// required, never null.
func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
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
			Variants:       l.Variants,
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

	// can_cancel: true only for pre-acceptance states (before restaurant accepts).
	preAcceptanceStates := map[string]bool{
		"CREATED": true, "AUTHORIZED": true, "RESTAURANT_PENDING": true,
	}
	canCancel := preAcceptanceStates[row.State]

	// delivery_instructions and dispatch_history are empty slices when no data
	// is loaded — the contract allows these to be absent/null but we emit empty
	// arrays to match the array type declared in the schema.
	deliveryInstructions := []any{}
	dispatchHistory := []adminDispatchHistoryEntry{}

	// delivery_address / rider are oneOf[object,null]: emit the object when the
	// store joined the row, else null.
	var deliveryAddress any
	if row.DeliveryAddress != nil {
		a := row.DeliveryAddress
		deliveryAddress = adminAddress{
			ID: a.ID, Label: a.Label, Line1: a.Line1, Line2: a.Line2, Unit: a.Unit,
			Buzzer: a.Buzzer, City: a.City, Province: a.Province, PostalCode: a.PostalCode,
			Country: a.Country, Latitude: a.Latitude, Longitude: a.Longitude,
			Timezone: a.Timezone, DeliveryNotes: a.DeliveryNotes, IsDefault: a.IsDefault,
		}
	}
	var rider any
	if row.Rider != nil {
		rd := row.Rider
		rider = adminRiderProfile{
			FirstName: rd.FirstName, LastInitial: rd.LastInitial, PhotoURL: rd.PhotoURL,
			VehicleType: rd.VehicleType, RatingAvg: rd.RatingAvg,
		}
	}

	stateSince := ptr(httpx.Timestamp(row.StateSince))

	restaurantLocation := &adminGeoPoint{Latitude: row.RestaurantLat, Longitude: row.RestaurantLng}
	var destinationLocation *adminGeoPoint
	if row.DeliveryAddress != nil {
		a := row.DeliveryAddress
		destinationLocation = &adminGeoPoint{Latitude: a.Latitude, Longitude: a.Longitude}
	}
	var riderLocation *adminRiderLocation
	if row.RiderLocation != nil {
		rl := row.RiderLocation
		riderLocation = &adminRiderLocation{
			Latitude:   rl.Latitude,
			Longitude:  rl.Longitude,
			HeadingDeg: rl.HeadingDeg,
			SpeedMPS:   rl.SpeedMPS,
			AccuracyM:  rl.AccuracyM,
			RecordedAt: httpx.Timestamp(rl.RecordedAt),
			IsCoarse:   rl.IsCoarse,
		}
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
		PlacedAt:             httpx.Timestamp(row.PlacedAt),
		StateSince:           stateSince,
		DeadlineAt:           tsPtr(row.DeadlineAt),
		CancelReason:         row.CancelReason,
		RejectReason:         row.RejectReason,
		CanCancel:            canCancel,
		AcceptedAt:           tsPtr(row.AcceptedAt),
		ReadyAt:              nil,
		PickedUpAt:           nil,
		DeliveredAt:          nil,
		CompletedAt:          tsPtr(row.CompletedAt),
		DeliveryAddress:      deliveryAddress,
		DeliveryInstructions: deliveryInstructions,
		SpecialInstructions:  nil,
		Rider:                rider,
		DispatchState:        row.DispatchState,
		DispatchHistory:      dispatchHistory,
		InternalMoney: adminOrderInternalMoney{
			CommissionCents:    row.CommissionCents,
			RestaurantNetCents: row.RestaurantNetCents,
			RiderEarningsCents: row.RiderEarningsCents,
			PlatformGrossCents: row.PlatformGrossCents,
			Currency:           row.Currency,
		},
		Timeline:            timeline,
		Payment:             payment,
		Refunds:             refunds,
		PiiRevealed:         piiRevealed,
		MoneyTimeline:       nonNil(row.Money.Timeline),
		Chargebacks:         nonNil(row.Money.Chargebacks),
		RestaurantLocation:  restaurantLocation,
		DestinationLocation: destinationLocation,
		RiderLocation:       riderLocation,
	}
}
