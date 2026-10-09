package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Scenarios for the redesign journeys (offers, timeouts, escalations, staff
// interventions, refunds and payouts). Like the catalogue in scenario.go they
// act through the API as the personas would. The ones that need time to pass
// move one row's clock (scenario_clock.go) and let the running API's own
// timers act; none writes a state, a payment or a ledger row.

// bismillahCertificateID is the approved certificate reset seeds for
// bismillah-grill (migrations/devworld/001_personas.sql).
const bismillahCertificateID = "d0000000-0000-4000-8000-000000000208"

const (
	// offerTimeoutWindow is how long offer-timeout leaves the restaurant to
	// answer, in place of the real 180 seconds.
	offerTimeoutWindow = 30 * time.Second
	// offerWait is how long a scenario waits for dispatch to offer a ready
	// order to rider-sim, who went online before the order was ready.
	offerWait = 45 * time.Second
	// tickerWait is how long a scenario waits for the deadline ticker, which
	// sweeps every second, to act on a deadline that has passed.
	tickerWait = 30 * time.Second
)

// Order states a scenario may continue from.
const (
	statePending   = "RESTAURANT_PENDING"
	statePreparing = "PREPARING"
	stateReady     = "READY_FOR_PICKUP"
)

func states(s ...string) func(string) bool {
	return func(state string) bool {
		for _, want := range s {
			if state == want {
				return true
			}
		}
		return false
	}
}

// pickCustomer returns a customer with an order the scenario can continue:
// amina's active order when usable accepts its state, a new order for amina
// when she has none, and otherwise the same for nour. Two customers let a
// scenario that leaves an order waiting run twice per reset.
func pickCustomer(ctx context.Context, base string, usable func(string) bool) (*apiClient, placedOrder, error) {
	var busy []string
	for _, slug := range []string{"amina", "nour"} {
		cust, err := customer(ctx, base, slug)
		if err != nil {
			return nil, placedOrder{}, err
		}
		active, err := cust.active(ctx)
		if err != nil {
			return nil, placedOrder{}, err
		}
		if active.ID == "" {
			order, err := cust.place(ctx)
			if err != nil {
				return nil, placedOrder{}, fmt.Errorf("%w (if bismillah-grill is delisted after cert-lapse-mid-order, run `make dev-reset`)", err)
			}
			return cust, order, nil
		}
		if usable(active.State) {
			fmt.Printf("using  %s  %s  %s\n", slug, active.Code, active.State)
			return cust, active, nil
		}
		fmt.Printf("busy  %s  %s  %s\n", slug, active.Code, active.State)
		busy = append(busy, slug+" "+active.Code+" "+active.State)
	}
	return nil, placedOrder{}, fmt.Errorf("devworld: amina and nour both hold an order this scenario cannot continue (%v); finish them or run `make dev-reset`", busy)
}

// advanceTo accepts and marks ready as the restaurant until the order reaches
// want (PREPARING or READY_FOR_PICKUP).
func advanceTo(ctx context.Context, kitchen *apiClient, order placedOrder, want string) (placedOrder, error) {
	var err error
	if order.State == statePending {
		order, err = kitchen.accept(ctx, order.ID)
		if err != nil {
			return order, err
		}
		fmt.Printf("accept  %s  %s\n", order.Code, order.State)
	}
	if want == stateReady && order.State == statePreparing {
		order, err = kitchen.ready(ctx, order.ID)
		if err != nil {
			return order, err
		}
		fmt.Printf("ready  %s  %s\n", order.Code, order.State)
	}
	if order.State != want {
		return order, fmt.Errorf("devworld: %s is %s, want %s", order.Code, order.State, want)
	}
	return order, nil
}

// scenarioOfferToRider brings rider-sim online at bismillah-grill, then
// readies an order there, so dispatch offers it to rider-sim. The offer is
// left for the rider app to answer within its 30 seconds.
func scenarioOfferToRider(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	rider, err := riderClientFor(ctx, base)
	if err != nil {
		return err
	}
	if offer, ok, err := rider.currentOffer(ctx); err != nil {
		return err
	} else if ok {
		fmt.Printf("already offered  %s  order %s  expires %s\n", offer.OfferID, offer.OrderID, offer.ExpiresAt)
		return nil
	}
	if err := rider.goOnline(ctx, restaurantPoint); err != nil {
		return err
	}
	fmt.Printf("rider online  %.5f,%.5f\n", restaurantPoint.Lat, restaurantPoint.Lng)
	_, order, err := pickCustomer(ctx, base, states(statePending, statePreparing))
	if err != nil {
		return err
	}
	kitchen, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	if order, err = advanceTo(ctx, kitchen, order, stateReady); err != nil {
		return err
	}
	offer, err := rider.waitOffer(ctx, order.ID, offerWait)
	if err != nil {
		return err
	}
	fmt.Printf("offer pending  %s  order %s  expires %s\n", offer.OfferID, order.Code, offer.ExpiresAt)
	fmt.Println("answer it in the rider app as rider-sim before it expires")
	return nil
}

// scenarioOfferTimeout places an order and brings its restaurant deadline
// forward to 30 seconds from now, then waits for the deadline ticker to
// cancel it as RESTAURANT_TIMEOUT and void the authorisation.
func scenarioOfferTimeout(ctx context.Context, base string) error {
	if err := clockGuard(base); err != nil {
		return err
	}
	_, order, err := pickCustomer(ctx, base, states(statePending))
	if err != nil {
		return err
	}
	at, err := bringDeadlineForward(ctx, order.ID, statePending, "RESTAURANT_TIMEOUT", offerTimeoutWindow)
	if err != nil {
		return err
	}
	fmt.Printf("offer window  %s  times out at %s (in %s; the real window is 180 s)\n",
		order.Code, at.UTC().Format(time.RFC3339), time.Until(at).Round(time.Second))
	c, err := waitClock(ctx, order.ID, time.Until(at)+tickerWait, func(c orderClock) bool {
		return c.State != statePending
	})
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s  %s\n", order.Code, c.State, c.CancelledAs)
	if c.State != "CANCELLED" || c.CancelledAs != "RESTAURANT_TIMEOUT" {
		return fmt.Errorf("devworld: offer-timeout left %s in %s (%s); the restaurant answered first?", order.Code, c.State, c.CancelledAs)
	}
	return nil
}

// scenarioAdminCancel has admin-seed cancel an order the kitchen has
// accepted: CANCELLED with SUPPORT_CANCELLED and a full refund, in one
// transaction (cancelOrderAdmin).
func scenarioAdminCancel(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	_, order, err := pickCustomer(ctx, base, states(statePending, statePreparing))
	if err != nil {
		return err
	}
	kitchen, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	if order, err = advanceTo(ctx, kitchen, order, statePreparing); err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/orders/"+order.ID+"/cancel", map[string]any{
		"reason_code": "SUPPORT_CANCELLED",
		"reason_text": "Devworld: support cancelled the order after the kitchen accepted it.",
		"case_id":     uuid.NewString(),
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: admin cancel: %w", err)
	}
	var view struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &view)
	fmt.Printf("admin cancel  http %d  %s  %s\n", status, order.Code, view.State)
	if view.State != "CANCELLED" {
		return fmt.Errorf("devworld: admin cancel left %s in %s", order.Code, view.State)
	}
	return nil
}

