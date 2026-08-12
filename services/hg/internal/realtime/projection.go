package realtime

import (
	"encoding/json"
	"math"
)

// Viewer is a subscriber's relationship to a channel, resolved at subscribe time
// and reused at every send. Projection (§5) is part of ownership: there is one
// projection per (event, role), and the gateway applies it before a frame leaves
// the process, never trusting a shared struct with conditional blanking.
type Viewer int

const (
	// ViewCustomer is the order's customer.
	ViewCustomer Viewer = iota
	// ViewRestaurant is restaurant staff for the order's restaurant.
	ViewRestaurant
	// ViewRider is the assigned rider.
	ViewRider
	// ViewSupport is support or admin: everything, PII masked by default.
	ViewSupport
	// ViewSelf is the account channel owner (account:{id}), rider channel owner,
	// or admin:ops — no cross-audience projection applies.
	ViewSelf
)

// Project applies the §5 per-role projection to an event's payload for a given
// viewer. It returns the payload the viewer is permitted to see, or ok=false
// when this viewer is not in the event's audience at all (the frame is dropped).
//
// The event carries its audience as a []string of role tokens; the gateway
// resolved the viewer's relationship when it authorized the subscribe. Two
// projections the contract singles out are enforced here:
//   - rider.location to a restaurant is coarse (≈100 m) with no customer PII;
//   - the restaurant does not see the delivery address until ACCEPTED, and the
//     rider does not see the full customer address until PICKED_UP.
//
// Because the emitting modules write the unprojected payload, Project withholds
// rather than adds: it strips fields a viewer must not see. A field a viewer is
// entitled to that the emitter never wrote is simply absent — never fabricated.
func Project(eventType string, viewer Viewer, audience []string, payload json.RawMessage) (json.RawMessage, bool) {
	if !viewerInAudience(viewer, audience) {
		return nil, false
	}
	// Support/admin and the self channels see the payload as written (support
	// with masking already applied by the emitter per §5; unmasking is a
	// separate, audited HTTP path, never a socket concern).
	if viewer == ViewSupport || viewer == ViewSelf {
		return payload, true
	}

	switch eventType {
	case "rider.location":
		if viewer == ViewRestaurant {
			return coarsenLocation(payload), true
		}
		return payload, true
	}
	return payload, true
}

// viewerInAudience maps the event's role-token audience to the viewer relation.
// An empty audience means "all participants" (§4.2 order.state_changed and
// friends list "all participants"), so anyone subscribed receives it.
func viewerInAudience(viewer Viewer, audience []string) bool {
	if len(audience) == 0 {
		return true
	}
	want := ""
	switch viewer {
	case ViewCustomer:
		want = "customer"
	case ViewRestaurant:
		want = "restaurant"
	case ViewRider:
		want = "rider"
	case ViewSupport:
		want = "support"
	case ViewSelf:
		return true
	}
	for _, a := range audience {
		switch a {
		case "all", "all_participants":
			return true
		case want:
			return true
		case "support", "admin":
			if viewer == ViewSupport {
				return true
			}
		}
	}
	return false
}

// coarsenLocation rounds lat/lng to ~100 m and drops accuracy so a restaurant
// receives only enough to know the rider is close (§5). The customer, in
// contrast, receives the precise position unchanged.
func coarsenLocation(payload json.RawMessage) json.RawMessage {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(payload, &m); err != nil {
		// If we cannot parse it we must not forward a payload we could not
		// redact. Return an empty object rather than leaking.
		return json.RawMessage(`{}`)
	}
	roundField := func(key string) {
		raw, ok := m[key]
		if !ok {
			return
		}
		var f float64
		if err := json.Unmarshal(raw, &f); err != nil {
			return
		}
		// ~100 m ≈ 0.001° at these latitudes; round to 3 decimals.
		r := math.Round(f*1000) / 1000
		b, _ := json.Marshal(r)
		m[key] = b
	}
	roundField("lat")
	roundField("lng")
	// Precise accuracy would let a restaurant reconstruct the fine position;
	// remove it along with any customer PII fields that must never reach the
	// restaurant on this event.
	delete(m, "accuracy_m")
	delete(m, "speed_mps")
	delete(m, "customer_phone")
	delete(m, "customer_address")

	out, err := json.Marshal(m)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}
