package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

// The refund-decisions scenario (issue #679): staff approve one refund and
// decline another, so the refund states after a decision, the customer's
// refund tracking and notification, and the refund's ledger batch can be
// watched locally. It drives the API as amina and admin-seed; the ledger is
// only read, never written.
//
// Moving money needs a staff session signed in with an authenticator code,
// which admin-seed has once `make dev-reset` ran with HG_APP_DATA_KEY set.

// refundJourneys caps how many orders one run drives to completion.
const refundJourneys = 2

// refundSettleWait is how long the scenario follows an approved refund
// through the refund sender before it reports the state it has reached.
const refundSettleWait = 20 * time.Second

// allRefundStates is every RefundState in the contract, for the staff list.
const allRefundStates = "REQUESTED,PENDING_APPROVAL,APPROVED,AUTHORISED,SUBMITTED,SUCCEEDED,SETTLED,FAILED,DECLINED,CANCELLED"

type refundRow struct {
	ID          string `json:"id"`
	OrderID     string `json:"order_id"`
	Kind        string `json:"kind"`
	Scope       string `json:"scope"`
	ReasonCode  string `json:"reason_code"`
	AmountCents int64  `json:"amount_cents"`
	State       string `json:"state"`
}

type pastOrder struct {
	ID    string `json:"id"`
	Code  string `json:"code"`
	State string `json:"state"`
}

// refundPlan is what one run decides: the order whose full refund staff
// approve, and the order whose partial refund staff decline.
type refundPlan struct {
	Approve       pastOrder
	ApproveRefund *refundRow // a full refund amina already asked for, if any
	Decline       pastOrder
}

// liveRefund reports whether a refund still counts against the order's
// captured amount, as the server counts it (payments.PriorRefundedCents).
func liveRefund(state string) bool {
	switch state {
	case "DECLINED", "CANCELLED", "FAILED":
		return false
	}
	return true
}

// planRefunds picks the two orders from amina's completed orders and her
// refunds. A completed order with a full refund still waiting for staff is
// approved again; otherwise any completed order with no refund in flight
// takes a new full request. The declined partial refund needs a second
// completed order with no refund in flight; a declined refund leaves its order
// free, so a later run can use it again.
func planRefunds(orders []pastOrder, refunds []refundRow) (refundPlan, bool, bool) {
	byOrder := map[string][]refundRow{}
	for _, r := range refunds {
		byOrder[r.OrderID] = append(byOrder[r.OrderID], r)
	}
	var plan refundPlan
	var free []pastOrder
	for _, o := range orders {
		if o.State != "COMPLETED" {
			continue
		}
		live := 0
		for _, r := range byOrder[o.ID] {
			if !liveRefund(r.State) {
				continue
			}
			live++
			if plan.ApproveRefund == nil && r.State == "REQUESTED" && r.Kind == "FULL" {
				plan.Approve = o
				r := r
				plan.ApproveRefund = &r
			}
		}
		if live == 0 {
			free = append(free, o)
		}
	}
	if plan.ApproveRefund == nil && len(free) > 0 {
		plan.Approve, free = free[0], free[1:]
	}
	haveApprove := plan.Approve.ID != ""
	for _, o := range free {
		if o.ID != plan.Approve.ID {
			plan.Decline = o
			break
		}
	}
	return plan, haveApprove, plan.Decline.ID != ""
}

func scenarioRefundDecisions(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	plan, err := refundOrders(ctx, base, cust)
	if err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}

	approved, err := approveFullRefund(ctx, cust, admin, plan)
	if err != nil {
		return err
	}
	declined, err := declinePartialRefund(ctx, cust, admin, plan.Decline)
	if err != nil {
		return err
	}

	return errors.Join(
		listRefunds(ctx, cust, admin, approved, declined),
		declineNotice(ctx, cust, plan.Decline),
		printLedger(ctx, plan.Approve, plan.Decline),
	)
}