// scenarioNoRider takes rider-sim offline, readies an order and lets its
// pickup deadline lapse. toCap repeats the lapse up to the escalation cap,
// where the ticker cancels the order as NO_RIDER_FOUND with a full refund.
func scenarioNoRider(ctx context.Context, base string, toCap bool) error {
	if err := clockGuard(base); err != nil {
		return err
	}
	rider, err := riderClientFor(ctx, base)
	if err != nil {
		return err
	}
	if _, _, err := rider.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{"is_online": false}, false); err != nil {
		return fmt.Errorf("devworld: rider-sim offline: %w", err)
	}
	fmt.Println("rider offline  rider-sim")
	_, order, err := pickCustomer(ctx, base, states(statePending, statePreparing, stateReady))
	if err != nil {
		return err
	}
	if order.State != stateReady {
		kitchen, err := restaurant(ctx, base, "bismillah-grill")
		if err != nil {
			return err
		}
		if order, err = advanceTo(ctx, kitchen, order, stateReady); err != nil {
			return err
		}
	}
	for lapse := 0; lapse < 8; lapse++ {
		before, err := readOrderClock(ctx, order.ID)
		if err != nil {
			return err
		}
		if before.State != stateReady {
			break
		}
		if lapse > 0 && !toCap {
			break
		}
		if _, err := bringDeadlineForward(ctx, order.ID, stateReady, "PICKUP_OVERDUE", 0); err != nil {
			return err
		}
		after, err := waitClock(ctx, order.ID, tickerWait, func(c orderClock) bool {
			return c.State != stateReady || c.Escalations > before.Escalations
		})
		if err != nil {
			return err
		}
		if after.State == stateReady {
			fmt.Printf("pickup lapsed  %s  lapse %d  next %s\n", order.Code, after.Escalations, after.DeadlineAt.UTC().Format(time.RFC3339))
		}
	}
	c, err := readOrderClock(ctx, order.ID)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s  %s\n", order.Code, c.State, c.CancelledAs)
	switch {
	case !toCap && c.State == stateReady && c.Escalations >= 1:
		return nil
	case toCap && c.State == "CANCELLED" && c.CancelledAs == "NO_RIDER_FOUND":
		return nil
	}
	return fmt.Errorf("devworld: no-rider left %s in %s (%s, %d lapses)", order.Code, c.State, c.CancelledAs, c.Escalations)
}

