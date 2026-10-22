package geo

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ActionSearch is the permission to use address search. The contract gives all
// three operations the same roles (CUSTOMER, RESTAURANT_OWNER,
// RESTAURANT_MANAGER), and internal/auth/matrix.go grants it to exactly those.
const ActionSearch httpx.Action = "geo.search"

// Routes registers the three address-search operations. None is public: each
// needs a signed-in customer, restaurant owner or restaurant manager, because
// every call costs money at the provider and is rate-limited per account.
func Routes(r *httpx.Router, h *Handler) {
	policy := func(op string) httpx.Policy {
		return httpx.Policy{Action: ActionSearch, Class: httpx.ClassRead, OperationID: op}
	}
	r.Get("/v1/geo/autocomplete", policy("suggestAddresses"), h.SuggestAddresses)
	r.Get("/v1/geo/places/{placeId}", policy("getPlaceAddress"), func(w http.ResponseWriter, r *http.Request) {
		h.GetPlaceAddress(w, r, chi.URLParam(r, "placeId"))
	})
	r.Get("/v1/geo/reverse", policy("reverseGeocode"), h.ReverseGeocode)
}
