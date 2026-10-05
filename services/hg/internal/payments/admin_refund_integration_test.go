package payments

import (
	"context"
	"errors"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// These run against the migrated Postgres named by HG_TEST_POSTGRES_DSN and skip
// cleanly when it is unset (see integration_test.go's testPool). They exercise
// issueRefund end to end against the real deferred triggers.
//
// The shared fixture order captures CAD 43.63, which is *below* the launch
// goodwill dual-approval threshold (CAD 50.00) and far below every operator cap,
// so the 202 escalation path cannot be reached on this fixture without first
// tripping the I-18.1 capture ceiling. That path's decision is therefore covered
// exhaustively as a pure unit (TestRequiresApproval); here we cover the two DB
// paths the fixture *can* reach: an authorised refund posting a balanced batch,
// and the capture-ceiling rejection by the deferred trigger.
//
// Amounts stay small and cleanup is registered BEFORE the assertions so a failing
// assert never leaks a refund row that would poison the next run's ledger check.

func TestIntegration_IssueRefund_WithinCap_Authorises(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	repo := NewRepo(pool)
	svc := NewService(repo, &mockStripe{}, config.Stripe{}, nil)
	ctx := context.Background()

	// A small GOODWILL (CAD 10.00, under the CAD 50 dual-approval threshold) by a
	// SUPER_ADMIN (uncapped) authorises immediately with a balanced REFUND batch.
	amount := int64(1000)
	in := AdminRefundInput{
		OrderID:     fxOrderID,
		Scope:       ScopePartialAmount,
		ReasonCode:  "GOODWILL",
		ReasonText:  "small goodwill, retention gesture",
		AmountCents: &amount,
	}
	refund, approval, escalated, err := issueAs(ctx, svc, in, fxAccountID, "SUPER_ADMIN")
	if err != nil {
		t.Fatalf("IssueAdminRefund within cap: %v", err)
	}
	if refund.ID != "" {
		t.Cleanup(func() { cleanupRefund(t, pool, refund.ID) })
	}
	if escalated {
		t.Fatalf("within-cap refund must not escalate; got approval %+v", approval)
	}
	if refund.State != string(RefundAuthorised) {
		t.Fatalf("state = %s, want AUTHORISED", refund.State)
	}
	if refund.AmountCents != amount {
		t.Fatalf("amount = %d, want %d", refund.AmountCents, amount)
	}
	// The split legs must sum to the amount — that is what makes the REFUND batch
	// balance, and it committed past the deferred SUM=0 trigger.
	sum := refund.LiabilitySplit.PlatformCents + refund.LiabilitySplit.RestaurantCents + refund.LiabilitySplit.RiderCents
	if sum != refund.AmountCents {
		t.Fatalf("split legs sum to %d, want %d", sum, refund.AmountCents)
	}
}

func TestIntegration_IssueRefund_ExceedsCaptured_Rejected(t *testing.T) {
	pool := testPool(t)
	t.Cleanup(pool.Close)
	repo := NewRepo(pool)
	svc := NewService(repo, &mockStripe{}, config.Stripe{}, nil)
	ctx := context.Background()

	over := int64(fxCapturedC + 100000)
	in := AdminRefundInput{
		OrderID:     fxOrderID,
		Scope:       ScopePartialAmount,
		ReasonCode:  "GOODWILL",
		ReasonText:  "goodwill exceeding the captured amount should be refused",
		AmountCents: &over,
	}
	_, _, _, err := issueAs(ctx, svc, in, fxAccountID, "SUPER_ADMIN")
	if err == nil {
		t.Fatal("expected REFUND_EXCEEDS_CAPTURED for an over-capture goodwill refund")
	}
	var de *DomainError
	if !errors.As(err, &de) || de.Code != string(CodeRefundExceedsCaptured) {
		t.Fatalf("error = %v, want REFUND_EXCEEDS_CAPTURED", err)
	}
}
