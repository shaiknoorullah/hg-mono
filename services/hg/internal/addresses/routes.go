package addresses

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Actions owned by this module (P-05 / I-05.2).
const (
	ActionAddressRead       httpx.Action = "address.read"
	ActionAddressWrite      httpx.Action = "address.write"
	ActionAddressDelete     httpx.Action = "address.delete"
	ActionAddressSetDefault httpx.Action = "address.set_default"
)

// Routes registers the customer address routes. Every route is authenticated
// (CUSTOMER only) — none is public (G-4 / I-06.1).
func Routes(r *httpx.Router, h *Handler) {
	read := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassRead, OperationID: op}
	}
	write := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassWrite, Idempotent: true, OperationID: op}
	}
	writeNoIdem := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassWrite, OperationID: op}
	}

	r.Get("/v1/addresses",
		read(ActionAddressRead, "listAddresses"), h.ListAddresses)
	r.Post("/v1/addresses",
		write(ActionAddressWrite, "createAddress"), h.CreateAddress)

	r.Get("/v1/addresses/{addressId}",
		read(ActionAddressRead, "getAddress"), func(w http.ResponseWriter, r *http.Request) {
			h.GetAddress(w, r, chi.URLParam(r, "addressId"))
		})
	r.Patch("/v1/addresses/{addressId}",
		writeNoIdem(ActionAddressWrite, "updateAddress"), func(w http.ResponseWriter, r *http.Request) {
			h.UpdateAddress(w, r, chi.URLParam(r, "addressId"))
		})
	r.Delete("/v1/addresses/{addressId}",
		writeNoIdem(ActionAddressDelete, "deleteAddress"), func(w http.ResponseWriter, r *http.Request) {
			h.DeleteAddress(w, r, chi.URLParam(r, "addressId"))
		})

	r.Post("/v1/addresses/{addressId}/default",
		writeNoIdem(ActionAddressSetDefault, "setDefaultAddress"), func(w http.ResponseWriter, r *http.Request) {
			h.SetDefaultAddress(w, r, chi.URLParam(r, "addressId"))
		})
}
