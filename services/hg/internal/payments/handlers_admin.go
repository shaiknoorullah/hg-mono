package payments

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The admin refund review and chargeback handlers (#172). Each reads the
// verified principal into a Staff, validates the request's shape against the
// contract, and leaves every decision about who may do what to the service.

// validRefundStates is the contract RefundState enum.
var validRefundStates = map[string]bool{
	"REQUESTED": true, "PENDING_APPROVAL": true, "APPROVED": true, "AUTHORISED": true,
	"SUBMITTED": true, "SUCCEEDED": true, "SETTLED": true, "FAILED": true,
	"DECLINED": true, "CANCELLED": true,
}

// validRefundReasonCodes is the contract RefundReasonCode enum.
var validRefundReasonCodes = map[string]bool{
	"RESTAURANT_REJECTED": true, "ITEM_MISSING": true, "MISSING_ITEMS": true, "WRONG_ITEM": true,
	"WRONG_ITEMS": true, "FOOD_QUALITY": true, "FOOD_SAFETY": true, "NEVER_DELIVERED": true,
	"ORDER_NEVER_ARRIVED": true, "LATE_DELIVERY": true, "DAMAGED_SPILLED": true, "NO_RIDER_FOUND": true,
	"CUSTOMER_CHANGED_MIND": true, "RESTAURANT_CANCELLED": true, "PLATFORM_INITIATED_CANCELLATION": true,
	"PLATFORM_ERROR": true, "DUPLICATE_CHARGE": true, "CHARGED_INCORRECTLY": true, "PRICING_ERROR": true,
	"HALAL_CONCERN": true, "HALAL_INTEGRITY": true, "GOODWILL": true, "DISPUTE_RESOLUTION": true,
	"CHARGEBACK_PREEMPTIVE": true, "OTHER": true,
}

func invalidQuery(w http.ResponseWriter, r *http.Request, field, msg string) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, msg,
		[]httpx.FieldError{{Field: field, Code: "invalid", Message: msg}})
}

func invalidBody(w http.ResponseWriter, r *http.Request, err error) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
		"The request body is not valid.", []httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
}

func isUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil && len(s) == 36
}

// pageLimit reads ?limit= as the contract's Limit: 1–100, default 20, and a
// value that is not one of those is a 422, never a silent default.
func pageLimit(w http.ResponseWriter, r *http.Request) (int, bool) {
	v := r.URL.Query().Get("limit")
	if v == "" {
		return 20, true
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 100 {
		invalidQuery(w, r, "limit", "limit must be a whole number from 1 to 100.")
		return 0, false
	}
	return n, true
}

// ListRefundsAdmin implements GET /v1/admin/refunds (listRefundsAdmin).
func (h *Handler) ListRefundsAdmin(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := AdminRefundFilter{Cursor: q.Get("cursor"), OrderID: q.Get("order_id")}
	var ok bool
	if f.Limit, ok = pageLimit(w, r); !ok {
		return
	}
	if v := q.Get("state"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if !validRefundStates[s] {
				invalidQuery(w, r, "state", s+" is not a refund state.")
				return
			}
			f.States = append(f.States, s)
		}
	}
	if v := q.Get("reason_code"); v != "" {
		for _, c := range strings.Split(v, ",") {
			if !validRefundReasonCodes[c] {
				invalidQuery(w, r, "reason_code", c+" is not a refund reason.")
				return
			}
			f.ReasonCodes = append(f.ReasonCodes, c)
		}
	}
	for _, p := range []struct {
		name string
		dst  **int64
	}{{"min_amount_cents", &f.MinAmountCents}, {"max_amount_cents", &f.MaxAmountCents}} {
		if v := q.Get(p.name); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n < 0 {
				invalidQuery(w, r, p.name, p.name+" must be a whole number of cents, 0 or more.")
				return
			}
			*p.dst = &n
		}
	}
	for _, p := range []struct {
		name string
		dst  **time.Time
	}{{"requested_from", &f.RequestedFrom}, {"requested_to", &f.RequestedTo}} {
		if v := q.Get(p.name); v != "" {
			t, err := time.Parse(time.RFC3339Nano, v)
			if err != nil {
				invalidQuery(w, r, p.name, p.name+" must be an RFC 3339 date-time.")
				return
			}
			*p.dst = &t
		}
	}
	if f.OrderID != "" && !isUUID(f.OrderID) {
		invalidQuery(w, r, "order_id", "order_id must be a UUID.")
		return
	}
	refunds, next, err := h.svc.ListRefundsForReview(r.Context(), StaffFrom(r), f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.RespondList(w, r, http.StatusOK, refunds, httpx.Meta{HasMore: next != nil, NextCursor: next})
}

