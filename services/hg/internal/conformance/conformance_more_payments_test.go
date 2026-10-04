package conformance

// Additional conformance coverage — class: more-payments-customer.
//
// This file extends the oracle to the payment-method write surface, device
// registration, the customer order-read surface (tracking / receipt / rider
// public profile), quote read, and the address default toggle. It adds NO new
// harness plumbing beyond the shared helpers: payment-method ops run through the
// existing newPaymentsHarness (fake Stripe, no network); everything else runs
// through the existing newARWHarness (which wires orders, account, addresses).
//
// Each newly covered op seeds the state it needs under its own fresh UUIDs,
// drives a contract-valid request, and validates the live 2xx body (or records
// coverage on a 204). Write bodies are proven contract-valid with ValidateRequest
// before they are issued. Nothing here weakens the oracle.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── seed helpers (scoped to this file, `mp` prefix) ─────────────────────────

// mpSeedCustomer inserts a fresh ACTIVE customer (verified phone) with a
// customer_profile, and registers cleanup.
func mpSeedCustomer(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var acctID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, phone_e164, phone_verified_at, status)
		VALUES ('mp-'||substr(md5(random()::text),1,8)||'@hg.test',
		        '+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'),
		        now(), 'ACTIVE')
		RETURNING id`).Scan(&acctID); err != nil {
		t.Fatalf("mpSeedCustomer account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'CUSTOMER','GLOBAL')`,
		acctID); err != nil {
		t.Fatalf("mpSeedCustomer role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO customer_profile (account_id, first_name) VALUES ($1,'MpUser')
		ON CONFLICT (account_id) DO NOTHING`, acctID); err != nil {
		t.Fatalf("mpSeedCustomer profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM saved_payment_method WHERE account_id=$1`, acctID)
		_, _ = pool.Exec(ctx, `DELETE FROM device WHERE account_id=$1`, acctID)
		_, _ = pool.Exec(ctx, `DELETE FROM address WHERE account_id=$1`, acctID)
		_, _ = pool.Exec(ctx, `DELETE FROM customer_profile WHERE account_id=$1`, acctID)
		_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, acctID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acctID)
	})
	return acctID
}

// mpSeedSavedCard inserts one saved_payment_method for the account and returns
// its id. DeletePaymentMethod soft-deletes (no Stripe detach), so a fabricated
// stripe id is fine.
func mpSeedSavedCard(t *testing.T, pool *pgxpool.Pool, accountID string, isDefault bool) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO saved_payment_method
		  (account_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default)
		VALUES ($1, 'pm_mp_'||substr(md5(random()::text),1,16), 'VISA', '4242', 12, 2030, $2)
		RETURNING id`, accountID, isDefault).Scan(&id); err != nil {
		t.Fatalf("mpSeedSavedCard: %v", err)
	}
	return id
}

// mpSeedAddress inserts one Ontario address for the account and returns its id.
func mpSeedAddress(t *testing.T, pool *pgxpool.Pool, accountID string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '10 Mp St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', false)
		RETURNING id`, accountID).Scan(&id); err != nil {
		t.Fatalf("mpSeedAddress: %v", err)
	}
	return id
}

