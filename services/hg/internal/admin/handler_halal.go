package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// GetHalalCertificate implements getHalalCertificate. Support agents receive a
// reduced projection (A-15); that role-based redaction is applied by rendering
// only the safe fields when the principal is a support agent and not an admin.
func (h *Handler) GetHalalCertificate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "certificateId")
	cert, checks, err := h.repo.GetCertificate(r.Context(), id)
	if err != nil {
		h.failCert(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderCert(r, cert, checks))
}

// TranscribeHalalCertificate implements transcribeHalalCertificate.
func (h *Handler) TranscribeHalalCertificate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "certificateId")
	var in halalTranscriptionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if err := validateTranscription(in); err != "" {
		fieldFail(w, r, err, "the field is missing or malformed")
		return
	}
	cert, checks, err := h.repo.Transcribe(r.Context(), actorFrom(r), id, in, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such certificate.", nil)
		case errors.Is(err, errUnknownIssuer):
			fieldFail(w, r, "issuing_body_id", "The issuing body is not in the registry; propose it first.")
		case errors.Is(err, errBadDate):
			fieldFail(w, r, "issued_on", "issued_on and expires_on must be YYYY-MM-DD dates.")
		case errors.Is(err, errImmutable):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The certificate is decided and its fields are immutable.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderCert(r, cert, checks))
}

// RecordHalalChecks implements recordHalalChecks — the core product function.
func (h *Handler) RecordHalalChecks(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "certificateId")
	var in halalChecksInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Checks) < 1 || len(in.Checks) > 7 {
		fieldFail(w, r, "checks", "between 1 and 7 checks are required.")
		return
	}
	seen := map[string]bool{}
	for _, c := range in.Checks {
		if !isValidCheckKey(c.CheckKey) {
			fieldFail(w, r, "checks.check_key", "unknown check key "+c.CheckKey)
			return
		}
		if seen[c.CheckKey] {
			fieldFail(w, r, "checks.check_key", "duplicate check key "+c.CheckKey)
			return
		}
		seen[c.CheckKey] = true
		if !isValidResult(c.Result) {
			fieldFail(w, r, "checks.result", "result must be PASS, FAIL or NOT_ASSESSED")
			return
		}
		if c.Note != nil && len([]rune(*c.Note)) < 20 {
			fieldFail(w, r, "checks.note", "a note must be at least 20 characters")
			return
		}
	}
	cert, checks, err := h.repo.RecordChecks(r.Context(), actorFrom(r), id, in, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		var ov checkOverrideError
		switch {
		case errors.As(err, &ov):
			httpx.Fail(w, r, http.StatusConflict, CodeCheckNotOverridable,
				"H5 and H7 are computed by the server and cannot be overridden.",
				map[string]any{"check_key": ov.CheckKey, "computed": ov.Computed})
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such certificate.", nil)
		case errors.Is(err, errNotTranscribed):
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
				"Transcribe the certificate fields before recording checks.", nil)
		case errors.Is(err, errImmutable):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The certificate is decided.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderCert(r, cert, checks))
}

// DecideHalalCertificate implements decideHalalCertificate. REVOKE is
// super-admin only (A-15): a non-super-admin attempt is 403.
func (h *Handler) DecideHalalCertificate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "certificateId")
	var in halalDecisionInput
	if !decodeJSON(w, r, &in) {
		return
	}
	switch in.Decision {
	case "APPROVE", "REJECT", "REVOKE":
	default:
		fieldFail(w, r, "decision", "decision must be APPROVE, REJECT or REVOKE")
		return
	}
	if in.Decision == "REVOKE" {
		p := httpx.PrincipalFrom(r.Context())
		if !p.HasRole(httpx.RoleSuperAdmin) {
			httpx.Fail(w, r, http.StatusForbidden, CodeForbidden,
				"Only a super admin may revoke a certificate.",
				map[string]any{"required": "SUPER_ADMIN"})
			return
		}
	}
	if in.Decision == "REJECT" && in.ReasonCode == nil {
		fieldFail(w, r, "reason_code", "a rejection requires a reason_code")
		return
	}
	cert, checks, err := h.repo.Decide(r.Context(), actorFrom(r), id, in.Decision, in.ReasonCode, in.ReasonText, h.cfg.HalalCertMinRemainingDays, h.today())
	if err != nil {
		var de decisionError
		switch {
		case errors.As(err, &de):
			code := CodeChecklistIncomplete
			if de.Code == decCheckFailed {
				code = CodeCheckFailed
			}
			httpx.Fail(w, r, http.StatusUnprocessableEntity, code,
				"The seven checks are not all present and PASS.",
				map[string]any{"check_keys": de.CheckKeys})
		case errors.Is(err, ErrAlreadyDecided):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The certificate is already decided.", nil)
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such certificate.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, h.renderCert(r, cert, checks))
}

