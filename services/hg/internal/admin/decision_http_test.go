package admin

// The application decisions end to end through the HTTP handler, the real role
// matrix and the database: issue #163
// (https://github.com/shaiknoorullah/hg-mono/issues/163). The contract used to
// require a document rejection reason on every rider decision, so an admin could
// not approve a rider honestly. Each decision now has its own body shape
// (RiderDecisionInput / RestaurantDecisionInput in contracts/openapi.yaml): an
// approval carries an approval reason, and a rejection or a request for changes
// carries a rejection reason.
//
// Rules pinned here, from the admin spec:
//   - rider onboarding review and approval:
//     https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-23--rider-onboarding-review-and-approval
//   - restaurant approval or rejection:
//     https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-18--restaurant-approval--rejection-decision

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// decisionServer serves the admin routes as principal. A non-zero now pins the
// handler's clock, which is what the age rule is computed against.
func decisionServer(t *testing.T, pool *pgxpool.Pool, principal httpx.Principal, now time.Time) *httptest.Server {
	t.Helper()
	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: fixedPrincipalAuth{principal},
		Authorizer:    auth.Matrix{},
	})
	h := NewHandler(NewRepo(pool), DefaultConfig())
	if !now.IsZero() {
		h.now = func() time.Time { return now }
	}
	Routes(router, h)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

// postDecision sends one decision body with a fresh Idempotency-Key.
func postDecision(t *testing.T, srv *httptest.Server, path string, body map[string]any) *http.Response {
	t.Helper()
	key := fmt.Sprintf("decision-http-test-%d", time.Now().UnixNano())
	return doJSON(t, http.MethodPost, srv.URL+path, body, map[string]string{"Idempotency-Key": key})
}

// validationField returns the error code and the first field named in a 422.
func validationField(t *testing.T, resp *http.Response) (code, field string) {
	t.Helper()
	body := decodeBody(t, resp)
	errObj, _ := body["error"].(map[string]any)
	code, _ = errObj["code"].(string)
	if details, ok := errObj["details"].([]any); ok && len(details) > 0 {
		if first, ok := details[0].(map[string]any); ok {
			field, _ = first["field"].(string)
		}
	}
	return code, field
}

