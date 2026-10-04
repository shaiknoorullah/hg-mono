package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// An application decision body has one shape per decision (contract
// RestaurantDecisionInput and RiderDecisionInput, issue #163:
// https://github.com/shaiknoorullah/hg-mono/issues/163). An approval carries an
// approval reason; a rejection or a request for changes carries a rejection
// reason; only a request for changes names documents to redo. Every decision
// carries a reason code and a reason text, because every state-changing admin
// action does (admin conventions:
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#01-units-time-money-identity).
// A code that does not fit the decision is a 422.
type decisionVocabulary struct {
	approveCodes map[string]bool // codes an APPROVE may carry
	rejectCodes  map[string]bool // codes a REJECT or REQUEST_CHANGES may carry
	docTypes     map[string]bool // documents a REQUEST_CHANGES may name
}

// restaurantDecisionVocabulary is the contract's RestaurantApproveReasonCode,
// RestaurantRejectApplicationReasonCode and RestaurantDocType.
var restaurantDecisionVocabulary = decisionVocabulary{
	approveCodes: map[string]bool{"ALL_CHECKS_PASSED": true, "APPROVED_WITH_NOTES": true},
	rejectCodes: map[string]bool{
		"HALAL_CERTIFICATION_INVALID": true, "DOCUMENTS_INSUFFICIENT": true,
		"IDENTITY_UNVERIFIED": true, "OUTSIDE_SERVICE_AREA": true,
		"PROHIBITED_CUISINE_OR_PRODUCT": true, "SUSPECTED_FRAUD": true,
		"DUPLICATE_APPLICATION": true, "WITHDRAWN_BY_APPLICANT": true, "OTHER": true,
	},
	docTypes: map[string]bool{
		"BUSINESS_LICENCE": true, "HALAL_CERTIFICATE": true, "FOOD_SAFETY": true,
		"OWNER_ID": true, "LIABILITY_INSURANCE": true,
	},
}

// riderDecisionVocabulary is the contract's RiderApproveReasonCode,
// DocumentRejectionReasonCode and RiderDocType.
var riderDecisionVocabulary = decisionVocabulary{
	approveCodes: map[string]bool{"ALL_CHECKS_PASSED": true, "APPROVED_WITH_NOTES": true},
	rejectCodes: map[string]bool{
		"ILLEGIBLE": true, "EXPIRED": true, "WRONG_DOCUMENT_TYPE": true, "NAME_MISMATCH": true,
		"DOB_MISMATCH": true, "ADDRESS_MISMATCH": true, "PLATE_MISMATCH": true,
		"UNRECOGNISED_CERTIFIER": true, "SUSPECTED_FORGERY": true, "SUSPECTED_ALTERATION": true,
		"INCOMPLETE_PAGES": true, "OTHER": true,
	},
	docTypes: map[string]bool{
		"DRIVERS_LICENCE": true, "VEHICLE_REGISTRATION": true, "VEHICLE_INSURANCE": true,
		"GOVERNMENT_ID": true, "WORK_ELIGIBILITY": true, "PROFILE_PHOTO": true,
	},
}

// validDecision checks a decision body against the shape its decision selects.
// It writes the 422 and returns false when the body does not fit.
func validDecision(w http.ResponseWriter, r *http.Request, v decisionVocabulary, decision, reasonCode, reasonText string, documentsToRedo []string) bool {
	switch decision {
	case "APPROVE":
		if !v.approveCodes[reasonCode] {
			fieldFail(w, r, "reason_code", "reason_code must be an approval reason (ALL_CHECKS_PASSED or APPROVED_WITH_NOTES) for an APPROVE decision")
			return false
		}
	case "REJECT", "REQUEST_CHANGES":
		if !v.rejectCodes[reasonCode] {
			fieldFail(w, r, "reason_code", "reason_code must be a rejection reason for this decision")
			return false
		}
	default:
		fieldFail(w, r, "decision", "decision must be APPROVE, REQUEST_CHANGES or REJECT")
		return false
	}
	if n := len([]rune(reasonText)); n < 10 || n > 1000 {
		fieldFail(w, r, "reason_text", "reason_text must be between 10 and 1000 characters")
		return false
	}
	if decision != "REQUEST_CHANGES" {
		if documentsToRedo != nil {
			fieldFail(w, r, "documents_to_redo", "documents_to_redo is only for a REQUEST_CHANGES decision")
			return false
		}
		return true
	}
	if len(documentsToRedo) == 0 {
		fieldFail(w, r, "documents_to_redo", "documents_to_redo must name at least one document for a REQUEST_CHANGES decision")
		return false
	}
	seen := make(map[string]bool, len(documentsToRedo))
	for _, doc := range documentsToRedo {
		if !v.docTypes[doc] || seen[doc] {
			fieldFail(w, r, "documents_to_redo", "documents_to_redo must name each document once, from this application's document types")
			return false
		}
		seen[doc] = true
	}
	return true
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
	if !validDecision(w, r, restaurantDecisionVocabulary, in.Decision, in.ReasonCode, in.ReasonText, in.DocumentsToRedo) {
		return
	}
	if in.InternalNote != nil && len([]rune(*in.InternalNote)) > 2000 {
		fieldFail(w, r, "internal_note", "internal_note must be at most 2000 characters")
		return
	}

	detail, err := h.repo.DecideRestaurantApplication(r.Context(), actorFrom(r), id,
		in.Decision, in.ReasonCode, in.ReasonText, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		// The contract answers an unapprovable restaurant with 409.
		h.failDecision(w, r, err, http.StatusConflict)
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderRestaurantApplication(r, detail))
}

// failDecision writes the error for a decision the store refused: an under-18
// rider, live blockers (blockedStatus is the status the operation's contract
// gives them), a second decision on a decided application, or no such
// application. Anything else is an internal error.
func (h *Handler) failDecision(w http.ResponseWriter, r *http.Request, err error, blockedStatus int) {
	var pe preconditionError
	switch {
	case errors.Is(err, ErrAgeNotMet):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeAgeNotMet,
			"The rider is under 18; approval is refused and cannot be overridden.", nil)
	case errors.As(err, &pe):
		httpx.Fail(w, r, blockedStatus, CodePreconditionNotMet,
			"The application is not yet approvable.",
			map[string]any{"blockers": pe.Blockers})
	case errors.Is(err, ErrAlreadyDecided):
		httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The application is already decided.", nil)
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such application.", nil)
	default:
		h.failInternal(w, r, err)
	}
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
	if !validDecision(w, r, riderDecisionVocabulary, in.Decision, in.ReasonCode, in.ReasonText, in.DocumentsToRedo) {
		return
	}

	detail, err := h.repo.DecideRiderApplication(r.Context(), actorFrom(r), id,
		in.Decision, in.ReasonCode, in.ReasonText, h.today())
	if err != nil {
		// The contract answers an unapprovable rider with 422.
		h.failDecision(w, r, err, http.StatusUnprocessableEntity)
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
