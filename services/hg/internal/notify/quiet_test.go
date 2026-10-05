package notify

import (
	"testing"
	"time"
)

// TestQuietHours: from 22:00 to 08:00 in the recipient's own zone, push and
// SMS wait for a notice that is not transactional; an order message, a
// must-reach message, the inbox and the email never do
// (docs/spec/01-platform.md, "P-24 — Notification router", quiet hours and
// acceptance criterion 6).
func TestQuietHours(t *testing.T) {
	toronto, vancouver := Zone("America/Toronto"), Zone("America/Vancouver")
	at := func(hour, min int) time.Time { // an instant, given as Toronto wall time
		return time.Date(2026, 10, 5, hour, min, 0, 0, toronto)
	}
	payout := Notification{Kind: KindPayoutSent}
	cases := []struct {
		name string
		n    Notification
		ch   Channel
		now  time.Time
		zone *time.Location
		want bool
	}{
		{"payout push at 23:40", payout, ChannelPush, at(23, 40), toronto, true},
		{"payout SMS at 07:59", payout, ChannelSMS, at(7, 59), toronto, true},
		{"payout push at 08:00", payout, ChannelPush, at(8, 0), toronto, false},
		{"payout push at 21:59", payout, ChannelPush, at(21, 59), toronto, false},
		{"payout email at 23:40", payout, ChannelEmail, at(23, 40), toronto, false},
		{"payout inbox at 23:40", payout, ChannelInApp, at(23, 40), toronto, false},
		{"23:40 in Toronto is 20:40 in Vancouver", payout, ChannelPush, at(23, 40), vancouver, false},
		{"no zone is the platform's", payout, ChannelPush, at(23, 40), nil, true},
		{"rider approved at 02:00", Notification{Kind: KindRiderApplicationApproved}, ChannelPush, at(2, 0), toronto, true},
		{"order delivered at 23:40 is transactional", Notification{Kind: KindOrderDelivered}, ChannelPush, at(23, 40), toronto, false},
		{"a kind nobody classified sends", Notification{Kind: "SOMETHING_NEW"}, ChannelPush, at(23, 40), toronto, false},
		{"must-reach always sends", Notification{Kind: KindPayoutFailed, MustReach: true}, ChannelSMS, at(23, 40), toronto, false},
	}
	for _, c := range cases {
		if got := quietHoursSuppress(c.n, c.ch, c.now, c.zone); got != c.want {
			t.Errorf("%s: suppressed = %v, want %v", c.name, got, c.want)
		}
	}
}
