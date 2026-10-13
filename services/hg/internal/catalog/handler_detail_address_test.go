package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// getRestaurantAs calls GetRestaurant for restaurantID with the given query, as accountID.
func getRestaurantAs(h *Handler, restaurantID, query, accountID string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/v1/restaurants/"+restaurantID+query, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("restaurantId", restaurantID)
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rctx)
	ctx = httpx.WithPrincipalForTest(ctx, httpx.Principal{AccountID: accountID})
	w := httptest.NewRecorder()
	h.GetRestaurant(w, r.WithContext(ctx))
	return w
}

// TestGetRestaurantRejectsMalformedAddressID: a delivery_address_id that is not a UUID is a
// validation error, answered before any database read.
func TestGetRestaurantRejectsMalformedAddressID(t *testing.T) {
	h := NewHandler(nil, nil, nil, nil)
	w := getRestaurantAs(h, "33333333-3333-4333-8333-333333333333",
		"?delivery_address_id=not-a-uuid", "11111111-1111-4111-8111-111111111111")
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body %s", w.Code, w.Body.String())
	}
}

// TestGetRestaurantResolvesTheCallersAddress pins the delivery_address_id branch end to end:
// with no latitude/longitude, the caller's own saved address supplies the point, so the
// availability is priced against it (a distance, not NO_ADDRESS). The same id asked for by
// another account reads as no address.
func TestGetRestaurantResolvesTheCallersAddress(t *testing.T) {
	pool := requirePool(t)
	rp := NewRepo(pool)
	ctx := context.Background()

	var addressID, owner string
	if err := pool.QueryRow(ctx, `
		SELECT id::text, account_id::text FROM address
		 WHERE deleted_at IS NULL AND location IS NOT NULL LIMIT 1`).Scan(&addressID, &owner); err != nil {
		t.Skipf("no located address in the target database: %v", err)
	}
	rows, err := rp.listVisible(ctx, listFilters{limit: 1})
	if err != nil {
		t.Fatalf("listVisible: %v", err)
	}
	if len(rows) == 0 {
		t.Skip("no visible restaurant in the target database")
	}
	restaurantID := rows[0].id
	h := NewHandler(rp, nil, nil, nil)

	availability := func(w *httptest.ResponseRecorder) RestaurantAvailabilityInfo {
		t.Helper()
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body %s", w.Code, w.Body.String())
		}
		var env struct {
			Data RestaurantDetail `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return env.Data.Availability
	}

	mine := availability(getRestaurantAs(h, restaurantID, "?delivery_address_id="+addressID, owner))
	if mine.State == availNoAddress || mine.DistanceM == nil {
		t.Fatalf("owner's address not used: state=%q distance=%v", mine.State, mine.DistanceM)
	}

	other := "00000000-0000-4000-8000-0000000000ff"
	theirs := availability(getRestaurantAs(h, restaurantID, "?delivery_address_id="+addressID, other))
	if theirs.State != availNoAddress || theirs.DistanceM != nil {
		t.Fatalf("another account's request got a point: state=%q distance=%v", theirs.State, theirs.DistanceM)
	}
}
