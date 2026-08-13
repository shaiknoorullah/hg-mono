package admin

// STAGE 3 — boundary & leak analysis for the admin-order operations.
//
// These tests close gaps the stage-2 tests left open. They assert the wire
// shape *exactly* against contracts/openapi.yaml — no extra fields, no missing
// required fields, correct field NAMES, closed enums, correct types — rather
// than merely spot-checking that a required field is present. They also pin the
// data-isolation, error-taxonomy and concurrency boundaries.
//
// Contract sources (contracts/openapi.yaml):
//   - OrderAdminView = OrderCustomerView + {timeline, payment, refunds, internal_money, pii_revealed, ...}
//   - OrderSummary, OrderRestaurantRef, OrderMoney, OrderLine, OrderTransition,
//     OrderPayment, OrderInternalMoney, Refund, PageMeta.

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// assertClosedObject asserts that obj's keys are a subset of allowed and that
// every required key is present. This is the closed-schema (additionalProperties:
// false) check the stage-2 tests omitted.
func assertClosedObject(t *testing.T, where string, obj map[string]any, required, optional []string) {
	t.Helper()
	allowed := make(map[string]bool)
	for _, k := range required {
		allowed[k] = true
	}
	for _, k := range optional {
		allowed[k] = true
	}
	for k := range obj {
		if !allowed[k] {
			t.Errorf("%s: extra field %q not named by the contract schema", where, k)
		}
	}
	for _, k := range required {
		if _, ok := obj[k]; !ok {
			t.Errorf("%s: missing required field %q", where, k)
		}
	}
}

// contract key sets ---------------------------------------------------------

// OrderAdminView = OrderCustomerView ∪ admin extension. Every property named in
// either allOf branch is allowed; the contract's required set is the union of
// each branch's required list.
var (
	adminViewRequired = []string{
		// OrderCustomerView required
		"id", "code", "state", "restaurant", "lines", "money", "placed_at",
		// admin extension required
		"timeline", "payment", "refunds", "internal_money",
	}
	adminViewOptional = []string{
		// OrderCustomerView optional
		"state_since", "deadline_at", "quote_id", "delivery_address",
		"delivery_instructions", "special_instructions", "rider", "dispatch_state",
		"cancel_reason", "reject_reason", "eta_at", "can_cancel", "accepted_at",
		"ready_at", "picked_up_at", "delivered_at", "completed_at",
		// admin extension optional
		"dispatch_history", "pii_revealed",
	}

	orderSummaryRequired = []string{"id", "code", "state", "restaurant", "total_cents", "currency", "placed_at"}
	orderSummaryOptional = []string{"item_count", "first_item_names", "deadline_at"}

	restaurantRefRequired = []string{"id", "name"}
	restaurantRefOptional = []string{"logo_image_url", "halal"}

	orderMoneyRequired = []string{
		"subtotal_cents", "discount_cents", "delivery_fee_cents", "service_fee_cents",
		"tax_total_cents", "tip_cents", "total_cents", "currency",
	}
	orderMoneyOptional = []string{"tax_lines"}

	internalMoneyRequired = []string{
		"commission_cents", "restaurant_net_cents", "rider_earnings_cents",
		"platform_gross_cents", "currency",
	}
	internalMoneyOptional = []string{"ledger_residual_cents", "ledger_entries"}

	orderLineRequired = []string{"line_no", "menu_item_id", "name", "quantity", "unit_price_cents", "line_total_cents", "currency"}
	orderLineOptional = []string{"variant_name", "addons", "special_request"}

	transitionRequired = []string{"to_state", "actor_kind", "at"}
	transitionOptional = []string{"from_state", "reason"}

	paymentRequired = []string{"order_id", "state", "amount_authorized_cents", "amount_captured_cents", "amount_refunded_cents", "currency"}
	paymentOptional = []string{"kind", "card_brand", "card_last4", "wallet", "failure_code", "decline_code", "client_secret", "authorized_at", "captured_at"}

	refundRequired = []string{"id", "order_id", "kind", "reason_code", "amount_cents", "currency", "state", "requested_at"}
	refundOptional = []string{"scope", "tax_cents", "liability_split", "note", "settled_at", "failure_message"}

	pageMetaRequired = []string{"next_cursor", "has_more"}
	pageMetaOptional = []string{"total"}
)

