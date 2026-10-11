package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestListRestaurantsResolvesDeliveryAddressID pins the contract's delivery_address_id on the
// list: the caller's saved address supplies the point, so a nearby address lists the
// restaurant OPEN with a distance and a far one lists it OUT_OF_RANGE, never NO_ADDRESS.
// Another account's address id, and an anonymous caller, read as no address.
// https://github.com/shaiknoorullah/hg-mono/issues/724
func TestListRestaurantsResolvesDeliveryAddressID(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), testseed.FreshDatabase(t, "catalog_listaddr"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	var restaurantID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code,
		                        location, timezone, onboarding_state, account_state, is_accepting_orders,
		                        last_heartbeat_at, commission_rate_bps, tax_role, minimum_order_cents)
		VALUES ('list-addr', 'Test Co', 'List Addr', 'ON', 'Toronto', '1 King St', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography, 'America/Toronto',
		        'ACTIVE', 'LIVE', true, now(), 0, 'RESTAURANT_IS_SUPPLIER', 0)
		RETURNING id`).Scan(&restaurantID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	testseed.CertifyRestaurant(t, pool, restaurantID, 300)
	if _, err := pool.Exec(ctx, `
		INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)
		SELECT $1, d, time '00:00', time '00:00', true FROM generate_series(0, 6) AS d`, restaurantID); err != nil {
		t.Fatalf("seed hours: %v", err)
	}

	account := func(email string) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id`,
			email).Scan(&id); err != nil {
			t.Fatalf("seed account: %v", err)
		}
		return id
	}
	address := func(accountID, label string, lng, lat float64) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO address (account_id, label, line1, city, province, postal_code, location, timezone)
			VALUES ($1, $2, '1 Test St', 'Toronto', 'ON', 'M5J 0C3',
			        ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, 'America/Toronto')
			RETURNING id`, accountID, label, lng, lat).Scan(&id); err != nil {
			t.Fatalf("seed address %s: %v", label, err)
		}
		return id
	}
	amina, other := account("amina@test.local"), account("other@test.local")
	home := address(amina, "Home", -79.3900, 43.6450)    // about 1 km away
	cottage := address(amina, "Cottage", -79.6000, 45.0) // Muskoka, far beyond the 8 km radius
	othersHome := address(other, "Home", -79.3900, 43.6450)

	h := NewHandler(NewRepo(pool), nil, nil, nil)
	list := func(query string, p httpx.Principal) RestaurantAvailabilityInfo {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "/v1/restaurants"+query, nil)
		r = r.WithContext(httpx.WithPrincipalForTest(r.Context(), p))
		w := httptest.NewRecorder()
		h.ListRestaurants(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status = %d; body %s", query, w.Code, w.Body.String())
		}
		var env struct {
			Data []RestaurantCard `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, c := range env.Data {
			if c.ID == restaurantID {
				return c.Availability
			}
		}
		t.Fatalf("%s: restaurant not listed", query)
		return RestaurantAvailabilityInfo{}
	}

	as := httpx.Principal{AccountID: amina}
	if got := list("?delivery_address_id="+home, as); got.State != availOpen || got.DistanceM == nil {
		t.Errorf("Home: state=%q distance=%v, want OPEN with a distance", got.State, got.DistanceM)
	}
	if got := list("?delivery_address_id="+cottage, as); got.State != availOutOfRange || got.DistanceM == nil {
		t.Errorf("Cottage: state=%q distance=%v, want OUT_OF_RANGE with a distance", got.State, got.DistanceM)
	}
	if got := list("?delivery_address_id="+othersHome, as); got.State != availNoAddress || got.DistanceM != nil {
		t.Errorf("another account's address: state=%q distance=%v, want NO_ADDRESS", got.State, got.DistanceM)
	}
	if got := list("?delivery_address_id="+home, httpx.AnonymousPrincipal()); got.State != availNoAddress {
		t.Errorf("anonymous: state=%q, want NO_ADDRESS", got.State)
	}
}
