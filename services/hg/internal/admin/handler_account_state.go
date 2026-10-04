package admin

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// accountActionBody is RestaurantAccountActionInput, RiderAccountActionInput and
// CustomerAccountActionInput: the same three fields, with each subject's own
// action and reason vocabulary checked by internal/accountstate.
type accountActionBody struct {
	Action     string `json:"action"`
	ReasonCode string `json:"reason_code"`
	ReasonText string `json:"reason_text"`
}

// ApplyRestaurantAccountAction implements applyRestaurantAccountAction: suspend,
// reinstate, delist, deactivate or ban a restaurant.
func (h *Handler) ApplyRestaurantAccountAction(w http.ResponseWriter, r *http.Request) {
	h.applyAccountAction(w, r, accountstate.Restaurant, chi.URLParam(r, "restaurantId"))
}

// ApplyRiderAccountAction implements applyRiderAccountAction: suspend, reinstate,
// deactivate or ban a rider.
func (h *Handler) ApplyRiderAccountAction(w http.ResponseWriter, r *http.Request) {
	h.applyAccountAction(w, r, accountstate.Rider, chi.URLParam(r, "riderAccountId"))
}

// ApplyCustomerAccountAction implements applyCustomerAccountAction: suspend,
// reinstate or ban a customer.
func (h *Handler) ApplyCustomerAccountAction(w http.ResponseWriter, r *http.Request) {
	h.applyAccountAction(w, r, accountstate.Customer, chi.URLParam(r, "customerAccountId"))
}

// applyAccountAction is the one path behind the three operations
// (https://github.com/shaiknoorullah/hg-mono/issues/253). The route already lets
// only admins and super admins in; the service checks again, from the verified
// principal, before reading the body, so a route registered wrongly can never
// let anyone else change an account.
func (h *Handler) applyAccountAction(w http.ResponseWriter, r *http.Request, subject accountstate.Subject, subjectID string) {
	p := httpx.PrincipalFrom(r.Context())
	superAdmin := p.HasRole(httpx.RoleSuperAdmin)
	if !superAdmin && !p.HasRole(httpx.RoleAdmin) {
		httpx.Fail(w, r, http.StatusForbidden, CodeForbiddenPermission,
			"Only admins and super admins can change an account's state.",
			map[string]any{"permission": string(subject) + ".account_state_change"})
		return
	}
	// Account actions are destructive staff actions, which the admin spec allows
	// only from a session signed in with two-step sign-in
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-02--role-based-access-control-model).
	// A staff session lasts at most 12 hours in total
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01),
	// so its two-step sign-in is never older than the spec's 12-hour limit.
	if !hasAMR(p, "pwd+totp") {
		httpx.Fail(w, r, http.StatusForbidden, CodeMFARequired,
			"Sign in with two-step sign-in to change an account's state.", nil)
		return
	}

	var in accountActionBody
	if !decodeJSON(w, r, &in) {
		return
	}
	action := accountstate.Action(in.Action)
	if !accountstate.KnownAction(subject, action) {
		fieldFail(w, r, "action", "action is not one of the actions for this kind of account")
		return
	}
	if !accountstate.ReasonAllowed(subject, action, in.ReasonCode) {
		fieldFail(w, r, "reason_code", "reason_code does not fit this action")
		return
	}
	if n := len([]rune(in.ReasonText)); n < 10 || n > 1000 {
		fieldFail(w, r, "reason_text", "reason_text must be between 10 and 1000 characters")
		return
	}
	if _, err := uuid.Parse(subjectID); err != nil {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such account.", nil)
		return
	}
	key, _ := httpx.IdempotencyKeyFrom(r.Context())

	row, err := h.repo.ApplyAccountAction(r.Context(),
		accountActionDeps{orders: h.accountOrders, notify: h.accountNotify},
		accountActionInput{
			Subject: subject, SubjectID: subjectID, Action: action,
			ReasonCode: in.ReasonCode, ReasonText: in.ReasonText,
			IdemKey: key, SuperAdmin: superAdmin, Actor: actorFrom(r),
		})
	if err != nil {
		h.failAccountAction(w, r, err)
		return
	}

	// Release the payment authorisations of the orders cancelled before the
	// restaurant accepted them, after the commit, as the restaurant's own reject
	// path does. A failure is logged; the release is idempotent per order and the
	// payments catch-up reconciles a missed one.
	for _, orderID := range row.releaseOrderIDs {
		if h.accountReleaser == nil {
			slog.Warn("account action: payment releaser not wired; authorisation not released",
				slog.String("order_id", orderID))
			continue
		}
		if err := h.accountReleaser.Void(r.Context(), orderID); err != nil {
			slog.Error("account action: releasing a cancelled order's authorisation failed",
				slog.String("order_id", orderID), slog.String("error", err.Error()))
		}
	}

	if row.Replayed {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	httpx.Respond(w, r, http.StatusOK, renderAccountStateChange(row))
}

