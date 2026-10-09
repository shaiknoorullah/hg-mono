package admin

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// The P-05 permission actions this module declares. Each handler names exactly
// one, and the httpx.Router refuses to boot a route that names none (I-06.1).
//
// The role→action mapping itself is the auth sibling's internal/authz.Matrix
// (a compile-time constant with a golden test). This module only *declares*
// which action guards which route; it never decides which role holds it.
const (
	// Staff & RBAC (A-01, A-02).
	ActionStaffRead   httpx.Action = "staff.read"
	ActionStaffCreate httpx.Action = "staff.create"

	// Restaurant onboarding queue (A-13, A-18).
	ActionRestaurantApplicationRead   httpx.Action = "restaurant_application.read"
	ActionRestaurantApplicationClaim  httpx.Action = "restaurant_application.claim"
	ActionRestaurantApplicationDecide httpx.Action = "restaurant.approve"

	// Rider onboarding queue (A-23).
	ActionRiderApplicationRead   httpx.Action = "rider_application.read"
	ActionRiderApplicationClaim  httpx.Action = "rider_application.claim"
	ActionRiderApplicationDecide httpx.Action = "rider.approve"

	// Document review (A-14).
	ActionDocumentReview httpx.Action = "document.review"

	// The halal seven-check (A-15, A-16) — the platform's reason to exist.
	ActionHalalCertRead        httpx.Action = "halal_certificate.read"
	ActionHalalCertTranscribe  httpx.Action = "halal_certificate.transcribe"
	ActionHalalCertChecks      httpx.Action = "halal_certificate.check"
	ActionHalalCertDecide      httpx.Action = "halal_certificate.decide"
	ActionHalalIssuerRead      httpx.Action = "halal_issuing_body.read"
	ActionHalalIssuerPropose   httpx.Action = "halal_issuing_body.propose"
	ActionHalalIssuerSetStatus httpx.Action = "halal_issuing_body.set_status"

	// Menu approval on claim-bearing fields (A-19).
	ActionMenuReviewRead     httpx.Action = "menu_version.read"
	ActionMenuReviewDecide   httpx.Action = "menu_version.decide"
	ActionMenuCreateOnBehalf httpx.Action = "menu.create_on_behalf"

	// Order oversight (A-38).
	// ActionOrderReadAny guards listOrdersAdmin and getOrderAdmin: staff can read
	// any order regardless of customer ownership.
	ActionOrderReadAny httpx.Action = "order.read_any"
	// ActionOrderCancelSupport guards cancelOrderAdmin: staff can force-cancel via
	// the support/admin path (machine transition T11).
	ActionOrderCancelSupport httpx.Action = "order.cancel_support"
	// ActionOrderHandoverOverride guards overrideHandoverCode: support or an
	// admin confirms a pickup or a met handover whose code cannot be used — the
	// only way past a handover code (https://github.com/shaiknoorullah/hg-mono/issues/310).
	ActionOrderHandoverOverride httpx.Action = "order.handover_override"

	// The platform-wide pause on new orders
	// (https://github.com/shaiknoorullah/hg-mono/issues/244). Reading it is for
	// every staff role; changing it is for ADMIN and SUPER_ADMIN only
	// (ordering_pause.go says why).
	ActionOrderingPauseRead httpx.Action = "ordering_pause.read"
	ActionOrderingPauseSet  httpx.Action = "ordering_pause.set"
)
