package conformance

// Restaurant-partner + catalog trading-state conformance — class: more-restaurant.
//
// This file extends the contract-conformance oracle to the restaurant portal
// WRITE surface and the catalog trading-state surface that the existing passes
// left uncovered. It reuses newARWHarness (conformance_admin-rider-writes_test.go)
// which already wires restaurant + catalog (with a pg scope resolver) + orders +
// admin, so every route here is reachable through the production constructors.
//
// Operations covered here:
//
//	Restaurant module (partner portal):
//	  submitRestaurantProfile     PUT  /v1/restaurant/profile
//	  setRestaurantHours          PUT  /v1/restaurant/hours
//	  attachRestaurantDocument    POST /v1/restaurant/documents
//	  submitRestaurantDocuments   POST /v1/restaurant/documents/submit
//	  createMenuCategory          POST /v1/restaurant/menu/categories
//	  createMenuItem              POST /v1/restaurant/menu/items
//	  updateMenuItem              PATCH /v1/restaurant/menu/items/{itemId}
//	  setMenuItemAvailability     PUT  /v1/restaurant/menu/items/{itemId}/availability
//	  deleteMenuItem              DELETE /v1/restaurant/menu/items/{itemId}
//	  deleteMenuCategory          DELETE /v1/restaurant/menu/categories/{categoryId}
//	  markOrderReady              POST /v1/restaurant/orders/{orderId}/ready
//
//	Catalog module (restaurant trading state):
//	  getRestaurantAvailability   GET   /v1/restaurant/availability
//	  setRestaurantAcceptingOrders PATCH /v1/restaurant/availability
//	  sendRestaurantHeartbeat     POST  /v1/restaurant/heartbeat
//
// Every write op has its request body proven contract-valid (ValidateRequest)
// and its 2xx response validated (ValidateResponse). The restaurant portal
// resolves the caller's restaurant from an account_role RESTAURANT grant, so
// each seed inserts a RESTAURANT_MANAGER account scoped to a freshly-seeded
// restaurant; the request carries the RESTAURANT_MANAGER role header, which the
// production auth matrix grants every action under test.

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// ─── seed helpers (scoped to this file, mr* prefix) ──────────────────────────

// mrRestaurant is the seeded restaurant + its scoped manager + a menu
// category/item, all owned by this test and removed on cleanup.
type mrRestaurant struct {
	restaurantID string
	managerID    string
	categoryID   string
	itemID       string
}