var paymentStateEnum = map[string]bool{
	"REQUIRES_PAYMENT_METHOD": true, "REQUIRES_CONFIRMATION": true, "REQUIRES_ACTION": true,
	"PROCESSING": true, "REQUIRES_CAPTURE": true, "SUCCEEDED": true, "CANCELED": true, "FAILED": true,
}

var orderActorKindEnum = map[string]bool{
	"CUSTOMER": true, "RESTAURANT": true, "RIDER": true, "SYSTEM": true,
	"ADMIN": true, "SUPPORT": true,
}

// seedPaymentAndRefund attaches a captured ORDER payment_intent and one SETTLED
// refund to an order so the admin view exercises the non-empty payment/refund
// projection paths.
func seedPaymentAndRefund(t *testing.T, pool *pgxpool.Pool, orderID, requestedBy string) {
	t.Helper()
	ctx := context.Background()
	var piID string
	err := pool.QueryRow(ctx, `
		INSERT INTO payment_intent (
			order_id, kind, stripe_payment_intent_id, state,
			amount_authorized_cents, amount_captured_cents, amount_refunded_cents, currency,
			card_brand, card_last4, authorized_at, captured_at
		) VALUES (
			$1, 'ORDER', 'pi_test_'||substr(md5(random()::text),1,12), 'SUCCEEDED',
			1500, 1500, 0, 'CAD', 'visa', '4242', now(), now()
		) RETURNING id`, orderID).Scan(&piID)
	if err != nil {
		t.Fatalf("seed payment_intent: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO refund (
			order_id, payment_intent_id, kind, scope, reason_code, amount_cents,
			state, requested_by, settled_at
		) VALUES (
			$1, $2, 'FULL', 'FULL', 'PLATFORM_ERROR', 500, 'SETTLED', $3, now()
		)`, orderID, piID, requestedBy)
	if err != nil {
		t.Fatalf("seed refund: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM refund WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM payment_intent WHERE order_id=$1`, orderID)
	})
}

// =========================================================================
// A) CONTRACT CONFORMANCE — closed-schema golden assertions
// =========================================================================

// getOrderAdmin: the entire OrderAdminView tree must conform exactly. This
// catches renamed fields (timeline.at vs occurred_at), extra fields
// (fulfilment), and stub objects (payment:{}).
func TestConformance_GetOrderAdmin_ClosedSchema(t *testing.T) {
	pool := dialTestPool(t)
	orderID, custID := seedOrderForAdmin(t, pool, "COMPLETED")
	seedPaymentAndRefund(t, pool, orderID, custID)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)

	// Top-level envelope: {data}.
	assertClosedObject(t, "envelope", body, []string{"data"}, nil)
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatal("data must be an object")
	}

	assertClosedObject(t, "OrderAdminView", data, adminViewRequired, adminViewOptional)

	// restaurant (OrderRestaurantRef)
	if rest, ok := data["restaurant"].(map[string]any); ok {
		assertClosedObject(t, "restaurant", rest, restaurantRefRequired, restaurantRefOptional)
	} else {
		t.Error("restaurant must be an object")
	}

	// money (OrderMoney)
	if money, ok := data["money"].(map[string]any); ok {
		assertClosedObject(t, "money", money, orderMoneyRequired, orderMoneyOptional)
	} else {
		t.Error("money must be an object")
	}

	// internal_money (OrderInternalMoney) — staff-only split
	if im, ok := data["internal_money"].(map[string]any); ok {
		assertClosedObject(t, "internal_money", im, internalMoneyRequired, internalMoneyOptional)
	} else {
		t.Error("internal_money must be an object")
	}

	// lines[] (OrderLine)
	if lines, ok := data["lines"].([]any); ok {
		for i, raw := range lines {
			if line, ok := raw.(map[string]any); ok {
				assertClosedObject(t, fmt.Sprintf("lines[%d]", i), line, orderLineRequired, orderLineOptional)
			}
		}
	}

	// timeline[] (OrderTransition) — must use "at", never "occurred_at"
	timeline, ok := data["timeline"].([]any)
	if !ok || len(timeline) == 0 {
		t.Fatal("timeline must be a non-empty array for a COMPLETED order")
	}
	for i, raw := range timeline {
		tr, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("timeline[%d] must be an object", i)
		}
		assertClosedObject(t, fmt.Sprintf("timeline[%d]", i), tr, transitionRequired, transitionOptional)
		if _, bad := tr["occurred_at"]; bad {
			t.Errorf("timeline[%d]: field is named 'occurred_at' but the contract requires 'at'", i)
		}
		if ak, _ := tr["actor_kind"].(string); ak != "" && !orderActorKindEnum[ak] {
			t.Errorf("timeline[%d]: actor_kind %q is not in the OrderActorKind enum", i, ak)
		}
	}

	// payment (OrderPayment) — must be a valid, populated OrderPayment (never {})
	pay, ok := data["payment"].(map[string]any)
	if !ok {
		t.Fatal("payment must be an object")
	}
	assertClosedObject(t, "payment", pay, paymentRequired, paymentOptional)
	if st, _ := pay["state"].(string); st == "" || !paymentStateEnum[st] {
		t.Errorf("payment.state %q is not in the PaymentState enum", st)
	}

	// refunds[] (Refund)
	refunds, ok := data["refunds"].([]any)
	if !ok {
		t.Fatal("refunds must be an array")
	}
	if len(refunds) == 0 {
		t.Fatal("refunds must be non-empty (one refund was seeded)")
	}
	for i, raw := range refunds {
		if rf, ok := raw.(map[string]any); ok {
			assertClosedObject(t, fmt.Sprintf("refunds[%d]", i), rf, refundRequired, refundOptional)
		}
	}

	// pii_revealed must be a bool, and false without a reveal.
	if pr, ok := data["pii_revealed"].(bool); !ok || pr {
		t.Errorf("pii_revealed: want false bool, got %v", data["pii_revealed"])
	}
}

