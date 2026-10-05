package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// JourneyOptions selects how far the simulator drives one live order.
type JourneyOptions struct {
	Route       string
	Speed       string
	Auto        string
	ManualRider bool
}

// ParseJourneyArgs reads journey flags. Omitted flags select the short route,
// real pace, and no automatic restaurant or rider steps.
func ParseJourneyArgs(args []string) (JourneyOptions, error) {
	opts := JourneyOptions{Route: "short", Speed: "1x", Auto: "none"}
	for _, a := range args {
		switch {
		case strings.HasPrefix(a, "--route="):
			opts.Route = strings.TrimPrefix(a, "--route=")
		case strings.HasPrefix(a, "--speed="):
			opts.Speed = strings.TrimPrefix(a, "--speed=")
		case strings.HasPrefix(a, "--auto="):
			opts.Auto = strings.TrimPrefix(a, "--auto=")
		case a == "--manual=rider":
			opts.ManualRider = true
		default:
			return JourneyOptions{}, fmt.Errorf("devworld: unknown journey flag %q", a)
		}
	}
	switch opts.Route {
	case "short", "long", "early-rider":
	default:
		return JourneyOptions{}, errors.New("devworld: route must be short, long, or early-rider")
	}
	switch opts.Speed {
	case "1x", "4x", "max":
	default:
		return JourneyOptions{}, errors.New("devworld: speed must be 1x, 4x, or max")
	}
	switch opts.Auto {
	case "none", "restaurant", "all":
	default:
		return JourneyOptions{}, errors.New("devworld: auto must be none, restaurant, or all")
	}
	return opts, nil
}

