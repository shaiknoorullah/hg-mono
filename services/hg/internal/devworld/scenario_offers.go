package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// The rider offer scenarios (issue #684): an offer rejected, an offer left to
// expire, two riders racing to accept, and a ready order no rider takes. Each
// drives the real API as rider-sim and rider-sim-2 and waits for the real
// dispatch runner. None of them moves a deadline: every wait below is the
// runner's own clock (internal/dispatch: a 30 s offer, a 2 s gap between
// waves, a sweep every 5 s), because every order state's deadline_at is set by
// the server alone (AGENTS.md, "Non-negotiable invariants").

// Where the two riders go online: both inside the first wave's 3 km of
// bismillah-grill's door, a few hundred metres apart.
var (
	firstRiderAt  = shortStart
	secondRiderAt = routePoint{Lat: 43.6800, Lng: -79.3335}
)

const (
	// firstOfferWait covers the runner's first sweep after the order is ready.
	firstOfferWait = 30 * time.Second
	// nextWaveWait covers the rest of the first wave's 30 s offer, the gap
	// between waves and the next sweep.
	nextWaveWait = 75 * time.Second
	// noRiderWait covers five empty waves of about 27 s each; the search
	// stops at five waves or 300 s, whichever comes first.
	noRiderWait = 4 * time.Minute
	// readyPickupWindow is the READY_FOR_PICKUP deadline: ready + 15 min
	// (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions").
	readyPickupWindow = 15 * time.Minute
)

func runOfferScenario(ctx context.Context, base, name string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	switch name {
	case "offer-reject":
		return scenarioOfferPassedOn(ctx, base, true)
	case "offer-ignored":
		return scenarioOfferPassedOn(ctx, base, false)
	case "offer-race":
		return scenarioOfferRace(ctx, base)
	case "no-rider":
		return scenarioNoRider(ctx, base)
	}
	return fmt.Errorf("devworld: unknown scenario %q", name)
}

// scenarioOfferPassedOn: rider-sim alone is online when the order is ready, so
// the first wave offers it alone. It rejects the offer, or lets it expire;
// rider-sim-2 comes online and the next wave offers it the order, which it
// accepts. rider-sim is never offered the order again.
func scenarioOfferPassedOn(ctx context.Context, base string, reject bool) error {
	cust, err := offerCustomer(ctx, base)
	if err != nil {
		return err
	}
	first, second, err := offlinePair(ctx, base)
	if err != nil {
		return err
	}
	if err := first.onlineIdle(ctx, "rider-sim", firstRiderAt); err != nil {
		return err
	}
	order, err := readyOrder(ctx, base, cust)
	if err != nil {
		return err
	}
	offer, err := first.waitOffer(ctx, order.ID, firstOfferWait)
	if err != nil {
		return err
	}
	fmt.Printf("rider-sim offered first  %s\n", offer.OfferID)
	if reject {
		if _, _, err := first.call(ctx, http.MethodPost, "/v1/riders/me/offers/"+offer.OfferID+"/reject",
			map[string]any{"reason_code": "EARNINGS_TOO_LOW"}, true); err != nil {
			return fmt.Errorf("devworld: reject offer: %w", err)
		}
		fmt.Println("rider-sim rejected  EARNINGS_TOO_LOW")
	} else {
		fmt.Println("rider-sim ignores the offer; it expires 30 s after it was made")
	}
	if err := second.onlineIdle(ctx, "rider-sim-2", secondRiderAt); err != nil {
		return err
	}
	fmt.Println("waiting for the next wave")
	next, err := second.waitOffer(ctx, order.ID, nextWaveWait)
	if err != nil {
		return err
	}
	fmt.Printf("rider-sim-2 offered  %s\n", next.OfferID)
	if again, ok, err := first.currentOffer(ctx); err != nil {
		return err
	} else if ok && again.OrderID == order.ID {
		return fmt.Errorf("devworld: rider-sim was offered %s again (%s)", order.Code, again.OfferID)
	}
	assignment, _, err := second.acceptOffer(ctx, next.OfferID)
	if err != nil {
		return err
	}
	fmt.Printf("rider-sim-2 accepted  assignment %s\n", assignment)
	if err := first.offline(ctx, "rider-sim"); err != nil {
		return err
	}
	return expectAssigned(ctx, cust, order, "Second")
}

