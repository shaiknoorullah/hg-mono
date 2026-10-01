package conformance

import (
	"sort"
	"testing"
)

// TestConformance_SpecLoadsAndEnumerates is the harness's own self-check: it
// proves contracts/openapi.yaml loads, validates, and enumerates the full
// operation surface. The count is pinned so a contract that gains or loses an
// operation forces a deliberate update here — coverage accounting cannot
// silently lapse.
func TestConformance_SpecLoadsAndEnumerates(t *testing.T) {
	spec := LoadSpec(t)

	// 144 + listRestaurantStaff/createRestaurantStaffUser (restaurant-scoped
	// staff roster, closing the platform-role-only gap on /v1/admin/staff) +
	// getOrderRating/submitOrderRating (durable food+rider ratings, replacing
	// the previously in-memory customer rating state) + bindPackageSeal/
	// scanPickup/scanDelivery/reportTamper (internal/handoff, migration 00027:
	// the tamper-evident seal chain of custody that gates PICKED_UP/DELIVERED) +
	// updateMenuItemOnBehalf/deleteMenuItemOnBehalf (an admin edits or removes a
	// menu item for a restaurant — the owner's launch-scope decision of 2026-10-01,
	// docs/decisions/README.md "Launch scope and contract"; no handler yet).
	const wantOps = 154
	if got := len(spec.Operations); got != wantOps {
		ids := make([]string, 0, len(spec.Operations))
		for id := range spec.Operations {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		t.Fatalf("contract declares %d operations, harness expected %d — update wantOps and COVERAGE.md.\noperations: %v",
			got, wantOps, ids)
	}

	// Every operation must carry an operationId (the map key) and a method/path.
	for id, op := range spec.Operations {
		if op.Method == "" || op.Path == "" {
			t.Errorf("operation %q missing method/path: %+v", id, op)
		}
	}
}