// refundOrders returns the plan, driving up to two journeys (without their
// closing refund request) until amina has the completed orders it needs.
func refundOrders(ctx context.Context, base string, cust *apiClient) (refundPlan, error) {
	for driven := 0; ; driven++ {
		orders, err := cust.pastOrders(ctx)
		if err != nil {
			return refundPlan{}, err
		}
		refunds, err := cust.refunds(ctx, "/v1/refunds?limit=100")
		if err != nil {
			return refundPlan{}, err
		}
		plan, okApprove, okDecline := planRefunds(orders, refunds)
		if okApprove && okDecline {
			fmt.Printf("orders  approve %s  decline %s\n", plan.Approve.Code, plan.Decline.Code)
			return plan, nil
		}
		if driven >= refundJourneys {
			return refundPlan{}, fmt.Errorf("devworld: amina still lacks two completed orders after %d journeys", driven)
		}
		fmt.Printf("driving a journey to a completed order (%d of at most %d)\n", driven+1, refundJourneys)
		opts := JourneyOptions{Route: "short", Speed: "max", Auto: "all", NoRefundRequest: true, EndShift: true}
		if err := RunJourney(ctx, base, opts); err != nil {
			return refundPlan{}, fmt.Errorf("devworld: refund-decisions journey: %w", err)
		}
	}
}

func approveFullRefund(ctx context.Context, cust, admin *apiClient, plan refundPlan) (refundRow, error) {
	req := plan.ApproveRefund
	if req == nil {
		r, err := cust.requestRefund(ctx, map[string]any{
			"order_id":    plan.Approve.ID,
			"kind":        "FULL",
			"reason_code": "ITEM_MISSING",
			"note":        "The karahi was missing from the bag.",
		})
		if err != nil {
			return refundRow{}, err
		}
		req = &r
		fmt.Printf("requested  %s  %s  %s  %d cents  %s\n", plan.Approve.Code, r.ID, r.Kind, r.AmountCents, r.State)
	} else {
		fmt.Printf("using request  %s  %s  %s  %d cents  %s\n", plan.Approve.Code, req.ID, req.Kind, req.AmountCents, req.State)
	}
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/refunds/"+req.ID+"/approve", map[string]any{
		"reason_text": "Dev world: the missing item is confirmed by the restaurant.",
	}, true)
	if err != nil {
		return refundRow{}, fmt.Errorf("devworld: approve refund %s: %w", req.ID, err)
	}
	var got refundRow
	_ = json.Unmarshal(data, &got)
	fmt.Printf("approved  %s  http %d  %s\n", got.ID, status, got.State)
	if status != http.StatusOK || got.State != "AUTHORISED" {
		return refundRow{}, fmt.Errorf("devworld: approval left refund %s %s (http %d), want AUTHORISED", req.ID, got.State, status)
	}
	return cust.followRefund(ctx, got)
}

func declinePartialRefund(ctx context.Context, cust, admin *apiClient, order pastOrder) (refundRow, error) {
	line, err := cust.firstLine(ctx, order.ID)
	if err != nil {
		return refundRow{}, err
	}
	r, err := cust.requestRefund(ctx, map[string]any{
		"order_id":    order.ID,
		"kind":        "PARTIAL_ITEMS",
		"reason_code": "WRONG_ITEM",
		"lines":       []any{map[string]any{"order_line_no": line, "quantity": 1}},
		"note":        "I think this was the wrong dish.",
	})
	if err != nil {
		return refundRow{}, err
	}
	fmt.Printf("requested  %s  %s  %s  %d cents  %s\n", order.Code, r.ID, r.Kind, r.AmountCents, r.State)
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/refunds/"+r.ID+"/decline", map[string]any{
		"reason_text":      "Dev world: the photo shows the dish that was ordered.",
		"customer_message": "We checked your order and the dish you received was the one you ordered.",
	}, true)
	if err != nil {
		return refundRow{}, fmt.Errorf("devworld: decline refund %s: %w", r.ID, err)
	}
	var got refundRow
	_ = json.Unmarshal(data, &got)
	fmt.Printf("declined  %s  http %d  %s\n", got.ID, status, got.State)
	if got.State != "DECLINED" {
		return refundRow{}, fmt.Errorf("devworld: decline left refund %s %s (http %d)", r.ID, got.State, status)
	}
	return got, nil
}

