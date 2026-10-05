package restaurant

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Actions owned by this module. Declared here so the auth matrix can import
// them as constants and every handler uses a typed constant, never a string
// literal (I-05.2).
const (
	ActionOnboardingRead    httpx.Action = "restaurant.onboarding_read"
	ActionProfileRead       httpx.Action = "restaurant.profile_read"
	ActionProfileWrite      httpx.Action = "restaurant.profile_write"
	ActionHoursRead         httpx.Action = "restaurant.hours_read"
	ActionHoursWrite        httpx.Action = "restaurant.hours_write"
	ActionDocumentsRead     httpx.Action = "restaurant.documents_read"
	ActionDocumentsWrite    httpx.Action = "restaurant.documents_write"
	ActionDocumentsSubmit   httpx.Action = "restaurant.documents_submit"
	ActionMenuRead          httpx.Action = "restaurant.menu_read_own"
	ActionMenuCategoryWrite httpx.Action = "restaurant.menu_category_write"
	ActionMenuItemWrite     httpx.Action = "restaurant.menu_item_write"
	ActionMenuItemAvail     httpx.Action = "restaurant.menu_item_availability"
	ActionOrderRead         httpx.Action = "restaurant.order_read"
	ActionOrderAccept       httpx.Action = "restaurant.order_accept"
	ActionOrderReject       httpx.Action = "restaurant.order_reject"
	ActionOrderReady        httpx.Action = "restaurant.order_ready"
	ActionOrderDelay        httpx.Action = "restaurant.order_delay"
	ActionStaffRead         httpx.Action = "restaurant.staff_read"
	ActionStaffWrite        httpx.Action = "restaurant.staff_write"
)

// Routes registers the restaurant-partner routes.  Every route carries an
// explicit Policy — no route is Public (deny by default, G-4 / I-06.2).
// MONEY-class routes (accept, reject) set Idempotent (I-37.4).
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
	money := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassMoney, Idempotent: true, OperationID: op}
	}

	// Onboarding (R-04).
	r.Get("/v1/restaurant/onboarding/status",
		read(ActionOnboardingRead, "getRestaurantOnboardingStatus"), h.GetRestaurantOnboardingStatus)

	// Profile (R-05).
	r.Get("/v1/restaurant/profile",
		read(ActionProfileRead, "getRestaurantProfile"), h.GetRestaurantProfile)
	r.Put("/v1/restaurant/profile",
		writeNoIdem(ActionProfileWrite, "submitRestaurantProfile"), h.SubmitRestaurantProfile)

	// Hours (R-06).
	r.Get("/v1/restaurant/hours",
		read(ActionHoursRead, "getRestaurantHours"), h.GetRestaurantHours)
	r.Put("/v1/restaurant/hours",
		writeNoIdem(ActionHoursWrite, "setRestaurantHours"), h.SetRestaurantHours)

	// Documents (R-07 / R-08).
	r.Get("/v1/restaurant/documents",
		read(ActionDocumentsRead, "listRestaurantDocuments"), h.ListRestaurantDocuments)
	r.Post("/v1/restaurant/documents",
		write(ActionDocumentsWrite, "attachRestaurantDocument"), h.AttachRestaurantDocument)
	r.Post("/v1/restaurant/documents/submit",
		write(ActionDocumentsSubmit, "submitRestaurantDocuments"), h.SubmitRestaurantDocuments)

	// Menu (R-14 … R-18).
	r.Get("/v1/restaurant/menu",
		read(ActionMenuRead, "getOwnMenu"), h.GetOwnMenu)
	r.Post("/v1/restaurant/menu/categories",
		write(ActionMenuCategoryWrite, "createMenuCategory"), h.CreateMenuCategory)
	r.Patch("/v1/restaurant/menu/categories/{categoryId}",
		writeNoIdem(ActionMenuCategoryWrite, "updateMenuCategory"), h.UpdateMenuCategory)
	r.Post("/v1/restaurant/menu/items",
		write(ActionMenuItemWrite, "createMenuItem"), h.CreateMenuItem)
	r.Patch("/v1/restaurant/menu/items/{itemId}",
		writeNoIdem(ActionMenuItemWrite, "updateMenuItem"), h.UpdateMenuItem)
	r.Put("/v1/restaurant/menu/items/{itemId}/availability",
		writeNoIdem(ActionMenuItemAvail, "setMenuItemAvailability"), h.SetMenuItemAvailability)

	// Orders (R-23 … R-26).
	r.Get("/v1/restaurant/orders",
		read(ActionOrderRead, "listRestaurantOrders"), h.ListRestaurantOrders)
	r.Get("/v1/restaurant/orders/{orderId}",
		read(ActionOrderRead, "getRestaurantOrder"), h.GetRestaurantOrder)
	r.Post("/v1/restaurant/orders/{orderId}/accept",
		money(ActionOrderAccept, "acceptOrder"), h.AcceptOrder)
	r.Post("/v1/restaurant/orders/{orderId}/reject",
		money(ActionOrderReject, "rejectOrder"), h.RejectOrder)
	r.Post("/v1/restaurant/orders/{orderId}/ready",
		write(ActionOrderReady, "markOrderReady"), h.MarkOrderReady)
	r.Post("/v1/restaurant/orders/{orderId}/delay",
		write(ActionOrderDelay, "delayOrder"), h.DelayOrder)

	// Staff (restaurant-scoped roster; platform /v1/admin/staff is SUPER_ADMIN only).
	r.Get("/v1/restaurant/staff",
		read(ActionStaffRead, "listRestaurantStaff"), h.ListRestaurantStaff)
	r.Post("/v1/restaurant/staff",
		write(ActionStaffWrite, "createRestaurantStaffUser"), h.CreateRestaurantStaffUser)
}
