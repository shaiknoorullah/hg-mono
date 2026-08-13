package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// approveReasonCodes and rejectApplicationReasonCodes are the closed enums a
// restaurant decision may carry (contract RestaurantApproveReasonCode /
// RestaurantRejectApplicationReasonCode). A code outside the set is a 422.
var approveReasonCodes = map[string]bool{
	"ALL_CHECKS_PASSED": true, "APPROVED_WITH_NOTES": true,
}

var rejectApplicationReasonCodes = map[string]bool{
	"HALAL_CERTIFICATION_INVALID": true, "DOCUMENTS_INSUFFICIENT": true,
	"IDENTITY_UNVERIFIED": true, "OUTSIDE_SERVICE_AREA": true,
	"PROHIBITED_CUISINE_OR_PRODUCT": true, "SUSPECTED_FRAUD": true,
	"DUPLICATE_APPLICATION": true, "WITHDRAWN_BY_APPLICANT": true, "OTHER": true,
}

// riderDecisionReasonCodes is DocumentRejectionReasonCode (the rider decision
// reason enum per the contract).
var riderDecisionReasonCodes = map[string]bool{
	"ILLEGIBLE": true, "EXPIRED": true, "WRONG_DOCUMENT_TYPE": true, "NAME_MISMATCH": true,
	"DOB_MISMATCH": true, "ADDRESS_MISMATCH": true, "PLATE_MISMATCH": true,
	"UNRECOGNISED_CERTIFIER": true, "SUSPECTED_FORGERY": true, "SUSPECTED_ALTERATION": true,
	"INCOMPLETE_PAGES": true, "OTHER": true,
}

// GetRestaurantApplication implements getRestaurantApplication (A-13). Support
// agents receive a reduced projection: no document contents and no certificate
// panel — that redaction is applied at render time.
func (h *Handler) GetRestaurantApplication(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	detail, err := h.repo.GetRestaurantApplication(r.Context(), id, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such application.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderRestaurantApplication(r, detail))
}

// DecideRestaurantApplication implements decideRestaurantApplication (A-18).
func (h *Handler) DecideRestaurantApplication(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "restaurantId")
	var in restaurantDecisionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	switch in.Decision {
	case "APPROVE":
		if !approveReasonCodes[in.ReasonCode] {
			fieldFail(w, r, "reason_code", "reason_code must be an approve reason for an APPROVE decision")
			return
		}
	case "REJECT", "REQUEST_CHANGES":
		if !rejectApplicationReasonCodes[in.ReasonCode] {
			fieldFail(w, r, "reason_code", "reason_code must be a reject reason for this decision")
			return
		}
	default:
		fieldFail(w, r, "decision", "decision must be APPROVE, REQUEST_CHANGES or REJECT")
		return
	}
	if n := len([]rune(in.ReasonText)); n < 10 || n > 1000 {
		fieldFail(w, r, "reason_text", "reason_text must be between 10 and 1000 characters")
		return
	}
	if in.InternalNote != nil && len([]rune(*in.InternalNote)) > 2000 {
		fieldFail(w, r, "internal_note", "internal_note must be at most 2000 characters")
		return
	}

	detail, err := h.repo.DecideRestaurantApplication(r.Context(), actorFrom(r), id,
		in.Decision, in.ReasonCode, in.ReasonText, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		var pe preconditionError
		switch {
		case errors.As(err, &pe):
			httpx.Fail(w, r, http.StatusConflict, CodePreconditionNotMet,
				"The application is not yet approvable.",
				map[string]any{"blockers": pe.Blockers})
		case errors.Is(err, ErrAlreadyDecided):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The application is already decided.", nil)
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such application.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderRestaurantApplication(r, detail))
}

// GetRiderApplication implements getRiderApplication (A-23).
func (h *Handler) GetRiderApplication(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "riderAccountId")
	detail, err := h.repo.GetRiderApplication(r.Context(), id, h.today())
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such application.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderRiderApplication(r, detail))
}

// DecideRiderApplication implements decideRiderApplication (A-23).
func (h *Handler) DecideRiderApplication(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "riderAccountId")
	var in riderDecisionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	switch in.Decision {
	case "APPROVE", "REJECT", "REQUEST_CHANGES":
	default:
		fieldFail(w, r, "decision", "decision must be APPROVE, REQUEST_CHANGES or REJECT")
		return
	}
	if in.Decision != "APPROVE" && !riderDecisionReasonCodes[in.ReasonCode] {
		fieldFail(w, r, "reason_code", "reason_code must be a valid rider decision reason")
		return
	}
	if n := len([]rune(in.ReasonText)); n < 10 || n > 1000 {
		fieldFail(w, r, "reason_text", "reason_text must be between 10 and 1000 characters")
		return
	}

	detail, err := h.repo.DecideRiderApplication(r.Context(), actorFrom(r), id,
		in.Decision, in.ReasonCode, in.ReasonText, h.today())
	if err != nil {
		var pe preconditionError
		switch {
		case errors.Is(err, ErrAgeNotMet):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeAgeNotMet,
				"The rider is under 18; approval is refused and cannot be overridden.", nil)
		case errors.As(err, &pe):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodePreconditionNotMet,
				"The application is not yet approvable.",
				map[string]any{"blockers": pe.Blockers})
		case errors.Is(err, ErrAlreadyDecided):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The application is already decided.", nil)
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such application.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderRiderApplication(r, detail))
}

