package admin

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

var validIssuerStatus = map[string]bool{
	"PROPOSED": true, "ACCEPTED": true, "SUSPENDED": true, "RETIRED": true, "REJECTED": true,
}

// ListHalalIssuingBodies implements listHalalIssuingBodies. Support agents see
// name and status only (A-16).
func (h *Handler) ListHalalIssuingBodies(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)
	var statuses []string
	if q := r.URL.Query().Get("status"); q != "" {
		for _, s := range splitCSV(q) {
			if !validIssuerStatus[s] {
				fieldFail(w, r, "status", "unknown status "+s)
				return
			}
			statuses = append(statuses, s)
		}
	}
	cur, curID, ok := decodeCursor(r)
	if !ok {
		fieldFail(w, r, "cursor", "malformed cursor")
		return
	}
	var curName *string
	if cur != nil {
		curName = cur
	}
	bodies, err := h.repo.ListIssuingBodies(r.Context(), statuses, limit+1, curName, curID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	p := httpx.PrincipalFrom(r.Context())
	supportOnly := p.HasRole(httpx.RoleSupportAgent) && !p.HasRole(httpx.RoleAdmin) && !p.HasRole(httpx.RoleSuperAdmin)

	hasMore := len(bodies) > limit
	if hasMore {
		bodies = bodies[:limit]
	}
	out := make([]halalIssuingBody, 0, len(bodies))
	for _, b := range bodies {
		rb := renderIssuingBody(b)
		if supportOnly {
			rb = halalIssuingBody{ID: rb.ID, Name: rb.Name, Status: rb.Status}
		}
		out = append(out, rb)
	}
	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(bodies) > 0 {
		last := bodies[len(bodies)-1]
		meta.NextCursor = ptr(encodeCursor(last.Name, last.ID))
	}
	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// ProposeHalalIssuingBody implements proposeHalalIssuingBody. An admin may only
// propose; ACCEPTED is a super-admin act via setHalalIssuingBodyStatus (A-16).
func (h *Handler) ProposeHalalIssuingBody(w http.ResponseWriter, r *http.Request) {
	var in halalIssuingBodyInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if l := len([]rune(in.Name)); l < 2 || l > 200 {
		fieldFail(w, r, "name", "name must be 2..200 characters")
		return
	}
	if l := len([]rune(in.Justification)); l < 20 || l > 2000 {
		fieldFail(w, r, "justification", "justification must be 20..2000 characters")
		return
	}
	row := issuingBodyRow{Name: in.Name, Aliases: in.Aliases}
	if in.Country != "" {
		row.Country = ptr(in.Country)
	}
	if in.Region != "" {
		row.Region = ptr(in.Region)
	}
	if in.Website != "" {
		row.Website = ptr(in.Website)
	}
	if in.AccreditationRef != "" {
		row.AccreditationRef = ptr(in.AccreditationRef)
	}
	if row.Aliases == nil {
		row.Aliases = []string{}
	}
	out, err := h.repo.ProposeIssuingBody(r.Context(), actorFrom(r), row, in.Justification)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	rb := renderIssuingBody(out)
	httpx.Respond(w, r, http.StatusCreated, rb)
}

// SetHalalIssuingBodyStatus implements setHalalIssuingBodyStatus (super-admin).
func (h *Handler) SetHalalIssuingBodyStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "bodyId")
	var in halalIssuingBodyStatusInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validIssuerStatus[in.Status] {
		fieldFail(w, r, "status", "unknown status")
		return
	}
	if l := len([]rune(in.Justification)); l < 20 || l > 2000 {
		fieldFail(w, r, "justification", "justification must be 20..2000 characters")
		return
	}
	out, err := h.repo.SetIssuingBodyStatus(r.Context(), actorFrom(r), id, in.Status, in.RequiresIssuerConfirmation, in.Justification)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such issuing body.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderIssuingBody(out))
}

func renderIssuingBody(b issuingBodyRow) halalIssuingBody {
	out := halalIssuingBody{
		ID:                         b.ID,
		Name:                       b.Name,
		Aliases:                    b.Aliases,
		Country:                    b.Country,
		Region:                     b.Region,
		Website:                    b.Website,
		AccreditationRef:           b.AccreditationRef,
		RequiresIssuerConfirmation: b.RequiresIssuerConfirmation,
		Status:                     b.Status,
		Notes:                      b.Notes,
	}
	if out.Aliases == nil {
		out.Aliases = []string{}
	}
	return out
}
