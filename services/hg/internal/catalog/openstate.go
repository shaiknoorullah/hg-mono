package catalog

import "time"

// RestaurantOpenState members (contract RestaurantOpenState, R-22).
const (
	OpenStateOpen            = "OPEN"
	OpenStatePaused          = "PAUSED"
	OpenStateClosedHours     = "CLOSED_HOURS"
	OpenStateClosedHoliday   = "CLOSED_HOLIDAY"
	OpenStateClosedToggle    = "CLOSED_TOGGLE"
	OpenStateClosedOffline   = "CLOSED_OFFLINE"
	OpenStateClosedSuspended = "CLOSED_SUSPENDED"
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

// deriveOpenState computes RestaurantOpenState in the strict R-22 precedence:
//
//	CLOSED_SUSPENDED → CLOSED_OFFLINE (stale heartbeat) → CLOSED_TOGGLE →
//	PAUSED → CLOSED_HOLIDAY → CLOSED_HOURS → OPEN
//
// Trading hours and holidays are evaluated by the caller (which knows the
// timezone) and passed in as withinHours/holidayClosed; keeping the pure
// precedence here makes it unit-testable without a clock or a database.
func deriveOpenState(a availabilityRow, now time.Time, withinHours, holidayClosed bool) openStateVerdict {
	switch a.accountState {
	case "SUSPENDED", "DEACTIVATED", "BANNED":
		return openStateVerdict{OpenStateClosedSuspended,
			"This restaurant is temporarily unavailable.", resolvableAdmin}
	}

	// Heartbeat gate: a stale order screen is offered nothing, but the toggle is
	// not mutated, so service resumes the moment it reconnects.
	if a.isAcceptingOrders {
		if a.lastHeartbeatAt == nil || now.Sub(*a.lastHeartbeatAt) > staleHeartbeat {
			return openStateVerdict{OpenStateClosedOffline,
				"The order screen is offline. Reconnect it to resume taking orders.", resolvableRestaurant}
		}
	}

	if !a.isAcceptingOrders {
		return openStateVerdict{OpenStateClosedToggle,
			"This restaurant has paused new orders.", resolvableRestaurant}
	}

	if a.pauseUntil != nil && a.pauseUntil.After(now) {
		return openStateVerdict{OpenStatePaused,
			"This restaurant is briefly paused and will resume shortly.", resolvableTime}
	}

	if holidayClosed {
		return openStateVerdict{OpenStateClosedHoliday,
			"This restaurant is closed for a holiday.", resolvableTime}
	}

	if !withinHours {
		return openStateVerdict{OpenStateClosedHours,
			"This restaurant is closed right now.", resolvableTime}
	}

	return openStateVerdict{OpenStateOpen, "Open and accepting orders.", ""}
}