// followRefund reads the approved refund as the customer while the refund
// sender takes it to the payment provider, and returns the last state seen.
func (c *apiClient) followRefund(ctx context.Context, r refundRow) (refundRow, error) {
	last := r.State
	stop := time.Now().Add(refundSettleWait)
	for time.Now().Before(stop) && last != "SUCCEEDED" && last != "SETTLED" && last != "FAILED" {
		select {
		case <-ctx.Done():
			return r, ctx.Err()
		case <-time.After(2 * time.Second):
		}
		_, data, err := c.call(ctx, http.MethodGet, "/v1/refunds/"+r.ID, nil, false)
		if err != nil {
			return r, fmt.Errorf("devworld: read refund %s: %w", r.ID, err)
		}
		var got refundRow
		if jerr := json.Unmarshal(data, &got); jerr != nil {
			return r, jerr
		}
		r = got
		if r.State != last {
			fmt.Printf("refund  %s  %s\n", r.ID, r.State)
			last = r.State
		}
	}
	if r.State == "FAILED" {
		return r, fmt.Errorf("devworld: refund %s FAILED", r.ID)
	}
	return r, nil
}

// listRefunds checks that both decisions are listed for the customer and for
// staff.
func listRefunds(ctx context.Context, cust, admin *apiClient, approved, declined refundRow) error {
	mine, err := cust.refunds(ctx, "/v1/refunds?limit=100")
	if err != nil {
		return err
	}
	var errs []error
	for _, want := range []refundRow{approved, declined} {
		found := false
		for _, r := range mine {
			if r.ID == want.ID {
				found = true
				fmt.Printf("amina sees  %s  %s  %s  %d cents\n", r.ID, r.Kind, r.State, r.AmountCents)
			}
		}
		if !found {
			errs = append(errs, fmt.Errorf("devworld: GET /v1/refunds as amina does not list %s", want.ID))
		}
		// With no state the staff list is only what waits for a person.
		staffSees, err := admin.refunds(ctx, "/v1/admin/refunds?state="+allRefundStates+
			"&order_id="+url.QueryEscape(want.OrderID)+"&limit=100")
		if err != nil {
			errs = append(errs, err)
			continue
		}
		found = false
		for _, r := range staffSees {
			if r.ID == want.ID {
				found = true
				fmt.Printf("admin sees  %s  %s  %s\n", r.ID, r.Kind, r.State)
			}
		}
		if !found {
			errs = append(errs, fmt.Errorf("devworld: GET /v1/admin/refunds does not list %s", want.ID))
		}
	}
	return errors.Join(errs...)
}

// declineNotice prints the notification that told amina about the decline.
// The decline writes it in its own transaction, so it is there at once.
func declineNotice(ctx context.Context, cust *apiClient, order pastOrder) error {
	_, data, err := cust.call(ctx, http.MethodGet, "/v1/notifications?limit=50", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: notifications: %w", err)
	}
	var list []struct {
		Kind    string  `json:"kind"`
		Title   string  `json:"title"`
		OrderID *string `json:"order_id"`
	}
	if jerr := json.Unmarshal(data, &list); jerr != nil {
		return fmt.Errorf("devworld: notifications: %w", jerr)
	}
	for _, n := range list {
		if n.OrderID != nil && *n.OrderID == order.ID && n.Kind == "REFUND_DECLINED" {
			fmt.Printf("notification  %s  %q\n", n.Kind, n.Title)
			return nil
		}
	}
	return fmt.Errorf("devworld: amina has no REFUND_DECLINED notification for %s", order.Code)
}

