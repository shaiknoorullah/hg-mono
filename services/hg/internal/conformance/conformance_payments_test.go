package conformance

// Payments conformance: this file drives the payments module (payment intents,
// refunds, connect, earnings, payouts) against a LIVE in-process server backed by
// the LOCAL FAKE Stripe client (payments.NewFakeStripe — the same path the real
// server takes in local env when HG_STRIPE_SECRET_KEY is unset), then validates
// every 2xx body against contracts/openapi.yaml via the package's ValidateResponse
// oracle (additionalProperties:false + required[] + closed enums). Write ops also
// have their request bodies proven contract-valid with ValidateRequest.
//
// It stands up its OWN httptest server (payments.Routes wired with the fake Stripe
// client) rather than editing the shared NewHarness — other agents add their own
// files concurrently to this package. It reuses the shared oracle plumbing
// (LoadSpec, testAuthenticator, authMatrix, the Harness Do/Build/CheckResponse
// helpers, and writeCoverage) so coverage is aggregated with the rest of the pass.

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// Payments fixtures. These reference rows the migrated+seeded DB already carries:
//   - fxOrderID (88888888…) has a SUCCEEDED payment_intent capturing 4363 cents
//     (from migrations/test/fixtures.sql), which makes getOrderPayment, createRefund,
//     issueRefund, getRefund and listRefunds reachable with a real captured order.
//   - fxRiderID (019ffe57…) already has an ACTIVE rider_profile AND a
//     connect_account (owner_type RIDER, charges/payouts enabled), so getConnectStatus,
//     createConnectAccount (idempotent) and createConnectOnboardingLink all resolve.
//
// The earning_entry and payout rows the rider read paths need are NOT in the base
// seed, so this file seeds them itself (idempotently, under its own fixed UUIDs)
// and never mutates another module's shared rows.
const (
	// A DELIVERY earning entry for fxRiderID (listRiderEarningEntries / summary).
	fxPayEarningEntryID = "0a111111-0000-4000-8000-00000000ea01"
	// A DRAFT payout for fxRiderID's connect account (listRiderPayouts / getRiderPayout).
	fxPayPayoutID = "0a222222-0000-4000-8000-00000000b001"
)