// mrSeedRestaurant inserts a restaurant in the given onboarding_state (LIVE
// account_state, accepting orders) plus a RESTAURANT_MANAGER account scoped to
// it via account_role, a menu category and a menu item. All rows are removed in
// FK order on cleanup.
func mrSeedRestaurant(t *testing.T, pool *pgxpool.Pool, onboarding string) mrRestaurant {
	t.Helper()
	ctx := context.Background()
	var b mrRestaurant

	// account_state 'LIVE' requires onboarding_state 'ACTIVE'
	// (restaurant_live_needs_onboarding CHECK); a mid-onboarding restaurant is PENDING.
	accountState := "PENDING"
	if onboarding == "ACTIVE" {
		accountState = "LIVE"
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (
			slug, legal_name, display_name, line1, city, province, postal_code,
			location, timezone, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps)
		VALUES (
			'mr-'||substr(md5(random()::text),1,10), 'MR Kitchen Inc.', 'MR Kitchen',
			'50 Bay St', 'Toronto', 'ON', 'M5J2X2',
			ST_SetSRID(ST_MakePoint(-79.3785, 43.6440), 4326)::geography, 'America/Toronto',
			$1::restaurant_onboarding_state, $2::restaurant_account_state, true, 0)
		RETURNING id`, onboarding, accountState).Scan(&b.restaurantID); err != nil {
		t.Fatalf("mrSeedRestaurant restaurant: %v", err)
	}

	// Manager account + RESTAURANT-scoped grant (resolveRestaurant reads this).
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('mr-mgr-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
		RETURNING id`).Scan(&b.managerID); err != nil {
		t.Fatalf("mrSeedRestaurant manager account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type, scope_id)
		VALUES ($1, 'RESTAURANT_MANAGER', 'RESTAURANT', $2)`, b.managerID, b.restaurantID); err != nil {
		t.Fatalf("mrSeedRestaurant account_role: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Mains') RETURNING id`,
		b.restaurantID).Scan(&b.categoryID); err != nil {
		t.Fatalf("mrSeedRestaurant category: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
		VALUES ($1, $2, 1500, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		b.restaurantID, b.categoryID).Scan(&b.itemID); err != nil {
		t.Fatalf("mrSeedRestaurant menu_item: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM menu_item WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM menu_category WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM kyc_document WHERE subject_id=$1 AND subject_type='RESTAURANT'`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM halal_certificate WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_application WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_cuisine WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_hours WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant_hours_override WHERE restaurant_id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM stored_object WHERE uploaded_by=$1`, b.managerID)
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, b.restaurantID)
		_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, b.managerID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, b.managerID)
	})
	return b
}

// mrSeedStoredObject inserts one READY KYC_DOCUMENT stored object uploaded by the
// given account, returning its id. A READY object must carry no deadline (the
// stored_object_deadline_required CHECK).
func mrSeedStoredObject(t *testing.T, pool *pgxpool.Pool, uploader string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
		                           state, virus_scan_state, uploaded_by, confirmed_at)
		VALUES ('hg-kyc', 'mr/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 2048,
		        decode(repeat('c3',32),'hex'), 'READY', 'CLEAN', $1, now())
		RETURNING id`, uploader).Scan(&id); err != nil {
		t.Fatalf("mrSeedStoredObject: %v", err)
	}
	return id
}

// mrSeedDocPack inserts one kyc_document for each of the four required restaurant
// doc types (BUSINESS_LICENCE, HALAL_CERTIFICATE, FOOD_SAFETY, OWNER_ID) in the
// SUBMITTED state, so submitRestaurantDocuments' CheckDocumentPack passes.
func mrSeedDocPack(t *testing.T, pool *pgxpool.Pool, restaurantID, storedObjectID string) {
	t.Helper()
	ctx := context.Background()
	for _, dt := range []string{"BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY", "OWNER_ID"} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
			                          state, deadline_at, deadline_action)
			VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'SUBMITTED',
			        now()+interval '72h', 'ESCALATE')`, restaurantID, dt, storedObjectID); err != nil {
			t.Fatalf("mrSeedDocPack %s: %v", dt, err)
		}
	}
}

