package payments

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

// Approved refunds reach Stripe, once, and nothing else does (#318). Each
// test runs the refund sender against the real database and the live Stripe
// client pointed at a stub (stripe_stub_test.go): no call reaches Stripe.
// Every test ends by checking that the ledger still sums to zero: each batch,
// each of its orders, and the ledger as a whole. Skips without
// HG_TEST_POSTGRES_DSN (see testPool).

type refundHarness struct {
	*webhookHarness
	stub   *stripeStub
	sender *RefundSender
}

func newRefundHarness(t *testing.T) *refundHarness {
	t.Helper()
	h := newWebhookHarness(t)
	stub := newStripeStub(t, "rs_"+h.run)
	// The webhook route still verifies with the test secret; every Stripe
	// call goes to the stub.
	h.svc.stripe = stub.client()
	return &refundHarness{webhookHarness: h, stub: stub, sender: NewRefundSender(h.svc)}
}

// capturedOrder adds a delivered order whose card was charged subtotal plus
// CAD 9.19 (a CAD 4.19 delivery fee and a CAD 5.00 tip), captured through the
// payment_intent.succeeded webhook as in production, so its CAPTURE batch is
// posted. Stripe's stub knows the capture.
func (h *refundHarness) capturedOrder(name string, subtotal int64) (orderID, pi string) {
	h.t.Helper()
	pi = h.id("pi_" + name)
	orderID = seedOrderWithIntent(h.t, h.pool, pi, "COMPLETED", "REQUIRES_CAPTURE")
	// The seed is a CAD 30.00 subtotal; the order, its quote and its
	// authorisation grow together, since the schema holds them equal.
	for _, sql := range []string{
		`UPDATE quote SET subtotal_cents = subtotal_cents + $2, total_cents = total_cents + $2
		  WHERE id = (SELECT quote_id FROM "order" WHERE id = $1)`,
		`UPDATE "order" SET subtotal_cents = subtotal_cents + $2, total_cents = total_cents + $2,
		                    restaurant_net_cents = restaurant_net_cents + $2
		  WHERE id = $1`,
		`UPDATE payment_intent SET amount_authorized_cents = amount_authorized_cents + $2 WHERE order_id = $1`,
	} {
		if _, err := h.pool.Exec(context.Background(), sql, orderID, subtotal-3000); err != nil {
			h.t.Fatalf("size the order: %v", err)
		}
	}
	total := subtotal + 919
	h.send(h.id("evt_cap_"+name), "payment_intent.succeeded", time.Now().Add(-time.Hour),
		map[string]any{"id": pi, "object": "payment_intent", "status": "succeeded", "amount": total, "amount_received": total})
	h.process()
	if got := h.count(`SELECT amount_captured_cents FROM payment_intent WHERE stripe_payment_intent_id = $1`, pi); int64(got) != total {
		h.t.Fatalf("seeded capture is %d cents, want %d", got, total)
	}
	h.stub.capture(pi, total)
	return orderID, pi
}

// staff adds an account to stand for a member of staff; the roles a caller
// holds are passed to the service, as the router does.
func (h *refundHarness) staff(name string) string {
	h.t.Helper()
	return h.text(`INSERT INTO account (email, status) VALUES ($1, 'ACTIVE') RETURNING id::text`,
		name+"-"+h.run+"@staff.test.local")
}

// pass runs one sender pass and fails the test if it could not run.
func (h *refundHarness) pass() RefundPass {
	h.t.Helper()
	p, ran, err := h.sender.RunOnce(context.Background())
	if err != nil || !ran {
		h.t.Fatalf("refund sender pass: ran=%t err=%v", ran, err)
	}
	return p
}

