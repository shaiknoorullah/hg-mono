package auth

import (
	"sort"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// TestMatrixGolden pins the role→action map so any permission change is a visible
// diff (P-05 acceptance #1). Update the golden set deliberately when the matrix
// changes.
func TestMatrixGolden(t *testing.T) {
	golden := map[httpx.Action]struct{}{
		ActionSessionReadSelf:                           {},
		ActionSessionRevokeSelf:                         {},
		httpx.Action("assignment.pod.submit"):           {},
		httpx.Action("assignment.read"):                 {},
		httpx.Action("assignment.transition"):           {},
		httpx.Action("cart.read"):                       {},
		httpx.Action("cart.write"):                      {},
		httpx.Action("connect.read"):                    {},
		httpx.Action("connect.write"):                   {},
		httpx.Action("discovery.feed_read"):             {},
		httpx.Action("discovery.search"):                {},
		httpx.Action("document.review"):                 {},
		httpx.Action("earnings.read"):                   {},
		httpx.Action("halal_certificate.check"):         {},
		httpx.Action("halal_certificate.decide"):        {},
		httpx.Action("halal_certificate.read"):          {},
		httpx.Action("halal_certificate.transcribe"):    {},
		httpx.Action("halal_issuing_body.propose"):      {},
		httpx.Action("halal_issuing_body.read"):         {},
		httpx.Action("halal_issuing_body.set_status"):   {},
		httpx.Action("kyc_document.download"):           {},
		httpx.Action("offer.accept"):                    {},
		httpx.Action("offer.read"):                      {},
		httpx.Action("offer.reject"):                    {},
		httpx.Action("order.cancel"):                    {},
		httpx.Action("order.create"):                    {},
		httpx.Action("order.read"):                      {},
		httpx.Action("payment.read"):                    {},
		httpx.Action("payment_method.read"):             {},
		httpx.Action("payment_method.write"):            {},
		httpx.Action("payout.read"):                     {},
		httpx.Action("platform_deps.read"):              {},
		httpx.Action("quote.create"):                    {},
		httpx.Action("quote.read"):                      {},
		httpx.Action("realtime_schema.read"):            {},
		httpx.Action("realtime_ticket.create"):          {},
		httpx.Action("refund.issue_goodwill"):           {},
		httpx.Action("refund.read"):                     {},
		httpx.Action("refund.request"):                  {},
		httpx.Action("restaurant.accepting_orders_set"): {},
		httpx.Action("restaurant.approve"):              {},
		httpx.Action("restaurant.availability_read"):    {},
		httpx.Action("restaurant.certificate_view"):     {},
		httpx.Action("restaurant.certification_read"):   {},
		httpx.Action("restaurant.heartbeat"):            {},
		httpx.Action("restaurant.list"):                 {},
		httpx.Action("restaurant.menu_read"):            {},
		httpx.Action("restaurant.read"):                 {},
		// Restaurant-partner module (B-restaurant) actions — one per declared
		// route action in internal/restaurant/routes.go, reconciled from x-roles.
		httpx.Action("restaurant.onboarding_read"):        {},
		httpx.Action("restaurant.profile_read"):           {},
		httpx.Action("restaurant.profile_write"):          {},
		httpx.Action("restaurant.hours_read"):             {},
		httpx.Action("restaurant.hours_write"):            {},
		httpx.Action("restaurant.documents_read"):         {},
		httpx.Action("restaurant.documents_write"):        {},
		httpx.Action("restaurant.documents_submit"):       {},
		httpx.Action("restaurant.menu_read_own"):          {},
		httpx.Action("restaurant.menu_category_write"):    {},
		httpx.Action("restaurant.menu_item_write"):        {},
		httpx.Action("restaurant.menu_item_availability"): {},
		httpx.Action("restaurant.order_read"):             {},
		httpx.Action("restaurant.order_accept"):           {},
		httpx.Action("restaurant.order_reject"):           {},
		httpx.Action("restaurant.order_ready"):            {},
		httpx.Action("restaurant.order_delay"):            {},
		httpx.Action("restaurant_application.claim"):      {},
		httpx.Action("restaurant_application.read"):       {},
		httpx.Action("rider.approve"):                     {},
		httpx.Action("rider.availability.write"):          {},
		httpx.Action("rider.position.write"):              {},
		httpx.Action("rider_application.claim"):           {},
		httpx.Action("rider_application.read"):            {},
		httpx.Action("staff.create"):                      {},
		httpx.Action("staff.read"):                        {},
		httpx.Action("upload.confirm"):                    {},
		httpx.Action("upload.create"):                     {},
	}
	got := AllActions()
	if len(got) != len(golden) {
		t.Fatalf("matrix has %d actions, golden has %d", len(got), len(golden))
	}
	for a := range golden {
		if _, ok := got[a]; !ok {
			t.Errorf("golden action %q missing from matrix", a)
		}
	}
	var names []string
	for a := range got {
		names = append(names, string(a))
	}
	sort.Strings(names)
	t.Logf("matrix actions: %v", names)
}

func TestMatrixRoleHasAction(t *testing.T) {
	m := Matrix{}
	if !m.RoleHasAction([]httpx.Role{httpx.RoleCustomer}, ActionSessionReadSelf) {
		t.Error("CUSTOMER should hold session.read_self")
	}
	if m.RoleHasAction([]httpx.Role{httpx.RoleCustomer}, platformDepsRead) {
		t.Error("CUSTOMER must not hold platform_deps.read")
	}
	if !m.RoleHasAction([]httpx.Role{httpx.RoleAdmin}, platformDepsRead) {
		t.Error("ADMIN should hold platform_deps.read")
	}
	if m.RoleHasAction(nil, ActionSessionReadSelf) {
		t.Error("no roles must grant nothing")
	}
}

// TestEveryRouteActionIsInMatrix is I-05.1 for this module: every non-public
// route's declared action exists in the matrix.
func TestEveryRouteActionIsInMatrix(t *testing.T) {
	declared := []httpx.Action{ActionSessionReadSelf, ActionSessionRevokeSelf}
	all := AllActions()
	for _, a := range declared {
		if _, ok := all[a]; !ok {
			t.Errorf("route action %q is not present in the matrix for any role", a)
		}
	}
}
