package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Order history in every end state (issue #682). One run leaves amina with a
// past order in each end state the API reaches in V1 without Stripe test keys,
// all through the API: no order row is written, and every deadline is the
// server's own.
//
//  1. CANCELLED by amina before acceptance (the customer-cancels steps).
//  2. REJECTED by bismillah-grill (the restaurant-rejected steps).
//  3. CANCELLED by the restaurant deadline: placed and left alone until the
//     180-second deadline cancels it and voids the authorisation.
//  4. COMPLETED, with a receipt (the journey, auto=all, speed=max).
//
// The deadline and the two-minute delivered-to-completed wait make the run
// longer than the command's usual five minutes, so it gets OrderHistoryTimeout.

// OrderHistoryTimeout is the order-history command's limit: the 180-second
// restaurant deadline, then the journey and its two-minute settle.
const OrderHistoryTimeout = 10 * time.Minute

// ScenarioTimeout is how long `devworld scenario name` may run: five minutes,
// or OrderHistoryTimeout for order-history.
func ScenarioTimeout(name string) time.Duration {
	if name == "order-history" {
		return OrderHistoryTimeout
	}
	return 5 * time.Minute
}

// restaurantTimeoutWait is how long the scenario polls a pending order after
// its 180-second deadline for the deadline runner to cancel it.
const restaurantTimeoutWait = 240 * time.Second

// historyEntry is one past order the scenario left, and how it ended.
type historyEntry struct {
	Code, State, Reason string
}

func scenarioOrderHistory(ctx context.Context, base string) error {
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	if active, err := cust.active(ctx); err != nil {
		return err
	} else if active.ID != "" {
		return fmt.Errorf("devworld: order-history starts with no active order; amina has %s in %s (run `make dev-reset`, or finish it)", active.Code, active.State)
	}
	var want []historyEntry
	step := func(name string, run func() error) error {
		fmt.Printf("== %s\n", name)
		if err := run(); err != nil {
			return err
		}
		last, err := cust.latestOrder(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("ended  %s  %s  %s\n", last.Code, last.State, last.Reason)
		want = append(want, last)
		return nil
	}
	if err := step("cancelled by the customer", func() error { return scenarioCustomerCancels(ctx, base) }); err != nil {
		return err
	}
	if err := step("rejected by the restaurant", func() error { return scenarioRestaurantRejected(ctx, base) }); err != nil {
		return err
	}
	if err := step("restaurant deadline", func() error { return waitRestaurantTimeout(ctx, cust) }); err != nil {
		return err
	}
	if err := step("completed", func() error {
		return RunJourney(ctx, base, JourneyOptions{Route: "short", Speed: "max", Auto: "all"})
	}); err != nil {
		return err
	}
	// The journey leaves rider-sim online; the seeded world has it offline.
	if err := riderOffline(ctx, base); err != nil {
		return err
	}
	return historySeenEverywhere(ctx, base, cust, want)
}

// riderOffline signs rider-sim out of the dispatch pool, as the rider app's
// switch does, so `devworld verify` finds the rider as seeded.
func riderOffline(ctx context.Context, base string) error {
	rider, err := riderClientFor(ctx, base)
	if err != nil {
		return err
	}
	if _, _, err := rider.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{"is_online": false}, false); err != nil {
		return fmt.Errorf("devworld: rider-sim go offline: %w", err)
	}
	fmt.Println("rider-sim  offline")
	return nil
}

// waitRestaurantTimeout places an order and leaves it alone until the server's
// restaurant deadline cancels it.
func waitRestaurantTimeout(ctx context.Context, cust *apiClient) error {
	order, err := cust.place(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s  left alone for the 180-second restaurant deadline\n", order.Code, order.State)
	end := time.Now().Add(restaurantTimeoutWait)
	for {
		got, err := cust.orderEnd(ctx, order.ID)
		if err != nil {
			return err
		}
		if got.State == "CANCELLED" {
			if got.Reason != "RESTAURANT_TIMEOUT" {
				return fmt.Errorf("devworld: %s was cancelled with %q, want RESTAURANT_TIMEOUT", got.Code, got.Reason)
			}
			return nil
		}
		if got.State != "CREATED" && got.State != "RESTAURANT_PENDING" {
			return fmt.Errorf("devworld: %s moved to %s while it waited for the restaurant deadline", got.Code, got.State)
		}
		if time.Now().After(end) {
			return fmt.Errorf("devworld: %s still %s after %s; is the API's deadline runner running?", got.Code, got.State, restaurantTimeoutWait)
		}
		if err := sleepCtx(ctx, 5*time.Second); err != nil {
			return err
		}
	}
}

// orderEnd reads one of the caller's orders with its cancel or reject reason.
func (c *apiClient) orderEnd(ctx context.Context, id string) (historyEntry, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders/"+id, nil, false)
	if err != nil {
		return historyEntry{}, fmt.Errorf("devworld: get order: %w", err)
	}
	return decodeEnd(data)
}

func decodeEnd(data json.RawMessage) (historyEntry, error) {
	var o struct {
		Code         string  `json:"code"`
		State        string  `json:"state"`
		CancelReason *string `json:"cancel_reason"`
		RejectReason *string `json:"reject_reason"`
	}
	if err := json.Unmarshal(data, &o); err != nil {
		return historyEntry{}, err
	}
	reason := deref(o.CancelReason)
	if reason == "" {
		reason = deref(o.RejectReason)
	}
	return historyEntry{Code: o.Code, State: o.State, Reason: reason}, nil
}

// latestOrder is the caller's newest order, read back by id for its reason.
func (c *apiClient) latestOrder(ctx context.Context) (historyEntry, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders?limit=1", nil, false)
	if err != nil {
		return historyEntry{}, fmt.Errorf("devworld: listOrders: %w", err)
	}
	var list []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &list); err != nil || len(list) == 0 {
		return historyEntry{}, errors.New("devworld: listOrders returned no order")
	}
	return c.orderEnd(ctx, list[0].ID)
}

// historySeenEverywhere checks that the customer's past orders, the
// restaurant's order list and the admin order lookup all carry the codes.
func historySeenEverywhere(ctx context.Context, base string, cust *apiClient, want []historyEntry) error {
	fmt.Println("== history")
	if active, err := cust.active(ctx); err != nil {
		return err
	} else if active.ID != "" {
		return fmt.Errorf("devworld: amina still has an active order, %s in %s", active.Code, active.State)
	}
	kitchen, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	lists := []struct {
		who    string
		client *apiClient
		path   string
	}{
		{"amina  past orders", cust, "/v1/orders?status_group=PAST&limit=50"},
		{"bismillah-grill  orders", kitchen, "/v1/restaurant/orders?limit=50"},
	}
	var problems []error
	for _, l := range lists {
		codes, err := l.client.orderCodes(ctx, l.path)
		if err != nil {
			problems = append(problems, err)
			continue
		}
		problems = append(problems, expectCodes(l.who, codes, want)...)
	}
	// The admin lookup is searched by code: it lists every customer's orders.
	for _, w := range want {
		codes, err := admin.orderCodes(ctx, "/v1/admin/orders?code="+url.QueryEscape(w.Code))
		if err != nil {
			problems = append(problems, err)
			continue
		}
		problems = append(problems, expectCodes("admin-seed  order lookup", codes, []historyEntry{w})...)
	}
	for _, w := range want {
		fmt.Printf("past  %s  %-9s  %s\n", w.Code, w.State, w.Reason)
	}
	return errors.Join(problems...)
}

func (c *apiClient) orderCodes(ctx context.Context, path string) (map[string]string, error) {
	_, data, err := c.call(ctx, http.MethodGet, path, nil, false)
	if err != nil {
		return nil, fmt.Errorf("devworld: GET %s: %w", path, err)
	}
	var list []struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("devworld: GET %s: %w", path, err)
	}
	out := make(map[string]string, len(list))
	for _, o := range list {
		out[o.Code] = o.State
	}
	return out, nil
}

// expectCodes reports every wanted order missing from a list, or listed in
// another state.
func expectCodes(who string, got map[string]string, want []historyEntry) []error {
	var problems []error
	for _, w := range want {
		state, ok := got[w.Code]
		switch {
		case !ok:
			problems = append(problems, fmt.Errorf("devworld: %s does not list %s", who, w.Code))
		case state != w.State:
			problems = append(problems, fmt.Errorf("devworld: %s lists %s as %s, want %s", who, w.Code, state, w.State))
		}
	}
	if len(problems) == 0 {
		fmt.Printf("%s  lists all %d\n", who, len(want))
	}
	return problems
}
