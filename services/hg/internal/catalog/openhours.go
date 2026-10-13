package catalog

// openhours.go derives the customer card's open state (C-14 in
// docs/spec/02-customer.md) from the restaurant's hours, toggle, pause and
// heartbeat. Whether the restaurant is inside its hours, and the R-22
// precedence, live in internal/openhours, which the order path uses too, so the
// card never reads OPEN when quoting would refuse.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/645
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/648

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/openhours"
)

// The card query's names for the shared types.
type (
	weeklySlot    = openhours.Slot
	hoursOverride = openhours.Override
	hoursVerdict  = openhours.Verdict
)

// tradingColumns read what the card's open state is derived from
// (openhours.Columns): the toggle, pause and heartbeat, the open payout
// collection that blocks quoting, the weekly hours and the overrides.
const tradingColumns = openhours.Columns

// evaluateHours places now in the restaurant's hours (openhours.Evaluate).
func evaluateHours(weekly []weeklySlot, overrides []hoursOverride, timezone string, now time.Time) hoursVerdict {
	return openhours.Evaluate(weekly, overrides, timezone, now)
}

// cardOpenState is the open state behind a customer card. Outside its hours, or
// on a closed day, a restaurant is closed whatever its toggle, pause or
// heartbeat say, because the card's PAUSED means "inside hours but not taking
// orders" (C-14). Inside its hours the R-22 precedence applies as it does for
// the restaurant itself. collectionBlock is the payout block that quoting also
// refuses on, so the card never reads open when quoting would refuse for that
// reason.
func cardOpenState(a availabilityRow, collectionBlock bool, hv hoursVerdict, now time.Time) openStateVerdict {
	if collectionBlock {
		a.isAcceptingOrders = false
	}
	if a.accountState == "LIVE" && (!hv.Within || hv.Holiday) {
		a.isAcceptingOrders, a.pauseUntil, a.lastHeartbeatAt = true, nil, &now
	}
	return deriveOpenState(a, now, hv.Within, hv.Holiday)
}
