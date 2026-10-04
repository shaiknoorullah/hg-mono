package conformance

// Conformance for the admin payout-run operations (issue #251):
// createPayoutRun, getPayoutRun and listPayoutRuns, against the payments
// harness. The run is queued but never executed — executing one pays partners
// out of the shared database — so the test appends one line to it, the way
// the payout worker does, to give getPayoutRun a PayoutRunDetail with a line
// to validate.

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestConformance_PayoutRuns(t *testing.T) {
	pool := openPool(t)
	h := newPaymentsHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })
	seedRiderEarningAndPayout(t, pool)

	// createPayoutRun for one rider: 202 with the queued PayoutRun.
	rq := Request{Method: "POST", Path: "/v1/admin/payout-runs",
		AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("conf-payout-run-%d", time.Now().UnixNano()),
		Body:    map[string]any{"payee": map[string]any{"type": "RIDER", "id": fxRiderID}}}
	req := h.Build(t, rq)
	if _, verr := ValidateRequest(t, h.Spec, req); verr != nil {
		t.Fatalf("createPayoutRun body is not contract-valid (fix the test, not the server): %v", verr)
	}
	_, resp := h.Do(t, rq)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("createPayoutRun status = %d, want 202", resp.StatusCode)
	}
	runID, _ := dataObject(t, resp)["id"].(string)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM payout_run_line WHERE run_id = $1`, runID)
		_, _ = pool.Exec(ctx, `DELETE FROM payout_run WHERE id = $1`, runID)
	})
	if _, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
		t.Errorf("CONFORMANCE FAIL (createPayoutRun): %v", err)
	} else {
		h.MarkCovered("createPayoutRun")
	}

	// One line, as the worker writes them.
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO payout_run_line (run_id, attempt, payee_type, payee_id, outcome, payout_id, amount_cents, detail)
		VALUES ($1, 1, 'RIDER', $2, 'HELD', $3, 0, 'Stripe has payouts turned off for this partner: payouts_disabled')`,
		runID, fxRiderID, fxPayPayoutID); err != nil {
		t.Fatalf("seed payout run line: %v", err)
	}

	h.CheckResponse(t, Request{Method: "GET", Path: "/v1/admin/payout-runs/" + runID,
		AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200)
	h.CheckResponse(t, Request{Method: "GET", Path: "/v1/admin/payout-runs",
		AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200)
}
