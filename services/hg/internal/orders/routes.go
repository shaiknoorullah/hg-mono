package orders

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Routes registers the cart, quote and order operations on the shared router
// (P-06). Every route carries an explicit Policy with its P-05 Action and rate
// class; none is public (deny by default — the contract marks none of these
// PUBLIC). The two MONEY-class routes are Idempotent, which Verify enforces.
func Routes(r *httpx.Router, h *Handler) {
	// Cart (C-19).
	r.Get("/v1/cart", httpx.Policy{Action: ActionCartRead, Class: httpx.ClassRead, OperationID: "getCart"}, h.GetCart)
	r.Delete("/v1/cart", httpx.Policy{Action: ActionCartWrite, Class: httpx.ClassWrite, OperationID: "clearCart"}, h.ClearCart)
	r.Post("/v1/cart/lines", httpx.Policy{Action: ActionCartWrite, Class: httpx.ClassWrite, Idempotent: true, OperationID: "addCartLine"}, h.AddCartLine)
	r.Patch("/v1/cart/lines/{lineId}", httpx.Policy{Action: ActionCartWrite, Class: httpx.ClassWrite, OperationID: "updateCartLine"}, h.UpdateCartLine)
	r.Delete("/v1/cart/lines/{lineId}", httpx.Policy{Action: ActionCartWrite, Class: httpx.ClassWrite, OperationID: "removeCartLine"}, h.RemoveCartLine)

	// Quote (P-09) — createQuote is MONEY class and Idempotent.
	r.Post("/v1/quotes", httpx.Policy{Action: ActionQuoteCreate, Class: httpx.ClassMoney, Idempotent: true, OperationID: "createQuote"}, h.CreateQuote)
	r.Get("/v1/quotes/{quoteId}", httpx.Policy{Action: ActionQuoteRead, Class: httpx.ClassRead, OperationID: "getQuote"}, h.GetQuote)

	// Orders (P-14/P-16) — createOrder is MONEY class and Idempotent.
	r.Post("/v1/orders", httpx.Policy{Action: ActionOrderCreate, Class: httpx.ClassMoney, Idempotent: true, OperationID: "createOrder"}, h.CreateOrder)
	r.Get("/v1/orders", httpx.Policy{Action: ActionOrderRead, Class: httpx.ClassRead, OperationID: "listOrders"}, h.ListOrders)
	r.Get("/v1/orders/active", httpx.Policy{Action: ActionOrderRead, Class: httpx.ClassRead, OperationID: "getActiveOrder"}, h.GetActiveOrder)
	r.Get("/v1/orders/{orderId}", httpx.Policy{Action: ActionOrderRead, Class: httpx.ClassRead, OperationID: "getOrder"}, h.GetOrder)
	r.Post("/v1/orders/{orderId}/cancel", httpx.Policy{Action: ActionOrderCancel, Class: httpx.ClassMoney, Idempotent: true, OperationID: "cancelOrder"}, h.CancelOrder)

	// New read-only customer tracking operations (C-32, ordersread feature).
	r.Get("/v1/orders/{orderId}/tracking", httpx.Policy{Action: ActionOrderTrackingRead, Class: httpx.ClassRead, OperationID: "getOrderTracking"}, h.GetOrderTracking)
	r.Get("/v1/orders/{orderId}/receipt", httpx.Policy{Action: ActionOrderReceiptRead, Class: httpx.ClassRead, OperationID: "getOrderReceipt"}, h.GetOrderReceipt)
	r.Get("/v1/orders/{orderId}/rider", httpx.Policy{Action: ActionOrderRiderProfileRead, Class: httpx.ClassRead, OperationID: "getOrderRiderPublicProfile"}, h.GetOrderRiderPublicProfile)

	// Ratings (C-38, scoped to food + rider targets).
	r.Get("/v1/orders/{orderId}/rating", httpx.Policy{Action: ActionOrderRatingRead, Class: httpx.ClassRead, OperationID: "getOrderRating"}, h.GetOrderRating)
	r.Put("/v1/orders/{orderId}/rating", httpx.Policy{Action: ActionOrderRatingWrite, Class: httpx.ClassWrite, Idempotent: true, OperationID: "submitOrderRating"}, h.SubmitOrderRating)
}