// mpSeedOrder inserts a quote + order in the given order_state for accountID,
// bound to the fixture restaurant + the given address, and returns the order id.
// A non-terminal state carries a deadline; a terminal state does not. Cleanup
// removes the order, its transitions, dispatch, quote and cart.
func mpSeedOrder(t *testing.T, pool *pgxpool.Pool, accountID, addressID, state string) string {
	t.Helper()
	ctx := context.Background()

	var cartID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO cart (account_id, restaurant_id)
		VALUES ($1, '33333333-3333-4333-8333-333333333333')
		RETURNING id`, accountID).Scan(&cartID); err != nil {
		t.Fatalf("mpSeedOrder cart: %v", err)
	}
	var quoteID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO quote (
		  account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
		  pricing_config_id, tax_jurisdiction_code,
		  subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
		  input_hash, state_hash, expires_at)
		SELECT $1, $2, '33333333-3333-4333-8333-333333333333', $3, 'DELIVERY',
		       pc.id, 'CA-ON', 3000, 419, 0, 0, 500, 3919,
		       digest('mp-o-in'||$4,'sha256'), digest('mp-o-st'||$4,'sha256'), now() + interval '10 minutes'
		  FROM pricing_config pc WHERE pc.version = 1
		RETURNING id`, accountID, cartID, addressID, state).Scan(&quoteID); err != nil {
		t.Fatalf("mpSeedOrder quote: %v", err)
	}

	terminal := state == "COMPLETED" || state == "CANCELLED" || state == "REJECTED" ||
		state == "FAILED" || state == "RESOLVED"

	code := "HG-MP" + fmt.Sprintf("%06d", time.Now().UnixNano()%1_000_000)
	var orderID string
	if terminal {
		if err := pool.QueryRow(ctx, `
			INSERT INTO "order" (
			  code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
			  state, subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
			  tax_total_cents, tip_cents, total_cents)
			VALUES ($1, $2, $3, '33333333-3333-4333-8333-333333333333', $4, 'DELIVERY',
			        $5::order_state, 3000, 0, 419, 0, 0, 500, 3919)
			RETURNING id`, code, quoteID, accountID, addressID, state).Scan(&orderID); err != nil {
			t.Fatalf("mpSeedOrder terminal order: %v", err)
		}
	} else {
		if err := pool.QueryRow(ctx, `
			INSERT INTO "order" (
			  code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
			  state, deadline_at, deadline_action,
			  subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
			  tax_total_cents, tip_cents, total_cents)
			VALUES ($1, $2, $3, '33333333-3333-4333-8333-333333333333', $4, 'DELIVERY',
			        $5::order_state, now() + interval '30 minutes', 'DELIVERY_OVERDUE',
			        3000, 0, 419, 0, 0, 500, 3919)
			RETURNING id`, code, quoteID, accountID, addressID, state).Scan(&orderID); err != nil {
			t.Fatalf("mpSeedOrder non-terminal order: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM dispatch WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM order_transition WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(ctx, `DELETE FROM cart WHERE id=$1`, cartID)
	})
	return orderID
}