// failAccountAction maps an account action's failure to its contract error.
func (h *Handler) failAccountAction(w http.ResponseWriter, r *http.Request, err error) {
	var ite *accountstate.IllegalTransitionError
	var perm permissionError
	var cert halalCertificateRequiredError
	var pre preconditionError
	var busy inFlightOrdersError
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such account.", nil)
	case errors.As(err, &ite):
		allowed := make([]string, 0, len(ite.Allowed))
		for _, a := range ite.Allowed {
			allowed = append(allowed, string(a))
		}
		httpx.Fail(w, r, http.StatusConflict, CodeIllegalStateTransition,
			"This action is not possible from the account's current state: "+ite.Why+".",
			map[string]any{"from_state": ite.From, "action": string(ite.Action), "allowed_actions": allowed})
	case errors.As(err, &perm):
		httpx.Fail(w, r, http.StatusForbidden, CodeForbiddenPermission,
			"Only a super admin can do this.", map[string]any{"permission": perm.permission})
	case errors.Is(err, errConfirmOwnProposal):
		httpx.Fail(w, r, http.StatusForbidden, CodeSelfApprovalNotOK,
			"A ban needs a second person: a different super admin must confirm it.", nil)
	case errors.Is(err, errActOnOwnAccount):
		httpx.Fail(w, r, http.StatusForbidden, CodeForbiddenPermission,
			"Staff cannot act on their own account or their own restaurant.", nil)
	case errors.Is(err, errStaffAccount):
		httpx.Fail(w, r, http.StatusForbidden, CodeForbiddenPermission,
			"Staff accounts are managed through the staff operations, not as customers.", nil)
	case errors.As(err, &cert):
		httpx.Fail(w, r, http.StatusConflict, CodeHalalCertRequired,
			"The restaurant can be listed again only with a current, verified halal certificate.",
			map[string]any{"halal_status": cert.state})
	case errors.As(err, &pre):
		httpx.Fail(w, r, http.StatusConflict, CodePreconditionNotMet,
			"The account cannot be reinstated yet.", map[string]any{"blockers": pre.Blockers})
	case errors.As(err, &busy):
		httpx.Fail(w, r, http.StatusConflict, CodeInFlightOrdersPresent,
			"The customer has accepted orders still in progress. Confirm the ban once they have finished.",
			map[string]any{"order_ids": busy.orderIDs})
	case errors.Is(err, errIdempotencyKeyReuse):
		httpx.Fail(w, r, http.StatusConflict, httpx.CodeIdempotencyKeyReuse,
			"This Idempotency-Key was already used for a different request.", nil)
	case errors.As(err, &pgErr) && pgErr.Code == "23514":
		// The database's own two-person and state checks (migration 00034) caught
		// a race the checks above could not see.
		httpx.Fail(w, r, http.StatusConflict, CodeIllegalStateTransition,
			"The account changed while this action was applied. Reload and try again.", nil)
	default:
		h.failInternal(w, r, err)
	}
}

func hasAMR(p httpx.Principal, method string) bool {
	for _, m := range p.AMR {
		if m == method {
			return true
		}
	}
	return false
}

// --- render ---

type banProposalDTO struct {
	ProposedBy string `json:"proposed_by"`
	ProposedAt string `json:"proposed_at"`
	LapsesAt   string `json:"lapses_at"`
}

// accountStateChangeDTO is AccountStateChange.
type accountStateChangeDTO struct {
	ID              string          `json:"id"`
	SubjectType     string          `json:"subject_type"`
	SubjectID       string          `json:"subject_id"`
	Action          string          `json:"action"`
	FromState       string          `json:"from_state"`
	ToState         string          `json:"to_state"`
	ReasonCode      string          `json:"reason_code"`
	ReasonText      string          `json:"reason_text"`
	ActorAccountID  string          `json:"actor_account_id"`
	BanProposal     *banProposalDTO `json:"ban_proposal"`
	DelistReasons   []string        `json:"delist_reasons"`
	MenuLocked      *bool           `json:"menu_locked"`
	SessionsRevoked int             `json:"sessions_revoked"`
	InFlight        accountInFlight `json:"in_flight"`
	CreatedAt       string          `json:"created_at"`
}

func renderAccountStateChange(row accountStateChangeRow) accountStateChangeDTO {
	out := accountStateChangeDTO{
		ID: row.ID, SubjectType: row.SubjectType, SubjectID: row.SubjectID, Action: row.Action,
		FromState: row.FromState, ToState: row.ToState, ReasonCode: row.ReasonCode,
		ReasonText: row.ReasonText, ActorAccountID: row.ActorAccountID,
		DelistReasons: append([]string{}, row.DelistReasons...), SessionsRevoked: row.SessionsRevoked,
		InFlight: row.InFlight, CreatedAt: httpx.Timestamp(row.CreatedAt),
	}
	if row.Action == string(accountstate.ProposeBan) {
		out.BanProposal = &banProposalDTO{
			ProposedBy: row.ActorAccountID,
			ProposedAt: httpx.Timestamp(row.CreatedAt),
			LapsesAt:   httpx.Timestamp(row.CreatedAt.Add(accountstate.BanProposalWindow)),
		}
	}
	if row.SubjectType == string(accountstate.Restaurant) {
		out.MenuLocked = ptr(accountstate.MenuLocked(row.ToState))
	}
	return out
}