// --- render ---

func supportOnly(r *http.Request) bool {
	p := httpx.PrincipalFrom(r.Context())
	return p.HasRole(httpx.RoleSupportAgent) && !p.HasRole(httpx.RoleAdmin) && !p.HasRole(httpx.RoleSuperAdmin)
}

func (h *Handler) renderRestaurantApplication(r *http.Request, d restaurantAppDetail) restaurantApplication {
	out := restaurantApplication{
		restaurantApplicationSummary: renderRestaurantSummary(d.summary),
		Profile:                      renderRestaurantProfile(d.profile),
		Blockers:                     append([]string{}, d.blockers...),
	}
	if d.addressPinWarning {
		out.AddressPinWarning = ptr("The map pin is more than 5 km from the postal-code centroid.")
	}
	// Support agents receive a reduced projection: no document contents and no
	// certificate panel (A-13).
	if supportOnly(r) {
		out.Documents = []kycDocument{}
		return out
	}
	out.Documents = make([]kycDocument, 0, len(d.documents))
	for _, doc := range d.documents {
		out.Documents = append(out.Documents, renderDoc(doc))
	}
	if d.certID != nil {
		cert, checks, err := h.repo.GetCertificate(r.Context(), *d.certID)
		if err == nil {
			c := h.renderCert(r, cert, checks)
			out.HalalCertificate = &c
		}
	}
	return out
}

func renderRestaurantProfile(p restaurantProfileRow) restaurantProfile {
	out := restaurantProfile{
		ID:              p.ID,
		LegalName:       p.LegalName,
		DisplayName:     p.DisplayName,
		Description:     p.Description,
		OwnerFirstName:  p.OwnerFirstName,
		OwnerLastName:   p.OwnerLastName,
		PhoneE164:       p.PhoneE164,
		PublicPhoneE164: p.PublicPhoneE164,
		GSTHSTNumber:    p.GSTHSTNumber,
		Timezone:        p.Timezone,
		CuisineIDs:      append([]string{}, p.CuisineIDs...),
		AvgPrepMinutes:  p.AvgPrepMinutes,
		DeliveryRadiusM: p.DeliveryRadiusM,
		AccountState:    p.AccountState,
		OnboardingState: p.OnboardingState,
		CommissionBps:   p.CommissionBps,
	}
	addr := publicAddress{Line2: p.Line2}
	if p.Line1 != nil {
		addr.Line1 = *p.Line1
	}
	if p.City != nil {
		addr.City = *p.City
	}
	if p.Province != nil {
		addr.Province = *p.Province
	}
	if p.PostalCode != nil {
		addr.PostalCode = *p.PostalCode
	}
	if p.Latitude != nil {
		addr.Latitude = *p.Latitude
	}
	if p.Longitude != nil {
		addr.Longitude = *p.Longitude
	}
	out.Address = addr
	// The halal badge is emitted only when there is a display state to show. A
	// missing halal field renders no badge (invariant 8) — never an optimistic one.
	if p.HalalStatus != "" {
		out.Halal = &halalBadge{DisplayState: p.HalalStatus}
	}
	return out
}

func (h *Handler) renderRiderApplication(r *http.Request, d riderAppDetail) riderApplication {
	out := riderApplication{
		riderApplicationSummary: renderRiderSummary(d.summary),
		Profile:                 renderRiderProfile(d.profile),
		ComputedAgeYears:        d.ageYears,
		Blockers:                append([]string{}, d.blockers...),
	}
	if d.vehicle != nil {
		out.Vehicle = ptr(renderRiderVehicle(*d.vehicle))
	}
	if supportOnly(r) {
		out.Documents = []kycDocument{}
		return out
	}
	out.Documents = make([]kycDocument, 0, len(d.documents))
	for _, doc := range d.documents {
		out.Documents = append(out.Documents, renderDoc(doc))
	}
	return out
}

func renderRiderProfile(p riderProfileRow) riderProfile {
	return riderProfile{
		AccountID:   p.AccountID,
		FirstName:   p.FirstName,
		LastName:    p.LastName,
		Email:       p.Email,
		DateOfBirth: p.DateOfBirth.Format("2006-01-02"),
		Timezone:    "America/Toronto",
	}
}

func renderRiderVehicle(v riderVehicleRow) riderVehicle {
	return riderVehicle{
		ID:           v.ID,
		VehicleType:  v.VehicleType,
		Make:         v.Make,
		Model:        v.Model,
		Year:         v.Year,
		Colour:       v.Colour,
		LicencePlate: v.LicencePlate,
		IsActive:     v.IsActive,
	}
}
