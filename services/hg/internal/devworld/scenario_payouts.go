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

// The payout-run and capture-fails scenarios (issue #676), on the local fake
// payment client. Both drive the API as personas and only read the ledger.

// payoutRunWait is how long the scenario follows a queued run. The server's
// payout worker picks an admin run up within seconds.
const payoutRunWait = 90 * time.Second

type payoutRun struct {
	ID        string `json:"id"`
	State     string `json:"state"`
	PeriodEnd string `json:"period_end"`
	Partners  int    `json:"partners"`
	Paid      int    `json:"paid"`
	Held      int    `json:"held"`
	Carried   int    `json:"carried"`
	Failed    int    `json:"failed"`
	PaidCents int64  `json:"paid_cents"`
	Error     string `json:"error"`
	Lines     []struct {
		Outcome     string  `json:"outcome"`
		PayoutID    *string `json:"payout_id"`
		AmountCents *int64  `json:"amount_cents"`
		Detail      *string `json:"detail"`
	} `json:"lines"`
}

// scenarioPayoutRun runs the weekly payout now for bismillah-grill, as
// admin-seed, and shows what the restaurant sees. A run pays the week that
// closed on the last Monday 00:00 Toronto, and a restaurant's earning waits
// three days after its order settles, so orders from this week are paid by a
// run after next Monday: on a fresh world the run finds nothing due, and the
// scenario says when that changes. Nothing moves the clock.
func scenarioPayoutRun(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/payout-runs", map[string]any{
		"reason": "Dev world: pay bismillah-grill now to see the payout screens.",
		"payee":  map[string]any{"type": "RESTAURANT", "id": BismillahRestaurantID},
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: payout run: %w", err)
	}
	var run payoutRun
	if jerr := json.Unmarshal(data, &run); jerr != nil || run.ID == "" {
		return errors.New("devworld: payout run returned no id")
	}
	fmt.Printf("payout run  %s  http %d  %s  period ends %s\n", run.ID, status, run.State, run.PeriodEnd)

	stop := time.Now().Add(payoutRunWait)
	for run.State == "QUEUED" || run.State == "RUNNING" {
		if time.Now().After(stop) {
			return fmt.Errorf("devworld: payout run %s still %s after %s; is the API's payout worker running?", run.ID, run.State, payoutRunWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
		_, data, err = admin.call(ctx, http.MethodGet, "/v1/admin/payout-runs/"+run.ID, nil, false)
		if err != nil {
			return fmt.Errorf("devworld: read payout run: %w", err)
		}
		if jerr := json.Unmarshal(data, &run); jerr != nil {
			return jerr
		}
	}
	fmt.Printf("payout run  %s  partners %d  paid %d (%d cents)  held %d  carried %d  failed %d\n",
		run.State, run.Partners, run.Paid, run.PaidCents, run.Held, run.Carried, run.Failed)
	for _, l := range run.Lines {
		fmt.Printf("line  %s  amount %s  %s\n", l.Outcome, centsOrDash(l.AmountCents), strOrDash(l.Detail))
	}
	if run.State != "SUCCEEDED" {
		return fmt.Errorf("devworld: payout run %s ended %s: %s", run.ID, run.State, run.Error)
	}

	rest, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	_, data, err = rest.call(ctx, http.MethodGet, "/v1/restaurant/payouts?limit=10", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: restaurant payouts: %w", err)
	}
	var list []struct {
		PeriodEnd   string `json:"period_end"`
		AmountCents int64  `json:"amount_cents"`
		State       string `json:"state"`
		EntryCount  int    `json:"entry_count"`
	}
	_ = json.Unmarshal(data, &list)
	fmt.Printf("bismillah-grill payouts  %d\n", len(list))
	for _, p := range list {
		fmt.Printf("payout  period ends %s  %d cents  %d entries  %s\n", p.PeriodEnd, p.AmountCents, p.EntryCount, p.State)
	}
	if run.Paid == 0 {
		fmt.Printf("nothing paid yet: an earning is paid by the first run whose week ends at least three days after its order settled (HG_PAYOUT_RESTAURANT_HOLD_HOURS); the current week ends %s\n",
			nextPayoutCutoff(time.Now()).Format("Mon 2 Jan 15:04 MST"))
	}
	return ledgerBalanced(ctx)
}

// nextPayoutCutoff is the next Monday 00:00 in Toronto, the end of the week
// a payout run pays.
func nextPayoutCutoff(now time.Time) time.Time {
	zone, err := time.LoadLocation("America/Toronto")
	if err != nil {
		zone = time.UTC
	}
	local := now.In(zone)
	days := (int(time.Monday) - int(local.Weekday()) + 7) % 7
	if days == 0 {
		days = 7
	}
	return time.Date(local.Year(), local.Month(), local.Day()+days, 0, 0, 0, 0, zone)
}

// scenarioCaptureFails has nour order with the fake's capture-fails payment
// method and bismillah-grill accept it. The accept stands, the capture is
// refused, and the payment stays authorised and uncaptured. nour, not amina,
// so the order that stays in the kitchen does not block amina's scenarios.
func scenarioCaptureFails(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	cust, err := customer(ctx, base, "nour")
	if err != nil {
		return err
	}
	order, err := cust.active(ctx)
	if err != nil {
		return err
	}
	switch {
	case order.ID == "":
		cust.paymentMethod = payments.FakeMethodCaptureFails
		if order, err = cust.place(ctx); err != nil {
			return err
		}
	case order.State == "RESTAURANT_PENDING" || order.State == "PREPARING":
		// A previous run's order: accepted already, or still to accept.
		fmt.Printf("using  %s  %s\n", order.Code, order.State)
	default:
		return fmt.Errorf("devworld: nour already has %s in %s; finish it first", order.Code, order.State)
	}
	if order.State == "RESTAURANT_PENDING" {
		kitchen, err := restaurant(ctx, base, "bismillah-grill")
		if err != nil {
			return err
		}
		if order, err = kitchen.accept(ctx, order.ID); err != nil {
			return err
		}
		fmt.Printf("accepted  %s  %s\n", order.Code, order.State)
	}
	if order.State != "PREPARING" {
		return fmt.Errorf("devworld: %s is %s, want PREPARING", order.Code, order.State)
	}

	_, data, err := cust.call(ctx, http.MethodGet, "/v1/orders/"+order.ID+"/payment", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: payment: %w", err)
	}
	var pay struct {
		State    string `json:"state"`
		Captured int64  `json:"amount_captured_cents"`
	}
	_ = json.Unmarshal(data, &pay)
	fmt.Printf("payment  %s  captured %d cents\n", pay.State, pay.Captured)
	if pay.State != "REQUIRES_CAPTURE" || pay.Captured != 0 {
		return fmt.Errorf("devworld: %s payment is %s with %d captured; the capture was meant to fail", order.Code, pay.State, pay.Captured)
	}
	fmt.Println("the API logged \"payment capture failed after accept\"; the authorisation is still held, and nothing retries it yet (#741)")
	return orderLedgerEmpty(ctx, placedOrderView(order))
}

// ledgerBalanced reads the whole ledger, read-only, and fails when a batch
// does not sum to zero (every order's money decomposes to zero residual,
// AGENTS.md "Non-negotiable invariants"). It needs the local database
// address `make dev-scenario` exports and skips the check without it.
func ledgerBalanced(ctx context.Context) error {
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
	var batches, unbalanced, payouts int
	if err := conn.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE s <> 0),
		       count(*) FILTER (WHERE kind = 'PAYOUT')
		  FROM (SELECT b.kind::text AS kind, COALESCE(sum(e.amount_cents), 0) AS s
		          FROM ledger_batch b LEFT JOIN ledger_entry e ON e.batch_id = b.id
		         GROUP BY b.id, b.kind) t`).Scan(&batches, &unbalanced, &payouts); err != nil {
		return fmt.Errorf("devworld: ledger: %w", err)
	}
	fmt.Printf("ledger  %d batches (%d payout)  %d not summing to zero\n", batches, payouts, unbalanced)
	if unbalanced != 0 {
		return fmt.Errorf("devworld: %d ledger batches do not sum to zero", unbalanced)
	}
	return nil
}

func centsOrDash(v *int64) string {
	if v == nil {
		return "-"
	}
	return fmt.Sprintf("%d", *v)
}

func strOrDash(v *string) string {
	if v == nil || *v == "" {
		return "-"
	}
	return *v
}
