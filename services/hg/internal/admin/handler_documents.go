package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

var validDocReason = map[string]bool{
	"ILLEGIBLE": true, "EXPIRED": true, "WRONG_DOCUMENT_TYPE": true, "NAME_MISMATCH": true,
	"DOB_MISMATCH": true, "ADDRESS_MISMATCH": true, "PLATE_MISMATCH": true,
	"SUSPECTED_FORGERY": true, "OTHER": true,
}

// ReviewRestaurantDocument implements reviewRestaurantDocument (A-14).
func (h *Handler) ReviewRestaurantDocument(w http.ResponseWriter, r *http.Request) {
	h.reviewDocument(w, r, "RESTAURANT")
}

// ReviewRiderDocument implements reviewRiderDocument (A-23/A-14).
func (h *Handler) ReviewRiderDocument(w http.ResponseWriter, r *http.Request) {
	h.reviewDocument(w, r, "RIDER")
}

func (h *Handler) reviewDocument(w http.ResponseWriter, r *http.Request, subjectType string) {
	id := chi.URLParam(r, "documentId")
	var in documentReviewInput
	if !decodeJSON(w, r, &in) {
		return
	}
	switch in.Decision {
	case "APPROVE":
	case "REJECT":
		if in.RejectionReasonCode == nil || !validDocReason[*in.RejectionReasonCode] {
			fieldFail(w, r, "rejection_reason_code", "a valid rejection_reason_code is required to reject")
			return
		}
		// review_note must be >= 20 chars when the code is OTHER.
		if *in.RejectionReasonCode == "OTHER" && (in.ReviewNote == nil || len([]rune(*in.ReviewNote)) < 20) {
			fieldFail(w, r, "review_note", "a note of at least 20 characters is required when the reason is OTHER")
			return
		}
	default:
		fieldFail(w, r, "decision", "decision must be APPROVE or REJECT")
		return
	}
	if in.ReviewNote != nil && len([]rune(*in.ReviewNote)) > 1000 {
		fieldFail(w, r, "review_note", "review_note must be at most 1000 characters")
		return
	}

	p := httpx.PrincipalFrom(r.Context())
	isSuper := p.HasRole(httpx.RoleSuperAdmin)

	out, err := h.repo.ReviewDocument(r.Context(), actorFrom(r), id, subjectType, in.Decision, in.RejectionReasonCode, in.ReviewNote, isSuper)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such document.", nil)
		case errors.Is(err, ErrForgeryHold):
			httpx.Fail(w, r, http.StatusConflict, CodePreconditionNotMet,
				"A suspected-forgery finding must be cleared by a super admin before approval.", nil)
		case errors.Is(err, ErrDocNotScanned):
			httpx.Fail(w, r, http.StatusConflict, CodePreconditionNotMet,
				"The document's file has not passed the virus scan, so it cannot be approved yet.", nil)
		case errors.Is(err, ErrDocDecided):
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided, "The document is already decided.", nil)
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderDoc(out))
}

func renderDoc(d kycDocRow) kycDocument {
	return kycDocument{
		ID:                  d.ID,
		SubjectType:         d.SubjectType,
		SubjectID:           d.SubjectID,
		DocType:             d.DocType,
		State:               d.State,
		Issuer:              d.Issuer,
		CertificateNumber:   d.CertificateNumber,
		IssuedOn:            dateStr(d.IssuedOn),
		ValidUntil:          dateStr(d.ValidUntil),
		Version:             d.Version,
		RejectionReasonCode: d.RejectionReasonCode,
		ReviewNote:          d.ReviewNote,
		ReviewedAt:          tsPtr(d.ReviewedAt),
		CreatedAt:           httpx.Timestamp(d.CreatedAt),
	}
}
