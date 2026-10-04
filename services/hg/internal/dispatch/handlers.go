package dispatch

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler is the module's HTTP surface. It holds the Service and nothing else;
// identity comes from the authenticated Principal in the context, never from a
// client-asserted field (the shipped app let any client subscribe as any user).
type Handler struct {
	svc *Service
}

// NewHandler builds a Handler over a Service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// riderID resolves the calling rider's account id from the authenticated
// principal. `/riders/me/...` operations are always the caller's own rider.
func riderID(r *http.Request) (string, bool) {
	p := httpx.PrincipalFrom(r.Context())
	if p.Anonymous || p.AccountID == "" {
		return "", false
	}
	return p.AccountID, true
}

// decodeJSON reads a JSON body with unknown-field rejection. It also refuses any
// inbound price field defensively (the server computes every price).
//
// The error names an unknown field but never quotes the body: a syntax error's
// text can carry a character of what was sent, and these bodies carry the
// handover codes, which no error body may echo (contracts/openapi.yaml,
// ErrorEnvelope: "Never a handover code").
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed, "A request body is required.", nil)
			return false
		}
		msg := "The request body is malformed."
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			msg = "The request body has an unknown field: " + field + "."
		}
		httpx.Fail(w, r, http.StatusBadRequest, httpx.CodeValidationFailed, msg, nil)
		return false
	}
	return true
}

// codeFieldFail rejects a malformed handover-code field. It names the field
// and never repeats the value.
func codeFieldFail(w http.ResponseWriter, r *http.Request, field, message string) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, message,
		[]httpx.FieldError{{Field: field, Code: "invalid", Message: message}})
}

// fail translates a service error into the error envelope, or 500 on an
// unexpected error.
func fail(w http.ResponseWriter, r *http.Request, err error) {
	if se, ok := asServiceError(err); ok {
		httpx.Fail(w, r, se.Status, se.Code, se.Message, se.Details)
		return
	}
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "The server failed to process this request.", nil)
}

// ---------------------------------------------------------------------------
// PUT /v1/riders/me/availability — setRiderAvailability
// ---------------------------------------------------------------------------

type availabilityInput struct {
	IsOnline               bool     `json:"is_online"`
	Latitude               *float64 `json:"latitude"`
	Longitude              *float64 `json:"longitude"`
	AccuracyM              *float64 `json:"accuracy_m"`
	GoOfflineAfterDelivery *bool    `json:"go_offline_after_delivery"`
}

// SetAvailability handles setRiderAvailability.
func (h *Handler) SetAvailability(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	var in availabilityInput
	if !decodeJSON(w, r, &in) {
		return
	}
	out, err := h.svc.SetAvailability(r.Context(), rid, in.IsOnline, in.Latitude, in.Longitude, in.AccuracyM, in.GoOfflineAfterDelivery)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// ---------------------------------------------------------------------------
// GET /v1/riders/me/offers/current — getCurrentOffer
// ---------------------------------------------------------------------------

// GetCurrentOffer handles getCurrentOffer. Returns null data (not 404) when idle.
func (h *Handler) GetCurrentOffer(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	offer, err := h.svc.CurrentOffer(r.Context(), rid)
	if err != nil {
		fail(w, r, err)
		return
	}
	if offer == nil {
		httpx.Respond(w, r, http.StatusOK, nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, offer)
}

// ---------------------------------------------------------------------------
// POST /v1/riders/me/offers/{offerId}/accept — acceptOffer
// ---------------------------------------------------------------------------

// AcceptOffer handles acceptOffer (race-free).
func (h *Handler) AcceptOffer(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	offerID := chi.URLParam(r, "offerId")
	if !validUUID(offerID) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such offer.", nil)
		return
	}
	asn, err := h.svc.AcceptOffer(r.Context(), rid, offerID)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, asn)
}

// ---------------------------------------------------------------------------
// POST /v1/riders/me/offers/{offerId}/reject — rejectOffer
// ---------------------------------------------------------------------------

type offerRejectInput struct {
	ReasonCode string  `json:"reason_code"`
	Note       *string `json:"note"`
}

var offerRejectReasons = map[string]bool{
	"TOO_FAR": true, "TOO_FAR_PICKUP": true, "TOO_FAR_DROPOFF": true, "TOO_LONG_WAIT": true,
	"EARNINGS_TOO_LOW": true, "VEHICLE_UNSUITABLE": true, "RESTAURANT_TOO_SLOW": true,
	"ENDING_SHIFT": true, "PERSONAL_BREAK": true, "SAFETY_CONCERN": true,
	"ORDER_TOO_LARGE": true, "OTHER": true,
}

