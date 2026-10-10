package payments

import (
	"context"
	"testing"
	"time"
)

// The per-order and order-age limits on what a member of staff may refund
// alone (docs/spec/05-admin.md, "A-33 — Refund issuance and authority
// limits", #364). A refund past either is sent up for a second person, as one
// past the 24-hour limit is, never approved and never rejected. Skips without
// HG_TEST_POSTGRES_DSN (see testPool).

// deliveredAgo backdates an order's delivery, and its placing before it.
func (h *refundHarness) deliveredAgo(order string, d time.Duration) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `
		UPDATE "order" SET placed_at = now() - $2::interval - interval '1 hour', delivered_at = now() - $2::interval
		 WHERE id = $1`, order, d.String()); err != nil {
		h.t.Fatalf("backdate the order: %v", err)
	}
}

// feesOnly is a staff refund of an order's delivery fee (CAD 4.19 on a
// capturedOrder): well inside every per-order and 24-hour limit.
func feesOnly(order string) AdminRefundInput {
	return AdminRefundInput{OrderID: order, Scope: ScopePartialAmount, ReasonCode: "LATE_DELIVERY",
		ReasonText: "the rider was forty minutes late"}
}

func TestRefundAuthority_AboveTheAgentsPerOrderLimitIsSentUp(t *testing.T) {
	h := newReviewHarness(t)
	ctx := context.Background()
	agent, admin := h.staff("limit-agent"), h.staff("limit-admin")

	// CAD 39.19 is inside the agent's 24-hour limit but above CAD 25 per order.
	whole, _ := h.capturedOrder("limit-whole", 3000)
	_, approval, escalated, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: whole, Scope: ScopeFull,
		ReasonCode: "ORDER_NEVER_ARRIVED", ReasonText: "the rider's trace shows no drop-off"}, agent, "SUPPORT_AGENT")
	if err != nil || !escalated || approval.RequiredRole != "ADMIN" {
		t.Fatalf("agent's CAD 39.19 refund: %+v escalated=%t err=%v; want sent up to an ADMIN", approval, escalated, err)
	}
	if got := h.text(`SELECT after->>'limit_exceeded' FROM audit_event WHERE subject_id = $1 AND action = 'refund.escalate'`,
		approval.ID); got != "per_order" {
		t.Errorf("audited limit: %q, want per_order", got)
	}
	if _, err := approveAs(ctx, h.svc, approval.ID, admin, "ADMIN"); err != nil {
		t.Fatalf("an admin may refund up to the order total: %v", err)
	}

	// Within the limit: approved at once.
	small, _ := h.capturedOrder("limit-small", 3000)
	refund, _, escalated, err := issueAs(ctx, h.svc, feesOnly(small), agent, "SUPPORT_AGENT")
	if err != nil || escalated || refund.State != string(RefundAuthorised) {
		t.Fatalf("agent's CAD 4.19 refund: %+v escalated=%t err=%v; want AUTHORISED", refund, escalated, err)
	}

	// A customer's request reviewed by an agent is held to the same limit.
	asked, _ := h.capturedOrder("limit-asked", 3000)
	request := h.request(asked)
	out, err := h.svc.ApproveRefund(ctx, request.ID, staffAs(agent, "SUPPORT_AGENT"),
		RefundDecisionInput{ReasonText: "the rider's trace shows no drop-off"}, nil)
	if err != nil || out.Status != 202 || *out.Data.(AdminRefundDTO).ApprovalRequiredRole != "ADMIN" {
		t.Fatalf("agent approving a CAD 39.19 request: %+v err=%v; want 202 for an ADMIN", out, err)
	}
	h.assertLedgerZeroSum(whole, small, asked)
}

func TestRefundAuthority_AnOrderPastTheAgeLimitIsSentUp(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	agent, admin, super := h.staff("age-agent"), h.staff("age-admin"), h.staff("age-super")
	day := 24 * time.Hour

	recent, _ := h.capturedOrder("age-13d", 3000)
	h.deliveredAgo(recent, 13*day)
	if _, _, escalated, err := issueAs(ctx, h.svc, feesOnly(recent), agent, "SUPPORT_AGENT"); err != nil || escalated {
		t.Fatalf("agent, order delivered 13 days ago: escalated=%t err=%v; want approved", escalated, err)
	}

	fortnight, _ := h.capturedOrder("age-15d", 3000)
	h.deliveredAgo(fortnight, 15*day)
	_, approval, escalated, err := issueAs(ctx, h.svc, feesOnly(fortnight), agent, "SUPPORT_AGENT")
	if err != nil || !escalated || approval.RequiredRole != "ADMIN" {
		t.Fatalf("agent, order delivered 15 days ago: %+v escalated=%t err=%v; want sent up to an ADMIN", approval, escalated, err)
	}
	if got := h.text(`SELECT after->>'limit_exceeded' FROM audit_event WHERE subject_id = $1 AND action = 'refund.escalate'`,
		approval.ID); got != "order_age" {
		t.Errorf("audited limit: %q, want order_age", got)
	}
	if _, err := approveAs(ctx, h.svc, approval.ID, admin, "ADMIN"); err != nil {
		t.Fatalf("an admin may refund an order up to 90 days old: %v", err)
	}

	// Past the admin's 90 days too: only a super admin decides it, whoever asks.
	old, _ := h.capturedOrder("age-91d", 3000)
	h.deliveredAgo(old, 91*day)
	_, approval, escalated, err = issueAs(ctx, h.svc, feesOnly(old), agent, "SUPPORT_AGENT")
	if err != nil || !escalated || approval.RequiredRole != "SUPER_ADMIN" {
		t.Fatalf("agent, order delivered 91 days ago: %+v escalated=%t err=%v; want sent up to a SUPER_ADMIN", approval, escalated, err)
	}
	_, err = approveAs(ctx, h.svc, approval.ID, admin, "ADMIN")
	wantDomainErr(t, err, "FORBIDDEN")
	if _, err := approveAs(ctx, h.svc, approval.ID, super, "SUPER_ADMIN"); err != nil {
		t.Fatalf("a super admin has no age limit: %v", err)
	}
	older, _ := h.capturedOrder("age-91d-admin", 3000)
	h.deliveredAgo(older, 91*day)
	_, approval, escalated, err = issueAs(ctx, h.svc, feesOnly(older), admin, "ADMIN")
	if err != nil || !escalated || approval.RequiredRole != "SUPER_ADMIN" {
		t.Fatalf("admin, order delivered 91 days ago: %+v escalated=%t err=%v; want sent up to a SUPER_ADMIN", approval, escalated, err)
	}
	h.assertLedgerZeroSum(recent, fortnight, old, older)
}
