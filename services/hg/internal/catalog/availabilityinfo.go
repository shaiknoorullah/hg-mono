package catalog

// availabilityinfo.go computes the C-14 RestaurantAvailabilityInfo shown on a
// card: the serviceability verdict for one restaurant against one address. Every
// number here is server-computed; the client renders it verbatim and never does
// its own arithmetic (C-14).

// RestaurantAvailabilityState members (contract RestaurantAvailabilityState).
const (
	availOpen        = "OPEN"
	availClosedHours = "CLOSED_HOURS"
	availPaused      = "PAUSED"
	availOutOfRange  = "OUT_OF_RANGE"
	availNoAddress   = "NO_ADDRESS"
)

// buildAvailabilityInfo maps a restaurant row and an open-state verdict to the
// customer availability object. Add-to-cart is blocked for anything other than
// OPEN; browsing never is (C-14).
//
// hasAddress is false when the caller supplied no lat/lng and no default
// address: the state is then NO_ADDRESS, distance is null, and browsing still
// works. When an address is present, an out-of-range distance (beyond the
// restaurant's delivery_radius_m) yields OUT_OF_RANGE with a reason.
func buildAvailabilityInfo(rr restaurantRow, verdict openStateVerdict, hasAddress bool) RestaurantAvailabilityInfo {
	info := RestaurantAvailabilityInfo{
		DistanceM: rr.distanceM,
	}
	minOrder := rr.minimumOrderCents
	info.MinimumOrderCents = &minOrder

	if !hasAddress {
		info.State = availNoAddress
		return info
	}

	// Distance gate first: an out-of-range restaurant is not serviceable
	// regardless of its open state.
	if rr.distanceM != nil && *rr.distanceM > rr.deliveryRadiusM {
		info.State = availOutOfRange
		reason := "This restaurant does not deliver to your address."
		info.OutOfRangeReason = &reason
		return info
	}

	switch verdict.state {
	case OpenStateOpen:
		info.State = availOpen
	case OpenStatePaused:
		info.State = availPaused
	default:
		// Every other closed reason collapses to CLOSED_HOURS on the customer
		// card: the customer-facing enum has no OFFLINE/TOGGLE/SUSPENDED member,
		// and the card only needs "you cannot order now".
		info.State = availClosedHours
	}

	// ETA band: prep minutes plus a fixed travel allowance. Indicative only.
	if info.State == availOpen {
		etaMin := rr.avgPrepMinutes + 10
		etaMax := rr.avgPrepMinutes + 25
		info.ETAMinMinutes = &etaMin
		info.ETAMaxMinutes = &etaMax
	}
	return info
}
