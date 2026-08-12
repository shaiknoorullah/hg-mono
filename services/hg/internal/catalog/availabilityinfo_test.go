package catalog

import "testing"

func ptrI32(v int32) *int32 { return &v }

// TestBuildAvailabilityInfo covers the C-14 verdict cases the fixtures pin:
// no address, out of range, open, and closed.
func TestBuildAvailabilityInfo(t *testing.T) {
	openVerdict := openStateVerdict{state: OpenStateOpen}
	closedVerdict := openStateVerdict{state: OpenStateClosedHours}

	t.Run("no address browses with NO_ADDRESS", func(t *testing.T) {
		rr := restaurantRow{deliveryRadiusM: 8000, avgPrepMinutes: 20}
		info := buildAvailabilityInfo(rr, openVerdict, false)
		if info.State != availNoAddress {
			t.Errorf("state = %q, want NO_ADDRESS", info.State)
		}
		if info.DistanceM != nil {
			t.Errorf("distance must be nil without an address")
		}
	})

	t.Run("beyond radius is OUT_OF_RANGE", func(t *testing.T) {
		rr := restaurantRow{deliveryRadiusM: 8000, distanceM: ptrI32(12000), avgPrepMinutes: 20}
		info := buildAvailabilityInfo(rr, openVerdict, true)
		if info.State != availOutOfRange {
			t.Errorf("state = %q, want OUT_OF_RANGE", info.State)
		}
		if info.OutOfRangeReason == nil {
			t.Errorf("out-of-range must carry a reason")
		}
	})

	t.Run("in range and open is OPEN with an ETA", func(t *testing.T) {
		rr := restaurantRow{deliveryRadiusM: 8000, distanceM: ptrI32(1200), avgPrepMinutes: 20}
		info := buildAvailabilityInfo(rr, openVerdict, true)
		if info.State != availOpen {
			t.Fatalf("state = %q, want OPEN", info.State)
		}
		if info.ETAMinMinutes == nil || info.ETAMaxMinutes == nil {
			t.Errorf("an open restaurant must carry an ETA band")
		}
		if *info.ETAMinMinutes >= *info.ETAMaxMinutes {
			t.Errorf("eta min %d must be below max %d", *info.ETAMinMinutes, *info.ETAMaxMinutes)
		}
	})

	t.Run("in range but closed is CLOSED_HOURS without an ETA", func(t *testing.T) {
		rr := restaurantRow{deliveryRadiusM: 8000, distanceM: ptrI32(1200), avgPrepMinutes: 20}
		info := buildAvailabilityInfo(rr, closedVerdict, true)
		if info.State != availClosedHours {
			t.Errorf("state = %q, want CLOSED_HOURS", info.State)
		}
		if info.ETAMinMinutes != nil {
			t.Errorf("a closed restaurant must not carry an ETA")
		}
	})
}

// TestToCardRatingFloor pins the "New" rule: rating_avg is null below five ratings.
func TestToCardRatingFloor(t *testing.T) {
	avg := 4.9
	below := restaurantRow{id: "r1", displayName: "X", ratingAvg: &avg, ratingCount: 3, halalStatus: HalalCertified}
	if c := toCard(below, RestaurantAvailabilityInfo{}, nilMedia{}); c.RatingAvg != nil {
		t.Errorf("rating_avg must be null when rating_count < 5")
	}
	above := restaurantRow{id: "r1", displayName: "X", ratingAvg: &avg, ratingCount: 41, halalStatus: HalalCertified}
	if c := toCard(above, RestaurantAvailabilityInfo{}, nilMedia{}); c.RatingAvg == nil || *c.RatingAvg != 4.9 {
		t.Errorf("rating_avg must be present when rating_count >= 5")
	}
}
