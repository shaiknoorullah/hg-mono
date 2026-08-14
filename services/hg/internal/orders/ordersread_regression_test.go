package orders

// ordersread_regression_test.go — STAGE 4 adversarial-review regression tests.
//
// Each test here would have FAILED against the code as it stood at the start of
// STAGE 4 and PASSES after the fix. They pin two real defects found by trying to
// break the feature:
//
//   FINDING 1 (HIGH, contract/enum-shape drift): the receipt handler re-marshals
//     a frozen JSONB snapshot through a typed DTO. When the snapshot omits
//     `refunds`, `money.tax_lines` or a line's `addons` (or stores them as JSON
//     null), the nil Go slice re-marshalled to `null` on the wire — violating the
//     contract, where Receipt.refunds, OrderMoney.tax_lines and OrderLine.addons
//     are non-nullable `type: array`. A client decoding `[]Refund` would fail on
//     `null`. Fixed by receiptSnapshotDTO.normalizeArrays().
//
//   FINDING 2 (MEDIUM, spec/fixture conformance): getOrderTracking never selected
//     order.eta_at, so eta_at and eta_window_minutes were ALWAYS null even when the
//     order carried an ETA — diverging from every tracking fixture (which always
//     render both) and from C-32 rule 3 ("ETA is always present"). Fixed by
//     selecting o.eta_at and deriving the ±5-minute window.

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// ---- FINDING 1: array fields never render as JSON null --------------------

