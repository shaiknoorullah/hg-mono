package realtime

import (
	"encoding/json"
)

// Viewer is a subscriber's relationship to a channel, resolved at subscribe time
// and reused at every send. Projection (contracts/websocket.md section 5) is
// part of ownership: there is one serializer per (event, role), registered in
// catalogue.go, and the gateway applies it before a frame leaves the process.
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
	// ViewSelf is the account channel owner (account:{id}) or the rider channel
	// owner (rider:{id}).
	ViewSelf
)

// Project returns the payload one viewer may see for an event, or ok=false when
// the viewer is not in the event's audience — the frame is then dropped for
// that viewer.
//
// The payload is built by the serializer registered for (event type, viewer)
// in catalogue.go, from the source record the producer stored. Nothing is
// forwarded that a serializer did not build: an event type that is not in the
// catalogue, a viewer with no serializer, or a source record that does not
// decode is dropped, never passed through.
//
// audience is the role list stored with the event. It is a second gate, kept
// for events whose producer narrowed it further than the catalogue; an empty
// list means the catalogue's audience applies unchanged.
func Project(eventType string, viewer Viewer, audience []string, payload json.RawMessage) (json.RawMessage, bool) {
	s, ok := byType[eventType]
	if !ok {
		return nil, false
	}
	serialize, ok := s.views[viewer]
	if !ok || !inStoredAudience(viewer, audience) {
		return nil, false
	}
	out, err := serialize(payload)
	if err != nil {
		return nil, false
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil, false
	}
	return b, true
}

// audienceToken is the role token stored in realtime_event.audience.
func audienceToken(v Viewer) string {
	switch v {
	case ViewCustomer:
		return "customer"
	case ViewRestaurant:
		return "restaurant"
	case ViewRider:
		return "rider"
	case ViewSupport:
		return "support"
	default:
		return "self"
	}
}

// inStoredAudience applies the stored role list, if any.
func inStoredAudience(viewer Viewer, audience []string) bool {
	if len(audience) == 0 {
		return true
	}
	want := audienceToken(viewer)
	for _, a := range audience {
		if a == want || a == "all" {
			return true
		}
	}
	return false
}