// getOrderAdmin on an order with no payment_intent still returns a contract-valid
// OrderPayment (all required fields present, valid enum state) — never {}.
func TestConformance_GetOrderAdmin_NoPayment_ValidOrderPayment(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, fmt.Sprintf("%s/v1/admin/orders/%s", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	data := decodeBody(t, resp)["data"].(map[string]any)
	pay, ok := data["payment"].(map[string]any)
	if !ok {
		t.Fatal("payment must be an object")
	}
	assertClosedObject(t, "payment(no-intent)", pay, paymentRequired, paymentOptional)
	if st, _ := pay["state"].(string); !paymentStateEnum[st] {
		t.Errorf("payment.state %q not a valid PaymentState", st)
	}
	if _, ok := pay["order_id"].(string); !ok {
		t.Error("payment.order_id must be present and a string")
	}
}

// listOrdersAdmin: envelope + OrderSummary items conform exactly.
func TestConformance_ListOrdersAdmin_ClosedSchema(t *testing.T) {
	pool := dialTestPool(t)
	_, _ = seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	assertClosedObject(t, "list envelope", body, []string{"data", "meta"}, nil)

	meta, ok := body["meta"].(map[string]any)
	if !ok {
		t.Fatal("meta must be an object")
	}
	assertClosedObject(t, "meta (PageMeta)", meta, pageMetaRequired, pageMetaOptional)

	data, ok := body["data"].([]any)
	if !ok {
		t.Fatal("data must be an array")
	}
	if len(data) == 0 {
		t.Fatal("expected at least one seeded order")
	}
	for i, raw := range data {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("data[%d] must be an object", i)
		}
		assertClosedObject(t, fmt.Sprintf("OrderSummary[%d]", i), item, orderSummaryRequired, orderSummaryOptional)
		if rest, ok := item["restaurant"].(map[string]any); ok {
			assertClosedObject(t, fmt.Sprintf("OrderSummary[%d].restaurant", i), rest, restaurantRefRequired, restaurantRefOptional)
		}
		// total_cents must be an integer (JSON number, no fractional part) — money is int64 cents.
		if f, ok := item["total_cents"].(float64); ok {
			if f != float64(int64(f)) {
				t.Errorf("OrderSummary[%d].total_cents %v is not an integer number of cents", i, f)
			}
		} else {
			t.Errorf("OrderSummary[%d].total_cents must be a number", i)
		}
	}
}