// scenarioCertLapse puts a live order at bismillah-grill, accepted by the
// kitchen, then lapses the restaurant's certificate. The restaurant reads
// EXPIRED (never red, never a badge) and is delisted; the order carries on.
func scenarioCertLapse(ctx context.Context, base string) error {
	if err := clockGuard(base); err != nil {
		return err
	}
	cust, order, err := pickCustomer(ctx, base, states(statePending, statePreparing, stateReady))
	if err != nil {
		return err
	}
	if order.State == statePending {
		kitchen, err := restaurant(ctx, base, "bismillah-grill")
		if err != nil {
			return err
		}
		if order, err = advanceTo(ctx, kitchen, order, statePreparing); err != nil {
			return err
		}
	}
	lapsed, err := lapseCertificate(ctx, bismillahCertificateID)
	if err != nil {
		return err
	}
	if lapsed {
		fmt.Println("certificate lapsed  bismillah-grill  expires_on is yesterday, local time")
	} else {
		fmt.Println("certificate already lapsed  bismillah-grill")
	}
	halal, listing, err := readRestaurantHalal(ctx, BismillahRestaurantID)
	if err != nil {
		return err
	}
	fmt.Printf("restaurant  bismillah-grill  halal %s  listing %s\n", halal, listing)
	// A delisted restaurant leaves the customer catalogue, so its public
	// certification panel answers 404: no badge, never an optimistic one.
	status, _, cerr := cust.call(ctx, http.MethodGet, "/v1/restaurants/"+BismillahRestaurantID+"/certification", nil, false)
	if cerr != nil {
		fmt.Printf("public certification  http %d  %s\n", status, codeOf(cerr))
	} else {
		fmt.Printf("public certification  http %d\n", status)
	}
	if v, verr := cust.getOrder(ctx, order.ID); verr == nil {
		printOrderView(v)
	}
	fmt.Println("bismillah-grill is delisted until `make dev-reset`; the order scenarios need it live")
	if halal != "EXPIRED" {
		return fmt.Errorf("devworld: the lapsed certificate reads %q, want EXPIRED", halal)
	}
	return nil
}

