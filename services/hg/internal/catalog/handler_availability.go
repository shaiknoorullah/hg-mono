package catalog

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// resolveRestaurant maps the request's principal to the restaurant it acts for.
// A principal with no restaurant scope, or no resolver wired, is a 403 — the
// deny-by-default answer for a staff route with no established relationship.
func (h *Handler) resolveRestaurant(w http.ResponseWriter, r *http.Request) (string, bool) {
	if h.scope == nil {
		// TODO(auth/staff sibling): inject a RestaurantScopeResolver backed by the
		// account_role table. Until then a staff route cannot establish which
		// restaurant the caller acts for and must deny.
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden,
			"No restaurant is associated with this account.", nil)
		return "", false
	}
	id, ok := h.scope.RestaurantForPrincipal(r.Context(), httpx.PrincipalFrom(r.Context()))
	if !ok {
		httpx.Fail(w, r, http.StatusForbidden, httpx.CodeForbidden,
			"No restaurant is associated with this account.", nil)
		return "", false
	}
	return id, true
}

// toRestaurantAvailability builds the restaurant-facing availability DTO from a
// row and the derived open-state verdict.
func toRestaurantAvailability(a availabilityRow, verdict openStateVerdict) RestaurantAvailability {
	out := RestaurantAvailability{
		OpenState:         verdict.state,
		IsAcceptingOrders: a.isAcceptingOrders,
		MissedOrderCount:  a.missedOrderCount,
		Reason:            verdict.reason,
		ResolvableBy:      verdict.resolvableBy,
	}
	if a.pauseUntil != nil {
		s := httpx.Timestamp(*a.pauseUntil)
		out.PauseUntil = &s
	}
	if a.lastHeartbeatAt != nil {
		s := httpx.Timestamp(*a.lastHeartbeatAt)
		out.LastHeartbeatAt = &s
	}
	return out
}

// GetRestaurantAvailability implements getRestaurantAvailability (R-22).
func (h *Handler) GetRestaurantAvailability(w http.ResponseWriter, r *http.Request) {
	restaurantID, ok := h.resolveRestaurant(w, r)
	if !ok {
		return
	}
	a, err := h.repo.getAvailability(r.Context(), restaurantID)
	if h.mapErr(w, r, err) {
		return
	}
	// TODO(scope): within-hours and holiday evaluation in the restaurant's
	// timezone. Until the hours join lands, both are treated as "open" — a
	// conservative default that only ever reports MORE open, which the toggle and
	// heartbeat gates still override.
	verdict := deriveOpenState(a, h.now(), true, false)
	httpx.Respond(w, r, http.StatusOK, toRestaurantAvailability(a, verdict))
}

// setAcceptingOrdersInput is the request body for setRestaurantAcceptingOrders.
// additionalProperties:false is enforced by DisallowUnknownFields so an
// is_accepting or isAccepting spelling is 422 UNKNOWN_FIELD, not a cheerful 200.
type setAcceptingOrdersInput struct {
	IsAcceptingOrders *bool   `json:"is_accepting_orders"`
	PauseUntil        *string `json:"pause_until"`
}

// SetRestaurantAcceptingOrders implements setRestaurantAcceptingOrders (R-22).
func (h *Handler) SetRestaurantAcceptingOrders(w http.ResponseWriter, r *http.Request) {
	restaurantID, ok := h.resolveRestaurant(w, r)
	if !ok {
		return
	}

	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	var in setAcceptingOrdersInput
	if err := dec.Decode(&in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeUnknownField,
			"The request body has an unexpected or malformed field.", nil)
		return
	}
	if in.IsAcceptingOrders == nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"is_accepting_orders is required.",
			[]httpx.FieldError{{Field: "is_accepting_orders", Code: "required", Message: "is_accepting_orders is required"}})
		return
	}

	var pause *time.Time
	if in.PauseUntil != nil {
		t, err := time.Parse(time.RFC3339, *in.PauseUntil)
		if err != nil {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
				"pause_until must be an RFC3339 timestamp.",
				[]httpx.FieldError{{Field: "pause_until", Code: "invalid", Message: "not a timestamp"}})
			return
		}
		pause = &t
	}

	a, err := h.repo.setAcceptingOrders(r.Context(), restaurantID, *in.IsAcceptingOrders, pause)
	if h.mapErr(w, r, err) {
		return
	}
	verdict := deriveOpenState(a, h.now(), true, false)
	httpx.Respond(w, r, http.StatusOK, toRestaurantAvailability(a, verdict))
}

// SendRestaurantHeartbeat implements sendRestaurantHeartbeat (R-22): stamps the
// heartbeat and returns the current open state. Never mutates is_accepting_orders.
func (h *Handler) SendRestaurantHeartbeat(w http.ResponseWriter, r *http.Request) {
	restaurantID, ok := h.resolveRestaurant(w, r)
	if !ok {
		return
	}
	a, received, err := h.repo.recordHeartbeat(r.Context(), restaurantID)
	if h.mapErr(w, r, err) {
		return
	}
	verdict := deriveOpenState(a, h.now(), true, false)
	httpx.Respond(w, r, http.StatusOK, RestaurantHeartbeat{
		OpenState:  verdict.state,
		ReceivedAt: httpx.Timestamp(received),
	})
}