// due makes a refund's next attempt due now, instead of after its backoff.
func (h *refundHarness) due(refundID string) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE refund SET deadline_at = now() WHERE id = $1`, refundID); err != nil {
		h.t.Fatalf("make the refund due: %v", err)
	}
}

func (h *refundHarness) refundState(id string) string {
	h.t.Helper()
	return h.text(`SELECT state::text FROM refund WHERE id = $1`, id)
}

func wantDomainErr(t *testing.T, err error, code string) {
	t.Helper()
	var de *DomainError
	if !errors.As(err, &de) || de.Code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

// An approved refund is sent once, keyed by its row, however many senders try
// and however often: two senders at once make one call, and a retry after
// Stripe's answer was lost gets that answer back rather than a second refund.
// The refund webhook then finalises it. The live client carries the secret
// key; the package-level call it used before sent none.
func TestRefundSender_AnApprovedRefundIsSentOnceThenFinalisedByItsWebhook(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	order, pi := h.capturedOrder("once", 3000)
	admin := h.staff("admin-once")

	refund, _, escalated, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopeFull,
		ReasonCode: "PLATFORM_ERROR", ReasonText: "the platform charged for a broken order"}, admin, "ADMIN")
	if err != nil || escalated || refund.State != string(RefundAuthorised) || refund.AmountCents != 3919 {
		t.Fatalf("issue: %+v escalated=%t err=%v; want an AUTHORISED refund of 3919", refund, escalated, err)
	}

	// Stripe makes the refund, and its answer is lost on the way back. Two
	// senders reach the row at the same moment: one claims it, one skips it.
	h.stub.dropAfterCreate = 1
	outcomes := make([]sendOutcome, 2)
	var wg sync.WaitGroup
	for i, owner := range []string{"sender-a", "sender-b"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcomes[i] = h.svc.sendRefund(ctx, refund.ID, owner)
		}()
	}
	wg.Wait()
	slices.Sort(outcomes)
	if !slices.Equal(outcomes, []sendOutcome{sendSkipped, sendRetrying}) {
		t.Fatalf("two senders at once: outcomes %v, want one skipped and one retrying", outcomes)
	}
	if got := h.text(`SELECT state::text || '/' || attempts || '/' || (deadline_at > now() + interval '50 seconds')::text
		FROM refund WHERE id = $1`, refund.ID); got != "AUTHORISED/1/true" {
		t.Fatalf("after the lost answer: %s, want AUTHORISED/1/true (retried after a minute)", got)
	}

	// The retry, from two whole senders racing for the lease.
	h.due(refund.ID)
	var passes [2]RefundPass
	for i, s := range []*RefundSender{h.sender, NewRefundSender(h.svc)} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			passes[i], _, _ = s.RunOnce(ctx)
		}()
	}
	wg.Wait()
	if passes[0].Submitted+passes[1].Submitted != 1 {
		t.Fatalf("retry passes %+v, want one submission between them", passes)
	}

	calls := h.stub.refundsFor(pi)
	if len(calls) != 2 {
		t.Fatalf("Stripe received %d refund requests, want 2 (the lost one and its retry): %+v", len(calls), calls)
	}
	for _, c := range calls {
		if c.Key != "rf:"+refund.ID || c.RefundID != refund.ID || c.Amount != 3919 || c.Reason != "requested_by_customer" {
			t.Errorf("refund request %+v; want key rf:<refund id>, metadata.refund_id, 3919 cents", c)
		}
	}
	if h.stub.created != 1 || !h.stub.authorised {
		t.Fatalf("Stripe made %d refunds (authorised=%t), want exactly 1 with the secret key", h.stub.created, h.stub.authorised)
	}
	stripeID := "re_" + h.stub.prefix + "_1"
	if got := h.text(`SELECT state::text || '/' || coalesce(stripe_refund_id, '-') || '/' || attempts || '/' || deadline_action
		FROM refund WHERE id = $1`, refund.ID); got != "SUBMITTED/"+stripeID+"/2/await_refund_settlement" {
		t.Fatalf("after the retry: %s, want SUBMITTED/%s/2/await_refund_settlement", got, stripeID)
	}

	// Stripe's refund.updated finalises it through the webhook worker.
	h.send(h.id("evt_re_once"), "refund.updated", time.Now(), map[string]any{"id": stripeID, "object": "refund",
		"amount": 3919, "currency": "cad", "status": "succeeded", "payment_intent": pi,
		"metadata": map[string]any{"refund_id": refund.ID}})
	h.process()
	if got := h.refundState(refund.ID); got != "SUCCEEDED" {
		t.Errorf("after refund.updated: %s, want SUCCEEDED", got)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = $1`, refund.ID); n != 1 {
		t.Errorf("%d REFUND batches for the refund, want 1", n)
	}
	if n := h.count(`SELECT count(*) FROM audit_event WHERE subject_id = $1 AND action = 'payment.refund_submitted'`, refund.ID); n != 1 {
		t.Errorf("%d audit rows for the submission, want 1", n)
	}
	h.pass()
	if n := len(h.stub.refundsFor(pi)); n != 2 {
		t.Errorf("a pass after it was sent made %d requests in all, want still 2", n)
	}
	h.assertLedgerZeroSum(order)
}

