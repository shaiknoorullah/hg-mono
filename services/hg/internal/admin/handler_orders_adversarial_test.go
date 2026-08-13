package admin

// STAGE 4 — adversarial regression tests.
//
// Each test here was written against a concrete bug found in stage-4 review and
// would FAIL against the code as it stood before the fix:
//
//   A. cancelOrderAdmin ignored the caller's reason_code and hard-coded
//      'SUPPORT_CANCELLED' onto order.cancel_reason (audit corruption); it also
//      accepted an out-of-enum reason_code and rejected the contract's own
//      optional refund_kind field as an "unknown field".
//   B. cancelOrderAdmin on a post-acceptance (PREPARING, captured) order wrote
//      the state change but posted NO refund and NO ledger reversal, stranding
//      the customer's money and violating the contract's "always issues a refund
//      ... in the same transaction" guarantee and the money-zero-residual
//      invariant.
//   C. the raw-SQL cancel left deadline_escalations / lease columns untouched.

import (
	"context"
	"fmt"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// seedCapturedPreparingOrder builds a real order, forces it to PREPARING, and
// attaches a SUCCEEDED ORDER payment_intent captured for the full total plus the
// balanced CAPTURE ledger batch that acceptance would have posted. This is the
// state an admin post-acceptance cancel must reverse.
//
// It returns the orderID, the captured total, and the order's net ledger
// residual helper is asserted by the caller via orderLedgerResidual.
func seedCapturedPreparingOrder(t *testing.T, pool *pgxpool.Pool) (orderID string, capturedCents int64) {
	t.Helper()
	ctx := context.Background()
	orderID, _ = seedOrderForAdmin(t, pool, "PREPARING")

	// Read the order's decomposed money to post a realistic CAPTURE batch.
	var m struct {
		total, restNet, riderEarn, tax int64
		restID, riderID                string
	}
	if err := pool.QueryRow(ctx, `
		SELECT total_cents, restaurant_net_cents, rider_earnings_cents, tax_total_cents,
		       restaurant_id::text, ''
		  FROM "order" WHERE id=$1`, orderID).Scan(
		&m.total, &m.restNet, &m.riderEarn, &m.tax, &m.restID, &m.riderID); err != nil {
		t.Fatalf("read order money: %v", err)
	}
	capturedCents = m.total

	var piID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO payment_intent (
			order_id, kind, stripe_payment_intent_id, state,
			amount_authorized_cents, amount_captured_cents, amount_refunded_cents, currency,
			card_brand, card_last4, authorized_at, captured_at
		) VALUES (
			$1, 'ORDER', 'pi_prep_'||substr(md5(random()::text),1,12), 'SUCCEEDED',
			$2, $2, 0, 'CAD', 'visa', '4242', now(), now()
		) RETURNING id`, orderID, capturedCents).Scan(&piID); err != nil {
		t.Fatalf("seed captured payment_intent: %v", err)
	}

	// Post the CAPTURE batch by hand (balanced by construction): customer charged
	// -total, PSP +total; then PSP -total decomposed to restaurant net, tax and
	// the platform residual. No rider assigned in this seed, so rider earnings +
	// tip fold into the platform residual. The batch and its entries MUST land in
	// one transaction — the ledger_batch_has_entries / ledger_entry_batch_balanced
	// triggers are DEFERRABLE INITIALLY DEFERRED and assert at COMMIT.
	platform := m.total - m.restNet - m.tax
	entries := []struct {
		acct, cpType, cpID, comp string
		amt                      int64
	}{
		{"CUSTOMER_CHARGES", "CUSTOMER", "", "SUBTOTAL", -m.total},
		{"PSP_CLEARING", "", "", "SUBTOTAL", m.total},
		{"PSP_CLEARING", "", "", "SUBTOTAL", -m.total},
		{"RESTAURANT_PAYABLE", "RESTAURANT", m.restID, "SUBTOTAL", m.restNet},
		{"TAX_PAYABLE", "CRA", "", "TAX", m.tax},
		{"PLATFORM_REVENUE", "PLATFORM", "", "COMMISSION", platform},
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin capture tx: %v", err)
	}
	var batchID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO ledger_batch (kind, order_id, idempotency_key, posted_by, memo)
		VALUES ('CAPTURE', $1::uuid, 'seed-capture:'||$2::text, 'seed', 'seed capture')
		RETURNING id::text`, orderID, orderID).Scan(&batchID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("seed capture batch: %v", err)
	}
	for _, e := range entries {
		if e.amt == 0 && (e.acct == "RESTAURANT_PAYABLE" || e.acct == "TAX_PAYABLE" || e.acct == "PLATFORM_REVENUE") {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_entry (batch_id, order_id, account, counterparty_type, counterparty_id,
			                          amount_cents, component, memo)
			VALUES ($1,$2,$3::ledger_account,$4,$5,$6,$7::ledger_component,'seed')`,
			batchID, orderID, e.acct, nilIfEmpty(e.cpType), nilIfEmptyUUID(e.cpID), e.amt, e.comp); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("seed capture entry %s: %v", e.acct, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit capture batch: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM ledger_entry WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM ledger_batch WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM refund WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(ctx, `DELETE FROM payment_intent WHERE order_id=$1`, orderID)
	})
	return orderID, capturedCents
}

// orderLedgerResidual is the net position of the customer across ALL of an
// order's ledger batches. After a full capture + full refund it must be zero:
// the customer's charge is fully reversed (money-zero-residual for the order).
func orderCustomerNet(t *testing.T, pool *pgxpool.Pool, orderID string) int64 {
	t.Helper()
	var net int64
	if err := pool.QueryRow(context.Background(), `
		SELECT coalesce(sum(amount_cents),0) FROM ledger_entry
		 WHERE order_id=$1 AND account='CUSTOMER_CHARGES'`, orderID).Scan(&net); err != nil {
		t.Fatalf("sum customer charges: %v", err)
	}
	return net
}

func batchKindsForOrder(t *testing.T, pool *pgxpool.Pool, orderID string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT kind::text FROM ledger_batch WHERE order_id=$1 ORDER BY posted_at`, orderID)
	if err != nil {
		t.Fatalf("query batch kinds: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		out = append(out, k)
	}
	return out
}

// =========================================================================
// B) MONEY — post-acceptance cancel posts the refund + ledger reversal
//    atomically, and the customer is made whole (zero residual).
// =========================================================================

func TestCancelOrderAdmin_PreparingPostsRefundAndLedgerReversal(t *testing.T) {
	pool := dialTestPool(t)
	orderID, captured := seedCapturedPreparingOrder(t, pool)

	// Sanity: before the cancel the customer is out `captured` cents.
	if net := orderCustomerNet(t, pool, orderID); net != -captured {
		t.Fatalf("precondition: customer net = %d, want %d", net, -captured)
	}

	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "PLATFORM_ERROR",
			"reason_text": "kitchen fire, refunding the customer in full",
			"case_id":     "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
		},
		map[string]string{"Idempotency-Key": "prep-cancel-refund-1"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel PREPARING: want 200, got %d", resp.StatusCode)
	}

	// A REFUND ledger batch must now exist alongside the CAPTURE.
	kinds := batchKindsForOrder(t, pool, orderID)
	var hasRefund bool
	for _, k := range kinds {
		if k == "REFUND" {
			hasRefund = true
		}
	}
	if !hasRefund {
		t.Fatalf("expected a REFUND ledger batch after post-acceptance cancel, got kinds=%v", kinds)
	}

	// The customer must be made whole: CUSTOMER_CHARGES across all batches nets 0.
	if net := orderCustomerNet(t, pool, orderID); net != 0 {
		t.Fatalf("money-zero-residual violated: customer net = %d after cancel, want 0", net)
	}

	// A refund row must exist for the full captured amount, AUTHORISED.
	var cnt, amt int64
	var state string
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*), coalesce(max(amount_cents),0), coalesce(max(state::text),'')
		  FROM refund WHERE order_id=$1`, orderID).Scan(&cnt, &amt, &state); err != nil {
		t.Fatalf("read refund: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("want exactly 1 refund row, got %d", cnt)
	}
	if amt != captured {
		t.Errorf("refund amount = %d, want the full captured %d", amt, captured)
	}
	if state != "AUTHORISED" {
		t.Errorf("refund state = %q, want AUTHORISED", state)
	}
}

// If the refund cannot be posted, the state change must roll back too: there is
// no path where the order is CANCELLED but the money is not reversed. We force
// this by deleting the captured payment_intent AFTER seeding the capture batch,
// so postCaptureReversal fails and the whole cancel must abort with the order
// still in PREPARING.
func TestCancelOrderAdmin_Preparing_ReversalFailureRollsBackState(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedCapturedPreparingOrder(t, pool)

	// Remove the payment_intent so the reversal cannot find a captured payment.
	if _, err := pool.Exec(context.Background(),
		`DELETE FROM payment_intent WHERE order_id=$1`, orderID); err != nil {
		t.Fatalf("delete payment_intent: %v", err)
	}

	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "PLATFORM_ERROR",
			"reason_text": "reversal-failure rollback probe cancel",
			"case_id":     "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
		},
		map[string]string{"Idempotency-Key": "prep-cancel-rollback-1"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("reversal failure: want 500, got %d", resp.StatusCode)
	}
	// The order must NOT have been cancelled — the money effect failed, so the
	// state change rolled back with it.
	var state string
	if err := pool.QueryRow(context.Background(),
		`SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state); err != nil {
		t.Fatalf("read order state: %v", err)
	}
	if state != "PREPARING" {
		t.Errorf("order state = %q after failed reversal, want PREPARING (state must roll back with money)", state)
	}
	// No stray refund row either.
	var cnt int64
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM refund WHERE order_id=$1`, orderID).Scan(&cnt)
	if cnt != 0 {
		t.Errorf("a refund row was left behind after rollback: %d", cnt)
	}
}

// =========================================================================
// A) INPUT — reason_code is honoured verbatim (not rewritten), the enum is
//    validated, and the contract's optional refund_kind is accepted.
// =========================================================================

// The caller's reason_code must land on order.cancel_reason unchanged. Before
// the fix, 'FRAUD_SUSPECTED' was silently rewritten to 'SUPPORT_CANCELLED'.
func TestCancelOrderAdmin_ReasonCodeStoredVerbatim(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "FRAUD_SUSPECTED",
			"reason_text": "flagged by fraud rules, cancelling pre-acceptance",
			"case_id":     "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f90",
		},
		map[string]string{"Idempotency-Key": "reason-verbatim-1"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d", resp.StatusCode)
	}
	var stored string
	if err := pool.QueryRow(context.Background(),
		`SELECT cancel_reason::text FROM "order" WHERE id=$1`, orderID).Scan(&stored); err != nil {
		t.Fatalf("read cancel_reason: %v", err)
	}
	if stored != "FRAUD_SUSPECTED" {
		t.Errorf("cancel_reason = %q, want FRAUD_SUSPECTED (stored verbatim, not rewritten)", stored)
	}
}

// An out-of-enum reason_code must be a 422, not silently accepted.
func TestCancelOrderAdmin_UnknownReasonCode_422(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "TOTALLY_MADE_UP",
			"reason_text": "this reason code is not in the enum at all",
			"case_id":     "5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9012",
		},
		map[string]string{"Idempotency-Key": "bad-reason-key-000001"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("unknown reason_code: want 422, got %d", resp.StatusCode)
	}
	// The order must NOT have been cancelled by a rejected request.
	var state string
	_ = pool.QueryRow(context.Background(), `SELECT state::text FROM "order" WHERE id=$1`, orderID).Scan(&state)
	if state != "CREATED" {
		t.Errorf("order state = %q after rejected cancel, want CREATED", state)
	}
}

// The contract's optional refund_kind field must be ACCEPTED (a valid body is
// never a 422). Before the fix DisallowUnknownFields rejected it.
func TestCancelOrderAdmin_RefundKindAccepted(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "customer asked to cancel before acceptance",
			"case_id":     "6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f901234",
			"refund_kind": "FULL",
		},
		map[string]string{"Idempotency-Key": "refund-kind-ok-1"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid body with refund_kind: want 200, got %d", resp.StatusCode)
	}
}

// An out-of-enum refund_kind is a 422.
func TestCancelOrderAdmin_BadRefundKind_422(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "refund kind is not a valid enum value here",
			"case_id":     "7a8b9c0d-1e2f-3a4b-5c6d-7e8f90123456",
			"refund_kind": "HALF_MAYBE",
		},
		map[string]string{"Idempotency-Key": "refund-kind-bad-00001"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("bad refund_kind: want 422, got %d", resp.StatusCode)
	}
}

// case_id must be a UUID (contract format:uuid); a non-UUID is a 422.
func TestCancelOrderAdmin_NonUUIDCaseID_422(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "CREATED")
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "case id is not a uuid in this request",
			"case_id":     "not-a-uuid",
		},
		map[string]string{"Idempotency-Key": "bad-caseid-key-00001"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("non-uuid case_id: want 422, got %d", resp.StatusCode)
	}
}

// =========================================================================
// D) ERROR TAXONOMY — a malformed order id is a clean 404, never a 500 that
//    leaks a database uuid-cast error.
// =========================================================================

func TestGetOrderAdmin_MalformedOrderID_404(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	for _, bad := range []string{"not-a-uuid", "123", "'; DROP TABLE \"order\";--", "00000000-0000-0000-0000"} {
		resp := doJSON(t, http.MethodGet, srv.URL+"/v1/admin/orders/"+bad, nil, nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET malformed orderId %q: want 404, got %d", bad, resp.StatusCode)
		}
		body := decodeBody(t, resp)
		if eb, _ := body["error"].(map[string]any); eb["code"] != "NOT_FOUND" {
			t.Errorf("GET malformed orderId %q: want NOT_FOUND, got %v", bad, eb["code"])
		}
		resp.Body.Close()
	}
}

func TestCancelOrderAdmin_MalformedOrderID_404(t *testing.T) {
	pool := dialTestPool(t)
	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, srv.URL+"/v1/admin/orders/not-a-uuid/cancel",
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "malformed order id should be a 404 not a 500",
			"case_id":     "9c0d1e2f-3a4b-5c6d-7e8f-901234567890",
		},
		map[string]string{"Idempotency-Key": "malformed-orderid-0001"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("cancel malformed orderId: want 404, got %d", resp.StatusCode)
	}
	if eb, _ := decodeBody(t, resp)["error"].(map[string]any); eb["code"] != "NOT_FOUND" {
		t.Errorf("want NOT_FOUND, got %v", eb["code"])
	}
}

// =========================================================================
// C) STATE MACHINE — the cancel resets the lease/escalation columns the shared
//    machine transition resets, so a cancelled order is never claimable.
// =========================================================================

func TestCancelOrderAdmin_ResetsLeaseAndEscalations(t *testing.T) {
	pool := dialTestPool(t)
	orderID, _ := seedOrderForAdmin(t, pool, "RESTAURANT_PENDING")

	// Dirty the lease/escalation columns as the runner would.
	if _, err := pool.Exec(context.Background(), `
		UPDATE "order" SET deadline_escalations=3, lease_until=now()+interval '5 min', lease_owner='runner-x'
		 WHERE id=$1`, orderID); err != nil {
		t.Fatalf("dirty lease columns: %v", err)
	}

	p := principalFor(t, pool, httpx.RoleAdmin)
	srv := buildAdminTestServer(t, pool, p)
	defer srv.Close()

	resp := doJSON(t, http.MethodPost, fmt.Sprintf("%s/v1/admin/orders/%s/cancel", srv.URL, orderID),
		map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "cancel and ensure lease/escalation reset happens",
			"case_id":     "8b9c0d1e-2f3a-4b5c-6d7e-8f9012345678",
		},
		map[string]string{"Idempotency-Key": "reset-lease-key-0001"})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d", resp.StatusCode)
	}
	var esc int
	var leaseUntil, leaseOwner *string
	if err := pool.QueryRow(context.Background(), `
		SELECT deadline_escalations, lease_until::text, lease_owner FROM "order" WHERE id=$1`,
		orderID).Scan(&esc, &leaseUntil, &leaseOwner); err != nil {
		t.Fatalf("read lease columns: %v", err)
	}
	if esc != 0 {
		t.Errorf("deadline_escalations = %d after cancel, want 0", esc)
	}
	if leaseUntil != nil || leaseOwner != nil {
		t.Errorf("lease not cleared after cancel: until=%v owner=%v", leaseUntil, leaseOwner)
	}
}
