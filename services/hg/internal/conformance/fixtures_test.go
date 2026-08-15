package conformance

// Deterministic fixture identifiers present in the migrated+seeded Postgres the
// harness runs against (the same DB the other integration tests use). These are
// the stable, hand-placed seed rows; discovered once and pinned here so the
// harness drives real read paths without re-seeding what the fixture DB already
// provides.
//
// If a fixture row is missing the harness fails loudly at request time (wrong
// status / empty body), which is correct: the conformance gate needs a seeded DB
// and should not silently pass without one.
const (
	// Customer with orders and an (empty) cart.
	fxCustomerID = "11111111-1111-4111-8111-111111111111"

	// The seeded restaurant every fixture order/menu/cart is bound to.
	fxRestaurantID = "33333333-3333-4333-8333-333333333333"

	// A RESTAURANT_MANAGER account scoped (account_role.scope_id) to
	// fxRestaurantID — resolves the restaurant-facing surface.
	fxRestaurantManagerID = "77777777-7777-4777-8777-777777777777"

	// An order in the PREPARING state, bound to fxRestaurantID and placed by
	// fxCustomerID. Reachable from both the customer projection (getOrder) and
	// the restaurant projection (getRestaurantOrder).
	fxOrderID = "88888888-8888-4888-8888-888888888888"

	// A customer whose cart is NON-EMPTY (one line) and bound to fxRestaurantID.
	// A non-empty cart is where the getCart halal-badge / restaurant drift
	// surfaces (an empty cart legitimately carries restaurant:null).
	fxNonEmptyCartAccountID = "019ffb7c-d9ea-7bc5-aed9-9b645a83e27e"

	// An ACTIVE rider account (rider_profile present).
	fxRiderID = "019ffe57-fbd0-7355-ade8-b03ea7943578"

	// A SUPER_ADMIN account (global scope).
	fxSuperAdminID = "019ff68d-af0f-7e5b-a1ab-25bfa033f6f5"

	// A menu category and an APPROVED menu-item version under fxRestaurantID.
	fxMenuCategoryID = "44444444-4444-4444-8444-444444444444"
	fxMenuVersionID  = "66666666-6666-4666-8666-666666666666"

	// A delivery address owned by fxCustomerID.
	fxAddressID = "22222222-2222-4222-8222-222222222222"

	// A COMPLETED order (fxCustomerID, fxRestaurantID, fxRiderID assigned via
	// dispatch), delivered_at 1 day ago — inside the 14-day review window, for
	// getOrderRating / submitOrderRating (C-38, scoped; migrations/test/fixtures.sql).
	fxRatableOrderID = "14000000-0000-4000-8000-000000000001"
)

// Role name constants (mirror httpx.Role values; kept as plain strings so the
// Request.Roles slice reads naturally).
const (
	roleCustomer          = "CUSTOMER"
	roleRider             = "RIDER"
	roleRestaurantManager = "RESTAURANT_MANAGER"
	roleRestaurantOwner   = "RESTAURANT_OWNER"
	roleSuperAdmin        = "SUPER_ADMIN"
	roleAdmin             = "ADMIN"
)