// RejectOffer handles rejectOffer.
func (h *Handler) RejectOffer(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	offerID := chi.URLParam(r, "offerId")
	if !validUUID(offerID) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such offer.", nil)
		return
	}
	var in offerRejectInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !offerRejectReasons[in.ReasonCode] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "A valid reason_code is required.",
			[]httpx.FieldError{{Field: "reason_code", Code: "required", Message: "must be a valid reason code"}})
		return
	}
	if in.ReasonCode == "OTHER" {
		if in.Note == nil || len(*in.Note) < 5 || len(*in.Note) > 200 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "A note of 5–200 characters is required for OTHER.",
				[]httpx.FieldError{{Field: "note", Code: "required", Message: "5–200 characters required when reason_code=OTHER"}})
			return
		}
	}
	if err := h.svc.RejectOffer(r.Context(), rid, offerID, in.ReasonCode, in.Note); err != nil {
		fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// GET /v1/riders/me/assignments/{assignmentId} — getAssignment
// ---------------------------------------------------------------------------

// GetAssignment handles getAssignment.
func (h *Handler) GetAssignment(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	aid := chi.URLParam(r, "assignmentId")
	if !validUUID(aid) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such assignment.", nil)
		return
	}
	asn, err := h.svc.GetAssignment(r.Context(), rid, aid)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, asn)
}

// ---------------------------------------------------------------------------
// POST /v1/riders/me/assignments/{assignmentId}/transitions — createAssignmentTransition
// ---------------------------------------------------------------------------

// transitionInput is the union of the contract's two transition shapes:
// AssignmentStepInput (every step but PICKED_UP, with override_reason for a
// failed geofence) and PickupTransitionInput (PICKED_UP, with the required
// pickup_code and no override_reason). CreateTransition enforces which fields
// each shape may carry.
type transitionInput struct {
	ToState        string   `json:"to_state"`
	Latitude       *float64 `json:"latitude"`
	Longitude      *float64 `json:"longitude"`
	AccuracyM      *float64 `json:"accuracy_m"`
	OccurredAt     string   `json:"occurred_at"`
	OverrideReason *string  `json:"override_reason"`
	PickupCode     *string  `json:"pickup_code"`
}

var assignmentStates = map[string]bool{
	"ASSIGNED": true, "EN_ROUTE_TO_PICKUP": true, "ARRIVED_AT_PICKUP": true, "PICKED_UP": true,
	"EN_ROUTE_TO_DROPOFF": true, "ARRIVED_AT_DROPOFF": true, "DELIVERED": true,
	"UNDELIVERABLE": true, "RETURNING": true, "RETURNED": true,
	"CANCELLED_BY_PLATFORM": true, "REASSIGNED": true,
}

// CreateTransition handles createAssignmentTransition.
func (h *Handler) CreateTransition(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	aid := chi.URLParam(r, "assignmentId")
	if !validUUID(aid) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such assignment.", nil)
		return
	}
	var in transitionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !assignmentStates[in.ToState] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "A valid to_state is required.",
			[]httpx.FieldError{{Field: "to_state", Code: "invalid", Message: "not a known assignment state"}})
		return
	}
	occurred, err := parseTimestamp(in.OccurredAt)
	if err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "occurred_at must be an RFC3339 timestamp.",
			[]httpx.FieldError{{Field: "occurred_at", Code: "invalid", Message: "RFC3339 required"}})
		return
	}
	// The pickup code belongs to PICKED_UP alone, and PICKED_UP takes no
	// override_reason: a matching code is the proof, and when it cannot be used
	// only support can confirm the pickup (contracts/openapi.yaml,
	// AssignmentTransitionInput). A missing code is answered by the store,
	// after the lock check, because a locked code wins over a missing one.
	if in.ToState == "PICKED_UP" {
		if in.OverrideReason != nil {
			codeFieldFail(w, r, "override_reason",
				"PICKED_UP takes no override_reason: confirm pickup with the code the kitchen reads out.")
			return
		}
		if in.PickupCode != nil && !handover.WellFormed(*in.PickupCode) {
			codeFieldFail(w, r, "pickup_code", "pickup_code must be 4 digits.")
			return
		}
	} else if in.PickupCode != nil {
		codeFieldFail(w, r, "pickup_code", "Only PICKED_UP carries a pickup_code.")
		return
	}
	asn, serr := h.svc.Transition(r.Context(), rid, aid, TransitionInput{
		ToState:        in.ToState,
		Lat:            in.Latitude,
		Lng:            in.Longitude,
		AccuracyM:      in.AccuracyM,
		OccurredAt:     occurred,
		OverrideReason: in.OverrideReason,
		PickupCode:     in.PickupCode,
	})
	if serr != nil {
		fail(w, r, serr)
		return
	}
	httpx.Respond(w, r, http.StatusOK, asn)
}

// ---------------------------------------------------------------------------
// POST /v1/riders/me/assignments/{assignmentId}/proof-of-delivery — submitProofOfDelivery
// ---------------------------------------------------------------------------

type podInput struct {
	Method            string  `json:"method"`
	OtpCode           *string `json:"otp_code"`
	PhotoObjectID     *string `json:"photo_object_id"`
	HandoverMethod    *string `json:"handover_method"`
	AttestationReason *string `json:"attestation_reason"`
}

