package devworld

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

// A second run must find its orders again: a full request still waiting is
// approved, a declined refund frees its order for the next partial request,
// and an order with a refund in flight is never picked.
func TestPlanRefundsReusesOrdersAcrossRuns(t *testing.T) {
	orders := []pastOrder{
		{ID: "o1", Code: "A", State: "COMPLETED"},
		{ID: "o2", Code: "B", State: "COMPLETED"},
		{ID: "o3", Code: "C", State: "COMPLETED"},
		{ID: "o4", Code: "D", State: "CANCELLED"},
	}
	refunds := []refundRow{
		{ID: "r1", OrderID: "o1", Kind: "FULL", State: "SUBMITTED"},
		{ID: "r2", OrderID: "o2", Kind: "PARTIAL_ITEMS", State: "DECLINED"},
		{ID: "r3", OrderID: "o3", Kind: "FULL", State: "REQUESTED"},
	}
	plan, okA, okD := planRefunds(orders, refunds)
	if !okA || !okD {
		t.Fatalf("plan incomplete: %+v", plan)
	}
	if plan.Approve.ID != "o3" || plan.ApproveRefund == nil || plan.ApproveRefund.ID != "r3" {
		t.Fatalf("approve %+v, want the waiting full request r3 on o3", plan)
	}
	if plan.Decline.ID != "o2" {
		t.Fatalf("decline %s, want o2, freed by its declined refund", plan.Decline.ID)
	}

	// After a reset: no orders, so the scenario has to drive journeys.
	if _, okA, okD := planRefunds(nil, nil); okA || okD {
		t.Fatal("an empty history must ask for journeys")
	}
	// One free order is enough to approve but not to decline as well.
	one := []pastOrder{{ID: "o9", State: "COMPLETED"}}
	if plan, okA, okD := planRefunds(one, nil); !okA || okD || plan.Approve.ID != "o9" {
		t.Fatalf("one free order: %+v %v %v", plan, okA, okD)
	}
}

func TestRefundDecisionsRefusesNonLocalAPIBeforeAnyRequest(t *testing.T) {
	rec := &countingTransport{}
	prev := http.DefaultTransport
	http.DefaultTransport = rec
	defer func() { http.DefaultTransport = prev }()

	err := RunScenario(context.Background(), "https://api.halalgoes.com", "refund-decisions")
	if err == nil || !strings.Contains(err.Error(), "refuses API host") {
		t.Fatalf("got %v, want a refusal of the API host", err)
	}
	if rec.n != 0 {
		t.Fatalf("%d request(s) sent before the refusal; want none", rec.n)
	}
}