// mrSeedPreparingOrder seeds a full customer→cart→quote→order chain bound to the
// given restaurant, with the order in PREPARING (the state markOrderReady
// transitions). It returns the order id. All rows are removed on cleanup.
func mrSeedPreparingOrder(t *testing.T, pool *pgxpool.Pool, restaurantID, menuItemID string) string {
	t.Helper()
	ctx := context.Background()

	// A single transaction so the DEFERRED quote_tax_total / order money-identity
	// constraints see the tax + line rows together at commit, exactly as the real
	// pricing path writes them (fixtures.sql does the same in one BEGIN…COMMIT).
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("mrSeedPreparingOrder begin: %v", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	var customerID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO account (phone_e164, status, timezone)
		VALUES ('+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'), 'ACTIVE', 'America/Toronto')
		RETURNING id`).Scan(&customerID); err != nil {
		t.Fatalf("mrSeedPreparingOrder account: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO customer_profile (account_id, first_name) VALUES ($1, 'MR Cust')
		ON CONFLICT (account_id) DO NOTHING`, customerID); err != nil {
		t.Fatalf("mrSeedPreparingOrder customer_profile: %v", err)
	}
	var addressID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone)
		VALUES ($1, '1 King St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography, 'America/Toronto')
		RETURNING id`, customerID).Scan(&addressID); err != nil {
		t.Fatalf("mrSeedPreparingOrder address: %v", err)
	}
	var cartID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO cart (account_id, restaurant_id, delivery_address_id)
		VALUES ($1, $2, $3) RETURNING id`, customerID, restaurantID, addressID).Scan(&cartID); err != nil {
		t.Fatalf("mrSeedPreparingOrder cart: %v", err)
	}
	var quoteID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO quote (
			account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
			pricing_config_id, tax_jurisdiction_code,
			subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
			commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
			billable_km, route_meters, input_hash, state_hash, expires_at)
		SELECT $1, $2, $3, $4, 'DELIVERY', pc.id, 'CA-ON',
		       3000, 419, 0, 444, 500, 4363, 0, 3000, 919, 0,
		       2, 1900, digest('mr-input','sha256'), digest('mr-state','sha256'), now() + interval '10 minutes'
		  FROM pricing_config pc WHERE pc.version = 1
		RETURNING id`, customerID, cartID, restaurantID, addressID).Scan(&quoteID); err != nil {
		t.Fatalf("mrSeedPreparingOrder quote: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO quote_line (quote_id, line_no, menu_item_id, menu_item_name, quantity,
		                        base_price_cents, variant_part_cents, addons_part_cents,
		                        line_unit_cents, line_total_cents, tax_category)
		VALUES ($1, 1, $2, 'MR Item', 2, 1500, 1500, 0, 1500, 3000, 'PREPARED_FOOD')`,
		quoteID, menuItemID); err != nil {
		t.Fatalf("mrSeedPreparingOrder quote_line: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO quote_tax_line (quote_id, seq, jurisdiction_code, tax_kind, statutory_label,
		                            rate, base_cents, amount_cents, remittable_by)
		VALUES ($1, 1, 'CA-ON', 'HST', 'HST', 0.13000000, 3419, 444, 'PLATFORM')`, quoteID); err != nil {
		t.Fatalf("mrSeedPreparingOrder quote_tax_line: %v", err)
	}
	var orderID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO "order" (
			code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
			state, deadline_at, deadline_action,
			subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
			tax_total_cents, tip_cents, total_cents,
			commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
			accepted_at)
		VALUES (
			'MR-'||upper(substr(md5(random()::text),1,6)), $1, $2, $3, $4, 'DELIVERY',
			'PREPARING', now() + interval '30 minutes', 'PREP_OVERDUE',
			3000, 0, 419, 0, 444, 500, 4363, 0, 3000, 919, 0, now())
		RETURNING id`, quoteID, customerID, restaurantID, addressID).Scan(&orderID); err != nil {
		t.Fatalf("mrSeedPreparingOrder order: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_line (order_id, line_no, menu_item_id, name_snapshot, quantity,
		                        base_price_cents, variant_part_cents, addons_part_cents,
		                        line_unit_cents, line_total_cents, tax_category)
		VALUES ($1, 1, $2, 'MR Item', 2, 1500, 1500, 0, 1500, 3000, 'PREPARED_FOOD')`,
		orderID, menuItemID); err != nil {
		t.Fatalf("mrSeedPreparingOrder order_line: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("mrSeedPreparingOrder commit: %v", err)
	}
	committed = true

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM order_transition WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM order_line WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM deadline_audit WHERE subject_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote_tax_line WHERE quote_id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote_line WHERE quote_id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE account_id=$1`, customerID)
		_, _ = pool.Exec(ctx, `DELETE FROM customer_profile WHERE account_id=$1`, customerID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, customerID)
	})
	return orderID
}

// mrRoles is the role header for the seeded manager (the auth matrix grants
// RESTAURANT_MANAGER every action under test).
var mrRoles = []string{roleRestaurantManager}

// ─── tests ───────────────────────────────────────────────────────────────────

