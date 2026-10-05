package admin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

var validStaffRole = map[string]bool{"SUPPORT_AGENT": true, "ADMIN": true, "SUPER_ADMIN": true}

// ListStaff implements listStaff (A-01). Admins read; only a super admin mutates.
func (h *Handler) ListStaff(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)
	cur, curID, ok := decodeTimeCursor(r)
	if !ok {
		fieldFail(w, r, "cursor", "malformed cursor")
		return
	}
	rows, err := h.repo.ListStaff(r.Context(), limit+1, cur, curID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	out := make([]staffUser, 0, len(rows))
	for _, s := range rows {
		out = append(out, staffUser{
			ID:          s.ID,
			Email:       s.Email,
			FullName:    s.FullName,
			Role:        s.Role,
			Status:      s.Status,
			MFAEnrolled: s.MFAEnrolled,
			LastLoginAt: tsPtr(s.LastLoginAt),
			CreatedAt:   httpx.Timestamp(s.CreatedAt),
		})
	}
	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		meta.NextCursor = ptr(encodeTimeCursor(last.CreatedAt, last.ID))
	}
	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// CreateStaffUser implements createStaffUser (A-01, super-admin only). The
// creator sets no password; the account is INVITED. A staff user may never
// change their own role — not reachable on create, but the self-guard is a hard
// invariant elsewhere (A-01 R3).
func (h *Handler) CreateStaffUser(w http.ResponseWriter, r *http.Request) {
	var in staffUserInput
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	if in.Email == "" || len(in.Email) > 254 || !strings.Contains(in.Email, "@") {
		fieldFail(w, r, "email", "a valid email is required")
		return
	}
	if l := len([]rune(in.FullName)); l < 2 || l > 120 {
		fieldFail(w, r, "full_name", "full_name must be 2..120 characters")
		return
	}
	if !validStaffRole[in.Role] {
		fieldFail(w, r, "role", "role must be SUPPORT_AGENT, ADMIN or SUPER_ADMIN")
		return
	}
	row, err := h.repo.CreateStaff(r.Context(), actorFrom(r), in)
	if err != nil {
		if errors.Is(err, ErrEmailInUse) {
			httpx.Fail(w, r, http.StatusConflict, CodeEmailInUse,
				"That email already belongs to an account.", nil)
			return
		}
		if errors.Is(err, notify.ErrInviteLimited) {
			w.Header().Set("Retry-After", "86400")
			httpx.Fail(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
				"Too many invitations today. Try again tomorrow.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, staffUser{
		ID:          row.ID,
		Email:       row.Email,
		FullName:    row.FullName,
		Role:        row.Role,
		Status:      row.Status,
		MFAEnrolled: row.MFAEnrolled,
		LastLoginAt: nil,
		CreatedAt:   httpx.Timestamp(row.CreatedAt),
	})
}