// RunJourney places one order and drives it through the API. auto=all rides it
// from the restaurant through pickup, a proof photo and DELIVERED, then reads
// the receipt, a rating, the restaurant order and a refund request. A refused
// seal is recorded and the ride continues. The command does not insert a seal.
// Without a driven rider it returns once the order is ready.
func RunJourney(ctx context.Context, baseURL string, opts JourneyOptions) error {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return errors.New("devworld: journey requires an API base URL")
	}
	restaurantAuto := opts.Auto == "restaurant" || opts.Auto == "all"
	driveRider := opts.Auto == "all" && !opts.ManualRider
	early := opts.Route == "early-rider"
	fmt.Printf("journey  route %s  speed %s  auto %s  manual-rider %t  api %s\n",
		opts.Route, opts.Speed, opts.Auto, opts.ManualRider, baseURL)

	cust, err := customer(ctx, baseURL, "amina")
	if err != nil {
		return err
	}
	order, err := journeyOrder(ctx, cust)
	if err != nil {
		return err
	}
	fmt.Printf("order  %s  %s  %s\n", order.ID, order.Code, order.State)

	var kitchen *apiClient
	if restaurantAuto || driveRider {
		kitchen, err = restaurant(ctx, baseURL, "bismillah-grill")
		if err != nil {
			return err
		}
	}
	if restaurantAuto && order.State == "RESTAURANT_PENDING" {
		order, err = kitchen.accept(ctx, order.ID)
		if err != nil {
			return err
		}
		fmt.Printf("accept  %s  %s\n", order.Code, order.State)
	}
	if early && order.State == "READY_FOR_PICKUP" {
		fmt.Printf("early arrival cannot be shown; %s is already ready\n", order.Code)
		early = false
	}
	if early && !driveRider {
		fmt.Println("early arrival needs the rider to be driven; continuing once the order is ready")
		early = false
	}

	var riderClient *apiClient
	onlineBeforeReady := false
	if driveRider && order.State != "READY_FOR_PICKUP" {
		riderClient, err = riderClientFor(ctx, baseURL)
		if err != nil {
			return err
		}
		if err = riderClient.goOnline(ctx, approachStart(opts.Route)); err != nil {
			return err
		}
		onlineBeforeReady = true
		fmt.Printf("rider online  %.5f,%.5f\n", approachStart(opts.Route).Lat, approachStart(opts.Route).Lng)
	}

	if early && order.State == "PREPARING" {
		leg, how := pickupLeg(ctx, "early-rider", mapToken(), &http.Client{Timeout: 8 * time.Second})
		fmt.Printf("route early-rider  %s  %d points\n", howLabel(how), len(leg))
		if err = riderClient.walk(ctx, leg, "", stepWait(opts.Speed)); err != nil {
			return err
		}
		if err = riderClient.expectNoOffer(ctx, 4*time.Second); err != nil {
			return err
		}
	}

	if restaurantAuto && order.State == "PREPARING" {
		order, err = kitchen.ready(ctx, order.ID)
		if err != nil {
			return err
		}
		fmt.Printf("ready  %s  %s\n", order.Code, order.State)
	}
	if order.State != "READY_FOR_PICKUP" {
		order, err = waitForReady(ctx, cust, kitchen, order, restaurantAuto)
		if err != nil {
			return err
		}
	}
	if !driveRider {
		fmt.Printf("rider left to a person  %s  %s\n", order.ID, order.State)
		return nil
	}

	if riderClient == nil {
		riderClient, err = riderClientFor(ctx, baseURL)
		if err != nil {
			return err
		}
		if err = riderClient.goOnline(ctx, approachStart(opts.Route)); err != nil {
			return err
		}
		fmt.Printf("rider online  %.5f,%.5f\n", approachStart(opts.Route).Lat, approachStart(opts.Route).Lng)
	}

	wait := 25 * time.Second
	if !onlineBeforeReady {
		wait = 50 * time.Second
		fmt.Println("rider was not online before the order was ready; waiting for a later sweep")
	}
	offer, err := riderClient.waitOffer(ctx, order.ID, wait)
	if err != nil {
		return err
	}
	assignmentID, pickupAt, err := riderClient.acceptOffer(ctx, offer.OfferID)
	if err != nil {
		return err
	}
	fmt.Printf("assignment  %s\n", assignmentID)
	if pickupAt.Lat == 0 && pickupAt.Lng == 0 {
		pickupAt = restaurantPoint
	}

	if !early {
		leg, how := pickupLeg(ctx, opts.Route, mapToken(), &http.Client{Timeout: 8 * time.Second})
		if len(leg) > 0 {
			leg[len(leg)-1] = pickupAt
		}
		fmt.Printf("route %s  %s  %d points\n", opts.Route, howLabel(how), len(leg))
		if err = riderClient.walk(ctx, leg, assignmentID, stepWait(opts.Speed)); err != nil {
			return err
		}
	} else if err = riderClient.walk(ctx, []routePoint{pickupAt}, assignmentID, 0); err != nil {
		return err
	}
	if err = riderClient.transition(ctx, assignmentID, "EN_ROUTE_TO_PICKUP", approachStart(opts.Route)); err != nil {
		return err
	}
	fmt.Println("assignment  EN_ROUTE_TO_PICKUP")
	if err = riderClient.transition(ctx, assignmentID, "ARRIVED_AT_PICKUP", pickupAt); err != nil {
		return err
	}
	fmt.Println("assignment  ARRIVED_AT_PICKUP")

	seen, serr := cust.active(ctx)
	if serr == nil && seen.ID != "" {
		order = seen
	}
	return deliverLeg(ctx, cust, kitchen, riderClient, order, assignmentID, pickupAt)
}

func howLabel(how string) string {
	if how == "straight" && mapToken() != "" {
		return "straight (directions request did not return a line)"
	}
	return how
}

func journeyOrder(ctx context.Context, cust *apiClient) (placedOrder, error) {
	active, err := cust.active(ctx)
	if err != nil {
		return placedOrder{}, err
	}
	if active.ID == "" {
		return cust.place(ctx)
	}
	switch active.State {
	case "RESTAURANT_PENDING", "PREPARING", "READY_FOR_PICKUP":
		fmt.Printf("using  %s  %s\n", active.Code, active.State)
		return active, nil
	default:
		return placedOrder{}, fmt.Errorf("devworld: %s is %s; this command does not change that order", active.Code, active.State)
	}
}

