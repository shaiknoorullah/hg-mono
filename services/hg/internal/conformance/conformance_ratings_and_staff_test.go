package conformance

// Ratings + restaurant-scoped staff conformance — the four operations added to
// close the admin live-map / ratings / restaurant-staff contract gaps:
//
//	getOrderRating           GET  /v1/orders/{orderId}/rating
//	submitOrderRating        PUT  /v1/orders/{orderId}/rating
//	listRestaurantStaff      GET  /v1/restaurant/staff
//	createRestaurantStaffUser POST /v1/restaurant/staff

import (
	"fmt"
	"net/http"
	"testing"
)

func TestConformance_OrderRating(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// getOrderRating before any rating exists: both halves null, still 200.
	t.Run("getOrderRating_unrated", func(t *testing.T) {
		h.CheckResponse(t, Request{
			Method: "GET", Path: "/v1/orders/" + fxRatableOrderID + "/rating",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
		}, 200)
	})

	// submitOrderRating: both food and rider in one call (C-38: "submitting
	// persists all three [here, both] in one request").
	t.Run("submitOrderRating", func(t *testing.T) {
		h.CheckResponse(t, Request{
			Method: "PUT", Path: "/v1/orders/" + fxRatableOrderID + "/rating",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			IdemKey: "conf-rate-order-000001",
			Body: map[string]any{
				"food":  map[string]any{"score": 4, "review": "Solid biryani, arrived hot.", "tags": []string{"Food quality", "Speed"}},
				"rider": map[string]any{"score": 5, "comment": "On time and courteous.", "tags": []string{"On time", "Polite"}},
			},
		}, 200)
	})

	// getOrderRating after submission: both halves now populated.
	t.Run("getOrderRating_rated", func(t *testing.T) {
		h.CheckResponse(t, Request{
			Method: "GET", Path: "/v1/orders/" + fxRatableOrderID + "/rating",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
		}, 200)
	})
}

func TestConformance_RestaurantStaff(t *testing.T) {
	pool := openPool(t)
	h := NewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	t.Run("listRestaurantStaff", func(t *testing.T) {
		h.CheckResponse(t, Request{
			Method: "GET", Path: "/v1/restaurant/staff",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager},
		}, 200)
	})

	t.Run("createRestaurantStaffUser", func(t *testing.T) {
		email := fmt.Sprintf("conf-staff-%s@example.test", fxRestaurantManagerID[:8])
		req, resp := h.Do(t, Request{
			Method: "POST", Path: "/v1/restaurant/staff",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantManager},
			IdemKey: "conf-create-staff-000001",
			Body:    map[string]any{"email": email, "full_name": "Conformance Test Staff"},
		})
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusConflict {
			t.Errorf("createRestaurantStaffUser: status = %d, want 201 or 409", resp.StatusCode)
		}
		opID, err := ValidateResponse(t, h.Spec, req, resp)
		h.MarkCovered(opID)
		if err != nil && resp.StatusCode/100 == 2 {
			t.Errorf("CONFORMANCE FAIL (createRestaurantStaffUser): %v", err)
		}
	})
}