// TestConformance_MoreRestaurant_ProfileHoursAvailability covers the profile,
// hours and catalog trading-state write/read surface.
func TestConformance_MoreRestaurant_ProfileHoursAvailability(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	b := mrSeedRestaurant(t, pool, "ACTIVE")

	// submitRestaurantProfile — PUT /v1/restaurant/profile → RestaurantProfile.
	t.Run("submitRestaurantProfile", func(t *testing.T) {
		// cuisine_ids must reference the server-managed cuisine lookup (min 1 item,
		// FK-checked). Pull a real cuisine id from the seeded reference data.
		var cuisineID string
		if err := pool.QueryRow(context.Background(),
			`SELECT id::text FROM cuisine ORDER BY sort_order LIMIT 1`).Scan(&cuisineID); err != nil {
			t.Fatalf("fetch cuisine id: %v", err)
		}
		body := map[string]any{
			"legal_name":       "MR Kitchen Inc.",
			"display_name":     "MR Kitchen",
			"phone_e164":       "+14165550111",
			"description":      "A conformance-seeded halal kitchen serving biryani and grills.",
			"province":         "ON",
			"postal_code":      "M5J2X2",
			"city":             "Toronto",
			"line1":            "50 Bay St",
			"latitude":         43.6440,
			"longitude":        -79.3785,
			"cuisine_ids":      []string{cuisineID},
			"avg_prep_minutes": 20,
		}
		mrValidateReqThenResp(t, h, "PUT", "/v1/restaurant/profile", b.managerID, body, 200)
	})

	// setRestaurantHours — PUT /v1/restaurant/hours → RestaurantHours.
	t.Run("setRestaurantHours", func(t *testing.T) {
		body := map[string]any{
			"intervals": []map[string]any{
				{"day_of_week": 1, "opens_at": "09:00", "closes_at": "22:00"},
				{"day_of_week": 2, "opens_at": "09:00", "closes_at": "22:00"},
			},
			"overrides": []map[string]any{},
		}
		mrValidateReqThenResp(t, h, "PUT", "/v1/restaurant/hours", b.managerID, body, 200)
	})

	// getRestaurantAvailability — GET → RestaurantAvailability.
	t.Run("getRestaurantAvailability", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/restaurant/availability",
			AccountID: b.managerID, Roles: mrRoles}, 200)
	})

	// setRestaurantAcceptingOrders — PATCH → RestaurantAvailability.
	t.Run("setRestaurantAcceptingOrders", func(t *testing.T) {
		body := map[string]any{"is_accepting_orders": true}
		mrValidateReqThenResp(t, h, "PATCH", "/v1/restaurant/availability", b.managerID, body, 200)
	})

	// sendRestaurantHeartbeat — POST (no body) → RestaurantHeartbeat.
	t.Run("sendRestaurantHeartbeat", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/restaurant/heartbeat",
			AccountID: b.managerID, Roles: mrRoles}, 200)
	})
}

// TestConformance_MoreRestaurant_Menu covers the menu category/item write surface.
func TestConformance_MoreRestaurant_Menu(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	b := mrSeedRestaurant(t, pool, "ACTIVE")

	// createMenuCategory — POST → MenuCategory (201).
	t.Run("createMenuCategory", func(t *testing.T) {
		body := map[string]any{"name": "Desserts", "sort_order": 2}
		mrValidateReqThenResp(t, h, "POST", "/v1/restaurant/menu/categories", b.managerID, body, 201)
	})

	// createMenuItem — POST → MenuItem (201).
	t.Run("createMenuItem", func(t *testing.T) {
		body := map[string]any{
			"name":         "Lamb Biryani",
			"category_id":  b.categoryID,
			"price_cents":  1650,
			"dietary_tags": []string{},
		}
		mrValidateReqThenResp(t, h, "POST", "/v1/restaurant/menu/items", b.managerID, body, 201)
	})

	// updateMenuItem — PATCH → MenuItem (200).
	t.Run("updateMenuItem", func(t *testing.T) {
		body := map[string]any{"price_cents": 1700, "description": "Updated by conformance"}
		mrValidateReqThenResp(t, h, "PATCH", "/v1/restaurant/menu/items/"+b.itemID, b.managerID, body, 200)
	})

	// setMenuItemAvailability — PUT → MenuItem (200).
	t.Run("setMenuItemAvailability", func(t *testing.T) {
		body := map[string]any{"availability_state": "OUT_OF_STOCK"}
		mrValidateReqThenResp(t, h, "PUT", "/v1/restaurant/menu/items/"+b.itemID+"/availability", b.managerID, body, 200)
	})

	// deleteMenuItem — DELETE → 204, no body.
	t.Run("deleteMenuItem", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "DELETE", Path: "/v1/restaurant/menu/items/" + b.itemID,
			AccountID: b.managerID, Roles: mrRoles}, 204)
	})

	// deleteMenuCategory — DELETE → 204 on an empty category, 409
	// CATEGORY_NOT_EMPTY (an ErrorEnvelope) on one that still holds items.
	t.Run("deleteMenuCategory", func(t *testing.T) {
		var empty string
		if err := pool.QueryRow(context.Background(), `
			INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'Seasonal') RETURNING id`,
			b.restaurantID).Scan(&empty); err != nil {
			t.Fatalf("seed empty category: %v", err)
		}
		h.CheckResponse(t, Request{Method: "DELETE", Path: "/v1/restaurant/menu/categories/" + empty,
			AccountID: b.managerID, Roles: mrRoles}, 204)
		h.CheckResponse(t, Request{Method: "DELETE", Path: "/v1/restaurant/menu/categories/" + b.categoryID,
			AccountID: b.managerID, Roles: mrRoles}, 409)
	})
}

