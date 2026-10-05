package admin

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// The platform-wide pause on new orders, for use during an incident
// (https://github.com/shaiknoorullah/hg-mono/issues/244): getOrderingPause and
// setOrderingPause. The switch itself, and what it refuses, belong to the
// orders module (internal/orders/ordering_pause.go); this file is the staff
// surface and the audit row.
//
// Who may change it: ADMIN and SUPER_ADMIN. It is an operations control, like
// pausing a promotion or suspending a restaurant, both of which the permission
// matrix gives to those two roles (docs/spec/05-admin.md, "RBAC permission
// matrix"). SUPPORT_AGENT may read it, to tell a customer why checkout is
// refused, but not change it: a support agent "changes almost nothing", and
// stopping every new order on the platform is not a support action
// (docs/spec/05-admin.md, "The three roles"). The role→action mapping is in
// internal/auth/matrix.go.

// orderingPauseReasonMin and orderingPauseReasonMax bound the reason, the same
// as the contract's OrderingPauseInput.reason and the table's CHECK.
const (
	orderingPauseReasonMin = 10
	orderingPauseReasonMax = 500
)

// orderingPauseDTO is the contract's OrderingPause.
type orderingPauseDTO struct {
	Paused      bool    `json:"paused"`
	PausedSince *string `json:"paused_since"`
	Reason      *string `json:"reason"`
	ChangedAt   *string `json:"changed_at"`
	ChangedBy   *string `json:"changed_by"`
}

// orderingPauseInput is the contract's OrderingPauseInput. Paused is a pointer
// so a body without it is refused rather than read as "resume".
type orderingPauseInput struct {
	Paused *bool  `json:"paused"`
	Reason string `json:"reason"`
}

func renderOrderingPause(p orders.OrderingPause) orderingPauseDTO {
	return orderingPauseDTO{
		Paused:      p.Paused,
		PausedSince: tsPtr(p.PausedSince),
		Reason:      p.Reason,
		ChangedAt:   tsPtr(p.ChangedAt),
		ChangedBy:   p.ChangedBy,
	}
}

// GetOrderingPause implements getOrderingPause.
func (h *Handler) GetOrderingPause(w http.ResponseWriter, r *http.Request) {
	p, err := orders.NewStore(h.repo.pool).OrderingPause(r.Context())
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderOrderingPause(p))
}

// SetOrderingPause implements setOrderingPause: pause or resume new orders
// platform-wide, with a reason, audited in the same transaction.
func (h *Handler) SetOrderingPause(w http.ResponseWriter, r *http.Request) {
	var in orderingPauseInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Paused == nil {
		fieldFail(w, r, "paused", "paused is required: true to pause new orders, false to resume them")
		return
	}
	reason := strings.TrimSpace(in.Reason)
	if n := utf8.RuneCountInString(reason); n < orderingPauseReasonMin || n > orderingPauseReasonMax {
		fieldFail(w, r, "reason", "reason must be 10..500 characters")
		return
	}
	out, err := h.repo.SetOrderingPause(r.Context(), actorFrom(r), *in.Paused, reason)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, renderOrderingPause(out))
}

// SetOrderingPause changes the switch and writes its audit row in one
// transaction (the audit log's rule: the change and its record commit together
// or not at all). The action is ordering.pause or ordering.resume, on subject
// type PLATFORM, with the reason and the state before and after.
func (r *Repo) SetOrderingPause(ctx context.Context, actor auditActor, paused bool, reason string) (orders.OrderingPause, error) {
	var out orders.OrderingPause
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		before, after, err := orders.SetOrderingPauseTx(ctx, tx, paused, reason, actor.staffID)
		if err != nil {
			return err
		}
		action := "ordering.resume"
		if paused {
			action = "ordering.pause"
		}
		out = after
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      action,
			subjectType: "PLATFORM",
			outcome:     "SUCCESS",
			reason:      &reason,
			before:      orderingPauseAudit(before),
			after:       orderingPauseAudit(after),
		})
	})
	return out, err
}

func orderingPauseAudit(p orders.OrderingPause) map[string]any {
	return map[string]any{
		"paused":       p.Paused,
		"paused_since": tsPtr(p.PausedSince),
		"reason":       p.Reason,
	}
}