// riderUndecided fails the test unless the rider application is still waiting
// for a decision: no decision recorded, still in review, no audit row.
func riderUndecided(t *testing.T, pool *pgxpool.Pool, riderID string) {
	t.Helper()
	ctx := context.Background()
	var decided bool
	var state string
	if err := pool.QueryRow(ctx, `
SELECT ra.decided_at IS NOT NULL, rp.onboarding_state::text
  FROM rider_application ra JOIN rider_profile rp ON rp.account_id = ra.account_id
 WHERE ra.account_id = $1`, riderID).Scan(&decided, &state); err != nil {
		t.Fatalf("read rider application: %v", err)
	}
	if decided || state != "DOCUMENTS_REVIEW" {
		t.Fatalf("rider application changed: decided=%v onboarding_state=%s, want undecided and DOCUMENTS_REVIEW", decided, state)
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_event WHERE subject_type='RIDER' AND subject_id=$1`, riderID).Scan(&audits); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if audits != 0 {
		t.Fatalf("an undecided rider application has %d audit rows, want 0", audits)
	}
}

// restaurantUndecided is riderUndecided for a restaurant application.
func restaurantUndecided(t *testing.T, pool *pgxpool.Pool, restaurantID string) {
	t.Helper()
	var decided bool
	var state string
	if err := pool.QueryRow(context.Background(), `
SELECT ra.decided_at IS NOT NULL, r.onboarding_state::text
  FROM restaurant_application ra JOIN restaurant r ON r.id = ra.restaurant_id
 WHERE ra.restaurant_id = $1`, restaurantID).Scan(&decided, &state); err != nil {
		t.Fatalf("read restaurant application: %v", err)
	}
	if decided || state != "DOCUMENTS_REVIEW" {
		t.Fatalf("restaurant application changed: decided=%v onboarding_state=%s, want undecided and DOCUMENTS_REVIEW", decided, state)
	}
}

// An admin approves a rider with an approval reason: the rider moves to
// PAYOUT_PENDING (not straight to dispatchable), the approval is attributed to
// the signed-in admin, no rejection reason is stored, and exactly one audit row
// carries the approval reason. A second decision is ALREADY_DECIDED.
func TestDecideRiderApplicationHTTP_AdminApproves(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	riderID := seedRiderApplication(t, ctx, pool, sa, 25)
	admin := principalFor(t, pool, httpx.RoleAdmin)
	srv := decisionServer(t, pool, admin, time.Time{})
	path := "/v1/admin/rider-applications/" + riderID + "/decision"

	resp := postDecision(t, srv, path, map[string]any{
		"decision":    "APPROVE",
		"reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Welcome to HalalGoes. Set up payouts to start delivering.",
	})
	if resp.StatusCode != http.StatusOK {
		code, field := validationField(t, resp)
		t.Fatalf("approve: status %d (%s %s), want 200", resp.StatusCode, code, field)
	}
	assertConformant(t, resp)
	body := decodeBody(t, resp)
	data, _ := body["data"].(map[string]any)
	if got := data["onboarding_state"]; got != "PAYOUT_PENDING" {
		t.Fatalf("response onboarding_state = %v, want PAYOUT_PENDING", got)
	}

	var state, approvedBy string
	if err := pool.QueryRow(ctx, `SELECT onboarding_state::text, coalesce(approved_by::text, '') FROM rider_profile WHERE account_id=$1`, riderID).Scan(&state, &approvedBy); err != nil {
		t.Fatalf("read rider profile: %v", err)
	}
	if state != "PAYOUT_PENDING" || approvedBy != admin.AccountID {
		t.Fatalf("rider profile: onboarding_state=%s approved_by=%s, want PAYOUT_PENDING by %s", state, approvedBy, admin.AccountID)
	}
	var rejectCode *string
	var decidedBy string
	if err := pool.QueryRow(ctx, `SELECT reject_reason_code::text, decided_by::text FROM rider_application WHERE account_id=$1`, riderID).Scan(&rejectCode, &decidedBy); err != nil {
		t.Fatalf("read rider application: %v", err)
	}
	if rejectCode != nil {
		t.Fatalf("an approval stored a rejection reason %q", *rejectCode)
	}
	if decidedBy != admin.AccountID {
		t.Fatalf("decided_by = %s, want the signed-in admin %s", decidedBy, admin.AccountID)
	}
	var audits int
	var auditCode, auditActor string
	if err := pool.QueryRow(ctx, `
SELECT count(*) OVER (), coalesce(reason_code, ''), coalesce(actor_account_id::text, '')
  FROM audit_event WHERE action='rider.approve' AND subject_type='RIDER' AND subject_id=$1`, riderID).Scan(&audits, &auditCode, &auditActor); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if audits != 1 || auditCode != "ALL_CHECKS_PASSED" || auditActor != admin.AccountID {
		t.Fatalf("audit: %d rows, reason_code=%q, actor=%s; want 1 row, ALL_CHECKS_PASSED, %s", audits, auditCode, auditActor, admin.AccountID)
	}

	again := postDecision(t, srv, path, map[string]any{
		"decision":    "REJECT",
		"reason_code": "ILLEGIBLE",
		"reason_text": "Please upload a clearer photo of your ID.",
	})
	if code, _ := validationField(t, again); again.StatusCode != http.StatusConflict || code != "ALREADY_DECIDED" {
		t.Fatalf("second decision: %d %s, want 409 ALREADY_DECIDED", again.StatusCode, code)
	}
}

// A decision whose reason is missing, or does not fit the decision, is a 422
// and changes nothing. Approving with a rejection reason (the workaround the
// admin console used before issue #163) is refused too.
func TestDecideRiderApplicationHTTP_ReasonRules(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	riderID := seedRiderApplication(t, ctx, pool, sa, 25)
	srv := decisionServer(t, pool, principalFor(t, pool, httpx.RoleAdmin), time.Time{})
	path := "/v1/admin/rider-applications/" + riderID + "/decision"

	cases := []struct {
		name      string
		body      map[string]any
		wantField string
	}{
		{"reject without a reason code", map[string]any{
			"decision": "REJECT", "reason_text": "Please upload a clearer photo of your ID.",
		}, "reason_code"},
		{"reject without a reason text", map[string]any{
			"decision": "REJECT", "reason_code": "ILLEGIBLE",
		}, "reason_text"},
		{"request changes without a reason code", map[string]any{
			"decision": "REQUEST_CHANGES", "reason_text": "Please upload a clearer photo of your ID.",
			"documents_to_redo": []string{"GOVERNMENT_ID"},
		}, "reason_code"},
		{"request changes naming no documents", map[string]any{
			"decision": "REQUEST_CHANGES", "reason_code": "ILLEGIBLE",
			"reason_text": "Please upload a clearer photo of your ID.",
		}, "documents_to_redo"},
		{"request changes naming a restaurant document", map[string]any{
			"decision": "REQUEST_CHANGES", "reason_code": "ILLEGIBLE",
			"reason_text":       "Please upload a clearer photo of your ID.",
			"documents_to_redo": []string{"HALAL_CERTIFICATE"},
		}, "documents_to_redo"},
		{"reject naming documents to redo", map[string]any{
			"decision": "REJECT", "reason_code": "ILLEGIBLE",
			"reason_text":       "Please upload a clearer photo of your ID.",
			"documents_to_redo": []string{"GOVERNMENT_ID"},
		}, "documents_to_redo"},
		{"approve with a rejection reason", map[string]any{
			"decision": "APPROVE", "reason_code": "OTHER", "reason_text": "Approved on review.",
		}, "reason_code"},
		{"approve without a reason code", map[string]any{
			"decision": "APPROVE", "reason_text": "Welcome to HalalGoes.",
		}, "reason_code"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := postDecision(t, srv, path, tc.body)
			code, field := validationField(t, resp)
			if resp.StatusCode != http.StatusUnprocessableEntity || code != "VALIDATION_FAILED" || field != tc.wantField {
				t.Fatalf("got %d %s on %q, want 422 VALIDATION_FAILED on %q", resp.StatusCode, code, field, tc.wantField)
			}
			riderUndecided(t, pool, riderID)
		})
	}
}

// A support agent may guide a rider and re-open a remediable rejection, but may
// never approve: the role matrix refuses the route before the handler runs.
func TestDecideRiderApplicationHTTP_SupportAgentCannotApprove(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	riderID := seedRiderApplication(t, ctx, pool, sa, 25)
	srv := decisionServer(t, pool, principalFor(t, pool, httpx.RoleSupportAgent), time.Time{})

	resp := postDecision(t, srv, "/v1/admin/rider-applications/"+riderID+"/decision", map[string]any{
		"decision":    "APPROVE",
		"reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Welcome to HalalGoes. Set up payouts to start delivering.",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("support agent approve: status %d, want 403", resp.StatusCode)
	}
	riderUndecided(t, pool, riderID)
}

// A rider under 18 cannot be approved, and nothing overrides it. The database
// refuses to store an under-18 rider at all, so the rider is seeded at exactly
// 18 today and the handler's clock is set 30 days back, when they were 17.
func TestDecideRiderApplicationHTTP_Under18CannotBeApproved(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	riderID := seedRiderApplication(t, ctx, pool, sa, 18)
	srv := decisionServer(t, pool, principalFor(t, pool, httpx.RoleSuperAdmin), time.Now().UTC().AddDate(0, 0, -30))

	resp := postDecision(t, srv, "/v1/admin/rider-applications/"+riderID+"/decision", map[string]any{
		"decision":    "APPROVE",
		"reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Welcome to HalalGoes. Set up payouts to start delivering.",
	})
	if code, _ := validationField(t, resp); resp.StatusCode != http.StatusUnprocessableEntity || code != "AGE_REQUIREMENT_NOT_MET" {
		t.Fatalf("under-18 approve: %d %s, want 422 AGE_REQUIREMENT_NOT_MET", resp.StatusCode, code)
	}
	riderUndecided(t, pool, riderID)
}

// The restaurant decision has the same shape: an admin approves with an
// approval reason (to PAYOUT_PENDING, never straight to live) and the approval
// is audited with that reason.
func TestDecideRestaurantApplicationHTTP_AdminApproves(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	restaurantID := seedRestaurantApplication(t, ctx, pool, sa, true)
	admin := principalFor(t, pool, httpx.RoleAdmin)
	srv := decisionServer(t, pool, admin, time.Time{})

	resp := postDecision(t, srv, "/v1/admin/restaurant-applications/"+restaurantID+"/decision", map[string]any{
		"decision":      "APPROVE",
		"reason_code":   "ALL_CHECKS_PASSED",
		"reason_text":   "Every document and the halal certificate checked out.",
		"internal_note": "Certificate number confirmed with the certifier by phone.",
	})
	if resp.StatusCode != http.StatusOK {
		code, field := validationField(t, resp)
		t.Fatalf("approve: status %d (%s %s), want 200", resp.StatusCode, code, field)
	}
	assertConformant(t, resp)
	body := decodeBody(t, resp)
	data, _ := body["data"].(map[string]any)
	if got := data["onboarding_state"]; got != "PAYOUT_PENDING" {
		t.Fatalf("response onboarding_state = %v, want PAYOUT_PENDING", got)
	}
	var auditCode string
	if err := pool.QueryRow(ctx, `
SELECT coalesce(reason_code, '') FROM audit_event
 WHERE action='restaurant.approve' AND subject_type='RESTAURANT' AND subject_id=$1`, restaurantID).Scan(&auditCode); err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if auditCode != "ALL_CHECKS_PASSED" {
		t.Fatalf("audit reason_code = %q, want ALL_CHECKS_PASSED", auditCode)
	}
}

// The restaurant decision's reason rules: a missing reason, a reason that does
// not fit the decision, or a request for changes naming no documents is a 422
// that changes nothing.
func TestDecideRestaurantApplicationHTTP_ReasonRules(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	restaurantID := seedRestaurantApplication(t, ctx, pool, sa, true)
	srv := decisionServer(t, pool, principalFor(t, pool, httpx.RoleAdmin), time.Time{})
	path := "/v1/admin/restaurant-applications/" + restaurantID + "/decision"

	cases := []struct {
		name      string
		body      map[string]any
		wantField string
	}{
		{"reject without a reason code", map[string]any{
			"decision": "REJECT", "reason_text": "The business licence has expired.",
		}, "reason_code"},
		{"reject with an approval reason", map[string]any{
			"decision": "REJECT", "reason_code": "ALL_CHECKS_PASSED",
			"reason_text": "The business licence has expired.",
		}, "reason_code"},
		{"approve with a rejection reason", map[string]any{
			"decision": "APPROVE", "reason_code": "HALAL_CERTIFICATION_INVALID",
			"reason_text": "Every document checked out.",
		}, "reason_code"},
		{"request changes naming no documents", map[string]any{
			"decision": "REQUEST_CHANGES", "reason_code": "DOCUMENTS_INSUFFICIENT",
			"reason_text": "The business licence has expired.",
		}, "documents_to_redo"},
		{"request changes naming a document twice", map[string]any{
			"decision": "REQUEST_CHANGES", "reason_code": "DOCUMENTS_INSUFFICIENT",
			"reason_text":       "The business licence has expired.",
			"documents_to_redo": []string{"BUSINESS_LICENCE", "BUSINESS_LICENCE"},
		}, "documents_to_redo"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := postDecision(t, srv, path, tc.body)
			code, field := validationField(t, resp)
			if resp.StatusCode != http.StatusUnprocessableEntity || code != "VALIDATION_FAILED" || field != tc.wantField {
				t.Fatalf("got %d %s on %q, want 422 VALIDATION_FAILED on %q", resp.StatusCode, code, field, tc.wantField)
			}
			restaurantUndecided(t, pool, restaurantID)
		})
	}
}

// A support agent cannot approve a restaurant either.
func TestDecideRestaurantApplicationHTTP_SupportAgentCannotApprove(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()
	sa := seedSuperAdmin(t, ctx, pool)
	restaurantID := seedRestaurantApplication(t, ctx, pool, sa, true)
	srv := decisionServer(t, pool, principalFor(t, pool, httpx.RoleSupportAgent), time.Time{})

	resp := postDecision(t, srv, "/v1/admin/restaurant-applications/"+restaurantID+"/decision", map[string]any{
		"decision":    "APPROVE",
		"reason_code": "ALL_CHECKS_PASSED",
		"reason_text": "Every document and the halal certificate checked out.",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("support agent approve: status %d, want 403", resp.StatusCode)
	}
	restaurantUndecided(t, pool, restaurantID)
}
