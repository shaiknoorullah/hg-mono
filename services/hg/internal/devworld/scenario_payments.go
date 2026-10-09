package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// The payment-failed and payment-unpaid scenarios (issue #680): a declined
// card and an order nobody pays, on the local fake payment client, with no
// Stripe keys. amina places the order with one of the fake's switch payment
// method ids (internal/payments/fake_stripe_switch.go); the API does the rest.
// Against an API with a real Stripe key the ids are unknown to Stripe and the
// scenario reports that the fake is not in use.

// unpaidDeadline is the CREATED deadline: an order nobody pays is cancelled
// 15 minutes after it is placed (docs/spec/01-platform.md, "P-15 — Deadlines
// and timeout actions").
const unpaidDeadline = 15 * time.Minute

func scenarioPaymentFailed(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	if err := abandonUnpaid(ctx, cust); err != nil {
		return err
	}
	cust.paymentMethod = payments.FakeMethodDeclined
	placed, err := cust.place(ctx)
	if err == nil {
		return fmt.Errorf("devworld: %s was placed in %s; the card was not declined, so the API is not on the local fake payment client (HG_ENV=local, no HG_STRIPE_SECRET_KEY)", placed.Code, placed.State)
	}
	var api *apiError
	if !errors.As(err, &api) || api.Status != http.StatusServiceUnavailable {
		return err
	}
	fmt.Printf("declined  http %d  %s\n", api.Status, api.Code)

	order, err := cust.newestOrder(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", order.Code, order.State)
	if order.State != "FAILED" {
		return fmt.Errorf("devworld: amina's newest order %s is %s, want FAILED", order.Code, order.State)
	}
	status, _, perr := cust.call(ctx, http.MethodGet, "/v1/orders/"+order.ID+"/payment", nil, false)
	switch {
	case status == http.StatusNotFound:
		fmt.Printf("payment  http %d  no authorisation\n", status)
	case perr != nil:
		return fmt.Errorf("devworld: payment: %w", perr)
	default:
		return fmt.Errorf("devworld: %s has a payment (http %d); a declined card leaves none", order.Code, status)
	}
	active, err := cust.active(ctx)
	if err != nil {
		return err
	}
	if active.ID != "" {
		return fmt.Errorf("devworld: amina still has an active order %s in %s", active.Code, active.State)
	}
	fmt.Println("active order  none")
	return orderLedgerEmpty(ctx, order)
}

func scenarioPaymentUnpaid(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	order, err := cust.active(ctx)
	if err != nil {
		return err
	}
	switch {
	case order.ID == "":
		cust.paymentMethod = payments.FakeMethodUnpaid
		if order, err = cust.place(ctx); err != nil {
			return err
		}
	case order.State == "CREATED":
		fmt.Printf("already  %s  %s\n", order.Code, order.State)
	default:
		return fmt.Errorf("devworld: amina already has %s in %s; finish or cancel it first", order.Code, order.State)
	}
	if order.State != "CREATED" {
		return fmt.Errorf("devworld: %s is %s, want CREATED; the API is not on the local fake payment client (HG_ENV=local, no HG_STRIPE_SECRET_KEY)", order.Code, order.State)
	}

	_, data, err := cust.call(ctx, http.MethodGet, "/v1/orders/"+order.ID, nil, false)
	if err != nil {
		return fmt.Errorf("devworld: get order: %w", err)
	}
	var view struct {
		PlacedAt   time.Time  `json:"placed_at"`
		DeadlineAt *time.Time `json:"deadline_at"`
	}
	if jerr := json.Unmarshal(data, &view); jerr != nil || view.DeadlineAt == nil {
		return fmt.Errorf("devworld: %s has no deadline", order.Code)
	}
	fmt.Printf("deadline  %s  in %s (placed %s)\n", view.DeadlineAt.Format(time.RFC3339),
		time.Until(*view.DeadlineAt).Round(time.Second), view.PlacedAt.Format(time.RFC3339))
	if d := view.DeadlineAt.Sub(view.PlacedAt); d < unpaidDeadline-time.Minute || d > unpaidDeadline+time.Minute {
		return fmt.Errorf("devworld: %s deadline is %s after placing, want about %s", order.Code, d, unpaidDeadline)
	}

	// Reading the payment reconciles it with the provider; the fake still
	// reports it unconfirmed, so the order stays CREATED.
	_, data, err = cust.call(ctx, http.MethodGet, "/v1/orders/"+order.ID+"/payment", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: payment: %w", err)
	}
	var pay struct {
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &pay)
	fmt.Printf("payment  %s  (not authorised)\n", pay.State)
	if pay.State != "REQUIRES_PAYMENT_METHOD" {
		return fmt.Errorf("devworld: %s payment is %s, want REQUIRES_PAYMENT_METHOD", order.Code, pay.State)
	}
	again, err := cust.active(ctx)
	if err != nil {
		return err
	}
	if again.ID != order.ID || again.State != "CREATED" {
		return fmt.Errorf("devworld: after reading the payment amina's active order is %s %s", again.Code, again.State)
	}
	fmt.Printf("order %s  CREATED; left alone, the deadline runner cancels it\n", order.Code)
	return orderLedgerEmpty(ctx, placedOrderView(order))
}

// abandonUnpaid cancels an order of amina's still waiting for its payment, as
// the customer would, so payment-failed can place a new one after
// payment-unpaid. Any other active order stops the scenario.
func abandonUnpaid(ctx context.Context, cust *apiClient) error {
	active, err := cust.active(ctx)
	if err != nil || active.ID == "" {
		return err
	}
	if active.State != "CREATED" {
		return fmt.Errorf("devworld: amina already has %s in %s; finish or cancel it first", active.Code, active.State)
	}
	got, err := cust.cancel(ctx, active.ID)
	if err != nil {
		return err
	}
	fmt.Printf("abandoned unpaid  %s  %s\n", got.Code, got.State)
	return nil
}

type newestOrder struct {
	ID    string `json:"id"`
	Code  string `json:"code"`
	State string `json:"state"`
}

func placedOrderView(o placedOrder) newestOrder {
	return newestOrder{ID: o.ID, Code: o.Code, State: o.State}
}

// newestOrder is amina's most recently placed finished order; the list is
// newest first.
func (c *apiClient) newestOrder(ctx context.Context) (newestOrder, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders?status_group=PAST&limit=1", nil, false)
	if err != nil {
		return newestOrder{}, fmt.Errorf("devworld: orders: %w", err)
	}
	var list []newestOrder
	if jerr := json.Unmarshal(data, &list); jerr != nil || len(list) == 0 {
		return newestOrder{}, errors.New("devworld: amina has no finished order")
	}
	return list[0], nil
}

// orderLedgerEmpty checks, read-only, that no money moved for the order: no
// authorisation is captured, so it has no ledger batch. It needs the local
// database address `make dev-scenario` exports and skips the check without it.
func orderLedgerEmpty(ctx context.Context, o newestOrder) error {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if dsn == "" || AllowReset(os.Getenv("HG_ENV"), dsn) != nil {
		fmt.Println("ledger  not read (no local HG_POSTGRES_DSN)")
		return nil
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM ledger_batch WHERE order_id = $1`, o.ID).Scan(&n); err != nil {
		return fmt.Errorf("devworld: ledger for %s: %w", o.Code, err)
	}
	fmt.Printf("ledger  %s  %d batches\n", o.Code, n)
	if n != 0 {
		return fmt.Errorf("devworld: %s has %d ledger batches; no money moved", o.Code, n)
	}
	return nil
}