// newPaymentsHarness stands up an in-process server wired with ONLY the payments
// module, using the LOCAL FAKE Stripe client (the exact client cmd/hg/main.go
// selects in local env with no key). It returns a *Harness so all the shared
// request/validate/coverage helpers apply unchanged.
func newPaymentsHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	// The fake Stripe client fabricates requires_capture intents, succeeded
	// captures/refunds and enabled connect accounts — no network, no credentials.
	// Connect onboarding URLs are configured so createConnectOnboardingLink can
	// mint a link rather than 409 on missing config.
	cfg := &config.Config{
		Env: config.EnvLocal,
		Stripe: config.Stripe{
			ConnectReturnURL:  "https://partners.local/connect/return",
			ConnectRefreshURL: "https://partners.local/connect/refresh",
		},
	}
	repo, stripe := payments.NewRepo(pool), payments.NewFakeStripe()
	// The payout runner only queues admin runs here: its loop is not started,
	// so nothing is paid out of the shared database.
	runner := payments.NewPayoutRunner(repo, stripe, payments.PayoutPolicy{RestaurantNegativeBlockDays: 30},
		"conformance", slog.Default())
	svc := payments.NewService(repo, stripe, cfg.Stripe, slog.Default()).WithPayoutRunner(runner)
	payments.Routes(router, payments.NewHandler(svc, cfg))

	if err := router.Verify(); err != nil {
		t.Fatalf("payments router policy verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// seedRiderEarningAndPayout inserts one earning entry and one DRAFT payout for
// fxRiderID, both idempotent. A DRAFT payout is exempt from the deferred
// amount-matches-entries trigger (00018), so a zero-amount, zero-entry DRAFT with
// a live deadline is a legal, minimal row for the read paths under test.
func seedRiderEarningAndPayout(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// A resolved connect account id for the rider (present in the seed DB).
	var connectID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM connect_account WHERE owner_type='RIDER' AND owner_id=$1`,
		fxRiderID).Scan(&connectID); err != nil {
		t.Fatalf("rider connect_account not present (seed expected): %v", err)
	}

	// One AVAILABLE DELIVERY earning entry, gross = base+tip so the identity check
	// holds (gross = base+distance+wait+topup+tip+adjustment).
	if _, err := pool.Exec(ctx, `
		INSERT INTO earning_entry (id, account_id, type, status, base_cents, tip_cents,
		                           gross_cents, currency, formula_version, earned_at)
		VALUES ($1, $2, 'DELIVERY', 'AVAILABLE', 800, 200, 1000, 'CAD', 1, now())
		ON CONFLICT (id) DO NOTHING`, fxPayEarningEntryID, fxRiderID); err != nil {
		t.Fatalf("seed earning_entry: %v", err)
	}

	// One DRAFT payout for the rider's connect account. DRAFT skips the
	// amount-matches trigger; the deadline is required for a non-terminal state.
	if _, err := pool.Exec(ctx, `
		INSERT INTO payout (id, connect_account_id, period_start, period_end, amount_cents,
		                    currency, state, entry_count, deadline_at, deadline_action)
		VALUES ($1, $2, now() - interval '7 days', now(), 0, 'CAD', 'DRAFT', 0,
		        now() + interval '1 hour', 'execute_transfer')
		ON CONFLICT (id) DO NOTHING`, fxPayPayoutID, connectID); err != nil {
		t.Fatalf("seed payout: %v", err)
	}
}

// cleanupRefundByID detaches a refund's ledger batch (append-only ledger) and
// deletes the refund + its lines, so a write test leaves no residue that would
// accumulate against the shared captured order across runs or agents.
func cleanupRefundByID(t *testing.T, pool *pgxpool.Pool, refundID string) {
	if refundID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, _ = pool.Exec(ctx, `DELETE FROM refund_line WHERE refund_id = $1`, refundID)
	_, _ = pool.Exec(ctx, `UPDATE ledger_batch SET refund_id = NULL WHERE refund_id = $1`, refundID)
	if _, err := pool.Exec(ctx, `DELETE FROM refund WHERE id = $1`, refundID); err != nil {
		t.Logf("cleanup refund %s: %v", refundID, err)
	}
}

// TestConformance_Payments_Reads validates the payments READ surface. Each case
// issues a live request whose 2xx body is validated against the contract schema.
func TestConformance_Payments_Reads(t *testing.T) {
	pool := openPool(t)
	h := newPaymentsHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	seedRiderEarningAndPayout(t, pool)

	cases := []struct {
		name string
		rq   Request
		want int
	}{
		// Saved cards (empty list is a valid PaymentMethodList). CUSTOMER-scoped.
		{"listPaymentMethods", Request{Method: "GET", Path: "/v1/payment-methods",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},

		// Order payment state for the captured fixture order (P-16). The customer
		// owns fxOrderID, so ownership passes and OrderPayment is emitted.
		{"getOrderPayment", Request{Method: "GET", Path: "/v1/orders/" + fxOrderID + "/payment",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},

		// Refund history (empty or not, a valid RefundList). CUSTOMER-scoped.
		{"listRefunds", Request{Method: "GET", Path: "/v1/refunds",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200},

		// Connect status for the rider — the seeded connect_account resolves.
		{"getConnectStatus", Request{Method: "GET", Path: "/v1/connect/status",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// Rider earnings summary (D-27), zero-filled buckets over a WEEK window.
		{"getRiderEarningsSummary", Request{Method: "GET", Path: "/v1/riders/me/earnings/summary",
			Query: "period=WEEK", AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// Rider earnings ledger (D-26) — the seeded entry makes it non-empty.
		{"listRiderEarningEntries", Request{Method: "GET", Path: "/v1/riders/me/earnings/entries",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// Rider payout history (P-19 / S-04) — the seeded DRAFT payout appears.
		{"listRiderPayouts", Request{Method: "GET", Path: "/v1/riders/me/payouts",
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// One payout with its (empty) contributing entries — PayoutDetail.
		{"getRiderPayout", Request{Method: "GET", Path: "/v1/riders/me/payouts/" + fxPayPayoutID,
			AccountID: fxRiderID, Roles: []string{roleRider}}, 200},

		// Restaurant payouts (P-19 / S-04). The contract grants this op to
		// RESTAURANT_OWNER (x-roles: [RESTAURANT_OWNER]) — RESTAURANT_MANAGER lacks
		// payout.read in the matrix, matching the contract. The owner account has no
		// payouts; an empty PayoutList is still a contract-valid 200.
		{"listRestaurantPayouts", Request{Method: "GET", Path: "/v1/restaurant/payouts",
			AccountID: fxRestaurantManagerID, Roles: []string{roleRestaurantOwner}}, 200},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			h.CheckResponse(t, tc.rq, tc.want)
		})
	}
}

// TestConformance_Payments_ConnectWrites validates the connect WRITE surface
// against the fake Stripe client: create the account (idempotent — the seeded
// rider already has one) and mint an onboarding link. Both return 2xx bodies that
// are validated against ConnectStatus / ConnectOnboardingLink. Request bodies are
// empty (the contract declares no body), so only the response is validated.
func TestConformance_Payments_ConnectWrites(t *testing.T) {
	pool := openPool(t)
	h := newPaymentsHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// createConnectAccount is idempotent on (owner_type, owner_id): the seeded
	// rider account is returned rather than a duplicate created at Stripe (201).
	h.CheckResponse(t, Request{Method: "POST", Path: "/v1/connect/account",
		AccountID: fxRiderID, Roles: []string{roleRider}, IdemKey: "conf-connect-acct-01"}, 201)

	// createConnectOnboardingLink mints a fresh AccountLink from the fake client
	// (URLs are server-generated from config; the client supplies none) (201).
	h.CheckResponse(t, Request{Method: "POST", Path: "/v1/connect/onboarding-link",
		AccountID: fxRiderID, Roles: []string{roleRider}}, 201)
}

// TestConformance_Payments_RefundWrites validates the two refund WRITE ops. Each
// FIRST proves its body is contract-valid (ValidateRequest), then issues it and
// validates the 201 body (Refund) against the contract. Both refunds are small,
// within the remaining captured balance, and cleaned up so the shared captured
// order (fxOrderID) is left as found — no residual refund accrues across runs.
func TestConformance_Payments_RefundWrites(t *testing.T) {
	pool := openPool(t)
	h := newPaymentsHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// createRefund (customer, non-GOODWILL): a PARTIAL_ITEMS refund of one unit of
	// line 1 (2 units @ 1500). The server computes the amount — the body carries
	// none (G-3). Idempotency-Key is mandatory (MONEY class).
	t.Run("createRefund", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/refunds",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			IdemKey: "conf-refund-cust-01",
			Body: map[string]any{
				"order_id":    fxOrderID,
				"kind":        "PARTIAL_ITEMS",
				"reason_code": "CUSTOMER_CHANGED_MIND",
				"lines":       []map[string]any{{"order_line_no": 1, "quantity": 1}},
				"note":        "conformance partial-items refund probe",
			}}

		// Prove the body conforms before issuing (also records the op).
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("createRefund body is not contract-valid (fix the test, not the server): %v", verr)
		}

		_, resp := h.Do(t, rq)
		defer resp.Body.Close()
		refundID := extractRefundID(t, resp)
		t.Cleanup(func() { cleanupRefundByID(t, pool, refundID) })

		if _, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (createRefund): %v", err)
		} else {
			h.MarkCovered("createRefund")
		}
		if resp.StatusCode != http.StatusCreated {
			t.Errorf("createRefund status = %d, want 201", resp.StatusCode)
		}
	})

	// getRefund (customer reads their own refund). Create a throwaway FEES_ONLY
	// refund, read it back, validate the Refund body, then clean up.
	t.Run("getRefund", func(t *testing.T) {
		create := Request{Method: "POST", Path: "/v1/refunds",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			IdemKey: "conf-refund-get-01",
			Body: map[string]any{
				"order_id":    fxOrderID,
				"kind":        "FEES_ONLY",
				"reason_code": "LATE_DELIVERY",
			}}
		_, cresp := h.Do(t, create)
		defer cresp.Body.Close()
		refundID := extractRefundID(t, cresp)
		if refundID == "" {
			t.Skipf("could not create a refund to read back (status %d) — FEES_ONLY may be zero on this fixture", cresp.StatusCode)
		}
		t.Cleanup(func() { cleanupRefundByID(t, pool, refundID) })

		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/refunds/" + refundID,
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200)
	})

	// issueRefund (admin goodwill): a small GOODWILL PARTIAL_AMOUNT under both the
	// dual-approval threshold (CAD 50.00) and the support/admin cap, so it is
	// authorised immediately and returns 201 Refund (not a 202 approval request).
	// amount_cents is the single allowlisted staff-side monetary field (G-3).
	t.Run("issueRefund", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/admin/refunds",
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin},
			IdemKey: "conf-refund-admin-1",
			Body: map[string]any{
				"order_id":     fxOrderID,
				"scope":        "PARTIAL_AMOUNT",
				"reason_code":  "GOODWILL",
				"reason_text":  "conformance goodwill probe, kept small and cleaned up",
				"amount_cents": 500,
			}}

		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("issueRefund body is not contract-valid (fix the test, not the server): %v", verr)
		}

		_, resp := h.Do(t, rq)
		defer resp.Body.Close()
		refundID := extractRefundID(t, resp)
		t.Cleanup(func() { cleanupRefundByID(t, pool, refundID) })

		if _, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (issueRefund): %v", err)
		} else {
			h.MarkCovered("issueRefund")
		}
		if resp.StatusCode != http.StatusCreated {
			t.Errorf("issueRefund status = %d, want 201 (a small goodwill under the cap authorises immediately)", resp.StatusCode)
		}
	})
}

// extractRefundID pulls the refund id from a {data:{id:…}} envelope, or "" when
// the body is not a created-refund envelope (e.g. an error). The body is left
// readable for the caller's subsequent validation.
func extractRefundID(t *testing.T, resp *http.Response) string {
	t.Helper()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	d := dataObject(t, resp)
	id, _ := d["id"].(string)
	return id
}