// ApproveRefund implements POST /v1/admin/refunds/{refundId}/approve
// (approveRefund).
func (h *Handler) ApproveRefund(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "refundId")
	if !isUUID(id) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such refund.", nil)
		return
	}
	body, idem, err := readIdempotentBody(r, "/v1/admin/refunds/{refundId}/approve")
	if err != nil {
		invalidBody(w, r, err)
		return
	}
	var in RefundDecisionInput
	if err := decodeStrict(body, &in); err != nil {
		invalidBody(w, r, err)
		return
	}
	out, err := h.svc.ApproveRefund(r.Context(), id, StaffFrom(r), in, idem)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeOutcome(w, r, out)
}

// DeclineRefund implements POST /v1/admin/refunds/{refundId}/decline
// (declineRefund).
func (h *Handler) DeclineRefund(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "refundId")
	if !isUUID(id) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such refund.", nil)
		return
	}
	body, idem, err := readIdempotentBody(r, "/v1/admin/refunds/{refundId}/decline")
	if err != nil {
		invalidBody(w, r, err)
		return
	}
	var in RefundDeclineInput
	if err := decodeStrict(body, &in); err != nil {
		invalidBody(w, r, err)
		return
	}
	out, err := h.svc.DeclineRefund(r.Context(), id, StaffFrom(r), in, idem)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeOutcome(w, r, out)
}

// ListChargebacks implements GET /v1/admin/chargebacks (listChargebacks).
func (h *Handler) ListChargebacks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := ChargebackFilter{Cursor: q.Get("cursor"), OrderID: q.Get("order_id")}
	var ok bool
	if f.Limit, ok = pageLimit(w, r); !ok {
		return
	}
	if v := q.Get("open"); v != "" {
		open, err := strconv.ParseBool(v)
		if err != nil || (v != "true" && v != "false") {
			invalidQuery(w, r, "open", "open must be true or false.")
			return
		}
		f.Open = &open
	}
	if f.OrderID != "" && !isUUID(f.OrderID) {
		invalidQuery(w, r, "order_id", "order_id must be a UUID.")
		return
	}
	cbs, next, err := h.svc.ListChargebacks(r.Context(), StaffFrom(r), f)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.RespondList(w, r, http.StatusOK, cbs, httpx.Meta{HasMore: next != nil, NextCursor: next})
}

// GetChargeback implements GET /v1/admin/chargebacks/{chargebackId}
// (getChargeback).
func (h *Handler) GetChargeback(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "chargebackId")
	if !isUUID(id) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such chargeback.", nil)
		return
	}
	cb, err := h.svc.GetChargeback(r.Context(), StaffFrom(r), id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, cb)
}

// AddChargebackEvidenceNote implements
// POST /v1/admin/chargebacks/{chargebackId}/evidence-notes
// (addChargebackEvidenceNote).
func (h *Handler) AddChargebackEvidenceNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "chargebackId")
	if !isUUID(id) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such chargeback.", nil)
		return
	}
	body, idem, err := readIdempotentBody(r, "/v1/admin/chargebacks/{chargebackId}/evidence-notes")
	if err != nil {
		invalidBody(w, r, err)
		return
	}
	var in ChargebackNoteInput
	if err := decodeStrict(body, &in); err != nil {
		invalidBody(w, r, err)
		return
	}
	out, err := h.svc.AddChargebackEvidenceNote(r.Context(), StaffFrom(r), id, in, idem)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeOutcome(w, r, out)
}
