package handoff

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Routes registers this module's four routes on the shared router. Every route
// carries an explicit Policy (deny-by-default, G-4) and the contract's
// operationId. All four are ClassWrite and Idempotent (P-37): none moves money
// itself, but each is a mutating step in an append-only chain of custody where
// a client retry must never look like an independent second scan.
func Routes(r *httpx.Router, h *Handler) {
	r.Post("/v1/orders/{orderId}/handoff/seal", httpx.Policy{
		Action:      ActionSealBind,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "bindPackageSeal",
	}, h.BindSeal)

	r.Post("/v1/orders/{orderId}/handoff/pickup-scan", httpx.Policy{
		Action:      ActionPickupScan,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "scanPickup",
	}, h.PickupScan)

	r.Post("/v1/orders/{orderId}/handoff/delivery-scan", httpx.Policy{
		Action:      ActionDeliveryScan,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "scanDelivery",
	}, h.DeliveryScan)

	r.Post("/v1/orders/{orderId}/handoff/tamper-report", httpx.Policy{
		Action:      ActionTamperReport,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "reportTamper",
	}, h.ReportTamper)
}
