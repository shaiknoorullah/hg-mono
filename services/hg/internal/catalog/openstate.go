package catalog

import (
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/openhours"
)

// RestaurantOpenState members (contract RestaurantOpenState, R-22).
const (
	OpenStateOpen            = openhours.StateOpen
	OpenStatePaused          = openhours.StatePaused
	OpenStateClosedHours     = openhours.StateClosedHours
	OpenStateClosedHoliday   = openhours.StateClosedHoliday
	OpenStateClosedToggle    = openhours.StateClosedToggle
	OpenStateClosedOffline   = openhours.StateClosedOffline
	OpenStateClosedSuspended = openhours.StateClosedSuspended
)

// resolvableBy members (contract RestaurantAvailability.resolvable_by).
const (
	resolvableRestaurant = "RESTAURANT"
	resolvableAdmin      = "ADMIN"
	resolvableTime       = "TIME"
)

// openStateVerdict is the derived open state plus its reason and who can resolve it.
type openStateVerdict struct {
	state        string
	reason       string
	resolvableBy string
}

// deriveOpenState computes RestaurantOpenState in the strict R-22 precedence
// (openhours.Derive, which the order path refuses by too) and says why, and who
// can resolve it:
//
//	CLOSED_SUSPENDED → CLOSED_OFFLINE (stale heartbeat) → CLOSED_TOGGLE →
//	PAUSED → CLOSED_HOLIDAY → CLOSED_HOURS → OPEN
//
// Trading hours and holidays are evaluated by the caller (which knows the
// timezone) and passed in as withinHours/holidayClosed; keeping the pure
// precedence here makes it unit-testable without a clock or a database.
func deriveOpenState(a availabilityRow, now time.Time, withinHours, holidayClosed bool) openStateVerdict {
	state := openhours.Derive(openhours.Trading{
		AccountState: a.accountState, IsAcceptingOrders: a.isAcceptingOrders,
		PauseUntil: a.pauseUntil, LastHeartbeatAt: a.lastHeartbeatAt,
	}, now, withinHours, holidayClosed)
	switch state {
	case OpenStateClosedSuspended:
		return openStateVerdict{state, "This restaurant is temporarily unavailable.", resolvableAdmin}
	case OpenStateClosedOffline:
		// The toggle is not mutated, so service resumes the moment the
		// order screen reconnects.
		return openStateVerdict{state,
			"The order screen is offline. Reconnect it to resume taking orders.", resolvableRestaurant}
	case OpenStateClosedToggle:
		return openStateVerdict{state, "This restaurant has paused new orders.", resolvableRestaurant}
	case OpenStatePaused:
		return openStateVerdict{state, "This restaurant is briefly paused and will resume shortly.", resolvableTime}
	case OpenStateClosedHoliday:
		return openStateVerdict{state, "This restaurant is closed for a holiday.", resolvableTime}
	case OpenStateClosedHours:
		return openStateVerdict{state, "This restaurant is closed right now.", resolvableTime}
	}
	return openStateVerdict{OpenStateOpen, "Open and accepting orders.", ""}
}
