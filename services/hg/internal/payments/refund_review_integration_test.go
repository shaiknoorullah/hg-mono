package payments

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Staff review refund requests and keep evidence on chargebacks (#172). These
// run the refund sender against the real database and a Stripe stub, as
// refund_sender_integration_test.go does, so "nothing reaches Stripe" is what
// Stripe would have seen. Each ends with the ledger summing to zero. Skips
// without HG_TEST_POSTGRES_DSN (see testPool).

// fakeRiver stands in for River's insert: the notification row (the in-app
// inbox, the system of record) is real; the delivery job is not needed here.
type fakeRiver struct{}

func (fakeRiver) InsertTx(context.Context, pgx.Tx, river.JobArgs, *river.InsertOpts) (*rivertype.JobInsertResult, error) {
	return &rivertype.JobInsertResult{Job: &rivertype.JobRow{}}, nil
}

func newReviewHarness(t *testing.T) *refundHarness {
	h := newRefundHarness(t)
	h.svc.WithOutbox(notify.NewEnqueuer(notify.NewRepo(), fakeRiver{}))
	return h
}

func (h *refundHarness) customerOf(order string) string {
	h.t.Helper()
	return h.text(`SELECT account_id::text FROM "order" WHERE id = $1`, order)
}

func (h *refundHarness) request(order string) AdminRefundDTO {
	h.t.Helper()
	r, err := h.svc.RequestRefund(context.Background(), RefundInput{OrderID: order, Kind: RefundFull,
		ReasonCode: "ORDER_NEVER_ARRIVED", Note: "The order never came."}, h.customerOf(order))
	if err != nil || r.State != string(RefundRequested) {
		h.t.Fatalf("customer request: %+v err=%v; want REQUESTED", r, err)
	}
	d, err := getAdminRefund(context.Background(), h.pool, r.ID)
	if err != nil {
		h.t.Fatalf("read the request: %v", err)
	}
	return d
}

// requestFees is a customer's request for the delivery fee back (CAD 4.19),
// inside a support agent's per-order limit.
func (h *refundHarness) requestFees(order string) AdminRefundDTO {
	h.t.Helper()
	r, err := h.svc.RequestRefund(context.Background(), RefundInput{OrderID: order, Kind: RefundFeesOnly,
		ReasonCode: "LATE_DELIVERY"}, h.customerOf(order))
	if err != nil || r.State != string(RefundRequested) {
		h.t.Fatalf("customer request: %+v err=%v; want REQUESTED", r, err)
	}
	d, err := getAdminRefund(context.Background(), h.pool, r.ID)
	if err != nil {
		h.t.Fatalf("read the request: %v", err)
	}
	return d
}

func (h *refundHarness) audits(subject, action string) int {
	h.t.Helper()
	return h.count(`SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = $2 AND reason IS NOT NULL`, subject, action)
}

// A support agent approves a customer's request within their limits, and it
// is sent. One above them is not approved and not rejected: it
// goes up to an admin, the agent who sent it up cannot approve it, another
// agent cannot either, and only once an admin approves it is it sent. Each
// approval is audited with its reason, and a retried click replays the first
// answer rather than approving twice.
func TestRefundReview_SupportApprovesWithinItsLimitAndOverItNeedsASecondPerson(t *testing.T) {
	h := newReviewHarness(t)
	ctx := context.Background()
	small, smallPI := h.capturedOrder("review-small", 3000)  // its CAD 4.19 fee is within the agent's limits
	large, largePI := h.capturedOrder("review-large", 25000) // CAD 259.19, above the agent's CAD 25 per order and CAD 150 a day
	agent, otherAgent, admin := h.staff("review-agent"), h.staff("review-agent-2"), h.staff("review-admin")
	reason := RefundDecisionInput{ReasonText: "the rider's trace shows no drop-off"}

	within := h.requestFees(small)
	_, err := h.svc.ApproveRefund(ctx, within.ID, Staff{AccountID: agent, Roles: []string{"SUPPORT_AGENT"}}, reason, nil)
	wantDomainErr(t, err, string(codeMFARequired))
	out, err := h.svc.ApproveRefund(ctx, within.ID, staffAs(agent, "SUPPORT_AGENT"), reason, nil)
	if err != nil || out.Status != 200 || out.Data.(AdminRefundDTO).State != string(RefundAuthorised) {
		t.Fatalf("approve within the limit: %+v err=%v; want 200 AUTHORISED", out, err)
	}
	if got := out.Data.(AdminRefundDTO); got.ApprovedBy == nil || *got.ApprovedBy != agent || got.RequesterKind != "CUSTOMER" {
		t.Errorf("approved refund: %+v; want approved by the agent, asked for by the customer", got)
	}
	if h.audits(within.ID, "refund.approve") != 1 {
		t.Errorf("want one audited approval with its reason")
	}

	over := h.request(large)
	out, err = h.svc.ApproveRefund(ctx, over.ID, staffAs(agent, "SUPPORT_AGENT"), reason, nil)
	sentUp := out.Data.(AdminRefundDTO)
	if err != nil || out.Status != 202 || sentUp.State != string(RefundPendingApproval) ||
		*sentUp.ApprovalRequiredRole != "ADMIN" || *sentUp.EscalatedBy != agent {
		t.Fatalf("approve above the limit: %+v err=%v; want 202 PENDING_APPROVAL for an ADMIN, sent up by the agent", out, err)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = $1`, over.ID); n != 0 {
		t.Fatalf("%d ledger batches for a refund sent up, want 0", n)
	}
	h.pass()
	if n := len(h.stub.refundsFor(largePI)); n != 0 {
		t.Fatalf("Stripe got %d refunds for a request waiting for a second person, want 0", n)
	}

	_, err = h.svc.ApproveRefund(ctx, over.ID, staffAs(agent, "SUPPORT_AGENT", "ADMIN"), reason, nil)
	wantDomainErr(t, err, string(CodeSelfApprovalForbidden))
	_, err = h.svc.ApproveRefund(ctx, over.ID, staffAs(otherAgent, "SUPPORT_AGENT"), reason, nil)
	wantDomainErr(t, err, "FORBIDDEN")

	key := &Idempotency{AccountID: admin, Method: "POST", PathTemplate: "/v1/admin/refunds/{refundId}/approve",
		Key: "approve-" + h.run, RequestHash: []byte("the same request")}
	first, err := h.svc.ApproveRefund(ctx, over.ID, staffAs(admin, "ADMIN"), reason, key)
	if err != nil || first.Status != 200 || first.Data.(AdminRefundDTO).State != string(RefundAuthorised) {
		t.Fatalf("admin approval: %+v err=%v; want 200 AUTHORISED", first, err)
	}
	again, err := h.svc.ApproveRefund(ctx, over.ID, staffAs(admin, "ADMIN"), reason, key)
	want, _ := json.Marshal(map[string]any{"data": first.Data})
	if err != nil || !again.Replayed || again.Status != 200 || string(again.Body) != string(want) {
		t.Fatalf("retried approval: %+v err=%v; want the first answer replayed", again, err)
	}
	key.RequestHash = []byte("a different request")
	_, err = h.svc.ApproveRefund(ctx, over.ID, staffAs(admin, "ADMIN"), reason, key)
	wantDomainErr(t, err, "IDEMPOTENCY_KEY_REUSE")
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = $1`, over.ID); n != 1 {
		t.Errorf("%d ledger batches after one approval and its replay, want 1", n)
	}
	var approvers []string
	if err := h.pool.QueryRow(ctx, `SELECT after->'approver_ids' FROM audit_event WHERE subject_id = $1 AND action = 'refund.approve'`,
		over.ID).Scan(&approvers); err != nil || len(approvers) != 2 || approvers[0] != agent || approvers[1] != admin {
		t.Errorf("audited approvers: %v err=%v; want the agent who sent it up, then the admin", approvers, err)
	}

	// The first refund went with the earlier pass; this one sends the second.
	if p := h.pass(); p.Submitted != 1 {
		t.Fatalf("sender pass: %+v; want the admin-approved refund sent", p)
	}
	if len(h.stub.refundsFor(smallPI)) != 1 || len(h.stub.refundsFor(largePI)) != 1 {
		t.Errorf("Stripe got %d and %d refunds, want one each",
			len(h.stub.refundsFor(smallPI)), len(h.stub.refundsFor(largePI)))
	}
	h.assertLedgerZeroSum(small, large)
}

// Nobody approves their own refund: not the customer who asked (a member of
// staff ordering for themselves), and not the person who sent a request up,
// which the schema refuses too.
func TestRefundReview_TheRequesterCannotApproveTheirOwn(t *testing.T) {
	h := newReviewHarness(t)
	ctx := context.Background()
	order, _ := h.capturedOrder("own", 3000)
	request := h.request(order)

	_, err := h.svc.ApproveRefund(ctx, request.ID, staffAs(h.customerOf(order), "SUPPORT_AGENT"),
		RefundDecisionInput{ReasonText: "approving my own order's refund"}, nil)
	wantDomainErr(t, err, string(CodeSelfApprovalForbidden))
	if got := h.refundState(request.ID); got != string(RefundRequested) {
		t.Fatalf("after a self-approval: %s, want REQUESTED", got)
	}

	admin := h.staff("own-admin")
	other, _ := h.capturedOrder("own-goodwill", 8000) // CAD 89.19
	goodwill := int64(6000)
	_, approval, escalated, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: other, Scope: ScopePartialAmount,
		ReasonCode: "GOODWILL", ReasonText: "a second late order this week", AmountCents: &goodwill}, admin, "ADMIN")
	if err != nil || !escalated {
		t.Fatalf("goodwill above CAD 50: %+v err=%v; want an approval request", approval, err)
	}
	_, err = approveAs(ctx, h.svc, approval.ID, admin, "ADMIN", "SUPER_ADMIN")
	wantDomainErr(t, err, string(CodeSelfApprovalForbidden))

	// The schema refuses it as well: whoever sent a refund up never approves it.
	_, err = h.pool.Exec(ctx, `UPDATE refund SET approved_by = escalated_by, approved_at = now() WHERE id = $1`, approval.ID)
	if err == nil || !strings.Contains(err.Error(), "refund_second_person") {
		t.Fatalf("approving with the person who sent it up: err=%v; want refund_second_person", err)
	}
	h.assertLedgerZeroSum(order, other)
}