func validateTranscription(in halalTranscriptionInput) string {
	switch {
	case in.CertificateNumber == "" || len([]rune(in.CertificateNumber)) > 100:
		return "certificate_number"
	case in.IssuingBodyID == "":
		return "issuing_body_id"
	case len([]rune(in.CertifiedLegalName)) > 200:
		return "certified_legal_name"
	case len([]rune(in.CertifiedAddress)) > 300:
		return "certified_address"
	case in.Scope != ScopeWholeEstablishment && in.Scope != ScopeKitchenOnly &&
		in.Scope != ScopeSpecificMenuItems && in.Scope != ScopeSupplierChainOnly:
		return "scope"
	case in.IssuedOn == "":
		return "issued_on"
	case in.ExpiresOn == "":
		return "expires_on"
	}
	return ""
}

// renderCert builds the HalalCertificate DTO, applying the support-agent
// redaction (A-15): a support agent sees status, expires_on, the issuing body's
// name and the rejection reason, and nothing else — no document reference, no
// certified address, no check notes.
func (h *Handler) renderCert(r *http.Request, c certRow, checks []checkRow) halalCertificate {
	p := httpx.PrincipalFrom(r.Context())
	isSupportOnly := p.HasRole(httpx.RoleSupportAgent) && !p.HasRole(httpx.RoleAdmin) && !p.HasRole(httpx.RoleSuperAdmin)

	out := halalCertificate{
		ID:               c.ID,
		RestaurantID:     c.RestaurantID,
		Status:           c.Status,
		ChecklistVersion: c.ChecklistVersion,
		ExpiresOn:        dateStr(c.ExpiresOn),
	}
	if c.RejectionReasonCode != nil {
		out.RejectionReasonCode = c.RejectionReasonCode
	}

	// Issuing body: support agents see only the name; admins see the full body.
	if c.IssuingBodyID != nil {
		body, err := h.repo.GetIssuingBody(r.Context(), *c.IssuingBodyID)
		if err == nil {
			b := renderIssuingBody(body)
			if isSupportOnly {
				out.IssuingBody = &halalIssuingBody{ID: b.ID, Name: b.Name, Status: b.Status}
			} else {
				out.IssuingBody = &b
			}
		}
	}

	if isSupportOnly {
		out.Checks = []halalCheck{}
		return out
	}

	out.DocumentID = c.DocumentID
	out.CertificateNumber = c.CertificateNumber
	out.CertifiedLegalName = c.CertifiedLegalName
	out.CertifiedAddress = c.CertifiedAddress
	out.Scope = c.Scope
	out.IssuedOn = dateStr(c.IssuedOn)
	out.RejectionReasonText = c.RejectionReasonText
	out.VerifiedBy = c.VerifiedBy
	out.VerifiedAt = tsPtr(c.VerifiedAt)

	out.Checks = make([]halalCheck, 0, len(checks))
	for _, ck := range checks {
		hc := halalCheck{
			CheckKey:    ck.CheckKey,
			Result:      ck.Result,
			Overridable: ck.Overridable,
			Note:        ck.Note,
			CheckedAt:   tsPtr(ck.CheckedAt),
		}
		if ck.ComputedResult != "" {
			hc.ComputedResult = ptr(ck.ComputedResult)
		}
		out.Checks = append(out.Checks, hc)
	}
	return out
}

func (h *Handler) failCert(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such certificate.", nil)
		return
	}
	h.failInternal(w, r, err)
}

func (h *Handler) failInternal(w http.ResponseWriter, r *http.Request, err error) {
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
		"The server failed to process this request.", nil)
	_ = err
}