// mpSeedRiderForOrder inserts a rider (profile + active vehicle + position) and a
// dispatch row assigning that rider to orderID, so the order's rider public
// profile is loadable. Registers cleanup.
func mpSeedRiderForOrder(t *testing.T, pool *pgxpool.Pool, orderID string) string {
	t.Helper()
	ctx := context.Background()
	var riderID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (phone_e164, status)
		VALUES ('+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'), 'ACTIVE')
		RETURNING id`).Scan(&riderID); err != nil {
		t.Fatalf("mpSeedRiderForOrder account: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, riderID); err != nil {
		t.Fatalf("mpSeedRiderForOrder role: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO rider_profile
		  (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status,
		   availability_state, approved_at)
		VALUES ($1,'Mp','Rider','1994-02-02','ACTIVE','ACTIVE','OFFLINE', now()-interval '10 days')`,
		riderID); err != nil {
		t.Fatalf("mpSeedRiderForOrder rider_profile: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO rider_vehicle (account_id, vehicle_type, is_active)
		VALUES ($1, 'BICYCLE', true)`, riderID); err != nil {
		t.Fatalf("mpSeedRiderForOrder rider_vehicle: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3800, 43.6500), 4326)::geography, 8.0, now())
		ON CONFLICT (account_id) DO UPDATE SET location=EXCLUDED.location, recorded_at=EXCLUDED.recorded_at`,
		riderID); err != nil {
		t.Logf("mpSeedRiderForOrder rider_position (non-fatal, LEFT JOIN): %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO dispatch (order_id, state, rider_account_id, assigned_at, deadline_at, deadline_action)
		VALUES ($1, 'CARRYING', $2, now(), now()+interval '30 minutes', 'DELIVERY_OVERDUE')`,
		orderID, riderID); err != nil {
		t.Fatalf("mpSeedRiderForOrder dispatch: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM rider_position WHERE account_id=$1`, riderID)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_vehicle WHERE account_id=$1`, riderID)
		_, _ = pool.Exec(ctx, `DELETE FROM rider_profile WHERE account_id=$1`, riderID)
		_, _ = pool.Exec(ctx, `DELETE FROM account_role WHERE account_id=$1`, riderID)
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, riderID)
	})
	return riderID
}

// mpReceiptSnapshot builds a contract-shaped Receipt snapshot JSON for a
// COMPLETED order. The handler re-marshals this through a DTO closed to the
// contract Receipt schema, so every field is populated with a valid value.
func mpReceiptSnapshot(orderID string) []byte {
	snap := map[string]any{
		"order_id":                           orderID,
		"order_code":                         "HG-RCPT01",
		"receipt_number":                     "R-2026-000001",
		"issued_at":                          "2026-08-14T12:00:00.000Z",
		"platform_legal_name":                "HalalGoes Inc.",
		"platform_tax_registration_number":   nil,
		"restaurant_legal_name":              "CR Kitchen Inc.",
		"restaurant_tax_registration_number": nil,
		"delivery_address":                   nil,
		"lines": []map[string]any{{
			"line_no":          1,
			"menu_item_id":     "44444444-4444-4444-8444-444444444444",
			"name":             "Butter Chicken",
			"variant_name":     nil,
			"addons":           []any{},
			"quantity":         2,
			"special_request":  nil,
			"unit_price_cents": 1500,
			"line_total_cents": 3000,
			"currency":         "CAD",
		}},
		"money": map[string]any{
			"subtotal_cents":     3000,
			"discount_cents":     0,
			"delivery_fee_cents": 419,
			"service_fee_cents":  0,
			"tax_lines":          []any{},
			"tax_total_cents":    0,
			"tip_cents":          500,
			"total_cents":        3919,
			"currency":           "CAD",
		},
		"payment": map[string]any{
			"card_brand":           "VISA",
			"card_last4":           "4242",
			"wallet":               nil,
			"amount_charged_cents": 3919,
			"currency":             "CAD",
		},
		"refunds":      []any{},
		"placed_at":    "2026-08-14T11:00:00.000Z",
		"delivered_at": "2026-08-14T11:45:00.000Z",
	}
	b, _ := json.Marshal(snap)
	return b
}

// ─── payment-method writes (fake Stripe) ─────────────────────────────────────

// TestConformance_MorePayments_PaymentMethods covers createPaymentMethodSetupIntent,
// deletePaymentMethod and setDefaultPaymentMethod against the fake Stripe client.
func TestConformance_MorePayments_PaymentMethods(t *testing.T) {
	pool := openPool(t)
	h := newPaymentsHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// createPaymentMethodSetupIntent — MONEY class, Idempotency-Key required.
	// The fake Stripe fabricates a SetupIntent client secret → 201.
	t.Run("createPaymentMethodSetupIntent", func(t *testing.T) {
		acct := mpSeedCustomer(t, pool)
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/payment-methods/setup-intent",
			AccountID: acct, Roles: []string{roleCustomer}, IdemKey: "mp-setup-intent-0001"}, 201)
	})

	// deletePaymentMethod — soft-delete a seeded card → 204 (no body).
	t.Run("deletePaymentMethod", func(t *testing.T) {
		acct := mpSeedCustomer(t, pool)
		cardID := mpSeedSavedCard(t, pool, acct, false)
		req, resp := h.Do(t, Request{Method: "DELETE", Path: "/v1/payment-methods/" + cardID,
			AccountID: acct, Roles: []string{roleCustomer}})
		defer resp.Body.Close()
		if route, _, err := h.Spec.findRoute(req); err == nil && route != nil && route.Operation != nil {
			h.MarkCovered(route.Operation.OperationID)
		}
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("deletePaymentMethod: status = %d, want 204", resp.StatusCode)
		}
	})

	// setDefaultPaymentMethod — promote a seeded card → 200 PaymentMethod.
	t.Run("setDefaultPaymentMethod", func(t *testing.T) {
		acct := mpSeedCustomer(t, pool)
		cardID := mpSeedSavedCard(t, pool, acct, false)
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/payment-methods/" + cardID + "/default",
			AccountID: acct, Roles: []string{roleCustomer}}, 200)
	})
}

// ─── device registration (account module) ────────────────────────────────────

// TestConformance_MorePayments_Devices covers registerDevice (200 Device) and
// unregisterDevice (204). The delete targets the client-supplied device_id.
func TestConformance_MorePayments_Devices(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	acct := mpSeedCustomer(t, pool)
	deviceID := "mp-dev-" + fmt.Sprintf("%d", time.Now().UnixNano())

	body := map[string]any{
		"expo_push_token": "ExponentPushToken[mp-conformance-000000000000]",
		"device_id":       deviceID,
		"platform":        "ios",
		"role_context":    "CUSTOMER",
		"app_version":     "1.0.0",
		"os_version":      "17.4",
		"locale":          "en-CA",
	}

	t.Run("registerDevice", func(t *testing.T) {
		req := h.Build(t, Request{Method: "POST", Path: "/v1/devices",
			AccountID: acct, Roles: []string{roleCustomer}, Body: body})
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("registerDevice body not contract-valid: %v", verr)
		}
		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/devices",
			AccountID: acct, Roles: []string{roleCustomer}, Body: body}, 200)
	})

	t.Run("unregisterDevice", func(t *testing.T) {
		req, resp := h.Do(t, Request{Method: "DELETE", Path: "/v1/devices/" + deviceID,
			AccountID: acct, Roles: []string{roleCustomer}})
		defer resp.Body.Close()
		if route, _, err := h.Spec.findRoute(req); err == nil && route != nil && route.Operation != nil {
			h.MarkCovered(route.Operation.OperationID)
		}
		if resp.StatusCode != http.StatusNoContent {
			t.Errorf("unregisterDevice: status = %d, want 204", resp.StatusCode)
		}
	})
}

// ─── customer order reads + quote ────────────────────────────────────────────

// TestConformance_MorePayments_OrderReads covers getOrderTracking, getQuote,
// getOrderReceipt and getOrderRiderPublicProfile.
func TestConformance_MorePayments_OrderReads(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// getOrderTracking — the fixture order (PREPARING, owned by fxCustomer) is
	// tracking-visible; rider/ETA fields stay null pre-pickup (contract-nullable).
	t.Run("getOrderTracking", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/orders/" + fxOrderID + "/tracking",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200)
	})

	// getQuote — the fixture quote (77777777…) is owned by fxCustomer and unexpired.
	t.Run("getQuote", func(t *testing.T) {
		const fxQuoteID = "77777777-7777-4777-8777-777777777777"
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/quotes/" + fxQuoteID,
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200)
	})

	// getOrderReceipt — a receipt exists only for a COMPLETED order (receipt_snapshot
	// NULL otherwise → 409 RECEIPT_NOT_READY). Seed a COMPLETED order with a frozen
	// contract-shaped snapshot.
	t.Run("getOrderReceipt", func(t *testing.T) {
		acct := mpSeedCustomer(t, pool)
		addr := mpSeedAddress(t, pool, acct)
		orderID := mpSeedOrder(t, pool, acct, addr, "COMPLETED")
		if _, err := pool.Exec(context.Background(),
			`UPDATE "order" SET receipt_snapshot=$2 WHERE id=$1`, orderID, mpReceiptSnapshot(orderID)); err != nil {
			t.Fatalf("set receipt_snapshot: %v", err)
		}
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/orders/" + orderID + "/receipt",
			AccountID: acct, Roles: []string{roleCustomer}}, 200)
	})

	// getOrderRiderPublicProfile — rider identity is only visible in PICKED_UP /
	// ARRIVED (C-32) and requires an assigned rider. Seed an ARRIVED order with a
	// dispatched rider (profile + active vehicle).
	t.Run("getOrderRiderPublicProfile", func(t *testing.T) {
		acct := mpSeedCustomer(t, pool)
		addr := mpSeedAddress(t, pool, acct)
		orderID := mpSeedOrder(t, pool, acct, addr, "ARRIVED")
		mpSeedRiderForOrder(t, pool, orderID)
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/orders/" + orderID + "/rider",
			AccountID: acct, Roles: []string{roleCustomer}}, 200)
	})
}

// ─── address default ─────────────────────────────────────────────────────────

// TestConformance_MorePayments_AddressDefault covers setDefaultAddress (200 Address).
func TestConformance_MorePayments_AddressDefault(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	acct := mpSeedCustomer(t, pool)
	addr := mpSeedAddress(t, pool, acct)

	h.CheckResponse(t, Request{Method: "POST", Path: "/v1/addresses/" + addr + "/default",
		AccountID: acct, Roles: []string{roleCustomer}}, 200)
}