// A declined request sends nothing to Stripe and posts nothing to the ledger.
// The customer is told, in the decline's transaction, what staff chose to tell
// them, never the internal reason; the decline is audited and final.
func TestRefundReview_ADeclinedRequestSendsNothingToStripe(t *testing.T) {
	h := newReviewHarness(t)
	ctx := context.Background()
	order, pi := h.capturedOrder("decline", 3000)
	agent := h.staff("decline-agent")
	request := h.request(order)
	message := "Our records show the order was handed to you at the door."

	out, err := h.svc.DeclineRefund(ctx, request.ID, staffAs(agent, "SUPPORT_AGENT"), RefundDeclineInput{
		ReasonText: "internal: photo proof of delivery and signature", CustomerMessage: &message}, nil)
	declined, _ := out.Data.(AdminRefundDTO)
	if err != nil || declined.State != string(RefundDeclined) || *declined.DeclinedBy != agent || declined.DecisionReason == nil {
		t.Fatalf("decline: %+v err=%v; want DECLINED by the agent with a reason", out, err)
	}
	h.pass()
	if n := len(h.stub.refundsFor(pi)); n != 0 {
		t.Fatalf("Stripe got %d refunds for a declined request, want 0", n)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = $1`, request.ID); n != 0 {
		t.Fatalf("%d ledger batches for a declined request, want 0", n)
	}
	body := h.text(`SELECT body FROM notification WHERE account_id = $1 AND kind = 'REFUND_DECLINED'`, h.customerOf(order))
	if !strings.Contains(body, message) || strings.Contains(body, "internal") {
		t.Errorf("the customer was told %q; want the customer message and not the staff reason", body)
	}
	if h.audits(request.ID, "refund.decline") != 1 {
		t.Errorf("want one audited decline with its reason")
	}
	_, err = approveAs(ctx, h.svc, request.ID, agent, "SUPPORT_AGENT")
	wantDomainErr(t, err, codeAlreadyDecided)
	h.assertLedgerZeroSum(order)
}

// A chargeback Stripe reports is listed with its evidence deadline, takes
// audited evidence notes while open and none once closed, and shows in the
// order's money timeline after the payment and the refund.
func TestChargebacks_EvidenceNotesAndTheMoneyTimeline(t *testing.T) {
	h := newReviewHarness(t)
	ctx := context.Background()
	order, pi := h.capturedOrder("chargeback", 3000)
	agent := h.staff("chargeback-agent")
	dispute := h.id("dp_review")
	t.Cleanup(func() {
		_, _ = h.pool.Exec(ctx, `DELETE FROM chargeback_evidence_note WHERE chargeback_id IN
			(SELECT id FROM chargeback WHERE stripe_dispute_id = $1)`, dispute)
		_, _ = h.pool.Exec(ctx, `DELETE FROM chargeback WHERE stripe_dispute_id = $1`, dispute)
		_, _ = h.pool.Exec(ctx, `DELETE FROM reconciliation_exception WHERE stripe_object_id = $1`, dispute)
	})
	request := h.request(order)
	// A whole order is above a support agent's per-order limit; an admin approves it.
	if _, err := approveAs(ctx, h.svc, request.ID, agent, "ADMIN"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	due := time.Now().Add(5 * 24 * time.Hour).Truncate(time.Second).UTC()
	dp := func(status string) map[string]any {
		return map[string]any{"id": dispute, "object": "dispute", "amount": 3919, "currency": "cad",
			"payment_intent": pi, "reason": "product_not_received", "status": status,
			"evidence_details": map[string]any{"due_by": due.Unix()}}
	}
	h.send(h.id("evt_dp_review_open"), "charge.dispute.created", time.Now().Add(-time.Minute), dp("needs_response"))
	h.process()

	open := true
	list, _, err := h.svc.ListChargebacks(ctx, staffAs(agent, "SUPPORT_AGENT"), ChargebackFilter{Open: &open, OrderID: order})
	if err != nil || len(list) != 1 || list[0].Status != "NEEDS_RESPONSE" || list[0].EvidenceDueAt == nil {
		t.Fatalf("open chargebacks: %+v err=%v; want one needing a response, with its deadline", list, err)
	}
	cb := list[0]
	out, err := h.svc.AddChargebackEvidenceNote(ctx, staffAs(agent, "SUPPORT_AGENT"), cb.ID,
		ChargebackNoteInput{Body: "Proof of delivery photo at 19:42, signed by the customer."}, nil)
	if err != nil || out.Status != 201 || len(out.Data.(ChargebackDTO).EvidenceNotes) != 1 {
		t.Fatalf("evidence note: %+v err=%v; want the chargeback with one note", out, err)
	}
	if n := h.count(`SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = 'chargeback.evidence_note'`, cb.ID); n != 1 {
		t.Errorf("%d audited notes, want 1", n)
	}

	history, err := OrderMoneyHistory(ctx, h.pool, order)
	if err != nil {
		t.Fatalf("money history: %v", err)
	}
	var kinds []string
	for _, e := range history.Timeline {
		kinds = append(kinds, e.Kind)
	}
	want := []string{"PAYMENT_AUTHORISED", "PAYMENT_CAPTURED", "REFUND_REQUESTED", "REFUND_APPROVED", "CHARGEBACK_OPENED", "CHARGEBACK_EVIDENCE_NOTE"}
	if strings.Join(kinds, ",") != strings.Join(want, ",") || len(history.Chargebacks) != 1 {
		t.Errorf("money timeline %v with %d chargebacks; want %v with 1", kinds, len(history.Chargebacks), want)
	}

	h.send(h.id("evt_dp_review_lost"), "charge.dispute.closed", time.Now(), dp("lost"))
	h.process()
	_, err = h.svc.AddChargebackEvidenceNote(ctx, staffAs(agent, "SUPPORT_AGENT"), cb.ID,
		ChargebackNoteInput{Body: "A note after Stripe closed the dispute."}, nil)
	wantDomainErr(t, err, codeAlreadyDecided)
}