// TestConformance_MoreRestaurant_Documents covers attachRestaurantDocument and
// submitRestaurantDocuments. attachRestaurantDocument attaches a non-halal
// BUSINESS_LICENCE (avoiding the halal-cert required-fields branch);
// submitRestaurantDocuments runs against a restaurant with a complete doc pack
// seeded and its onboarding_state in DOCUMENTS_PENDING (the only states the
// submit transition accepts).
func TestConformance_MoreRestaurant_Documents(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// attachRestaurantDocument — POST → RestaurantDocument (201).
	t.Run("attachRestaurantDocument", func(t *testing.T) {
		b := mrSeedRestaurant(t, pool, "DOCUMENTS_PENDING")
		obj := mrSeedStoredObject(t, pool, b.managerID)
		body := map[string]any{
			"doc_type":         "BUSINESS_LICENCE",
			"stored_object_id": obj,
		}
		mrValidateReqThenResp(t, h, "POST", "/v1/restaurant/documents", b.managerID, body, 201)
	})

	// submitRestaurantDocuments — POST (no body) → RestaurantOnboardingStatus (200).
	t.Run("submitRestaurantDocuments", func(t *testing.T) {
		b := mrSeedRestaurant(t, pool, "DOCUMENTS_PENDING")
		obj := mrSeedStoredObject(t, pool, b.managerID)
		mrSeedDocPack(t, pool, b.restaurantID, obj)
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/restaurant/documents/submit",
			AccountID: b.managerID, Roles: mrRoles, IdemKey: fmt.Sprintf("mr-submit-%d", time.Now().UnixNano())}, 200)
	})
}

// TestConformance_MoreRestaurant_OrderReady covers markOrderReady against a
// freshly-seeded PREPARING order bound to the seeded restaurant (never the
// shared fxOrderID, whose state other tests read).
func TestConformance_MoreRestaurant_OrderReady(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	b := mrSeedRestaurant(t, pool, "ACTIVE")
	orderID := mrSeedPreparingOrder(t, pool, b.restaurantID, b.itemID)

	h.CheckResponse(t, Request{Method: "POST", Path: "/v1/restaurant/orders/" + orderID + "/ready",
		AccountID: b.managerID, Roles: mrRoles, IdemKey: fmt.Sprintf("mr-ready-%d", time.Now().UnixNano())}, 200)

	// The ready order carries the deadline action the deadline runner handles,
	// with a fresh escalation count. A hand-written RIDER_NO_SHOW had no handler,
	// and the order never moved (https://github.com/shaiknoorullah/hg-mono/issues/293).
	spec, _ := machine.DeadlineFor(machine.StateReadyForPickup)
	var action string
	var escalations int
	if err := pool.QueryRow(context.Background(),
		`SELECT deadline_action, deadline_escalations FROM "order" WHERE id = $1`, orderID).
		Scan(&action, &escalations); err != nil {
		t.Fatalf("read the ready order's deadline: %v", err)
	}
	if action != spec.Action || escalations != 0 {
		t.Errorf("ready order deadline_action = %q with %d escalations, want %q with 0", action, escalations, spec.Action)
	}
}

// ─── shared helper ───────────────────────────────────────────────────────────

// mrValidateReqThenResp proves the request body is contract-valid
// (ValidateRequest), then issues the call and validates the 2xx response
// (ValidateResponse), recording coverage for both. wantStatus asserts the
// handler reached the intended state.
func mrValidateReqThenResp(t *testing.T, h *Harness, method, path, accountID string, body any, wantStatus int) {
	t.Helper()
	idem := fmt.Sprintf("mr-%d", time.Now().UnixNano())
	req := h.Build(t, Request{Method: method, Path: path, AccountID: accountID, Roles: mrRoles, Body: body, IdemKey: idem})
	opID, verr := ValidateRequest(t, h.Spec, req)
	h.MarkCovered(opID)
	if verr != nil {
		t.Fatalf("%s %s: request body is not contract-valid (fix the test, not the server): %v", method, path, verr)
	}
	h.CheckResponse(t, Request{Method: method, Path: path, AccountID: accountID, Roles: mrRoles, Body: body, IdemKey: idem}, wantStatus)
	_ = http.StatusOK
}
