package payments

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// --- pure authority helpers -------------------------------------------------

func TestScopeToKind(t *testing.T) {
	cases := []struct {
		scope  RefundScope
		reason string
		want   RefundKind
	}{
		{ScopeFull, "PLATFORM_ERROR", RefundFull},
		{ScopePartialItems, "ITEM_MISSING", RefundPartialItems},
		{ScopePartialAmount, "GOODWILL", RefundGoodwill},
		{ScopePartialAmount, "PLATFORM_ERROR", RefundFeesOnly},
	}
	for _, c := range cases {
		if got := scopeToKind(c.scope, c.reason); got != c.want {
			t.Errorf("scopeToKind(%s,%s) = %s, want %s", c.scope, c.reason, got, c.want)
		}
	}
}

func TestOperatorCap(t *testing.T) {
	if cap, unc := operatorCap([]string{"SUPPORT_AGENT"}); unc || cap != CapSupportAgentCents {
		t.Fatalf("support agent cap = %d uncapped=%v", cap, unc)
	}
	if cap, unc := operatorCap([]string{"ADMIN"}); unc || cap != CapAdminCents {
		t.Fatalf("admin cap = %d uncapped=%v", cap, unc)
	}
	if _, unc := operatorCap([]string{"SUPER_ADMIN"}); !unc {
		t.Fatal("super admin must be uncapped")
	}
	// Highest role wins when several are held.
	if cap, _ := operatorCap([]string{"SUPPORT_AGENT", "ADMIN"}); cap != CapAdminCents {
		t.Fatalf("multi-role cap = %d, want admin cap %d", cap, CapAdminCents)
	}
}