// printLedger reads each order's ledger entries, read-only, and fails when
// they do not sum to zero (every order's money decomposes to zero residual,
// AGENTS.md "Non-negotiable invariants"). It needs the local database
// address `make dev-scenario` exports; without it the check is skipped and
// `devworld verify` checks the whole ledger instead.
func printLedger(ctx context.Context, orders ...pastOrder) error {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if dsn == "" {
		fmt.Println("ledger  not read (HG_POSTGRES_DSN unset); run `devworld verify`")
		return nil
	}
	if err := AllowReset(os.Getenv("HG_ENV"), dsn); err != nil {
		fmt.Printf("ledger  not read (%v)\n", err)
		return nil
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	var errs []error
	for _, o := range orders {
		var batches, entries int
		var sum int64
		var kinds string
		if err := conn.QueryRow(ctx, `
			SELECT count(DISTINCT b.id), count(e.id), COALESCE(sum(e.amount_cents), 0)::bigint,
			       COALESCE(string_agg(DISTINCT b.kind::text, ',' ORDER BY b.kind::text), '')
			  FROM ledger_batch b
			  JOIN ledger_entry e ON e.batch_id = b.id
			 WHERE b.order_id = $1`, o.ID).Scan(&batches, &entries, &sum, &kinds); err != nil {
			return fmt.Errorf("devworld: ledger for %s: %w", o.Code, err)
		}
		fmt.Printf("ledger  %s  %d batches (%s)  %d entries  sum %d\n", o.Code, batches, kinds, entries, sum)
		if sum != 0 {
			errs = append(errs, fmt.Errorf("devworld: ledger for %s sums to %d, not 0", o.Code, sum))
		}
	}
	return errors.Join(errs...)
}

func (c *apiClient) pastOrders(ctx context.Context) ([]pastOrder, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders?status_group=PAST&limit=100", nil, false)
	if err != nil {
		return nil, fmt.Errorf("devworld: past orders: %w", err)
	}
	var list []pastOrder
	if len(data) > 0 && string(data) != "null" {
		if jerr := json.Unmarshal(data, &list); jerr != nil {
			return nil, fmt.Errorf("devworld: past orders: %w", jerr)
		}
	}
	return list, nil
}

func (c *apiClient) refunds(ctx context.Context, path string) ([]refundRow, error) {
	_, data, err := c.call(ctx, http.MethodGet, path, nil, false)
	if err != nil {
		return nil, fmt.Errorf("devworld: %s: %w", path, err)
	}
	var list []refundRow
	if len(data) > 0 && string(data) != "null" {
		if jerr := json.Unmarshal(data, &list); jerr != nil {
			return nil, fmt.Errorf("devworld: %s: %w", path, jerr)
		}
	}
	return list, nil
}

func (c *apiClient) requestRefund(ctx context.Context, body map[string]any) (refundRow, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/refunds", body, true)
	if err != nil {
		return refundRow{}, fmt.Errorf("devworld: request %v refund: %w", body["kind"], err)
	}
	var r refundRow
	if jerr := json.Unmarshal(data, &r); jerr != nil || r.ID == "" {
		return refundRow{}, errors.New("devworld: refund request returned no id")
	}
	return r, nil
}

func (c *apiClient) firstLine(ctx context.Context, orderID string) (int, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders/"+orderID, nil, false)
	if err != nil {
		return 0, fmt.Errorf("devworld: get order: %w", err)
	}
	var o struct {
		Lines []struct {
			LineNo int `json:"line_no"`
		} `json:"lines"`
	}
	if jerr := json.Unmarshal(data, &o); jerr != nil || len(o.Lines) == 0 {
		return 0, fmt.Errorf("devworld: order %s has no lines", orderID)
	}
	return o.Lines[0].LineNo, nil
}

// ScenarioTimeout is how long `devworld scenario <name>` may run. A scenario
// that drives journeys to completion waits about two minutes for each order
// to complete, which the default five minutes does not leave room for.
func ScenarioTimeout(name string) time.Duration {
	if name == "refund-decisions" {
		return 12 * time.Minute
	}
	return 5 * time.Minute
}
