package account

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Actions owned by this module. Typed constants, never string literals at
// the call site (I-05.2). The auth matrix must be updated to include these.
const (
	ActionProfileWrite     httpx.Action = "account.profile_write"
	ActionDeviceWrite      httpx.Action = "account.device_write"
	ActionNotificationRead httpx.Action = "account.notification_read"
	ActionNotificationAck  httpx.Action = "account.notification_ack"
)

// Routes registers the account self-service routes. Every route carries an
// explicit Policy — no route is Public (deny by default, G-4 / I-06.2).
func Routes(r *httpx.Router, h *Handler) {
	r.Patch("/v1/me/profile",
		httpx.Policy{Action: ActionProfileWrite, Class: httpx.ClassWrite, OperationID: "updateCustomerProfile"},
		h.UpdateCustomerProfile)

	r.Post("/v1/devices",
		httpx.Policy{Action: ActionDeviceWrite, Class: httpx.ClassWrite, OperationID: "registerDevice"},
		h.RegisterDevice)

	r.Delete("/v1/devices/{deviceId}",
		httpx.Policy{Action: ActionDeviceWrite, Class: httpx.ClassWrite, OperationID: "unregisterDevice"},
		h.UnregisterDevice)

	r.Get("/v1/notifications",
		httpx.Policy{Action: ActionNotificationRead, Class: httpx.ClassRead, OperationID: "listNotifications"},
		h.ListNotifications)

	r.Post("/v1/notifications/{notificationId}/read",
		httpx.Policy{Action: ActionNotificationAck, Class: httpx.ClassWrite, OperationID: "markNotificationRead"},
		h.MarkNotificationRead)
}
