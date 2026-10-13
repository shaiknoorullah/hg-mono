package realtime

import (
	"encoding/json"
	"fmt"
)

// Viewer is the ONE role a subscription was authorised as. The ownership
// check that admits a subscribe (store.go, AuthorizeSubscribe) decides it, from
// the same facts, and the gateway projects every event on that subscription
// for that role and no other (contracts/websocket.md section 5, "Per-role
// projection rules"; https://github.com/shaiknoorullah/hg-mono/issues/247).
//
// It is one value, never a set: a principal who is related to a channel in
// several ways (restaurant staff who are also the order's customer, say) is
// projected for the single relationship that authorised the subscription, not
// for the union of what those roles may see. The union is not representable.
type Viewer int

const (
	// ViewNone is the zero value: no role. It is never granted and never
	// projected, so a subscription whose role was not set receives nothing.
	ViewNone Viewer = iota
	// ViewCustomer is the order's customer, on order:{id}.
	ViewCustomer
	// ViewRestaurant is staff of the order's restaurant, on order:{id} and
	// restaurant:{id}.
	ViewRestaurant
	// ViewRider is the order's assigned rider, on order:{id}.
	ViewRider
	// ViewSupport is support or admin: everything, PII masked by default.
	ViewSupport
	// ViewAccountOwner is the owner of account:{id}.
	ViewAccountOwner
	// ViewRiderSelf is the rider who owns rider:{id}.
	ViewRiderSelf
)

// Viewers is every role, in a fixed order.
func Viewers() []Viewer {
	return []Viewer{ViewCustomer, ViewRestaurant, ViewRider, ViewSupport, ViewAccountOwner, ViewRiderSelf}
}

// String names the role in logs.
func (v Viewer) String() string {
	switch v {
	case ViewCustomer:
		return "customer"
	case ViewRestaurant:
		return "restaurant"
	case ViewRider:
		return "rider"
	case ViewSupport:
		return "support"
	case ViewAccountOwner:
		return "account_owner"
	case ViewRiderSelf:
		return "rider_self"
	case ViewNone:
		return "none"
	}
	return fmt.Sprintf("unknown(%d)", int(v))
}

// dropReason says why a frame was not sent to one subscriber. Everything but
// notInAudience means the projection failed closed and is logged as a warning.
type dropReason int

const (
	delivered dropReason = iota
	// notInAudience: the role's allow-list has no serializer for the event —
	// the contract does not send it to that role. The everyday case.
	notInAudience
	// unknownViewer: the subscription's role is not one the allow-list knows
	// (no role, or a value outside the closed set).
	unknownViewer
	// unknownEvent: no role has a serializer for the event type, so it is not
	// an event this binary can send at all.
	unknownEvent
	// badSource: the stored source record did not decode or encode.
	badSource
	// storedAudience: the producer narrowed the event's audience below the
	// role's allow-list.
	storedAudience
)

func (r dropReason) String() string {
	switch r {
	case delivered:
		return "delivered"
	case notInAudience:
		return "not_in_audience"
	case unknownViewer:
		return "unknown_role"
	case unknownEvent:
		return "no_serializer"
	case badSource:
		return "bad_source"
	case storedAudience:
		return "stored_audience"
	}
	return "unknown"
}

// failedClosed reports whether a drop is a fault worth a warning rather than
// the contract's audience rule doing its job.
func (r dropReason) failedClosed() bool {
	return r == unknownViewer || r == unknownEvent || r == badSource
}

// Project returns the payload one role may see for an event, or ok=false when
// nothing may be sent — the frame is then dropped for that subscriber.
//
// It fails closed. The payload is built by the serializer the allow-list
// (catalogue.go, allowList: role → event type → serializer) names for exactly
// this role and event type, from the source record the producer stored.
// There is no default serializer and no pass-through: an unknown or missing
// role, an event type with no serializer for the role (including one added to
// the catalogue later without serializers), and a source record that does not
// decode all send nothing.
//
// audience is the role list stored with the event. It can only narrow: an
// empty list leaves the allow-list's audience unchanged.
func Project(eventType string, viewer Viewer, audience []string, payload json.RawMessage) (json.RawMessage, bool) {
	out, why := project(eventType, viewer, audience, payload)
	return out, why == delivered
}

// project is Project with the reason a frame was dropped, for the log.
func project(eventType string, viewer Viewer, audience []string, payload json.RawMessage) (json.RawMessage, dropReason) {
	serializers, ok := allowList[viewer]
	if !ok {
		return nil, unknownViewer
	}
	serialize, ok := serializers[eventType]
	if !ok {
		if !servedToAnyone(eventType) {
			return nil, unknownEvent
		}
		return nil, notInAudience
	}
	if !inStoredAudience(viewer, audience) {
		return nil, storedAudience
	}
	out, err := serialize.run(payload)
	if err != nil {
		return nil, badSource
	}
	b, err := json.Marshal(out)
	if err != nil {
		return nil, badSource
	}
	return b, delivered
}

// servedToAnyone reports whether any role has a serializer for an event type.
func servedToAnyone(eventType string) bool {
	for _, serializers := range allowList {
		if _, ok := serializers[eventType]; ok {
			return true
		}
	}
	return false
}

// audienceToken is the role token realtime_event.audience stores; "" for a
// role that has none, which no stored list contains.
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
	case ViewAccountOwner, ViewRiderSelf:
		return "self"
	}
	return ""
}

// inStoredAudience applies the stored role list, if any. It is a second gate
// behind the allow-list and can only narrow it.
func inStoredAudience(viewer Viewer, audience []string) bool {
	if len(audience) == 0 {
		return true
	}
	want := audienceToken(viewer)
	if want == "" {
		return false
	}
	for _, a := range audience {
		if a == want || a == "all" {
			return true
		}
	}
	return false
}