func TestRequiresApproval(t *testing.T) {
	cases := []struct {
		name      string
		kind      RefundKind
		amount    int64
		issued24h int64
		cap       int64
		uncapped  bool
		want      bool
	}{
		{"small goodwill under threshold, uncapped", RefundGoodwill, 1000, 0, 0, true, false},
		{"goodwill over threshold, uncapped still escalates", RefundGoodwill, GoodwillApprovalThresholdCents + 1, 0, 0, true, true},
		{"goodwill over threshold, capped", RefundGoodwill, GoodwillApprovalThresholdCents + 1, 0, CapAdminCents, false, true},
		{"computed refund within cap", RefundFull, 4000, 0, CapSupportAgentCents, false, false},
		{"computed refund tips over cap with prior window", RefundFull, 5000, CapSupportAgentCents - 100, CapSupportAgentCents, false, true},
		{"computed refund exactly at cap does not escalate", RefundFull, 100, CapSupportAgentCents - 100, CapSupportAgentCents, false, false},
		{"uncapped computed refund never escalates", RefundFull, 999999, 999999, 0, true, false},
	}
	for _, c := range cases {
		if got := requiresApproval(c.kind, c.amount, c.issued24h, c.cap, c.uncapped); got != c.want {
			t.Errorf("%s: requiresApproval = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestEscalationRole(t *testing.T) {
	if got := escalationRole([]string{"SUPPORT_AGENT"}, 0); got != "ADMIN" {
		t.Fatalf("support agent escalates to %s, want ADMIN", got)
	}
	if got := escalationRole([]string{"ADMIN"}, 0); got != "SUPER_ADMIN" {
		t.Fatalf("admin escalates to %s, want SUPER_ADMIN", got)
	}
	// Past an admin's age limit, nobody below a super admin may approve it.
	if got := escalationRole([]string{"SUPPORT_AGENT"}, MaxOrderAgeAdmin+time.Hour); got != "SUPER_ADMIN" {
		t.Fatalf("support agent on an order past 90 days escalates to %s, want SUPER_ADMIN", got)
	}
}

// The per-order and order-age limits (docs/spec/05-admin.md, "A-33 — Refund
// issuance and authority limits", #364).
func TestOrderLimitExceeded(t *testing.T) {
	agent, admin, super := operatorOrderLimits([]string{"SUPPORT_AGENT"}),
		operatorOrderLimits([]string{"ADMIN", "SUPPORT_AGENT"}), operatorOrderLimits([]string{"SUPER_ADMIN"})
	day := 24 * time.Hour
	cases := []struct {
		name             string
		limits           orderLimits
		amount, approved int64
		age              time.Duration
		want             string
	}{
		{"agent at the per-order limit", agent, PerOrderCapSupportAgentCents, 0, day, ""},
		{"agent a cent over it", agent, PerOrderCapSupportAgentCents + 1, 0, day, limitPerOrder},
		{"agent splitting one refund in two", agent, 1500, 1500, day, limitPerOrder},
		{"agent on the last day", agent, 100, 0, MaxOrderAgeSupportAgent, ""},
		{"agent past 14 days", agent, 100, 0, MaxOrderAgeSupportAgent + time.Minute, limitOrderAge},
		{"admin refunds a whole order", admin, 200000, 0, 30 * day, ""},
		{"admin past 90 days", admin, 100, 0, MaxOrderAgeAdmin + time.Minute, limitOrderAge},
		{"super admin has neither limit", super, 500000, 500000, 400 * day, ""},
	}
	for _, c := range cases {
		if got := orderLimitExceeded(c.limits, c.amount, c.approved, c.age); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

// --- G-3 amount_cents allowlist (validation runs before any DB call) --------

func issueRefundRecorder(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	// A nil repo is safe: every case here fails validation *before* the service
	// (and therefore the repo) is touched. The principal is read only after
	// validation, so the default anonymous principal on the request is fine.
	svc := NewService(nil, &mockStripe{}, config.Stripe{}, nil)
	h := NewHandler(svc, &config.Config{Env: config.EnvProduction})
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/refunds", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.IssueRefund(rec, req)
	return rec
}

func decodeCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("response not JSON: %v (%s)", err, rec.Body.String())
	}
	return env.Error.Code
}

func TestIssueRefund_AmountOnlyForGoodwill(t *testing.T) {
	// amount_cents with a non-goodwill scope is UNKNOWN_FIELD (G-3).
	rec := issueRefundRecorder(t, `{"order_id":"2e24b9a3-5c76-42e3-aaf9-18534b201ae9","scope":"FULL","reason_code":"PLATFORM_ERROR","reason_text":"issued in error","amount_cents":500}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if code := decodeCode(t, rec); code != string(CodeUnknownField) {
		t.Fatalf("code = %q, want UNKNOWN_FIELD", code)
	}
}

func TestIssueRefund_ReasonTextLength(t *testing.T) {
	rec := issueRefundRecorder(t, `{"order_id":"2e24b9a3-5c76-42e3-aaf9-18534b201ae9","scope":"FULL","reason_code":"PLATFORM_ERROR","reason_text":"short"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	if code := decodeCode(t, rec); code != string(httpx.CodeValidationFailed) {
		t.Fatalf("code = %q, want VALIDATION_FAILED", code)
	}
}

func TestIssueRefund_GoodwillRequiresAmount(t *testing.T) {
	rec := issueRefundRecorder(t, `{"order_id":"2e24b9a3-5c76-42e3-aaf9-18534b201ae9","scope":"PARTIAL_AMOUNT","reason_code":"GOODWILL","reason_text":"retention gesture"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}

func TestIssueRefund_UnknownBodyFieldRejected(t *testing.T) {
	// DisallowUnknownFields: a smuggled price-shaped field is rejected outright.
	rec := issueRefundRecorder(t, `{"order_id":"x","scope":"FULL","reason_code":"PLATFORM_ERROR","reason_text":"issued in error","price_cents":999}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}

func TestIssueRefund_MissingRequiredFields(t *testing.T) {
	rec := issueRefundRecorder(t, `{"scope":"FULL","reason_code":"PLATFORM_ERROR","reason_text":"issued in error"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}
