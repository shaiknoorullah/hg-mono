package auth

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// The P-05 permission matrix: a static Go map role → set[action]. It is not
// database-configurable (I-05.1), and every action a route declares must appear
// here for at least one role. Scope narrowing (a RESTAURANT_MANAGER only over
// their own restaurant) is the ownership check (P-07) done in SQL, never here.
//
// This module (B3, auth) owns only the actions its own routes declare. Sibling
// modules own the nouns they define (order.*, menu_item.*, refund.*, …) and
// contribute their actions to this matrix as they land. Until then the matrix
// carries the auth-owned actions plus the one action the system module already
// declares (platform_deps.read), so the router verifies and the deps route is
// reachable by an admin.

// Auth-owned Action constants. Actions are typed, never string literals at the
// call site (I-05.2).
const (
	// ActionSessionReadSelf guards the self-scoped session endpoints
	// (listSessions, getCurrentPrincipal). Ownership to the caller's own account
	// is enforced in SQL — these never read another account's sessions.
	ActionSessionReadSelf httpx.Action = "session.read_self"
	// ActionSessionRevokeSelf guards logout, logout-all and revokeSession over
	// the caller's own sessions only.
	ActionSessionRevokeSelf httpx.Action = "session.revoke_self"
)

// platformDepsRead mirrors system.ActionDepsRead without importing that package
// (an import cycle: system does not import auth, and auth must not depend on it
// for a constant). The string is the contract-anchored action id.
const platformDepsRead httpx.Action = "platform_deps.read"