// scenarioOfferRace: both riders are online when the order is ready, so the
// first wave offers it to both. Both accept at the same moment; exactly one
// gets the assignment and the other is refused.
func scenarioOfferRace(ctx context.Context, base string) error {
	cust, err := offerCustomer(ctx, base)
	if err != nil {
		return err
	}
	first, second, err := offlinePair(ctx, base)
	if err != nil {
		return err
	}
	if err := first.onlineIdle(ctx, "rider-sim", firstRiderAt); err != nil {
		return err
	}
	if err := second.onlineIdle(ctx, "rider-sim-2", secondRiderAt); err != nil {
		return err
	}
	order, err := readyOrder(ctx, base, cust)
	if err != nil {
		return err
	}
	riders := []*apiClient{first, second}
	slugs := []string{"rider-sim", "rider-sim-2"}
	offers := make([]offerView, 2)
	for i, r := range riders {
		if offers[i], err = r.waitOffer(ctx, order.ID, firstOfferWait); err != nil {
			return fmt.Errorf("%w (%s; the race needs both riders in one wave)", err, slugs[i])
		}
	}
	type result struct {
		assignment string
		err        error
	}
	results := make([]result, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range riders {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			id, _, err := riders[i].acceptOffer(ctx, offers[i].OfferID)
			results[i] = result{assignment: id, err: err}
		}(i)
	}
	fmt.Println("both riders accept at once")
	close(start)
	wg.Wait()

	winner, loser, err := raceOutcome(results[0].err, results[1].err)
	if err != nil {
		return err
	}
	fmt.Printf("%s won  assignment %s\n", slugs[winner], results[winner].assignment)
	fmt.Printf("%s refused  %s\n", slugs[loser], codeOf(results[loser].err))
	if note := raceRefusalNote(results[loser].err); note != "" {
		fmt.Println(note)
	}
	if err := riders[loser].offline(ctx, slugs[loser]); err != nil {
		return err
	}
	return expectAssigned(ctx, cust, order, map[int]string{0: "Sim", 1: "Second"}[winner])
}

// raceOutcome reads two simultaneous accepts: exactly one succeeded, and the
// other was refused with an offer conflict. The spec's code for the loser is
// OFFER_ALREADY_TAKEN; today's API can answer OFFER_EXPIRED instead (#696),
// which raceRefusalNote reports.
func raceOutcome(a, b error) (winner, loser int, err error) {
	switch {
	case a == nil && b == nil:
		return 0, 0, errors.New("devworld: both accepts succeeded; dispatch gave one order two riders")
	case a != nil && b != nil:
		return 0, 0, fmt.Errorf("devworld: neither accept succeeded: %w", errors.Join(a, b))
	case a == nil:
		winner, loser, err = 0, 1, b
	default:
		winner, loser, err = 1, 0, a
	}
	for _, code := range []string{"OFFER_ALREADY_TAKEN", "OFFER_WITHDRAWN", "OFFER_EXPIRED"} {
		if isConflict(err, code) {
			return winner, loser, nil
		}
	}
	return 0, 0, fmt.Errorf("devworld: the losing accept failed for another reason: %w", err)
}

// raceRefusalNote explains a losing code other than the spec's.
func raceRefusalNote(err error) string {
	if isConflict(err, "OFFER_ALREADY_TAKEN") {
		return ""
	}
	return "the spec answers the loser OFFER_ALREADY_TAKEN; https://github.com/shaiknoorullah/hg-mono/issues/696"
}