func waitForReady(ctx context.Context, cust, kitchen *apiClient, order placedOrder, restaurantAuto bool) (placedOrder, error) {
	last := ""
	var paySince time.Time
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		if order.State != last {
			fmt.Printf("waiting  %s  %s\n", order.Code, order.State)
			if v, verr := cust.getOrder(ctx, order.ID); verr == nil {
				printOrderView(v)
			}
			last = order.State
		}
		switch order.State {
		case "READY_FOR_PICKUP", "PICKED_UP", "ARRIVED", "DELIVERED", "COMPLETED":
			return order, nil
		case "CANCELLED", "REJECTED", "FAILED", "DISPUTED", "RESOLVED":
			return order, fmt.Errorf("devworld: %s is %s", order.Code, order.State)
		case "RESTAURANT_PENDING":
			if restaurantAuto && kitchen != nil {
				next, err := kitchen.accept(ctx, order.ID)
				if err != nil {
					return order, err
				}
				fmt.Printf("accept  %s  %s\n", next.Code, next.State)
				if next.State != "" && next.State != order.State {
					order = next
					continue
				}
				order = next
			}
		case "PREPARING":
			if restaurantAuto && kitchen != nil {
				next, err := kitchen.ready(ctx, order.ID)
				if err != nil {
					return order, err
				}
				fmt.Printf("ready  %s  %s\n", next.Code, next.State)
				if next.State != "" && next.State != order.State {
					order = next
					continue
				}
				order = next
			}
		case "CREATED", "AUTHORIZED":
			if paySince.IsZero() {
				paySince = time.Now()
			}
			if time.Since(paySince) >= paymentAuthoriseWait {
				return order, fmt.Errorf("devworld: payment was not authorised; %s is %s", order.Code, order.State)
			}
		}
		select {
		case <-ctx.Done():
			return order, fmt.Errorf("devworld: still waiting; %s is %s", order.Code, order.State)
		case <-tick.C:
			next, err := cust.active(ctx)
			if err != nil {
				return order, err
			}
			if next.ID == "" {
				return order, fmt.Errorf("devworld: %s left the active list from %s", order.Code, last)
			}
			order = next
		}
	}
}

func riderClientFor(ctx context.Context, base string) (*apiClient, error) {
	who, err := identity("rider-sim")
	if err != nil {
		return nil, err
	}
	c := newAPI(base, "rider-app")
	if err := c.signInPhone(ctx, who.Phone); err != nil {
		return nil, err
	}
	fmt.Println("signed in  rider-sim")
	return c, nil
}

type offerView struct {
	OfferID string `json:"offer_id"`
	OrderID string `json:"order_id"`
}

func (c *apiClient) goOnline(ctx context.Context, p routePoint) error {
	_, _, err := c.call(ctx, http.MethodPut, "/v1/riders/me/availability", map[string]any{
		"is_online":  true,
		"latitude":   p.Lat,
		"longitude":  p.Lng,
		"accuracy_m": 10,
	}, false)
	if err != nil {
		return fmt.Errorf("devworld: go online: %w", err)
	}
	c.positionNotBefore = time.Now()
	return nil
}

func (c *apiClient) currentOffer(ctx context.Context) (offerView, bool, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/riders/me/offers/current", nil, false)
	if err != nil {
		return offerView{}, false, fmt.Errorf("devworld: current offer: %w", err)
	}
	if len(data) == 0 || string(data) == "null" {
		return offerView{}, false, nil
	}
	var offer offerView
	if jerr := json.Unmarshal(data, &offer); jerr != nil {
		return offerView{}, false, jerr
	}
	if offer.OfferID == "" {
		return offerView{}, false, nil
	}
	return offer, true, nil
}

func (c *apiClient) expectNoOffer(ctx context.Context, window time.Duration) error {
	deadline := time.Now().Add(window)
	for {
		offer, ok, err := c.currentOffer(ctx)
		if err != nil {
			return err
		}
		if ok {
			return fmt.Errorf("devworld: an offer arrived while the order was still preparing (%s)", offer.OrderID)
		}
		if !time.Now().Before(deadline) {
			fmt.Println("no offer while the order is preparing")
			return nil
		}
		if err := sleepCtx(ctx, time.Second); err != nil {
			return err
		}
	}
}

func (c *apiClient) waitOffer(ctx context.Context, orderID string, window time.Duration) (offerView, error) {
	deadline := time.Now().Add(window)
	for {
		offer, ok, err := c.currentOffer(ctx)
		if err != nil {
			return offerView{}, err
		}
		if ok {
			if offer.OrderID != orderID {
				return offerView{}, fmt.Errorf("devworld: offer %s is for %s, not %s", offer.OfferID, offer.OrderID, orderID)
			}
			fmt.Printf("offer  %s\n", offer.OfferID)
			return offer, nil
		}
		if !time.Now().Before(deadline) {
			return offerView{}, fmt.Errorf("devworld: no offer for %s after %s", orderID, window)
		}
		if err := sleepCtx(ctx, time.Second); err != nil {
			return offerView{}, err
		}
	}
}