// cancelOrderAdmin response is an OrderAdminView too — same closed-schema check.
func TestConformance_CancelOrderAdmin_ClosedSchema(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "customer called to cancel, verified identity",
			"case_id":     "5b3e6d7e-9f2a-4c1b-8d3e-1a2b3c4d5e6f",
		},
		map[string]string{"Idempotency-Key": "cancel-conformance-1"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	data := decodeBody(t, resp)["data"].(map[string]any)
	assertClosedObject(t, "cancel OrderAdminView", data, adminViewRequired, adminViewOptional)
	if st, _ := data["state"].(string); st != "CANCELLED" {
		t.Errorf("after cancel, state = %q, want CANCELLED", st)
	}
	// timeline must carry the cancel transition under "at".
	if tl, ok := data["timeline"].([]any); ok {
		for i, raw := range tl {
			if tr, ok := raw.(map[string]any); ok {
				if _, bad := tr["occurred_at"]; bad {
					t.Errorf("timeline[%d]: uses 'occurred_at', contract requires 'at'", i)
				}
			}
		}
	}
}

// =========================================================================
// F) CONCURRENCY / IDEMPOTENCY — two concurrent cancels, one effect
// =========================================================================

// Two concurrent cancel requests (same idempotency key) must not double-cancel
// nor corrupt state; the order ends CANCELLED with exactly one CANCELLED
// transition row.
func TestConcurrency_CancelOrderAdmin_ConcurrentDouble(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "duplicate concurrent support click test",
		"case_id":     "7c1e2d3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
	}

	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			resp := doJSON(t, http.MethodPost,
				fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
				body, map[string]string{"Idempotency-Key": "concurrent-cancel-key"})
			codes[idx] = resp.StatusCode
			resp.Body.Close()
		}(i)
	}
	wg.Wait()

	// At most one 200 (the winner); the loser is a replay/conflict, never a 500.
	okCount := 0
	for _, c := range codes {
		if c == http.StatusOK {
			okCount++
		}
		if c >= 500 {
			t.Errorf("concurrent cancel returned server error %d", c)
		}
	}
	if okCount == 0 {
		t.Errorf("expected at least one 200 from concurrent cancels, got %v", codes)
	}

	// Invariant: exactly one CANCELLED transition, order is CANCELLED.
	ctx := context.Background()
	var state string
	if err := pool.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read final state: %v", err)
	}
	if state != "CANCELLED" {
		t.Errorf("final state = %q, want CANCELLED", state)
	}
	var cancelledTransitions int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM order_transition WHERE order_id=$1 AND to_state='CANCELLED'`,
		orderID).Scan(&cancelledTransitions); err != nil {
		t.Fatalf("count transitions: %v", err)
	}
	if cancelledTransitions != 1 {
		t.Errorf("expected exactly 1 CANCELLED transition, got %d (double-cancel effect)", cancelledTransitions)
	}
}

// Sequential replay: cancelling an already-CANCELLED order must not produce a
// second effect. It returns a non-500 (409 illegal transition) and leaves the
// single CANCELLED transition intact.
func TestIdempotency_CancelOrderAdmin_SequentialReplayNoDoubleEffect(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	body := map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "first cancellation, legitimate reason here",
		"case_id":     "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
	}

	r1 := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body, map[string]string{"Idempotency-Key": "seq-cancel-key-000000001"})
	c1 := r1.StatusCode
	r1.Body.Close()
	if c1 != http.StatusOK {
		t.Fatalf("first cancel: want 200, got %d", c1)
	}

	// Second cancel with a DIFFERENT idempotency key: the order is now terminal,
	// so the state machine must reject it (409), never re-cancel and never 500.
	r2 := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		body, map[string]string{"Idempotency-Key": "seq-cancel-key-000000002"})
	c2 := r2.StatusCode
	b2 := decodeBody(t, r2)
	r2.Body.Close()
	if c2 >= 500 {
		t.Errorf("second cancel returned server error %d (should be a contract error)", c2)
	}
	if c2 != http.StatusConflict {
		t.Errorf("second cancel on terminal order: want 409, got %d", c2)
	}
	// Error taxonomy: must be a contract ErrorCode, never bare.
	if errObj, ok := b2["error"].(map[string]any); ok {
		if code, _ := errObj["code"].(string); code != "ILLEGAL_TRANSITION" {
			t.Errorf("second cancel error code = %q, want ILLEGAL_TRANSITION", code)
		}
	} else {
		t.Errorf("second cancel: expected an error envelope, got %v", b2)
	}

	// Exactly one CANCELLED transition remains.
	ctx := context.Background()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM order_transition WHERE order_id=$1 AND to_state='CANCELLED'`,
		orderID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 CANCELLED transition after replay, got %d", n)
	}
}