// matrix is the closed role → action grant set.
var matrix = map[httpx.Role]map[httpx.Action]struct{}{
	httpx.RoleCustomer: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("cart.read"),
		httpx.Action("cart.write"),
		httpx.Action("discovery.feed_read"),
		httpx.Action("discovery.search"),
		httpx.Action("order.cancel"),
		httpx.Action("order.create"),
		httpx.Action("order.receipt.read"),
		httpx.Action("order.rider_profile.read"),
		httpx.Action("order.tracking.read"),
		httpx.Action("payment.read"),
		httpx.Action("payment_method.read"),
		httpx.Action("payment_method.write"),
		httpx.Action("quote.create"),
		httpx.Action("quote.read"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("refund.read"),
		httpx.Action("refund.request"),
		httpx.Action("restaurant.certificate_view"),
		httpx.Action("restaurant.certification_read"),
		httpx.Action("restaurant.list"),
		httpx.Action("restaurant.menu_read"),
		httpx.Action("restaurant.order_read"),
		httpx.Action("restaurant.read"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleRider: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("assignment.pod.submit"),
		httpx.Action("assignment.read"),
		httpx.Action("assignment.transition"),
		httpx.Action("connect.read"),
		httpx.Action("connect.write"),
		httpx.Action("earnings.read"),
		httpx.Action("kyc_document.download"),
		httpx.Action("offer.accept"),
		httpx.Action("offer.read"),
		httpx.Action("offer.reject"),
		httpx.Action("payout.read"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("rider.availability.write"),
		httpx.Action("rider.dashboard.read"),
		httpx.Action("rider.document.read"),
		httpx.Action("rider.document.write"),
		httpx.Action("rider.onboarding.read"),
		httpx.Action("rider.onboarding.write"),
		httpx.Action("rider.position.write"),
		httpx.Action("rider.read_self"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleRestaurantOwner: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("connect.read"),
		httpx.Action("connect.write"),
		httpx.Action("kyc_document.download"),
		httpx.Action("payout.read"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("restaurant.accepting_orders_set"),
		httpx.Action("restaurant.availability_read"),
		httpx.Action("restaurant.documents_read"),
		httpx.Action("restaurant.documents_submit"),
		httpx.Action("restaurant.documents_write"),
		httpx.Action("restaurant.heartbeat"),
		httpx.Action("restaurant.hours_read"),
		httpx.Action("restaurant.hours_write"),
		httpx.Action("restaurant.menu_category_write"),
		httpx.Action("restaurant.menu_item_availability"),
		httpx.Action("restaurant.menu_item_write"),
		httpx.Action("restaurant.menu_read_own"),
		httpx.Action("restaurant.onboarding_read"),
		httpx.Action("restaurant.order_accept"),
		httpx.Action("restaurant.order_delay"),
		httpx.Action("restaurant.order_read"),
		httpx.Action("restaurant.order_ready"),
		httpx.Action("restaurant.order_reject"),
		httpx.Action("restaurant.profile_read"),
		httpx.Action("restaurant.profile_write"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleRestaurantManager: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("connect.read"),
		httpx.Action("kyc_document.download"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("restaurant.accepting_orders_set"),
		httpx.Action("restaurant.availability_read"),
		httpx.Action("restaurant.documents_read"),
		httpx.Action("restaurant.documents_submit"),
		httpx.Action("restaurant.documents_write"),
		httpx.Action("restaurant.heartbeat"),
		httpx.Action("restaurant.hours_read"),
		httpx.Action("restaurant.hours_write"),
		httpx.Action("restaurant.menu_category_write"),
		httpx.Action("restaurant.menu_item_availability"),
		httpx.Action("restaurant.menu_item_write"),
		httpx.Action("restaurant.menu_read_own"),
		httpx.Action("restaurant.onboarding_read"),
		httpx.Action("restaurant.order_accept"),
		httpx.Action("restaurant.order_delay"),
		httpx.Action("restaurant.order_read"),
		httpx.Action("restaurant.order_ready"),
		httpx.Action("restaurant.order_reject"),
		httpx.Action("restaurant.profile_read"),
		httpx.Action("restaurant.profile_write"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleRestaurantStaff: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("restaurant.accepting_orders_set"),
		httpx.Action("restaurant.availability_read"),
		httpx.Action("restaurant.heartbeat"),
		httpx.Action("restaurant.hours_read"),
		httpx.Action("restaurant.menu_item_availability"),
		httpx.Action("restaurant.menu_read_own"),
		httpx.Action("restaurant.onboarding_read"),
		httpx.Action("restaurant.order_accept"),
		httpx.Action("restaurant.order_delay"),
		httpx.Action("restaurant.order_read"),
		httpx.Action("restaurant.order_ready"),
		httpx.Action("restaurant.order_reject"),
		httpx.Action("restaurant.profile_read"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleSupportAgent: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("halal_certificate.read"),
		httpx.Action("halal_issuing_body.read"),
		httpx.Action("order.cancel_support"),
		httpx.Action("order.read_any"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("refund.issue_goodwill"),
		httpx.Action("refund.read"),
		httpx.Action("refund.request"),
		httpx.Action("restaurant_application.read"),
		httpx.Action("rider_application.read"),
	),
	httpx.RoleAdmin: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("document.review"),
		httpx.Action("halal_certificate.check"),
		httpx.Action("halal_certificate.decide"),
		httpx.Action("halal_certificate.read"),
		httpx.Action("halal_certificate.transcribe"),
		httpx.Action("halal_issuing_body.propose"),
		httpx.Action("halal_issuing_body.read"),
		httpx.Action("kyc_document.download"),
		httpx.Action("menu.create_on_behalf"),
		httpx.Action("menu_version.decide"),
		httpx.Action("menu_version.read"),
		httpx.Action("order.cancel_support"),
		httpx.Action("order.read_any"),
		httpx.Action("platform_deps.read"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("refund.issue_goodwill"),
		httpx.Action("refund.read"),
		httpx.Action("refund.request"),
		httpx.Action("restaurant.approve"),
		httpx.Action("restaurant_application.claim"),
		httpx.Action("restaurant_application.read"),
		httpx.Action("rider.approve"),
		httpx.Action("rider_application.claim"),
		httpx.Action("rider_application.read"),
		httpx.Action("staff.read"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
	httpx.RoleSuperAdmin: setOf(
		ActionSessionReadSelf,
		ActionSessionRevokeSelf,
		httpx.Action("document.review"),
		httpx.Action("halal_certificate.check"),
		httpx.Action("halal_certificate.decide"),
		httpx.Action("halal_certificate.read"),
		httpx.Action("halal_certificate.transcribe"),
		httpx.Action("halal_issuing_body.propose"),
		httpx.Action("halal_issuing_body.read"),
		httpx.Action("halal_issuing_body.set_status"),
		httpx.Action("kyc_document.download"),
		httpx.Action("menu.create_on_behalf"),
		httpx.Action("menu_version.decide"),
		httpx.Action("menu_version.read"),
		httpx.Action("order.cancel_support"),
		httpx.Action("order.read_any"),
		httpx.Action("platform_deps.read"),
		httpx.Action("realtime_schema.read"),
		httpx.Action("realtime_ticket.create"),
		httpx.Action("refund.issue_goodwill"),
		httpx.Action("refund.read"),
		httpx.Action("refund.request"),
		httpx.Action("restaurant.approve"),
		httpx.Action("restaurant_application.claim"),
		httpx.Action("restaurant_application.read"),
		httpx.Action("rider.approve"),
		httpx.Action("rider_application.claim"),
		httpx.Action("rider_application.read"),
		httpx.Action("staff.create"),
		httpx.Action("staff.read"),
		httpx.Action("upload.confirm"),
		httpx.Action("upload.create"),
	),
}

func setOf(actions ...httpx.Action) map[httpx.Action]struct{} {
	m := make(map[httpx.Action]struct{}, len(actions))
	for _, a := range actions {
		m[a] = struct{}{}
	}
	return m
}

// Matrix is the httpx.Authorizer answering the P-05 role question. It replaces
// the boot-time DenyAllAuthorizer. Ownership (P-07) is a separate, later
// question the repository answers in SQL — this only decides the role→action
// half.
type Matrix struct{}

// RoleHasAction reports whether any of the caller's roles grants the action.
func (Matrix) RoleHasAction(roles []httpx.Role, a httpx.Action) bool {
	for _, r := range roles {
		if acts, ok := matrix[r]; ok {
			if _, granted := acts[a]; granted {
				return true
			}
		}
	}
	return false
}

// AllActions returns every action present in the matrix, sorted-independent.
// Used by the golden test to assert the closed set does not drift silently.
func AllActions() map[httpx.Action]struct{} {
	all := map[httpx.Action]struct{}{}
	for _, acts := range matrix {
		for a := range acts {
			all[a] = struct{}{}
		}
	}
	return all
}
