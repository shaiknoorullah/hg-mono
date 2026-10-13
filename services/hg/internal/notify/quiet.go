package notify

import "time"

// Quiet hours: 22:00 to 08:00 in the recipient's timezone, PUSH and SMS are
// suppressed for notifications that are not transactional; transactional and
// must_reach ones always send (docs/spec/01-platform.md, "P-24 — Notification
// router: which event, which role, which channel"). The inbox row and the
// email are never held back: the person finds the message in the morning.
//
// Which kinds wait is a closed list. Every other kind, the order lifecycle,
// sign-in codes and anything added later, is transactional and sends at any
// hour, so a new kind can never be silenced by forgetting to classify it.
var quietKinds = map[Kind]bool{
	KindRestaurantApplicationApproved:      true,
	KindRestaurantApplicationChangesNeeded: true,
	KindRestaurantApplicationRejected:      true,
	KindRiderApplicationApproved:           true,
	KindRiderApplicationChangesNeeded:      true,
	KindRiderApplicationRejected:           true,
	KindRestaurantReinstated:               true,
	KindRiderReinstated:                    true,
	KindPayoutSent:                         true,
	KindPayoutHeld:                         true,
	KindPayoutFailed:                       true,
	KindHalalCertificateExpiring:           true,
}

const (
	quietStartHour = 22
	quietEndHour   = 8
)

// quietHoursSuppress reports whether channel ch of notification n waits for
// quiet hours to end at instant now, for a recipient in zone loc (nil means
// the platform's default zone).
func quietHoursSuppress(n Notification, ch Channel, now time.Time, loc *time.Location) bool {
	if ch != ChannelPush && ch != ChannelSMS {
		return false
	}
	if n.MustReach || !quietKinds[n.Kind] {
		return false
	}
	h := now.In(zoneOrDefault(loc)).Hour()
	return h >= quietStartHour || h < quietEndHour
}
