package admin

import (
	"net/http"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ListRestaurantApplications implements listRestaurantApplications (A-13).
func (h *Handler) ListRestaurantApplications(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)
	states := splitCSV(r.URL.Query().Get("state"))
	cur, curID, ok := decodeTimeCursor(r)
	if !ok {
		fieldFail(w, r, "cursor", "malformed cursor")
		return
	}
	rows, err := h.repo.ListRestaurantApplications(r.Context(), states, limit+1, cur, curID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]restaurantApplicationSummary, 0, len(rows))
	for _, a := range rows {
		out = append(out, renderRestaurantSummary(a))
	}
	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		meta.NextCursor = ptr(encodeTimeCursor(last.SubmittedAt, last.RestaurantID))
	}
	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// TakeNextRestaurantApplication implements takeNextRestaurantApplication (A-13).
// Returns data:null when the queue is empty.
func (h *Handler) TakeNextRestaurantApplication(w http.ResponseWriter, r *http.Request) {
	row, err := h.repo.TakeNextRestaurantApplication(r.Context(), actorFrom(r))
	if err != nil {
		if err == ErrNotFound {
			httpx.Respond(w, r, http.StatusOK, nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderRestaurantSummary(row))
}

// ListRiderApplications implements listRiderApplications (A-23).
func (h *Handler) ListRiderApplications(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)
	states := splitCSV(r.URL.Query().Get("state"))
	cur, curID, ok := decodeTimeCursor(r)
	if !ok {
		fieldFail(w, r, "cursor", "malformed cursor")
		return
	}
	rows, err := h.repo.ListRiderApplications(r.Context(), states, limit+1, cur, curID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]riderApplicationSummary, 0, len(rows))
	for _, a := range rows {
		out = append(out, renderRiderSummary(a))
	}
	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		meta.NextCursor = ptr(encodeTimeCursor(last.SubmittedAt, last.AccountID))
	}
	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// TakeNextRiderApplication implements takeNextRiderApplication (A-23).
func (h *Handler) TakeNextRiderApplication(w http.ResponseWriter, r *http.Request) {
	row, err := h.repo.TakeNextRiderApplication(r.Context(), actorFrom(r))
	if err != nil {
		if err == ErrNotFound {
			httpx.Respond(w, r, http.StatusOK, nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderRiderSummary(row))
}

func renderRestaurantSummary(a restaurantAppRow) restaurantApplicationSummary {
	out := restaurantApplicationSummary{
		RestaurantID:        a.RestaurantID,
		DisplayName:         a.DisplayName,
		City:                a.City,
		Province:            a.Province,
		OnboardingState:     a.OnboardingState,
		SubmissionCount:     ptr(a.SubmissionCount),
		AssignedAdminID:     a.AssignedAdminID,
		ReviewLockExpiresAt: tsPtr(a.ReviewLockExpiresAt),
		SubmittedAt:         httpx.Timestamp(a.SubmittedAt),
		SLADueAt:            httpx.Timestamp(a.SLADueAt),
	}
	return out
}

func renderRiderSummary(a riderAppRow) riderApplicationSummary {
	return riderApplicationSummary{
		RiderAccountID:      a.AccountID,
		DisplayName:         a.DisplayName,
		VehicleType:         a.VehicleType,
		OnboardingState:     a.OnboardingState,
		AttemptNumber:       ptr(a.AttemptNumber),
		AssignedAdminID:     a.AssignedAdminID,
		ReviewLockExpiresAt: tsPtr(a.ReviewLockExpiresAt),
		SubmittedAt:         httpx.Timestamp(a.SubmittedAt),
		SLADueAt:            httpx.Timestamp(a.SLADueAt),
	}
}