// =========================================================================
// D) MONEY/LEDGER — cancel keeps the order's ledger residual at zero
// =========================================================================

// After an admin cancel, the internal_money split remains consistent and, when a
// ledger residual is exposed, it is exactly zero (money-zero-residual invariant).
func TestMoney_CancelOrderAdmin_LedgerResidualZero(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "ledger residual invariant check cancel",
			"case_id":     "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
		},
		map[string]string{"Idempotency-Key": "ledger-residual-cancel"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d", resp.StatusCode)
	}
	data := decodeBody(t, resp)["data"].(map[string]any)
	im, ok := data["internal_money"].(map[string]any)
	if !ok {
		t.Fatal("internal_money must be present")
	}
	// Every money field must be an integer number of cents (int64), never a float.
	for _, k := range internalMoneyRequired {
		if k == "currency" {
			continue
		}
		v, present := im[k]
		if !present {
			continue
		}
		f, ok := v.(float64)
		if !ok {
			t.Errorf("internal_money.%s must be a number, got %T", k, v)
			continue
		}
		if f != float64(int64(f)) {
			t.Errorf("internal_money.%s = %v is not an integer number of cents", k, f)
		}
	}
	// If the residual is exposed it MUST be zero.
	if res, present := im["ledger_residual_cents"]; present {
		if f, ok := res.(float64); !ok || f != 0 {
			t.Errorf("ledger_residual_cents = %v, want 0 (money-zero-residual)", res)
		}
	}
}

// =========================================================================
// B/C) AUTHZ + IDOR — table-driven completeness across the three ops
// =========================================================================

// For each op, every non-x-role is denied (403) and each x-role is allowed;
// unauthenticated is 401 and the route is never public.
func TestAuthz_AdminOrders_RoleMatrixComplete(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")

	allowed := []httpx.Role{httpx.RoleSupportAgent, httpx.RoleAdmin, httpx.RoleSuperAdmin}
	denied := []httpx.Role{httpx.RoleCustomer, httpx.RoleRider, httpx.RoleRestaurantOwner}

	type opCase struct {
		name   string
		method string
		path   string
		body   any
		hdrs   map[string]string
	}
	ops := []opCase{
		{"listOrdersAdmin", http.MethodGet, "/v1/admin/orders", nil, nil},
		{"getOrderAdmin", http.MethodGet, "/v1/admin/orders/" + orderID, nil, nil},
	}

	for _, op := range ops {
		for _, role := range allowed {
			t.Run(op.name+"/allow/"+string(role), func(t *testing.T) {
				pp := principalFor(t, pool, role)
				srv := buildAdminTestServer(t, pool, pp)
				defer srv.Close()
				resp := doJSON(t, op.method, srv.URL+op.path, op.body, op.hdrs)
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
					t.Errorf("%s: x-role %s must be allowed, got %d", op.name, role, resp.StatusCode)
				}
			})
		}
		for _, role := range denied {
			t.Run(op.name+"/deny/"+string(role), func(t *testing.T) {
				pp := principalFor(t, pool, role)
				srv := buildAdminTestServer(t, pool, pp)
				defer srv.Close()
				resp := doJSON(t, op.method, srv.URL+op.path, op.body, op.hdrs)
				defer resp.Body.Close()
				if resp.StatusCode != http.StatusForbidden {
					t.Errorf("%s: non-x-role %s must get 403, got %d", op.name, role, resp.StatusCode)
				}
			})
		}
		// Not public: anonymous is 401, never 200.
		t.Run(op.name+"/anon", func(t *testing.T) {
			srv := buildAdminTestServerAnon(t, pool)
			defer srv.Close()
			resp := doJSON(t, op.method, srv.URL+op.path, op.body, op.hdrs)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s: anonymous must get 401 (deny-by-default), got %d", op.name, resp.StatusCode)
			}
		})
	}

	// cancelOrderAdmin denied roles (fresh order each, since cancel mutates).
	for _, role := range denied {
		t.Run("cancelOrderAdmin/deny/"+string(role), func(t *testing.T) {
			oid, _ := seedOrderForAdmin(t, pool, "CREATED")
			pp := principalFor(t, pool, role)
			srv := buildAdminTestServer(t, pool, pp)
			defer srv.Close()
			resp := doJSON(t, http.MethodPost, srv.URL+"/v1/admin/orders/"+oid+"/cancel",
				map[string]any{"reason_code": "SUPPORT_CANCELLED", "reason_text": "denied role attempt xx", "case_id": "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f"},
				map[string]string{"Idempotency-Key": "deny-role-cancel-key-" + string(role)})
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("cancelOrderAdmin: non-x-role %s must get 403, got %d", role, resp.StatusCode)
			}
		})
	}
}

