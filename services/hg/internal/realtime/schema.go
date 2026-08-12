package realtime

// schemaBundle returns the RealtimeSchemaBundle for getRealtimeSchema (§4). It is
// keyed {type}@v{version} and carries a JSON Schema per payload.
//
// The catalogue is large; this bundle enumerates the event types from
// contracts/websocket.md §4 with a permissive object schema per type so the
// endpoint answers with the correct SHAPE and the full key set. Tightening each
// payload's field schema is a follow-up that must stay lock-step with the Go
// structs the emitting modules own (a field rename fails CI unless v is bumped).
//
// TODO(scope): generate per-field JSON Schemas from the emitting modules' Go
// structs so a rename is caught by CI (§2). Until those structs exist across the
// order/payment/dispatch modules, the per-type schemas here are the object
// shape, not the field list.
func schemaBundle() realtimeSchemaBundle {
	events := map[string]map[string]any{}
	for _, t := range catalogueTypes {
		events[t+"@v1"] = objectSchema()
	}
	return realtimeSchemaBundle{Protocol: Protocol, Events: events}
}

type realtimeSchemaBundle struct {
	Protocol int                       `json:"protocol"`
	Events   map[string]map[string]any `json:"events"`
}

func objectSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": true,
	}
}

// catalogueTypes is the complete event-type list from §4.2–§4.7. Control frames
// (§4.1) are connection-scoped and not part of the payload schema bundle.
var catalogueTypes = []string{
	// Order (§4.2)
	"order.created", "order.state_changed", "order.eta_updated",
	"order.items_adjusted", "order.cancelled", "order.completed", "order.note_added",
	// Payment (§4.3)
	"payment.authorized", "payment.action_required", "payment.captured",
	"payment.failed", "refund.created", "refund.settled", "refund.failed",
	// Restaurant (§4.4)
	"restaurant.order_offered", "restaurant.order_offer_expired",
	"restaurant.order_offer_withdrawn", "restaurant.order_accepted",
	"restaurant.order_rejected", "restaurant.status_changed", "restaurant.payout_updated",
	// Dispatch and rider (§4.5)
	"dispatch.offer", "dispatch.offer_withdrawn", "dispatch.assigned",
	"dispatch.unassigned", "dispatch.state_changed", "rider.location",
	"rider.availability_changed", "rider.earnings_updated",
	// Account and onboarding (§4.6)
	"account.security_event", "document.review_state_changed",
	"onboarding.state_changed", "connect.requirements_changed",
	"notification.created", "notification.read",
	// Admin (§4.7)
	"admin.alert", "admin.dispatch_failure",
	"admin.reconciliation_exception", "admin.queue_depth",
}