// scenarioNoRider: no rider is online when the order is ready. The search runs
// empty waves until it gives up (NO_RIDER_FOUND, at five waves or 300 s); the
// order stays READY_FOR_PICKUP on its own pickup deadline.
func scenarioNoRider(ctx context.Context, base string) error {
	cust, err := offerCustomer(ctx, base)
	if err != nil {
		return err
	}
	if _, _, err := offlinePair(ctx, base); err != nil {
		return err
	}
	order, err := readyOrder(ctx, base, cust)
	if err != nil {
		return err
	}
	fmt.Println("waiting for the search to give up (about two minutes)")
	view, err := watchDispatch(ctx, cust, order.ID, noRiderWait)
	if err != nil {
		return err
	}
	if view.State != "READY_FOR_PICKUP" || view.Rider != nil {
		return fmt.Errorf("devworld: no-rider left %s in %s with a rider", view.Code, view.State)
	}
	if dispatchOf(view) != "NO_RIDER_FOUND" {
		fmt.Printf("search still running  %s; it ends at five waves or 300 s\n", dispatchOf(view))
	}
	printPickupDeadline(view)
	return nil
}

// offerCustomer signs amina in. These scenarios need an order dispatch has not
// searched for yet, so an order of hers that is already ready, or further on,
// is refused.
func offerCustomer(ctx context.Context, base string) (*apiClient, error) {
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return nil, err
	}
	active, err := cust.active(ctx)
	if err != nil {
		return nil, err
	}
	switch active.State {
	case "", "RESTAURANT_PENDING", "PREPARING":
		return cust, nil
	}
	return nil, fmt.Errorf("devworld: amina already has %s in %s; these scenarios start from an order no rider has been offered; run make dev-reset", active.Code, active.State)
}

// readyOrder takes amina's order to READY_FOR_PICKUP with the order-ready
// steps and returns it.
func readyOrder(ctx context.Context, base string, cust *apiClient) (placedOrder, error) {
	if err := scenarioReady(ctx, base); err != nil {
		return placedOrder{}, err
	}
	order, err := cust.active(ctx)
	if err != nil {
		return placedOrder{}, err
	}
	if order.State != "READY_FOR_PICKUP" {
		return placedOrder{}, fmt.Errorf("devworld: amina's order is %s, not ready", order.State)
	}
	return order, nil
}

// offlinePair signs both riders in and takes them offline, so a scenario
// decides who is online when the order becomes ready.
func offlinePair(ctx context.Context, base string) (*apiClient, *apiClient, error) {
	first, err := riderAs(ctx, base, "rider-sim")
	if err != nil {
		return nil, nil, err
	}
	second, err := riderAs(ctx, base, "rider-sim-2")
	if err != nil {
		return nil, nil, err
	}
	for i, r := range []*apiClient{first, second} {
		slug := []string{"rider-sim", "rider-sim-2"}[i]
		if err := r.offline(ctx, slug); err != nil {
			return nil, nil, err
		}
	}
	return first, second, nil
}

func (c *apiClient) offline(ctx context.Context, slug string) error {
	_, _, err := c.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{"is_online": false}, false)
	if isConflict(err, "ACTIVE_DELIVERY_IN_PROGRESS") {
		return fmt.Errorf("devworld: %s is on a delivery; run make dev-reset", slug)
	}
	if err != nil {
		return fmt.Errorf("devworld: %s offline: %w", slug, err)
	}
	fmt.Printf("%s offline\n", slug)
	return nil
}

// onlineIdle puts the rider online at p and checks dispatch can offer it work.
func (c *apiClient) onlineIdle(ctx context.Context, slug string, p routePoint) error {
	if err := c.goOnline(ctx, p); err != nil {
		return err
	}
	_, data, err := c.call(ctx, http.MethodGet, "/v1/riders/me", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: %s: %w", slug, err)
	}
	var me struct {
		AvailabilityState string `json:"availability_state"`
	}
	_ = json.Unmarshal(data, &me)
	if me.AvailabilityState != "ONLINE_IDLE" {
		return fmt.Errorf("devworld: %s is %s after going online, not ONLINE_IDLE", slug, me.AvailabilityState)
	}
	fmt.Printf("%s online  %.5f,%.5f\n", slug, p.Lat, p.Lng)
	return nil
}