// TestRegressionReceiptArraysNeverNull is a pure unit test (no DB): it drives the
// exact re-marshal path the handler uses with hostile snapshot shapes and asserts
// the array fields always come out as `[]`, never `null`. These are the five
// concrete hostile inputs a snapshot writer could realistically produce.
func TestRegressionReceiptArraysNeverNull(t *testing.T) {
	cases := []struct {
		name     string
		snapshot string
	}{
		{"refunds key absent", `{"order_id":"o","receipt_number":"r","issued_at":"t","money":{"currency":"CAD"},"payment":{"amount_charged_cents":0,"currency":"CAD"},"lines":[{"line_no":1,"menu_item_id":"m","name":"n","quantity":1,"unit_price_cents":0,"line_total_cents":0,"currency":"CAD"}]}`},
		{"refunds explicit null", `{"order_id":"o","receipt_number":"r","issued_at":"t","refunds":null,"money":{"currency":"CAD","tax_lines":null},"payment":{"amount_charged_cents":0,"currency":"CAD"},"lines":[]}`},
		{"tax_lines key absent", `{"order_id":"o","receipt_number":"r","issued_at":"t","refunds":[],"money":{"currency":"CAD"},"payment":{"amount_charged_cents":0,"currency":"CAD"},"lines":[]}`},
		{"line addons null", `{"order_id":"o","receipt_number":"r","issued_at":"t","refunds":[],"money":{"currency":"CAD","tax_lines":[]},"payment":{"amount_charged_cents":0,"currency":"CAD"},"lines":[{"line_no":1,"menu_item_id":"m","name":"n","quantity":1,"unit_price_cents":0,"line_total_cents":0,"currency":"CAD","addons":null}]}`},
		{"everything absent", `{"order_id":"o","receipt_number":"r","issued_at":"t","money":{"currency":"CAD"},"payment":{"amount_charged_cents":0,"currency":"CAD"}}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var snap receiptSnapshotDTO
			if err := json.Unmarshal([]byte(tc.snapshot), &snap); err != nil {
				t.Fatalf("unmarshal snapshot: %v", err)
			}
			snap.normalizeArrays()
			out, err := json.Marshal(snap)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}

			var m map[string]json.RawMessage
			if err := json.Unmarshal(out, &m); err != nil {
				t.Fatalf("re-decode: %v", err)
			}
			// Top-level refunds must be an array, never null.
			if isRawNull(m["refunds"]) {
				t.Errorf("refunds rendered as null; contract requires type: array\n  got: %s", out)
			}
			var refunds []json.RawMessage
			if err := json.Unmarshal(m["refunds"], &refunds); err != nil {
				t.Errorf("refunds is not a JSON array: %v (raw %s)", err, m["refunds"])
			}
			// money.tax_lines must be an array, never null.
			money := map[string]json.RawMessage{}
			_ = json.Unmarshal(m["money"], &money)
			if isRawNull(money["tax_lines"]) {
				t.Errorf("money.tax_lines rendered as null; contract requires type: array\n  got: %s", out)
			}
			// each line's addons must be an array, never null.
			var lines []map[string]json.RawMessage
			_ = json.Unmarshal(m["lines"], &lines)
			for i, ln := range lines {
				if isRawNull(ln["addons"]) {
					t.Errorf("lines[%d].addons rendered as null; contract requires type: array", i)
				}
			}
		})
	}
}

func isRawNull(raw json.RawMessage) bool {
	return string(raw) == "null"
}

// buildTestReceiptSnapshotJSON returns a self-contained, contract-valid receipt
// snapshot (independent of any Quote) used to seed COMPLETED orders in regression
// tests. Callers may strip keys from it to model hostile snapshot shapes.
func buildTestReceiptSnapshotJSON() []byte {
	snap := map[string]any{
		"order_id":                           "00000000-0000-0000-0000-0000000000aa",
		"order_code":                         "HG-REG-01",
		"receipt_number":                     "HG-2026-000000999",
		"issued_at":                          time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"platform_legal_name":                "Halal Goes Technologies Inc.",
		"platform_tax_registration_number":   nil,
		"restaurant_legal_name":              "Test Co",
		"restaurant_tax_registration_number": nil,
		"delivery_address":                   nil,
		"lines": []map[string]any{
			{
				"line_no": 1, "menu_item_id": "00000000-0000-0000-0000-0000000000bb",
				"name": "Test Item", "variant_name": nil, "addons": []any{},
				"quantity": 1, "special_request": nil,
				"unit_price_cents": 1500, "line_total_cents": 1500, "currency": "CAD",
			},
		},
		"money": map[string]any{
			"subtotal_cents": 1500, "discount_cents": 0, "delivery_fee_cents": 0,
			"service_fee_cents": 0, "tax_lines": []any{}, "tax_total_cents": 0,
			"tip_cents": 0, "total_cents": 1500, "currency": "CAD",
		},
		"payment": map[string]any{
			"card_brand": "visa", "card_last4": "4242", "wallet": nil,
			"amount_charged_cents": 1500, "currency": "CAD",
		},
		"refunds":      []any{},
		"placed_at":    time.Now().UTC().Add(-30 * time.Minute).Format("2006-01-02T15:04:05.000Z"),
		"delivered_at": time.Now().UTC().Add(-5 * time.Minute).Format("2006-01-02T15:04:05.000Z"),
	}
	raw, _ := json.Marshal(snap)
	return raw
}

// TestRegressionReceiptRefundsEmptyArrayOverWire is the end-to-end counterpart:
// a COMPLETED order whose stored snapshot has `refunds` REMOVED must still return
// `"refunds": []` (not null) over the HTTP wire. This proves the handler does not
// trust the snapshot's shape.
func TestRegressionReceiptRefundsEmptyArrayOverWire(t *testing.T) {
	pool := testPoolForRead(t)
	// Seed a PREPARING order — it has no receipt_snapshot yet, so our stripped
	// snapshot is the FIRST write and the P-10 immutability trigger permits it.
	seed := seedOrderInState(t, pool, "PREPARING")

	// Write a snapshot that OMITS `refunds` and `money.tax_lines` entirely — the
	// exact hostile shape a snapshot writer could produce. jsonb - 'key' strips
	// the top-level key from the base snapshot before it is ever stored.
	ctx := context.Background()
	base := buildTestReceiptSnapshotJSON()
	_, err := pool.Exec(ctx, `
		UPDATE "order"
		   SET state = 'COMPLETED'::order_state,
		       deadline_at = NULL, deadline_action = NULL,
		       completed_at = now(),
		       receipt_snapshot = (($2::jsonb - 'refunds')
		           || jsonb_build_object('money', ($2::jsonb->'money') - 'tax_lines'))
		 WHERE id = $1`, seed.orderID, base)
	if err != nil {
		t.Fatalf("write stripped snapshot: %v", err)
	}

	r := customerRouter(t, pool, seed.ownerAccountID)
	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/receipt")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())

	if isJSONNull(data["refunds"]) {
		t.Errorf("refunds must be [] not null even when the snapshot omits it; got %s", data["refunds"])
	}
	var refunds []json.RawMessage
	decodeJSON(t, data["refunds"], &refunds)

	money := decodeObject(t, data["money"], "money")
	if isJSONNull(money["tax_lines"]) {
		t.Errorf("money.tax_lines must be [] not null even when the snapshot omits it; got %s", money["tax_lines"])
	}
}

// ---- FINDING 2: tracking exposes the ETA when the order has one -----------

// TestRegressionTrackingExposesETA seeds an order whose eta_at is set and asserts
// the tracking projection renders eta_at and a non-null eta_window_minutes — the
// pre-fix code always returned null for both, dropping the ETA the fixtures and
// C-32 rule 3 require.
func TestRegressionTrackingExposesETA(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING")

	// Set a concrete ETA on the order (CreateOrder leaves it null in the seed).
	ctx := context.Background()
	eta := time.Now().Add(20 * time.Minute).UTC().Truncate(time.Second)
	_, err := pool.Exec(ctx, `UPDATE "order" SET eta_at = $2 WHERE id = $1`, seed.orderID, eta)
	if err != nil {
		t.Fatalf("set eta_at: %v", err)
	}

	r := customerRouter(t, pool, seed.ownerAccountID)
	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())

	if isJSONNull(data["eta_at"]) {
		t.Errorf("eta_at must be present when the order carries an ETA (C-32 rule 3), got null")
	}
	var etaAt string
	decodeJSON(t, data["eta_at"], &etaAt)
	if etaAt == "" {
		t.Errorf("eta_at must be a non-empty timestamp")
	}
	if isJSONNull(data["eta_window_minutes"]) {
		t.Errorf("eta_window_minutes must accompany a present eta_at, got null")
	}
	var window int
	decodeJSON(t, data["eta_window_minutes"], &window)
	if window != etaWindowMinutes {
		t.Errorf("eta_window_minutes = %d, want %d (±5-minute window)", window, etaWindowMinutes)
	}
}

// TestRegressionTrackingETANullWhenAbsent pins the other half of the contract's
// nullability: when the order has no eta_at, BOTH eta_at and eta_window_minutes
// are null (present-as-null, never omitted, never a fabricated window).
func TestRegressionTrackingETANullWhenAbsent(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING") // CreateOrder leaves eta_at null

	// Belt-and-braces: force eta_at NULL in case a future seed sets it.
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE "order" SET eta_at = NULL WHERE id = $1`, seed.orderID); err != nil {
		t.Fatalf("null eta_at: %v", err)
	}

	r := customerRouter(t, pool, seed.ownerAccountID)
	rec := doGET(t, r, "/v1/orders/"+seed.orderID+"/tracking")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	data := decodeData(t, rec.Body.Bytes())

	if _, ok := data["eta_at"]; !ok {
		t.Errorf("eta_at key must be present (as null), not omitted")
	}
	if !isJSONNull(data["eta_at"]) {
		t.Errorf("eta_at must be null when the order has no ETA, got %s", data["eta_at"])
	}
	if !isJSONNull(data["eta_window_minutes"]) {
		t.Errorf("eta_window_minutes must be null when eta_at is null (no fabricated window), got %s", data["eta_window_minutes"])
	}
}

// ---- FINDING 3: malformed order id → 404, never a bare 500 ----------------

// TestRegressionMalformedOrderIDIs404 throws non-UUID and boundary path params at
// all three read ops. Pre-fix, a non-UUID id reached the `uuid` comparison and
// Postgres raised "invalid input syntax for type uuid", surfacing as a bare 500
// INTERNAL_ERROR. A malformed id is a resource that cannot exist, so every op must
// answer 404 NOT_FOUND — the same answer an unowned valid id gets, leaking nothing.
// (SQL was already parameterised; injection was never possible — this pins the
// status code and error taxonomy.)
func TestRegressionMalformedOrderIDIs404(t *testing.T) {
	pool := testPoolForRead(t)
	seed := seedOrderInState(t, pool, "PREPARING")
	r := customerRouter(t, pool, seed.ownerAccountID)

	// Hostile / boundary ids: non-hex, wrong length, SQL-ish, empty-ish, unicode,
	// and a valid-shaped-but-nonexistent one as the control.
	malformed := []string{
		"not-a-uuid",
		"123",
		"00000000-0000-0000-0000-00000000000",   // 35 chars (one short)
		"00000000-0000-0000-0000-0000000000000", // 37 chars (one long)
		"gggggggg-0000-0000-0000-000000000000",  // non-hex
		"00000000_0000_0000_0000_000000000000",  // wrong separators
		"'OR'1'='1",                             // injection probe (url-safe, no spaces)
		"DROP;TABLE",                            // injection probe 2
	}
	ops := []string{"/tracking", "/receipt", "/rider"}

	for _, id := range malformed {
		for _, op := range ops {
			rec := doGET(t, r, "/v1/orders/"+id+op)
			if rec.Code >= 500 {
				t.Errorf("id=%q%s produced bare %d — malformed id must never 500 (body: %s)", id, op, rec.Code, rec.Body.String())
				continue
			}
			if rec.Code != http.StatusNotFound {
				t.Errorf("id=%q%s status = %d, want 404 NOT_FOUND", id, op, rec.Code)
				continue
			}
			if c := errCode(t, rec.Body.Bytes()); c != "NOT_FOUND" {
				t.Errorf("id=%q%s code = %q, want NOT_FOUND", id, op, c)
			}
			// The 404 body must leak nothing about the real seeded order.
			if strings.Contains(rec.Body.String(), seed.orderID) {
				t.Errorf("id=%q%s 404 body leaks the real order id", id, op)
			}
		}
	}
}
