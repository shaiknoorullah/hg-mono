package restaurant_test

// payment_seam_test.go — integration tests for the T6/T7 payment seam.
//
// These tests verify that AcceptOrder calls PaymentActions.Capture with the
// correct orderID and total_cents exactly once (T6), and that RejectOrder calls
// PaymentActions.Void with the correct orderID exactly once (T7).
//
// Guarded by HG_TEST_POSTGRES_DSN. Uses the existing seedOrder / seedFixtures
// helpers from integration_test.go, which share the same test package.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// Ensure restaurant import is used (the package exposes NewHandler/NewRepo).
var _ = restaurant.NewRepo

// ─── Fake PaymentActions ──────────────────────────────────────────────────────

// fakePayActions records calls to Capture and Void for assertion in tests.
type fakePayActions struct {
	mu sync.Mutex

	captureCalls []captureCall
	voidCalls    []string // orderIDs

	captureErr error
	voidErr    error
}

type captureCall struct {
	orderID     string
	amountCents int64
}

func (f *fakePayActions) Capture(_ context.Context, orderID string, amountCents int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.captureCalls = append(f.captureCalls, captureCall{orderID: orderID, amountCents: amountCents})
	return f.captureErr
}

func (f *fakePayActions) Void(_ context.Context, orderID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.voidCalls = append(f.voidCalls, orderID)
	return f.voidErr
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// TestPaymentSeam_AcceptOrder_CallsCapture asserts T6: after a successful
// AcceptOrder the handler calls PaymentActions.Capture exactly once with the
// correct orderID and total_cents (1500, as seeded by seedOrder).
func TestPaymentSeam_AcceptOrder_CallsCapture(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// seedOrder produces total_cents=1500; state=RESTAURANT_PENDING.
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	pay := &fakePayActions{}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/accept",
		strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.AcceptOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("AcceptOrder: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	pay.mu.Lock()
	defer pay.mu.Unlock()

	if len(pay.captureCalls) != 1 {
		t.Fatalf("Capture called %d times, want exactly 1", len(pay.captureCalls))
	}
	if pay.captureCalls[0].orderID != orderID {
		t.Errorf("Capture orderID=%q, want %q", pay.captureCalls[0].orderID, orderID)
	}
	// seedOrder seeds total_cents=1500.
	const wantTotal = int64(1500)
	if pay.captureCalls[0].amountCents != wantTotal {
		t.Errorf("Capture amountCents=%d, want %d", pay.captureCalls[0].amountCents, wantTotal)
	}
	if len(pay.voidCalls) != 0 {
		t.Errorf("Void called %d times on accept, want 0", len(pay.voidCalls))
	}
}

// TestPaymentSeam_RejectOrder_CallsVoid asserts T7: after a successful
// RejectOrder the handler calls PaymentActions.Void exactly once with the
// correct orderID.
func TestPaymentSeam_RejectOrder_CallsVoid(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	pay := &fakePayActions{}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/reject",
		strings.NewReader(`{"reason":"ITEM_UNAVAILABLE"}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.RejectOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("RejectOrder: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	pay.mu.Lock()
	defer pay.mu.Unlock()

	if len(pay.voidCalls) != 1 {
		t.Fatalf("Void called %d times, want exactly 1", len(pay.voidCalls))
	}
	if pay.voidCalls[0] != orderID {
		t.Errorf("Void orderID=%q, want %q", pay.voidCalls[0], orderID)
	}
	if len(pay.captureCalls) != 0 {
		t.Errorf("Capture called %d times on reject, want 0", len(pay.captureCalls))
	}
}

// TestPaymentSeam_AcceptOrder_CaptureError_StillReturns200 verifies the
// "store-then-process" contract: a Capture failure must not 500 the accept.
// The order is already PREPARING; the reconciler retries.
func TestPaymentSeam_AcceptOrder_CaptureError_StillReturns200(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	pay := &fakePayActions{captureErr: fmt.Errorf("stripe: timeout")}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/accept",
		strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.AcceptOrder(rec, req)

	// Even though Capture failed, the order was accepted — 200, not 500.
	if rec.Code != http.StatusOK {
		t.Fatalf("AcceptOrder with capture error: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestPaymentSeam_NilPay_AcceptOrder_StillReturns200 verifies that a nil
// PaymentActions (boot without payments wired) does not break AcceptOrder.
func TestPaymentSeam_NilPay_AcceptOrder_StillReturns200(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, nil) // nil pay — boot without payments

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/accept",
		strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.AcceptOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("nil pay AcceptOrder: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// ─── Hardening regression tests (adversarial verification) ────────────────────

// TestPaymentSeam_AcceptOrder_IllegalTransition_DoesNotCapture is the money-safety
// invariant: when repo.AcceptOrder fails (the order is not RESTAURANT_PENDING),
// the handler must NOT capture. Capturing on a failed accept would move money for
// an order that was never accepted. The order is seeded in PREPARING so accept is
// an ILLEGAL_TRANSITION (409); Capture must be called zero times.
func TestPaymentSeam_AcceptOrder_IllegalTransition_DoesNotCapture(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// PREPARING → accept is illegal (accept requires RESTAURANT_PENDING).
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"PREPARING", "now() + interval '30 minutes'")

	pay := &fakePayActions{}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/accept",
		strings.NewReader(`{}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.AcceptOrder(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("AcceptOrder on PREPARING: status=%d, want 409 (body: %s)", rec.Code, rec.Body.String())
	}

	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.captureCalls) != 0 {
		t.Errorf("Capture called %d times on a failed accept, want 0 (money moved for an unaccepted order)", len(pay.captureCalls))
	}
}

// TestPaymentSeam_RejectOrder_IllegalTransition_DoesNotVoid is the symmetric
// guard for reject: when repo.RejectOrder fails, Void must not be called. The
// order is seeded REJECTED (terminal) so a second reject is ILLEGAL_TRANSITION
// (409); Void must be called zero times.
func TestPaymentSeam_RejectOrder_IllegalTransition_DoesNotVoid(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// REJECTED → reject again is illegal.
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"REJECTED", "")

	pay := &fakePayActions{}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/reject",
		strings.NewReader(`{"reason":"ITEM_UNAVAILABLE"}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.RejectOrder(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("RejectOrder on REJECTED: status=%d, want 409 (body: %s)", rec.Code, rec.Body.String())
	}

	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.voidCalls) != 0 {
		t.Errorf("Void called %d times on a failed reject, want 0", len(pay.voidCalls))
	}
}

// TestPaymentSeam_RejectOrder_VoidError_StillReturns200 mirrors the capture-error
// case for the void path: a Void failure must not 500 the reject. The order is
// already REJECTED in the database; the reconciler retries the void.
func TestPaymentSeam_RejectOrder_VoidError_StillReturns200(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	pay := &fakePayActions{voidErr: fmt.Errorf("stripe: timeout")}
	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, pay)

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/reject",
		strings.NewReader(`{"reason":"ITEM_UNAVAILABLE"}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.RejectOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("RejectOrder with void error: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	pay.mu.Lock()
	defer pay.mu.Unlock()
	if len(pay.voidCalls) != 1 {
		t.Errorf("Void called %d times, want exactly 1 (attempted despite the error)", len(pay.voidCalls))
	}
}

// TestPaymentSeam_NilPay_RejectOrder_StillReturns200 is the reject-side twin of
// the nil-pay accept test: a nil PaymentActions (boot without payments wired)
// must not panic or 500 the reject.
func TestPaymentSeam_NilPay_RejectOrder_StillReturns200(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	orderID := seedOrder(t, pool, f.restaurantID, f.menuItemID,
		"RESTAURANT_PENDING", "now() + interval '3 minutes'")

	repo := restaurant.NewRepo(pool)
	h := restaurant.NewHandler(repo, nil, nil) // nil pay — boot without payments

	req := httptest.NewRequest(http.MethodPost,
		"/v1/restaurant/orders/"+orderID+"/reject",
		strings.NewReader(`{"reason":"ITEM_UNAVAILABLE"}`))
	req = withPrincipal(req, principalWith(f.ownerAccountID, httpx.RoleRestaurantOwner))
	req = withChiParam(req, "orderId", orderID)
	rec := httptest.NewRecorder()

	h.RejectOrder(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("nil pay RejectOrder: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}
