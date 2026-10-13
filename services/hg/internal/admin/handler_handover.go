package admin

import (
	"errors"
	"net/http"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handover"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// OverrideHandoverCode implements overrideHandoverCode.
// POST /v1/admin/orders/{orderId}/handover-override
// Roles: SUPPORT_AGENT, ADMIN, SUPER_ADMIN (the Policy in routes.go).
//
// The only way past a handover code (contracts/openapi.yaml,
// overrideHandoverCode; security review on
// https://github.com/shaiknoorullah/hg-mono/issues/183; backend
// https://github.com/shaiknoorullah/hg-mono/issues/310). When five wrong codes
// have locked a code, the kitchen cannot show it, or the customer cannot be
// reached at a met handover, support or an admin confirms the handover here,
// with a reason and a support case. The transition and the append-only audit
// record commit in one transaction. The rider has no override of their own.
//
// The token admits the request; the store then checks, in the override's own
// transaction, that the caller still holds a support or admin grant and an
// active staff account (a token outlives a suspension or a revoked role), and
// that the caller is not a party to the order: its customer, a rider it was
// assigned to, or its restaurant's staff, any of whom one account can also be.
//
// Step-up: the session must have signed in with two-step sign-in (amr
// pwd+totp), or the answer is 403 MFA_REQUIRED. Every admin and super-admin
// session already has; a support agent who signed in with a password alone has
// to sign in again with their authenticator. This is the strongest check the
// sessions carry today. The 12-hour window on the last two-step check that
// the admin spec asks of money and destructive actions (docs/spec/05-admin.md,
// "A-02 — Role-based access control model", rule 4) needs a step-up call and
// mfa_verified_at on the session, which is
// https://github.com/shaiknoorullah/hg-mono/issues/170.
func (h *Handler) OverrideHandoverCode(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	if !signedInWithTwoStep(p) {
		httpx.Fail(w, r, http.StatusForbidden, CodeMFARequired,
			"Sign in with two-step sign-in before confirming a handover without its code.", nil)
		return
	}

	orderID := chi.URLParam(r, "orderId")
	if !isUUID(orderID) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
		return
	}

	var in handoverOverrideInput
	if !decodeJSON(w, r, &in) {
		return
	}
	kind := handover.Kind(in.Handover)
	if !kind.Valid() {
		fieldFail(w, r, "handover", "handover must be PICKUP or DELIVERY")
		return
	}
	if n := utf8.RuneCountInString(in.Reason); n < 10 || n > 1000 {
		fieldFail(w, r, "reason", "reason must be between 10 and 1000 characters")
		return
	}
	if !isUUID(in.CaseID) {
		fieldFail(w, r, "case_id", "case_id must be the support case's UUID")
		return
	}

	// The actor kind (SUPPORT, or ADMIN for an admin or super admin) comes from
	// the live grant the store reads, not from the token.
	idemKey, _ := httpx.IdempotencyKeyFrom(r.Context())

	rec, replayed, err := h.ordersRepo.OverrideHandover(r.Context(), actorFrom(r), orderID, kind, in, idemKey)
	if err != nil {
		if errors.Is(err, errIdempotencyKeyReuse) {
			httpx.Fail(w, r, http.StatusConflict, httpx.CodeIdempotencyKeyReuse,
				"This Idempotency-Key was already used for a different override.", nil)
			return
		}
		if errors.Is(err, errStaffNotActive) {
			httpx.Fail(w, r, http.StatusForbidden, CodeAccountNotActive,
				"Your staff account is not active.", nil)
			return
		}
		if errors.Is(err, errStaffRoleRevoked) {
			httpx.Fail(w, r, http.StatusForbidden, CodeForbidden,
				"You do not have permission to perform this action.",
				map[string]any{"required": string(ActionOrderHandoverOverride)})
			return
		}
		if errors.Is(err, errPartyToOrder) {
			httpx.Fail(w, r, http.StatusForbidden, CodeForbidden,
				"You cannot confirm a handover on an order you are part of. Ask another member of support.", nil)
			return
		}
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such order.", nil)
			return
		}
		var illegal *orders.IllegalTransitionError
		if errors.As(err, &illegal) {
			allowed := make([]string, 0, len(illegal.Allowed))
			for _, s := range illegal.Allowed {
				allowed = append(allowed, string(s))
			}
			httpx.Fail(w, r, http.StatusConflict, CodeIllegalTransition,
				"This order is not waiting on that handover.",
				map[string]any{"from": string(illegal.From), "to": string(illegal.To), "allowed": allowed})
			return
		}
		h.failInternal(w, r, err)
		return
	}
	if replayed {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	httpx.Respond(w, r, http.StatusOK, rec)
}

// signedInWithTwoStep reports whether the session signed in with password and
// authenticator (P-04 amr "pwd+totp").
func signedInWithTwoStep(p httpx.Principal) bool {
	for _, m := range p.AMR {
		if m == "pwd+totp" {
			return true
		}
	}
	return false
}