// dispatchOrder is the customer's order view, as far as these scenarios read it.
type dispatchOrder struct {
	ID            string  `json:"id"`
	Code          string  `json:"code"`
	State         string  `json:"state"`
	DeadlineAt    *string `json:"deadline_at"`
	ReadyAt       *string `json:"ready_at"`
	DispatchState *string `json:"dispatch_state"`
	Rider         *struct {
		FirstName string `json:"first_name"`
	} `json:"rider"`
}

func dispatchOf(v dispatchOrder) string {
	return dash(v.DispatchState)
}

func readDispatch(ctx context.Context, cust *apiClient, id string) (dispatchOrder, error) {
	_, data, err := cust.call(ctx, http.MethodGet, "/v1/orders/"+id, nil, false)
	if err != nil {
		return dispatchOrder{}, fmt.Errorf("devworld: get order: %w", err)
	}
	var v dispatchOrder
	if err := json.Unmarshal(data, &v); err != nil {
		return dispatchOrder{}, err
	}
	return v, nil
}

// expectAssigned checks, as the customer, that the order is still ready and
// the rider named riderFirst holds it.
func expectAssigned(ctx context.Context, cust *apiClient, order placedOrder, riderFirst string) error {
	v, err := readDispatch(ctx, cust, order.ID)
	if err != nil {
		return err
	}
	got := "-"
	if v.Rider != nil {
		got = v.Rider.FirstName
	}
	fmt.Printf("order %s  %s  dispatch %s  rider %s\n", v.Code, v.State, dispatchOf(v), got)
	if v.State != "READY_FOR_PICKUP" || got != riderFirst {
		return fmt.Errorf("devworld: %s is %s with rider %s, want READY_FOR_PICKUP with %s", v.Code, v.State, got, riderFirst)
	}
	return nil
}

// watchDispatch prints each dispatch state the customer sees until the search
// ends in NO_RIDER_FOUND, a rider takes the order, or window passes.
func watchDispatch(ctx context.Context, cust *apiClient, id string, window time.Duration) (dispatchOrder, error) {
	if dl, ok := ctx.Deadline(); ok && time.Until(dl)-20*time.Second < window {
		window = time.Until(dl) - 20*time.Second
	}
	stop := time.Now().Add(window)
	last := ""
	for {
		v, err := readDispatch(ctx, cust, id)
		if err != nil {
			return v, err
		}
		if now := dispatchOf(v); now != last {
			fmt.Printf("dispatch  %s  %s\n", now, time.Now().UTC().Format(time.RFC3339))
			if now == "OFFERED" {
				fmt.Println("a rider outside these personas is online and was offered the order; the offer is left to expire")
			}
			last = now
		}
		switch {
		case last == "NO_RIDER_FOUND", v.Rider != nil, v.State != "READY_FOR_PICKUP":
			return v, nil
		case !time.Now().Before(stop):
			return v, nil
		}
		if err := sleepCtx(ctx, 3*time.Second); err != nil {
			return v, err
		}
	}
}

// printPickupDeadline says when the order's READY_FOR_PICKUP deadline falls
// and what the deadline runner does then. The time is the server's.
func printPickupDeadline(v dispatchOrder) {
	at := deref(v.DeadlineAt)
	if at == "" && v.ReadyAt != nil {
		if ready, err := time.Parse(time.RFC3339Nano, *v.ReadyAt); err == nil {
			at = ready.Add(readyPickupWindow).UTC().Format(time.RFC3339) + " (ready_at + 15 min)"
		}
	}
	if at == "" {
		at = "not shown to the customer"
	}
	fmt.Printf("order %s  %s  no rider  pickup deadline %s\n", v.Code, v.State, at)
	if t, err := time.Parse(time.RFC3339Nano, deref(v.DeadlineAt)); err == nil {
		fmt.Printf("deadline in %s; then the order escalates and re-arms every 10 min, and the third escalation cancels it with a full refund\n",
			time.Until(t).Round(time.Second))
	}
}
