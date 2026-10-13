package payments

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime/realtimetest"
)

// The refund and payout-account events reach their channels in the
// transaction that makes the change (issue #376; contracts/websocket.md
// sections 4.3 and 4.6), once each however often Stripe repeats itself, and
// each holds to the schema GET /v1/realtime/schema serves.

// TestRealtime_RefundCreatedSettledAndFailed: a refund that is recorded and
// then succeeds sends refund.created and refund.settled; one that fails sends
// refund.failed with HalalGoes's own words, never Stripe's.
func TestRealtime_RefundCreatedSettledAndFailed(t *testing.T) {
	h := newRefundHarness(t)
	ctx := context.Background()
	admin := h.staff("admin-rt")
	refundEvents := func(order string) []realtime.StoredEvent {
		return realtimetest.Events(t, h.pool, realtime.OrderChannel(order), "refund.created", "refund.settled", "refund.failed")
	}

	order, pi := h.capturedOrder("rt_ok", 3000)
	refund, _, _, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: order, Scope: ScopeFull,
		ReasonCode: "PLATFORM_ERROR", ReasonText: "the platform charged for a broken order"}, admin, "ADMIN")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	got := refundEvents(order)
	if !slices.Equal(realtimetest.Types(got), []string{"refund.created"}) {
		t.Fatalf("after the refund was recorded: %v, want [refund.created]", realtimetest.Types(got))
	}
	var created struct {
		RefundID    string `json:"refund_id"`
		AmountCents int64  `json:"amount_cents"`
		State       string `json:"state"`
		ReasonCode  string `json:"reason_code"`
	}
	if err := json.Unmarshal(got[0].Payload, &created); err != nil {
		t.Fatal(err)
	}
	if created.RefundID != refund.ID || created.AmountCents != 3919 || created.State != "AUTHORISED" || created.ReasonCode != "PLATFORM_ERROR" {
		t.Fatalf("refund.created = %+v, want refund %s, 3919, AUTHORISED, PLATFORM_ERROR", created, refund.ID)
	}

	h.pass()
	stripeID := "re_" + h.stub.prefix + "_1"
	succeeded := map[string]any{"id": stripeID, "object": "refund", "amount": 3919, "currency": "cad",
		"status": "succeeded", "payment_intent": pi, "metadata": map[string]any{"refund_id": refund.ID}}
	h.send(h.id("evt_rt_ok"), "refund.updated", time.Now(), succeeded)
	h.send(h.id("evt_rt_ok_again"), "refund.updated", time.Now(), succeeded)
	h.process()
	if got := realtimetest.Types(refundEvents(order)); !slices.Equal(got, []string{"refund.created", "refund.settled"}) {
		t.Fatalf("after Stripe said succeeded, twice: %v, want [refund.created refund.settled]", got)
	}

	failedOrder, failedPI := h.capturedOrder("rt_fail", 3000)
	failing, _, _, err := issueAs(ctx, h.svc, AdminRefundInput{OrderID: failedOrder, Scope: ScopeFull,
		ReasonCode: "PLATFORM_ERROR", ReasonText: "the platform charged for a broken order"}, admin, "ADMIN")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	h.pass()
	h.send(h.id("evt_rt_fail"), "refund.updated", time.Now(), map[string]any{"id": "re_" + h.stub.prefix + "_2",
		"object": "refund", "amount": 3919, "currency": "cad", "status": "failed", "failure_reason": "expired_or_canceled_card",
		"payment_intent": failedPI, "metadata": map[string]any{"refund_id": failing.ID}})
	h.process()
	got = refundEvents(failedOrder)
	if !slices.Equal(realtimetest.Types(got), []string{"refund.created", "refund.failed"}) {
		t.Fatalf("after Stripe said failed: %v, want [refund.created refund.failed]", realtimetest.Types(got))
	}
	var failed struct{ Message string }
	if err := json.Unmarshal(got[1].Payload, &failed); err != nil {
		t.Fatal(err)
	}
	if failed.Message != refundFailedMessage {
		t.Errorf("refund.failed says %q, want HalalGoes's own words", failed.Message)
	}
}

// TestRealtime_ConnectRequirementsAndRiderActivation: Stripe asking a rider
// for something, and then turning their payouts on, reaches the rider's own
// account channel as connect.requirements_changed, and the payouts turning on
// moves an approved rider to ACTIVE with onboarding.state_changed. A snapshot
// that changes nothing, or an older one arriving late, sends nothing.
func TestRealtime_ConnectRequirementsAndRiderActivation(t *testing.T) {
	h := newWebhookHarness(t)
	acct := h.id("acct_rt")
	rider := h.seedRider(acct, false)
	if _, err := h.pool.Exec(context.Background(), `
		INSERT INTO account (id, email, status) VALUES ($1, $2, 'ACTIVE')`, rider, "rider-"+h.run+"@test.local"); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if _, err := h.pool.Exec(context.Background(), `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, approved_at)
		VALUES ($1, 'Omar', 'K', '1990-01-01', 'PAYOUT_PENDING', now())`, rider); err != nil {
		t.Fatalf("seed rider: %v", err)
	}
	t0 := time.Now().Add(-10 * time.Minute)
	account := func(payouts bool, due []string) map[string]any {
		return map[string]any{"id": acct, "object": "account", "charges_enabled": false, "payouts_enabled": payouts,
			"details_submitted": payouts, "requirements": map[string]any{"currently_due": due}}
	}
	channel := realtime.AccountChannel(rider)

	h.sendFrom(acct, h.id("evt_rt_due"), "account.updated", t0.Add(time.Minute), account(false, []string{"external_account"}))
	h.process()
	h.sendFrom(acct, h.id("evt_rt_due_same"), "account.updated", t0.Add(2*time.Minute), account(false, []string{"external_account"}))
	h.process()
	if got := realtimetest.Types(realtimetest.Events(t, h.pool, channel)); !slices.Equal(got, []string{"connect.requirements_changed"}) {
		t.Fatalf("after Stripe asked for a bank account, twice: %v, want one connect.requirements_changed", got)
	}

	h.sendFrom(acct, h.id("evt_rt_on"), "account.updated", t0.Add(3*time.Minute), account(true, []string{}))
	h.process()
	h.sendFrom(acct, h.id("evt_rt_stale"), "account.updated", t0.Add(90*time.Second), account(false, []string{"external_account"}))
	h.process()
	events := realtimetest.Events(t, h.pool, channel)
	if got := realtimetest.Types(events); !slices.Equal(got, []string{"connect.requirements_changed",
		"connect.requirements_changed", "onboarding.state_changed"}) {
		t.Fatalf("after payouts turned on, and a stale snapshot: %v", got)
	}
	var req struct {
		CurrentlyDue   []string `json:"currently_due"`
		PayoutsEnabled bool     `json:"payouts_enabled"`
	}
	if err := json.Unmarshal(events[1].Payload, &req); err != nil {
		t.Fatal(err)
	}
	if !req.PayoutsEnabled || len(req.CurrentlyDue) != 0 {
		t.Errorf("connect.requirements_changed = %+v, want payouts on and nothing due", req)
	}
	var moved struct {
		SubjectType string  `json:"subject_type"`
		From        *string `json:"from"`
		To          string  `json:"to"`
	}
	if err := json.Unmarshal(events[2].Payload, &moved); err != nil {
		t.Fatal(err)
	}
	if moved.SubjectType != "RIDER" || moved.From == nil || *moved.From != "PAYOUT_PENDING" || moved.To != "ACTIVE" {
		t.Errorf("onboarding.state_changed = %+v, want RIDER PAYOUT_PENDING -> ACTIVE", moved)
	}
}