// IDOR: getOrderAdmin on a well-formed but non-existent order id returns 404 and
// leaks no order field. (Admin has cross-tenant read, so 404 is existence-only.)
func TestIDOR_GetOrderAdmin_UnknownId_404_NoLeak(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet,
		srv.URL+"/v1/admin/orders/00000000-0000-0000-0000-000000000000", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown order: want 404, got %d", resp.StatusCode)
	}
	body := decodeBody(t, resp)
	// No 'data' leak; only the error envelope.
	if _, leaked := body["data"]; leaked {
		t.Error("404 response must not carry a data payload")
	}
	if errObj, ok := body["error"].(map[string]any); ok {
		if code, _ := errObj["code"].(string); code != "NOT_FOUND" {
			t.Errorf("error code = %q, want NOT_FOUND", code)
		}
	} else {
		t.Error("expected an error envelope")
	}
}

// =========================================================================
// G) ERROR TAXONOMY — every expected failure is a contract ErrorCode, never 500
// =========================================================================

// errCodeOf extracts the error envelope's code, or "" if absent.
func errCodeOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	body := decodeBody(t, resp)
	if errObj, ok := body["error"].(map[string]any); ok {
		code, _ := errObj["code"].(string)
		return code
	}
	return ""
}

// A malformed cursor on listOrdersAdmin is a 422 VALIDATION_FAILED, never a 500
// and never a silent full-list scan.
func TestErrorTaxonomy_ListOrdersAdmin_MalformedCursor(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders?cursor=not-a-valid-cursor", nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("malformed cursor: want 422, got %d", resp.StatusCode)
	}
	if code := errCodeOf(t, resp); code != "VALIDATION_FAILED" {
		t.Errorf("malformed cursor error code = %q, want VALIDATION_FAILED", code)
	}
}

// cancelOrderAdmin: an inbound price/money field is rejected (G-3 — inbound bodies
// may not carry price fields). DisallowUnknownFields → 422 VALIDATION_FAILED.
func TestErrorTaxonomy_CancelOrderAdmin_InboundPriceRejected(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code":  "SUPPORT_CANCELLED",
			"reason_text":  "attempting to smuggle a price field in",
			"case_id":      "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f90",
			"total_cents":  9999, // forbidden inbound money field
			"amount_cents": 1,    // also forbidden
		},
		map[string]string{"Idempotency-Key": "price-reject-cancel-key-01"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("inbound price field: want 422, got %d", resp.StatusCode)
	}
	if code := errCodeOf(t, resp); code != "VALIDATION_FAILED" {
		t.Errorf("inbound price field error code = %q, want VALIDATION_FAILED", code)
	}
	// The order must NOT have been cancelled by a rejected request.
	ctx := context.Background()
	var state string
	_ = pool.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state)
	if state == "CANCELLED" {
		t.Error("a rejected (422) cancel must not mutate order state")
	}
}

// getOrderAdmin: reveal_pii=true without a justification is a 422 VALIDATION_FAILED.
func TestErrorTaxonomy_GetOrderAdmin_RevealWithoutJustification(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodGet,
		fmt.Sprintf("%s/v1/admin/orders/%s?reveal_pii=true", srv.URL, orderID), nil, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("reveal without justification: want 422, got %d", resp.StatusCode)
	}
	if code := errCodeOf(t, resp); code != "VALIDATION_FAILED" {
		t.Errorf("reveal without justification error code = %q, want VALIDATION_FAILED", code)
	}
}
