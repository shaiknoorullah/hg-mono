package conformance

import (
	"fmt"
	"os"
	"sort"
	"testing"
)

// TestMain runs the package's tests, then enforces coverage accountability
// AFTER every test's t.Cleanup has contributed to the aggregate covered set.
//
// The rule: coverage must not silently lapse. If the harness ran against a live
// DB (HG_TEST_POSTGRES_DSN set) and validated fewer operations than the pinned
// floor, the process exits non-zero — the gate fails loud. When the DB is
// absent every conformance test skips, coverage is 0, and we do NOT fail (there
// was nothing to validate); the skip is itself the loud signal in CI logs.
func TestMain(m *testing.M) {
	// Self-seed every FK prerequisite the conformance tests reference, once,
	// before any test runs — so the gate is real on a freshly-migrated DB and
	// not a false green riding on a polluted long-lived dev database. Skipped
	// when there is no DB (every conformance test then skips anyway).
	if dsn := os.Getenv("HG_TEST_POSTGRES_DSN"); dsn != "" {
		if err := ensureBaseSeed(dsn); err != nil {
			fmt.Fprintf(os.Stderr, "conformance TestMain: base seed: %v\n", err)
			os.Exit(1)
		}
	}

	code := m.Run()

	// Only enforce the floor when the harness actually had a DB to run against.
	// Without HG_TEST_POSTGRES_DSN every test t.Skip'd and covered 0 — that is a
	// skipped gate, surfaced by the SKIP lines, not a coverage regression.
	if os.Getenv("HG_TEST_POSTGRES_DSN") == "" {
		os.Exit(code)
	}

	spec, err := loadSpec()
	if err != nil {
		fmt.Fprintf(os.Stderr, "conformance TestMain: load spec: %v\n", err)
		os.Exit(1)
	}

	coverageMu.Lock()
	covered := make(map[string]bool, len(aggregateCovered))
	for k, v := range aggregateCovered {
		covered[k] = v
	}
	coverageMu.Unlock()

	// The floor is the set of operations this pass is designed to reach. It is
	// pinned so that a regression (an op quietly dropping out of the harness)
	// fails the gate rather than silently shrinking coverage.
	missing := []string{}
	for _, id := range expectedCovered {
		if !covered[id] {
			missing = append(missing, id)
		}
	}
	sort.Strings(missing)

	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr,
			"\nCONFORMANCE COVERAGE REGRESSION: %d operation(s) the harness must validate were NOT covered this run:\n",
			len(missing))
		for _, id := range missing {
			op := spec.Operations[id]
			fmt.Fprintf(os.Stderr, "  - %s (%s %s)\n", id, op.Method, op.Path)
		}
		fmt.Fprintf(os.Stderr,
			"An uncovered operation is invisible drift waiting to happen. See COVERAGE.md.\n")
		if code == 0 {
			code = 1
		}
	}

	fmt.Fprintf(os.Stderr, "conformance: validated %d/%d contract operations (see COVERAGE.md)\n",
		len(covered), len(spec.Operations))

	os.Exit(code)
}

// expectedCovered is the pinned floor of operations the harness must validate
// every run. These are the read/write surfaces reachable with the existing seed
// data — crucially every operation the three replaced fake-conformance files
// pretended to cover (admin orders, admin menu, rider), plus the drift
// epicentre (restaurant orders/profile, cart). If one drops out of the harness,
// TestMain fails loud.
var expectedCovered = []string{
	// discovery + owner menu
	"listRestaurants", "getRestaurant", "getRestaurantMenu", "getOwnMenu",
	// cart (halal-on-cart drift). getOrder/getCustomerProfile are NOT here:
	// they are unreachable in the current backend (getOrder: order.read not
	// granted to CUSTOMER → 403; getCustomerProfile: only PATCH registered →
	// 405), so no contract body is emitted to validate. They are reported as
	// reachability drifts by TestConformance_Reachability instead.
	"getCart",
	// restaurant portal (OrderRestaurantView + profile/hours/docs drift)
	"getRestaurantProfile", "getRestaurantHours", "getRestaurantOnboardingStatus",
	"listRestaurantDocuments", "listRestaurantOrders", "getRestaurantOrder",
	// restaurant write inputs (input DTO drift)
	"rejectOrder", "delayOrder", "acceptOrder",
	// rider (replaces rider_shape_test.go's pretended coverage)
	"getRiderMe", "getRiderOnboardingStatus", "listRiderDocuments", "getRiderDashboard",
	// account + addresses
	"listAddresses", "listNotifications",
	// admin (replaces handler_orders_conformance_test.go / handler_menu_conformance_test.go)
	"listOrdersAdmin", "getOrderAdmin", "listMenuReviewQueue",
	// menu edits that had no handler (https://github.com/shaiknoorullah/hg-mono/issues/502)
	"updateMenuCategory", "updateMenuItemOnBehalf", "deleteMenuItemOnBehalf",
	// a restaurant deletes its own items and empty categories
	// (https://github.com/shaiknoorullah/hg-mono/issues/239)
	"deleteMenuItem", "deleteMenuCategory",
	// gap-closers (conformance_gaps_test.go): the full checkout money path against
	// the local fake payment gateway, the dispatch accept/assignment pair, the
	// realtime ticket (seeded session), and the signed Stripe webhook.
	"createQuote", "createOrder", "cancelOrder",
	"acceptOffer", "getAssignment",
	"createRealtimeTicket", "receiveStripeWebhook",
	// admin payout runs (conformance_payout_runs_test.go, issue #251)
	"createPayoutRun", "getPayoutRun", "listPayoutRuns",
	// refund review and chargebacks (#172; conformance_refund_review_test.go)
	"listRefundsAdmin", "approveRefund", "declineRefund",
	"listChargebacks", "getChargeback", "addChargebackEvidenceNote",
	// the platform-wide pause on new orders, on a database of its own
	// (conformance_ordering_pause_test.go; https://github.com/shaiknoorullah/hg-mono/issues/244).
	"getOrderingPause", "setOrderingPause",
}
