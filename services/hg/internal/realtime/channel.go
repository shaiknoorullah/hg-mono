package realtime

import (
	"regexp"
	"strings"
)

// ChannelKind is the closed set of channel families from contracts/websocket.md
// §3.1. There is nothing else: a channel string that does not parse into one of
// these is invalid by construction.
type ChannelKind string

const (
	// KindAccount is account:{account_id} — that account only, auto-subscribed.
	KindAccount ChannelKind = "account"
	// KindOrder is order:{order_id} — customer, restaurant staff, rider, support/admin.
	KindOrder ChannelKind = "order"
	// KindRestaurant is restaurant:{restaurant_id} — scoped staff, support/admin.
	KindRestaurant ChannelKind = "restaurant"
	// KindRider is rider:{account_id} — that rider, support/admin.
	KindRider ChannelKind = "rider"
	// KindAdminOps is admin:ops — ADMIN, SUPER_ADMIN, SUPPORT_AGENT.
	KindAdminOps ChannelKind = "admin"
)

// uuidRe matches a canonical (v4/v7) UUID, lower-case hyphenated. The subject of
// every channel except admin:ops is a UUID; anything else is an invalid channel.
var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Channel is a parsed channel: its kind and its subject id. It is the only thing
// the ownership check and the projection ever see, so a malformed string can
// never reach the SQL predicate.
type Channel struct {
	Raw     string
	Kind    ChannelKind
	Subject string // the {account_id}/{order_id}/{restaurant_id}; "ops" for admin
}

// ParseChannel splits a channel string into its kind and subject and validates
// both. ok is false for any string that is not a member of the §3.1 vocabulary —
// which the gateway turns into subscribe_error{code:"invalid_channel"}.
func ParseChannel(s string) (Channel, bool) {
	prefix, subject, found := strings.Cut(s, ":")
	if !found || prefix == "" || subject == "" {
		return Channel{}, false
	}
	c := Channel{Raw: s, Subject: subject}
	switch ChannelKind(prefix) {
	case KindAccount, KindOrder, KindRestaurant, KindRider:
		if !uuidRe.MatchString(subject) {
			return Channel{}, false
		}
		c.Kind = ChannelKind(prefix)
	case KindAdminOps:
		if subject != "ops" {
			return Channel{}, false
		}
		c.Kind = KindAdminOps
	default:
		return Channel{}, false
	}
	return c, true
}

// AccountChannel is the account:{id} channel string for an account. Every
// principal is auto-subscribed to its own at hello.
func AccountChannel(accountID string) string { return string(KindAccount) + ":" + accountID }

// OrderChannel is the order:{id} channel string.
func OrderChannel(orderID string) string { return string(KindOrder) + ":" + orderID }

// RestaurantChannel is the restaurant:{id} channel string.
func RestaurantChannel(restaurantID string) string {
	return string(KindRestaurant) + ":" + restaurantID
}

// RiderChannel is the rider:{account_id} channel string.
func RiderChannel(accountID string) string { return string(KindRider) + ":" + accountID }

// AdminOpsChannel is the single admin:ops channel string.
const AdminOpsChannel = "admin:ops"