func (c *apiClient) acceptOffer(ctx context.Context, offerID string) (string, routePoint, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/riders/me/offers/"+offerID+"/accept", map[string]any{}, true)
	if err != nil {
		return "", routePoint{}, fmt.Errorf("devworld: accept offer: %w", err)
	}
	var asn struct {
		ID     string `json:"id"`
		Pickup struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"pickup"`
	}
	if jerr := json.Unmarshal(data, &asn); jerr != nil || asn.ID == "" {
		return "", routePoint{}, errors.New("devworld: accept offer returned no assignment")
	}
	return asn.ID, routePoint{Lat: asn.Pickup.Latitude, Lng: asn.Pickup.Longitude}, nil
}

func (c *apiClient) transition(ctx context.Context, assignmentID, to string, p routePoint) error {
	_, _, err := c.call(ctx, http.MethodPost, "/v1/riders/me/assignments/"+assignmentID+"/transitions", map[string]any{
		"to_state":    to,
		"latitude":    p.Lat,
		"longitude":   p.Lng,
		"accuracy_m":  10,
		"occurred_at": time.Now().UTC().Format(time.RFC3339),
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: transition %s: %w", to, err)
	}
	return nil
}

func (c *apiClient) walk(ctx context.Context, pts []routePoint, assignmentID string, pace time.Duration) error {
	if len(pts) == 0 {
		return nil
	}
	if pace == 0 {
		return c.postPoints(ctx, pts, assignmentID)
	}
	for i := range pts {
		if err := c.postPoints(ctx, pts[i:i+1], assignmentID); err != nil {
			return err
		}
		if i < len(pts)-1 {
			if err := sleepCtx(ctx, pace); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *apiClient) postPoints(ctx context.Context, pts []routePoint, assignmentID string) error {
	for start := 0; start < len(pts); start += 10 {
		end := start + 10
		if end > len(pts) {
			end = len(pts)
		}
		chunk := pts[start:end]
		stamps, err := c.stamps(ctx, len(chunk))
		if err != nil {
			return err
		}
		points := make([]map[string]any, len(chunk))
		for i, p := range chunk {
			heading := 0.0
			if i+1 < len(chunk) {
				heading = headingDeg(p, chunk[i+1])
			} else if i > 0 {
				heading = headingDeg(chunk[i-1], p)
			}
			point := map[string]any{
				"latitude":    p.Lat,
				"longitude":   p.Lng,
				"accuracy_m":  10,
				"heading_deg": heading,
				"speed_mps":   5,
				"battery_pct": 80,
				"recorded_at": stamps[i].Format(time.RFC3339Nano),
			}
			if assignmentID != "" {
				point["assignment_id"] = assignmentID
			}
			points[i] = point
		}
		_, data, err := c.call(ctx, http.MethodPost, "/v1/riders/me/positions", map[string]any{"points": points}, false)
		if err != nil {
			return fmt.Errorf("devworld: positions: %w", err)
		}
		var ack struct {
			Accepted int `json:"accepted"`
			Rejected []struct {
				Index int    `json:"index"`
				Code  string `json:"code"`
			} `json:"rejected"`
		}
		if len(data) > 0 {
			_ = json.Unmarshal(data, &ack)
		}
		if len(ack.Rejected) > 0 {
			return fmt.Errorf("devworld: position %d rejected (%s)", ack.Rejected[0].Index, ack.Rejected[0].Code)
		}
		if ack.Accepted == 0 {
			return errors.New("devworld: positions accepted nothing")
		}
	}
	return nil
}

func (c *apiClient) stamps(ctx context.Context, n int) ([]time.Time, error) {
	end := time.Now().UTC().Add(-300 * time.Millisecond)
	if !c.positionNotBefore.IsZero() {
		need := c.positionNotBefore.Add(1100 * time.Millisecond)
		if end.Before(need) {
			if err := sleepCtx(ctx, need.Sub(time.Now())); err != nil {
				return nil, err
			}
			end = time.Now().UTC().Add(-300 * time.Millisecond)
		}
	}
	out := make([]time.Time, n)
	for i := 0; i < n; i++ {
		out[i] = end.Add(-time.Duration(n-1-i) * time.Second)
	}
	return out, nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
