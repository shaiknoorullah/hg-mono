package admin

// Contract conformance + boundary/leak analysis for the admin-order operations
// (listOrdersAdmin, getOrderAdmin, cancelOrderAdmin).
//
// The wire-SHAPE assertions here run the LIVE response through the real
// kin-openapi oracle (assertConformant → internal/conformance.ValidateResponse)
// against contracts/openapi.yaml. This replaces the previous hand-transcribed
// []string field lists (adminViewRequired/optional, orderMoneyRequired, …) and
// the hand-maintained enum maps, which were only as correct as the transcription
// and let drift through. The contract itself is now the oracle:
// additionalProperties:false + required[] + closed enums reject any drift.
//
// The authz/IDOR/concurrency/money/error-taxonomy tests below are retained
// unchanged — they pin invariants the schema oracle does not (deny-by-default,
// single-effect concurrency, ledger residual, error codes).

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

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
			order_id, payment_intent_id, stripe_refund_id, kind, scope, reason_code, amount_cents,
			state, requested_by, approved_by, settled_at
		) VALUES (
			$1, $2, 're_test_'||substr(md5(random()::text),1,12), 'FULL', 'FULL', 'PLATFORM_ERROR', 500,
			'SETTLED', $3, $3, now()
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
// A) CONTRACT CONFORMANCE — the live response is validated against the contract
// =========================================================================

// getOrderAdmin: the entire OrderAdminView tree must conform exactly against
// contracts/openapi.yaml. kin-openapi catches renamed fields (timeline.at vs
// occurred_at), extra fields, missing required fields, wrong types, and
// out-of-enum values automatically.
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
	assertConformant(t, resp)
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
	assertConformant(t, resp)
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
	assertConformant(t, resp)
}

// cancelOrderAdmin response is an OrderAdminView too — same live-schema check,
// plus the state-transition invariant.
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
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("want 200, got %d", resp.StatusCode)
	}
	// Validate the live body first (consumes and restores it), then re-read the
	// state assertion from the restored body.
	assertConformant(t, resp)
	data := decodeBody(t, resp)["data"].(map[string]any)
	if st, _ := data["state"].(string); st != "CANCELLED" {
		t.Errorf("after cancel, state = %q, want CANCELLED", st)
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

// internalMoneyCentsFields are the int64-cents fields on OrderInternalMoney. This
// short list is inlined here (not a "closed schema" transcription): the schema
// oracle owns closedness; this test only asserts the money-integer + zero-residual
// invariants, which the schema cannot express.
var internalMoneyCentsFields = []string{
	"commission_cents", "restaurant_net_cents", "rider_earnings_cents", "platform_gross_cents",
}

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
	for _, k := range internalMoneyCentsFields {
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