// driveToDoor takes a fresh order from the kitchen to DELIVERED with rider-sim
// at full speed: online first, ready, offer, pickup, drop-off, proof photo.
func driveToDoor(ctx context.Context, base string) (*apiClient, *apiClient, placedOrder, error) {
	rider, err := riderClientFor(ctx, base)
	if err != nil {
		return nil, nil, placedOrder{}, err
	}
	start := approachStart("short")
	if err := rider.goOnline(ctx, start); err != nil {
		return nil, nil, placedOrder{}, err
	}
	fmt.Printf("rider online  %.5f,%.5f\n", start.Lat, start.Lng)
	cust, order, err := pickCustomer(ctx, base, states(statePending, statePreparing))
	if err != nil {
		return nil, nil, placedOrder{}, err
	}
	kitchen, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return nil, nil, placedOrder{}, err
	}
	if order, err = advanceTo(ctx, kitchen, order, stateReady); err != nil {
		return nil, nil, placedOrder{}, err
	}
	offer, err := rider.waitOffer(ctx, order.ID, offerWait)
	if err != nil {
		return nil, nil, placedOrder{}, err
	}
	assignmentID, pickupAt, err := rider.acceptOffer(ctx, offer.OfferID)
	if err != nil {
		return nil, nil, placedOrder{}, err
	}
	fmt.Printf("assignment  %s\n", assignmentID)
	if pickupAt.Lat == 0 && pickupAt.Lng == 0 {
		pickupAt = restaurantPoint
	}
	leg := straightPickup("short")
	leg[len(leg)-1] = pickupAt
	if err := rider.walk(ctx, leg, assignmentID, 0); err != nil {
		return nil, nil, placedOrder{}, err
	}
	for _, step := range []struct {
		to string
		at routePoint
	}{{"EN_ROUTE_TO_PICKUP", start}, {"ARRIVED_AT_PICKUP", pickupAt}} {
		if err := rider.transition(ctx, assignmentID, step.to, step.at); err != nil {
			return nil, nil, placedOrder{}, err
		}
		fmt.Printf("assignment  %s\n", step.to)
	}
	if err := riderDelivers(ctx, cust, kitchen, rider, order, assignmentID, pickupAt); err != nil {
		return nil, nil, placedOrder{}, err
	}
	return cust, kitchen, order, nil
}

// settleNow brings a delivered order's settle deadline (two minutes) forward
// and waits for the ticker to complete it and write its receipt.
func settleNow(ctx context.Context, order placedOrder) error {
	if _, err := bringDeadlineForward(ctx, order.ID, "DELIVERED", "SETTLE", 0); err != nil {
		return err
	}
	c, err := waitClock(ctx, order.ID, tickerWait, func(c orderClock) bool { return c.State != "DELIVERED" })
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", order.Code, c.State)
	if c.State != "COMPLETED" {
		return fmt.Errorf("devworld: settle left %s in %s", order.Code, c.State)
	}
	return nil
}

// scenarioOrderCompleted delivers one order end to end and settles it: a past
// order with a receipt for the customer, and one more delivery in rider-sim's
// history and earnings.
func scenarioOrderCompleted(ctx context.Context, base string) error {
	if err := clockGuard(base); err != nil {
		return err
	}
	_, _, order, err := driveToDoor(ctx, base)
	if err != nil {
		return err
	}
	return settleNow(ctx, order)
}