// A goodwill refund above CAD 50 waits for a second person, and nothing about
// it reaches Stripe until then (the goodwill approval decision); a
// customer's own request waits for staff review and is never sent. The person
// who asked cannot approve, nor can someone without the role it was escalated
// to. Once an admin approves, its REFUND batch is posted and it is sent.
func TestRefundSender_AnOverLimitRefundIsNotSentUntilASecondPersonApprovesIt(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	order, pi := h.capturedOrder("approve", 8000) // CAD 89.19 captured
	agent, otherAgent, admin := h.staff("agent"), h.staff("agent-2"), h.staff("admin")

	goodwill := int64(6000)
	_, approval, escalated, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopePartialAmount,
		ReasonCode: "GOODWILL", ReasonText: "a long wait on a cold evening", AmountCents: &goodwill}, agent, "SUPPORT_AGENT")
	if err != nil || !escalated || approval.RequiredRole != "ADMIN" || approval.Status != "PENDING" {
		t.Fatalf("issue: %+v escalated=%t err=%v; want an approval request for an ADMIN", approval, escalated, err)
	}
	refundID := approval.ID
	customer := h.text(`SELECT account_id::text FROM "order" WHERE id = $1`, order)
	request, err := h.svc.RequestRefund(ctx, RefundInput{OrderID: order, Kind: RefundFeesOnly, ReasonCode: "LATE_DELIVERY"}, customer)
	if err != nil || request.State != string(RefundRequested) || request.AmountCents != 419 {
		t.Fatalf("customer request: %+v err=%v; want REQUESTED for 419", request, err)
	}

	h.pass()
	if n := len(h.stub.refundsFor(pi)); n != 0 {
		t.Fatalf("Stripe received %d refund requests before anyone approved, want 0", n)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = ANY($1)`, []string{refundID, request.ID}); n != 0 {
		t.Fatalf("%d REFUND batches before approval, want 0", n)
	}

	_, err = approveAs(ctx, h.svc, refundID, agent, "SUPPORT_AGENT", "ADMIN")
	wantDomainErr(t, err, string(CodeSelfApprovalForbidden))
	_, err = approveAs(ctx, h.svc, refundID, otherAgent, "SUPPORT_AGENT")
	wantDomainErr(t, err, "FORBIDDEN")
	if got := h.refundState(refundID); got != "PENDING_APPROVAL" {
		t.Fatalf("after refused approvals: %s, want PENDING_APPROVAL", got)
	}

	approved, err := approveAs(ctx, h.svc, refundID, admin, "ADMIN")
	if err != nil || approved.State != string(RefundAuthorised) {
		t.Fatalf("approve: %+v err=%v; want AUTHORISED", approved, err)
	}
	if got := h.text(`SELECT approved_by::text FROM refund WHERE id = $1`, refundID); got != admin {
		t.Errorf("approved_by = %s, want the admin %s", got, admin)
	}
	if n := h.count(`SELECT count(*) FROM ledger_batch WHERE refund_id = $1 AND kind = 'REFUND'`, refundID); n != 1 {
		t.Errorf("%d REFUND batches after approval, want 1", n)
	}
	_, err = approveAs(ctx, h.svc, refundID, admin, "ADMIN")
	wantDomainErr(t, err, codeAlreadyDecided)

	if p := h.pass(); p.Submitted < 1 {
		t.Fatalf("pass after approval: %+v, want the approved refund submitted", p)
	}
	calls := h.stub.refundsFor(pi)
	if len(calls) != 1 || calls[0].Key != "rf:"+refundID || calls[0].Amount != goodwill {
		t.Fatalf("Stripe received %+v, want one request for 6000 keyed rf:<refund id>", calls)
	}
	if got := h.refundState(refundID); got != "SUBMITTED" {
		t.Errorf("approved refund: %s, want SUBMITTED", got)
	}
	if got := h.refundState(request.ID); got != "REQUESTED" {
		t.Errorf("the customer's request: %s, want still REQUESTED", got)
	}
	h.assertLedgerZeroSum(order)
}

// A refund never exceeds what is left of the capture: a second refund that
// would is refused when it is asked for, and an approved one that would,
// because Stripe has since refunded part of the charge outside this system,
// is refused by the sender without calling Stripe, FAILED and paged.
func TestRefundSender_ARefundAboveWhatIsLeftOfTheCaptureIsRefused(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	order, pi := h.capturedOrder("ceiling", 3000) // CAD 39.19 captured
	admin, admin2 := h.staff("admin-ceiling"), h.staff("admin-ceiling-2")

	first := int64(3000)
	refund, _, _, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopePartialAmount,
		ReasonCode: "GOODWILL", ReasonText: "most of the order arrived cold", AmountCents: &first}, admin, "ADMIN")
	if err != nil || refund.State != string(RefundAuthorised) {
		t.Fatalf("first refund: %+v err=%v", refund, err)
	}
	second := int64(1000)
	_, _, _, err = issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopePartialAmount,
		ReasonCode: "GOODWILL", ReasonText: "and the drinks were missing", AmountCents: &second}, admin2, "ADMIN")
	wantDomainErr(t, err, string(CodeRefundExceedsCaptured))
	if n := h.count(`SELECT count(*) FROM refund WHERE order_id = $1`, order); n != 1 {
		t.Fatalf("%d refunds on the order, want only the first", n)
	}

	// Someone refunds CAD 10 in Stripe's dashboard before the first is sent;
	// charge.refunded records Stripe's refunded total.
	h.send(h.id("evt_ch_ceiling"), "charge.refunded", time.Now(), map[string]any{"id": h.id("ch_ceiling"),
		"object": "charge", "payment_intent": pi, "amount_refunded": 1000, "currency": "cad"})
	h.process()
	if n := h.count(`SELECT amount_refunded_cents FROM payment_intent WHERE stripe_payment_intent_id = $1`, pi); n != 1000 {
		t.Fatalf("Stripe's refunded total recorded as %d, want 1000", n)
	}

	if p := h.pass(); p.Failed < 1 {
		t.Fatalf("pass: %+v, want the refund refused", p)
	}
	if n := len(h.stub.refundsFor(pi)); n != 0 {
		t.Fatalf("Stripe received %d refund requests, want 0: 3000 is more than the 2919 left", n)
	}
	if got := h.text(`SELECT state::text || '/' || deadline_action FROM refund WHERE id = $1`, refund.ID); got != "FAILED/review_failed_refund" {
		t.Errorf("refused refund: %s, want FAILED/review_failed_refund", got)
	}
	exc := h.text(`SELECT id::text FROM reconciliation_exception WHERE kind = 'refund_failed' AND stripe_object_id = $1
		AND resolved_at IS NULL`, "rf:"+refund.ID)
	if got := h.opsAlerts(exc); !slices.Equal(got, []string{"refund_failed"}) {
		t.Errorf("ops alerts about the refused refund: %v, want one refund_failed", got)
	}
	h.assertLedgerZeroSum(order)
}

// A payment that was authorised and never captured is voided, never
// refunded: asking for a refund of it is refused with no refund row, the
// cancel path voids the authorisation (PaymentIntent.cancel), and no refund
// request ever reaches Stripe for it.
func TestRefund_AnUncapturedOrderIsVoidedNotRefunded(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	pi := h.id("pi_uncaptured")
	order := seedOrderWithIntent(t, h.pool, pi, "RESTAURANT_PENDING", "REQUIRES_CAPTURE")
	customer := h.text(`SELECT account_id::text FROM "order" WHERE id = $1`, order)
	admin := h.staff("admin-void")

	_, err := h.svc.RequestRefund(ctx, RefundInput{OrderID: order, Kind: RefundFull, ReasonCode: "CUSTOMER_CHANGED_MIND"}, customer)
	wantDomainErr(t, err, string(CodePaymentNotRefundable))
	_, _, _, err = issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopeFull,
		ReasonCode: "RESTAURANT_REJECTED", ReasonText: "the restaurant could not make it"}, admin, "SUPER_ADMIN")
	wantDomainErr(t, err, string(CodePaymentNotRefundable))

	// What a rejection or a cancel before acceptance calls.
	if _, err := h.svc.Void(ctx, order); err != nil {
		t.Fatalf("void: %v", err)
	}
	h.pass()
	if got := h.stub.cancelsFor(pi); len(got) != 1 || got[0].Key != "void:"+order {
		t.Errorf("Stripe received cancels %+v, want one keyed void:<order id>", got)
	}
	if n := len(h.stub.refundsFor(pi)); n != 0 {
		t.Errorf("Stripe received %d refund requests for an uncaptured payment, want 0", n)
	}
	if got := intentState(t, h.pool, pi); got != "CANCELED" {
		t.Errorf("payment is %s, want CANCELED", got)
	}
	if n := h.count(`SELECT count(*) FROM refund WHERE order_id = $1`, order) +
		h.count(`SELECT count(*) FROM ledger_batch WHERE order_id = $1`, order); n != 0 {
		t.Errorf("%d refund rows and ledger batches for a voided order, want none", n)
	}
}

// A refund Stripe cannot be reached for is retried after 1 m, 2 m, 4 m …,
// keyed the same each time, and the eighth failure sets it aside and pages
// on-call; it stays AUTHORISED, its money still counted against the capture.
// One Stripe refuses outright is FAILED at once and paged.
func TestRefundSender_RetriesWithBackoffThenSetsAsideAndARefusedRefundFails(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	outageOrder, outagePI := h.capturedOrder("outage", 3000)
	refusedOrder, refusedPI := h.capturedOrder("refused", 3000)
	admin := h.staff("admin-retry")
	issue := func(order string) string {
		t.Helper()
		amount := int64(2500)
		r, _, _, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopePartialAmount,
			ReasonCode: "GOODWILL", ReasonText: "goodwill for a late delivery", AmountCents: &amount}, admin, "SUPER_ADMIN")
		if err != nil {
			t.Fatalf("issue: %v", err)
		}
		return r.ID
	}
	h.stub.fail[outagePI] = stubError{status: 503, typ: "api_error"}
	h.stub.fail[refusedPI] = stubError{status: 400, typ: "invalid_request_error", code: "charge_disputed"}
	outage, refused := issue(outageOrder), issue(refusedOrder)

	h.pass()
	if got := h.text(`SELECT state::text || '/' || coalesce(failure_message, '') FROM refund WHERE id = $1`, refused); got != "FAILED/Stripe refused the refund: charge_disputed" {
		t.Errorf("refused refund: %s, want FAILED with Stripe's code", got)
	}
	if n := len(h.stub.refundsFor(refusedPI)); n != 1 {
		t.Errorf("the refused refund was requested %d times, want once", n)
	}
	exc := h.text(`SELECT id::text FROM reconciliation_exception WHERE kind = 'refund_failed' AND stripe_object_id = $1`, "rf:"+refused)
	if got := h.opsAlerts(exc); !slices.Equal(got, []string{"refund_failed"}) {
		t.Errorf("ops alerts about the refused refund: %v, want one refund_failed", got)
	}

	for attempt := 1; attempt <= refundMaxAttempts; attempt++ {
		if attempt > 1 {
			h.due(outage)
			h.pass()
		}
		if attempt <= 2 {
			// The next attempt waits 1 m, then 2 m.
			wait := h.count(`SELECT round(extract(epoch FROM deadline_at - now()))::int FROM refund WHERE id = $1`, outage)
			if want := 60 * attempt; wait < want-5 || wait > want {
				t.Errorf("after attempt %d the next waits %d s, want about %d", attempt, wait, want)
			}
		}
	}
	if got := h.text(`SELECT state::text || '/' || attempts || '/' || deadline_action || '/' || (last_error <> '')::text
		FROM refund WHERE id = $1`, outage); got != "AUTHORISED/8/review_unsent_refund/true" {
		t.Errorf("after eight failures: %s, want AUTHORISED/8/review_unsent_refund/true", got)
	}
	if got := h.opsAlerts(outage); !slices.Equal(got, []string{"refund_dead_letter"}) {
		t.Errorf("ops alerts about the set-aside refund: %v, want one refund_dead_letter", got)
	}
	calls := h.stub.refundsFor(outagePI)
	if len(calls) != refundMaxAttempts {
		t.Errorf("Stripe received %d requests for the unreachable refund, want %d", len(calls), refundMaxAttempts)
	}
	for _, c := range calls {
		if c.Key != "rf:"+outage {
			t.Errorf("attempt keyed %q, want rf:%s every time", c.Key, outage)
		}
	}
	h.due(outage)
	h.pass()
	if n := len(h.stub.refundsFor(outagePI)); n != refundMaxAttempts {
		t.Errorf("a set-aside refund was sent again (%d requests)", n)
	}
	h.assertLedgerZeroSum(outageOrder, refusedOrder)
}
