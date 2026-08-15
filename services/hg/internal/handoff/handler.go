// Package handoff's HTTP handlers. Each maps one contract operation to the
// Service, decodes the body with an unknown-field-rejecting decoder, and
// renders the contract DTO. Identity always comes from the authenticated
// Principal (httpx.PrincipalFrom), never from a client-asserted field.
package handoff

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler is the module's HTTP surface. It holds the Service and nothing else.
type Handler struct {
	svc *Service
}

// NewHandler builds a Handler over a Service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func accountID(r *http.Request) (string, bool) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous || p.AccountID == "" {
		return "", false
	}
	return p.AccountID, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed, "A request body is required.", nil)
			return false
		}
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed, "The request body is malformed: "+err.Error(), nil)
		return false
	}
	return true
}

func fail(w http.ResponseWriter, r *http.Request, err error) {
	if se, ok := asServiceError(err); ok {
		httpx.Fail(w, r, se.Status, se.Code, se.Message, se.Details)
		return
	}
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "The server failed to process this request.", nil)
}

// ---------------------------------------------------------------------------
// POST /v1/orders/{orderId}/handoff/seal — bindPackageSeal
// ---------------------------------------------------------------------------

// BindSeal handles bindPackageSeal.
func (h *Handler) BindSeal(w http.ResponseWriter, r *http.Request) {
	acct, ok := accountID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	orderID := chi.URLParam(r, "orderId")
	var in sealBindInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.SealCode == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "seal_code is required.",
			[]httpx.FieldError{{Field: "seal_code", Code: "required", Message: "seal_code is required"}})
		return
	}
	out, err := h.svc.BindSeal(r.Context(), acct, orderID, in.SealCode)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, out)
}

// ---------------------------------------------------------------------------
// POST /v1/orders/{orderId}/handoff/pickup-scan — scanPickup
// ---------------------------------------------------------------------------

// PickupScan handles scanPickup.
func (h *Handler) PickupScan(w http.ResponseWriter, r *http.Request) {
	acct, ok := accountID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	orderID := chi.URLParam(r, "orderId")
	var in pickupScanInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.QRToken == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "qr_token is required.",
			[]httpx.FieldError{{Field: "qr_token", Code: "required", Message: "qr_token is required"}})
		return
	}
	out, err := h.svc.PickupScan(r.Context(), acct, orderID, scanInput{
		QRToken: in.QRToken, SealIntact: in.SealIntact,
		Latitude: in.Latitude, Longitude: in.Longitude, PhotoObjectID: in.PhotoObjectID,
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// POST /v1/orders/{orderId}/handoff/delivery-scan — scanDelivery
// ---------------------------------------------------------------------------

// DeliveryScan handles scanDelivery.
func (h *Handler) DeliveryScan(w http.ResponseWriter, r *http.Request) {
	acct, ok := accountID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	orderID := chi.URLParam(r, "orderId")
	var in deliveryScanInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.QRToken == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "qr_token is required.",
			[]httpx.FieldError{{Field: "qr_token", Code: "required", Message: "qr_token is required"}})
		return
	}
	out, err := h.svc.DeliveryScan(r.Context(), acct, orderID, scanInput{
		QRToken: in.QRToken, SealIntact: in.SealIntact,
		Latitude: in.Latitude, Longitude: in.Longitude, PhotoObjectID: in.PhotoObjectID,
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// POST /v1/orders/{orderId}/handoff/tamper-report — reportTamper
// ---------------------------------------------------------------------------

// ReportTamper handles reportTamper.
func (h *Handler) ReportTamper(w http.ResponseWriter, r *http.Request) {
	acct, ok := accountID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	orderID := chi.URLParam(r, "orderId")
	var in tamperReportInput
	if !decodeJSON(w, r, &in) {
		return
	}
	var fieldErrs []httpx.FieldError
	if in.PhotoObjectID == "" {
		fieldErrs = append(fieldErrs, httpx.FieldError{Field: "photo_object_id", Code: "required", Message: "photo_object_id is required"})
	}
	if len(in.Note) < 5 {
		fieldErrs = append(fieldErrs, httpx.FieldError{Field: "note", Code: "invalid", Message: "note must be at least 5 characters"})
	}
	if len(fieldErrs) > 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "The request failed validation.", fieldErrs)
		return
	}
	out, err := h.svc.TamperReport(r.Context(), acct, orderID, in.PhotoObjectID, in.Note)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, out)
}
