package catalog

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// P-05 actions this module guards. Handlers never pass a string literal (I-05.2);
// these constants live beside the module that owns the noun. The role→action
// mapping itself is the auth sibling's authz.Matrix; these are only the action
// names the routes require.
const (
	// Customer discovery. The contract gives every discovery operation
	// x-roles: [CUSTOMER]; the browse surface is not public because a customer's
	// address and cart context are part of every read.
	ActionRestaurantList     httpx.Action = "restaurant.list"
	ActionRestaurantRead     httpx.Action = "restaurant.read"
	ActionRestaurantMenuRead httpx.Action = "restaurant.menu_read"
	ActionCertificationRead  httpx.Action = "restaurant.certification_read"
	ActionCertificateView    httpx.Action = "restaurant.certificate_view"
	ActionFeedRead           httpx.Action = "discovery.feed_read"
	ActionSearch             httpx.Action = "discovery.search"

	// Restaurant-facing catalogue management (R-14…R-22).
	ActionOwnMenuRead          httpx.Action = "menu.own_read"
	ActionMenuCategoryCreate   httpx.Action = "menu.category_create"
	ActionMenuItemCreate       httpx.Action = "menu.item_create"
	ActionMenuItemUpdate       httpx.Action = "menu.item_update"
	ActionMenuItemAvailability httpx.Action = "menu.item_availability"
	ActionAvailabilityRead     httpx.Action = "restaurant.availability_read"
	ActionAcceptingOrdersSet   httpx.Action = "restaurant.accepting_orders_set"
	ActionHeartbeat            httpx.Action = "restaurant.heartbeat"
)

// Domain error codes this module raises. Every one exists in the contract's
// ErrorCode enum (contract first, then code).
const (
	codeRestaurantNotFound   httpx.ErrorCode = "NOT_FOUND"
	codeValidationFailed     httpx.ErrorCode = "VALIDATION_FAILED"
	codeUnknownField         httpx.ErrorCode = "UNKNOWN_FIELD"
	codePriceOutOfRange      httpx.ErrorCode = "PRICE_OUT_OF_RANGE"
	codeProhibitedIngredient httpx.ErrorCode = "PROHIBITED_INGREDIENT"
	codeFieldNotWritable     httpx.ErrorCode = "FIELD_NOT_WRITABLE"
	codeCategoryNameTaken    httpx.ErrorCode = "CATEGORY_NAME_TAKEN"
	codeItemBlockedByAdmin   httpx.ErrorCode = "ITEM_BLOCKED_BY_ADMIN"
	codeCertificateNotFound  httpx.ErrorCode = "NOT_FOUND"
)