var podMethods = map[string]bool{"OTP": true, "PHOTO": true, "PHOTO_WITH_ATTESTATION": true}

// podShapeProblem checks the body against the contract's three proof shapes,
// chosen by method: OtpProofInput (otp_code; a missing one is answered by the
// store, after the lock check), PhotoProofInput (photo_object_id) and
// PhotoWithAttestationProofInput (photo_object_id and a 5–500 character
// attestation_reason). A field from another shape is refused. It returns the
// offending field and a message that never repeats a code.
func podShapeProblem(in podInput) (field, message string) {
	switch in.Method {
	case "OTP":
		if in.PhotoObjectID != nil {
			return "photo_object_id", "A met handover is proved with the customer's code, not a photo."
		}
		if in.AttestationReason != nil {
			return "attestation_reason", "A met handover is proved with the customer's code, not a statement."
		}
		if in.OtpCode != nil && !handover.WellFormed(*in.OtpCode) {
			return "otp_code", "otp_code must be 4 digits."
		}
	case "PHOTO", "PHOTO_WITH_ATTESTATION":
		if in.OtpCode != nil {
			return "otp_code", "Only an OTP proof carries otp_code."
		}
		if in.PhotoObjectID == nil || !validUUID(*in.PhotoObjectID) {
			return "photo_object_id", "photo_object_id must be the id of the uploaded photo."
		}
		if in.Method == "PHOTO" && in.AttestationReason != nil {
			return "attestation_reason", "A statement goes with method PHOTO_WITH_ATTESTATION."
		}
		if in.Method == "PHOTO_WITH_ATTESTATION" {
			if in.AttestationReason == nil {
				return "attestation_reason", "attestation_reason is required with a photo and a statement."
			}
			if n := utf8.RuneCountInString(*in.AttestationReason); n < 5 || n > 500 {
				return "attestation_reason", "attestation_reason must be 5 to 500 characters."
			}
		}
	}
	return "", ""
}

// SubmitPod handles submitProofOfDelivery.
func (h *Handler) SubmitPod(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	aid := chi.URLParam(r, "assignmentId")
	if !validUUID(aid) {
		httpx.Fail(w, r, http.StatusNotFound, httpx.CodeNotFound, "No such assignment.", nil)
		return
	}
	var in podInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !podMethods[in.Method] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "A valid method is required.",
			[]httpx.FieldError{{Field: "method", Code: "invalid", Message: "not a known POD method"}})
		return
	}
	if field, msg := podShapeProblem(in); field != "" {
		codeFieldFail(w, r, field, msg)
		return
	}
	asn, err := h.svc.SubmitPod(r.Context(), rid, aid, PodInput{
		Method:         in.Method,
		OtpCode:        in.OtpCode,
		PhotoObjectID:  in.PhotoObjectID,
		HandoverMethod: in.HandoverMethod,
		Attestation:    in.AttestationReason,
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, asn)
}

// ---------------------------------------------------------------------------
// POST /v1/riders/me/positions — reportRiderPositions
// ---------------------------------------------------------------------------

type positionsInput struct {
	Points []struct {
		Latitude   float64  `json:"latitude"`
		Longitude  float64  `json:"longitude"`
		AccuracyM  *float64 `json:"accuracy_m"`
		HeadingDeg *float64 `json:"heading_deg"`
		SpeedMps   *float64 `json:"speed_mps"`
		BatteryPct *int32   `json:"battery_pct"`
		RecordedAt string   `json:"recorded_at"`
		Assignment *string  `json:"assignment_id"`
	} `json:"points"`
}

// ReportPositions handles reportRiderPositions.
func (h *Handler) ReportPositions(w http.ResponseWriter, r *http.Request) {
	rid, ok := riderID(r)
	if !ok {
		httpx.Fail(w, r, http.StatusUnauthorized, httpx.CodeAuthenticationRequired, "Authentication is required.", nil)
		return
	}
	var in positionsInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Points) == 0 || len(in.Points) > 10 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "points must contain between 1 and 10 items.", nil)
		return
	}
	pts := make([]PositionPoint, 0, len(in.Points))
	for i, p := range in.Points {
		rec, err := parseTimestamp(p.RecordedAt)
		if err != nil {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed, "recorded_at must be an RFC3339 timestamp.",
				[]httpx.FieldError{{Field: "points", Code: "invalid", Message: "point has a malformed recorded_at"}})
			return
		}
		_ = i
		pts = append(pts, PositionPoint{
			Lat: p.Latitude, Lng: p.Longitude, AccuracyM: p.AccuracyM,
			HeadingDeg: p.HeadingDeg, SpeedMps: p.SpeedMps, BatteryPct: p.BatteryPct,
			RecordedAt: rec, Assignment: p.Assignment,
		})
	}
	ack, err := h.svc.IngestPositions(r.Context(), rid, pts)
	if err != nil {
		fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusAccepted, ack)
}

// parseTimestamp parses an RFC3339 timestamp in UTC.
func parseTimestamp(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, errors.New("empty timestamp")
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}
