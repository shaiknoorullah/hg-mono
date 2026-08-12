package catalog

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"

// Routes registers the catalogue and discovery routes on the shared router.
//
// This is the single Routes(r, deps) function every module repeats. Every route
// carries an explicit Policy and the contract's operationId. Nothing is public:
// the contract marks every discovery and restaurant operation x-roles [CUSTOMER]
// or [RESTAURANT_*], never [PUBLIC], so deny-by-default keeps them all guarded.
//
// The contract's discovery operations declare x-rate-class SEARCH, which httpx
// does not (yet) enumerate as a RateClass; they are reads, so they take
// ClassRead — the timeout and body limit are identical. When httpx gains a
// SEARCH class with its own token bucket, only these lines change.
func Routes(r *httpx.Router, h *Handler) {
	read := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassRead, OperationID: op}
	}
	write := func(action httpx.Action, op string) httpx.Policy {
		return httpx.Policy{Action: action, Class: httpx.ClassWrite, OperationID: op}
	}

	// Customer discovery (tag: discovery).
	r.Get("/v1/restaurants", read(ActionRestaurantList, "listRestaurants"), h.ListRestaurants)
	r.Get("/v1/feed", read(ActionFeedRead, "getHomeFeed"), h.GetHomeFeed)
	r.Get("/v1/search", read(ActionSearch, "search"), h.Search)
	r.Get("/v1/restaurants/{restaurantId}", read(ActionRestaurantRead, "getRestaurant"), h.GetRestaurant)
	r.Get("/v1/restaurants/{restaurantId}/menu", read(ActionRestaurantMenuRead, "getRestaurantMenu"), h.GetRestaurantMenu)
	r.Get("/v1/restaurants/{restaurantId}/certification", read(ActionCertificationRead, "getRestaurantCertification"), h.GetRestaurantCertification)
	// The certificate view URL is a write (it mints and audits a presigned URL),
	// so it takes ClassWrite even though it reads no body.
	r.Post("/v1/restaurants/{restaurantId}/certificate-url",
		write(ActionCertificateView, "createCertificateViewUrl"), h.CreateCertificateViewUrl)

	// Restaurant-facing trading state (tag: restaurant).
	r.Get("/v1/restaurant/availability", read(ActionAvailabilityRead, "getRestaurantAvailability"), h.GetRestaurantAvailability)
	r.Patch("/v1/restaurant/availability", write(ActionAcceptingOrdersSet, "setRestaurantAcceptingOrders"), h.SetRestaurantAcceptingOrders)
	r.Post("/v1/restaurant/heartbeat", httpx.Policy{
		Action:      ActionHeartbeat,
		Class:       httpx.ClassRealtime,
		OperationID: "sendRestaurantHeartbeat",
	}, h.SendRestaurantHeartbeat)
}