// scenarioRefundApprove delivers and settles an order, has the customer ask
// for a full refund for a missing item, and has admin-seed approve it. The
// local fake payment client then sends the refund.
func scenarioRefundApprove(ctx context.Context, base string) error {
	if err := clockGuard(base); err != nil {
		return err
	}
	cust, _, order, err := driveToDoor(ctx, base)
	if err != nil {
		return err
	}
	if err := settleNow(ctx, order); err != nil {
		return err
	}
	status, data, err := cust.call(ctx, http.MethodPost, "/v1/refunds", map[string]any{
		"order_id":    order.ID,
		"kind":        "FULL",
		"reason_code": "ITEM_MISSING",
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: refund request: %w", err)
	}
	var refund struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &refund)
	fmt.Printf("refund requested  http %d  %s  %s\n", status, refund.ID, refund.State)
	if refund.ID == "" {
		return errors.New("devworld: refund request returned no id")
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err = admin.call(ctx, http.MethodPost, "/v1/admin/refunds/"+refund.ID+"/approve", map[string]any{
		"reason_text": "Devworld: the customer reported a missing item; approved in full.",
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: refund approve: %w", err)
	}
	var decided struct {
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &decided)
	fmt.Printf("refund approved  http %d  %s\n", status, decided.State)
	return watchRefund(ctx, cust, refund.ID)
}

// watchRefund prints the refund's state as the customer sees it until the
// sender has sent it (SUBMITTED) or it has succeeded, or for twenty seconds.
func watchRefund(ctx context.Context, cust *apiClient, refundID string) error {
	last := ""
	deadline := time.Now().Add(20 * time.Second)
	for {
		_, data, err := cust.call(ctx, http.MethodGet, "/v1/refunds/"+refundID, nil, false)
		if err != nil {
			return fmt.Errorf("devworld: read refund: %w", err)
		}
		var r struct {
			State       string `json:"state"`
			AmountCents int64  `json:"amount_cents"`
		}
		_ = json.Unmarshal(data, &r)
		if r.State != last {
			fmt.Printf("refund  %s  %d cents\n", r.State, r.AmountCents)
			last = r.State
		}
		switch r.State {
		case "SUCCEEDED", "SETTLED":
			return nil
		case "SUBMITTED":
			// Sent to the payment client. SUCCEEDED arrives by Stripe
			// webhook, which the local fake payment client never sends.
			fmt.Println("refund sent; locally it stays SUBMITTED (no Stripe webhook confirms it)")
			return nil
		case "FAILED", "DECLINED", "CANCELLED", "REQUESTED", "PENDING_APPROVAL":
			return fmt.Errorf("devworld: refund is %s after approval", r.State)
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("devworld: refund still %s after 20 s", r.State)
		}
		if err := sleepCtx(ctx, time.Second); err != nil {
			return err
		}
	}
}

// scenarioPayoutRun has admin-seed request a payout run for every partner and
// waits for it to finish. A run pays balances from closed weeks only, so on a
// world reset this week it finishes with nothing due; it still fills the
// admin's payout-run list and detail.
func scenarioPayoutRun(ctx context.Context, base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	status, data, err := admin.call(ctx, http.MethodPost, "/v1/admin/payout-runs", map[string]any{
		"reason": "Devworld: run the payout now to show the payout-run board.",
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: payout run: %w", err)
	}
	var run payoutRunView
	_ = json.Unmarshal(data, &run)
	fmt.Printf("payout run  http %d  %s  %s\n", status, run.ID, run.State)
	if run.ID == "" {
		return errors.New("devworld: payout run returned no id")
	}
	deadline := time.Now().Add(tickerWait)
	for run.State == "QUEUED" || run.State == "RUNNING" {
		if !time.Now().Before(deadline) {
			return fmt.Errorf("devworld: payout run %s still %s after %s", run.ID, run.State, tickerWait)
		}
		if err := sleepCtx(ctx, time.Second); err != nil {
			return err
		}
		_, data, err = admin.call(ctx, http.MethodGet, "/v1/admin/payout-runs/"+run.ID, nil, false)
		if err != nil {
			return fmt.Errorf("devworld: read payout run: %w", err)
		}
		_ = json.Unmarshal(data, &run)
	}
	fmt.Printf("payout run  %s  %s  partners %d  paid %d (%d cents)  held %d  carried %d  failed %d  lines %d\n",
		run.ID, run.State, run.Partners, run.Paid, run.PaidCents, run.Held, run.Carried, run.Failed, len(run.Lines))
	for _, l := range run.Lines {
		fmt.Printf("  %s %s  %s  %d cents\n", l.Payee.Type, l.Payee.ID, l.Outcome, l.AmountCents)
	}
	if run.State != "SUCCEEDED" {
		return fmt.Errorf("devworld: payout run %s ended %s", run.ID, run.State)
	}
	return nil
}

type payoutRunView struct {
	ID        string `json:"id"`
	State     string `json:"state"`
	Partners  int    `json:"partners"`
	Paid      int    `json:"paid"`
	Held      int    `json:"held"`
	Carried   int    `json:"carried"`
	Failed    int    `json:"failed"`
	PaidCents int64  `json:"paid_cents"`
	Lines     []struct {
		Payee struct {
			Type string `json:"type"`
			ID   string `json:"id"`
		} `json:"payee"`
		Outcome     string `json:"outcome"`
		AmountCents int64  `json:"amount_cents"`
	} `json:"lines"`
}
