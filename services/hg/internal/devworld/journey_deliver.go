package devworld

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	// paymentAuthoriseWait caps how long a created order may sit before the
	// ride gives up. The command's own deadline is five minutes, and the
	// settle poll plus the customer follow-ups still have to fit after this.
	paymentAuthoriseWait = 90 * time.Second
	// settleWindow is how long the command waits after DELIVERED for the
	// server to complete the order. The delivered deadline is two minutes.
	settleWindow = 150 * time.Second
	// followUpReserve leaves the receipt, rating, restaurant read and refund
	// enough of the command deadline to run after the settle poll stops.
	followUpReserve = 45 * time.Second
)

// deliverLeg picks the order up, walks the drop-off, records a proof photo
// and marks the assignment delivered. A refused seal does not stop it. The
// customer follow-ups run after delivery even when the order stays delivered.
func deliverLeg(ctx context.Context, cust, kitchen, rider *apiClient, order placedOrder, assignmentID string, pickup routePoint) error {
	if kitchen == nil || rider == nil {
		return errors.New("devworld: delivery needs the restaurant and rider sessions")
	}
	if err := kitchen.recordSeal(ctx, order); err != nil {
		return err
	}
	if err := rider.transition(ctx, assignmentID, "PICKED_UP", pickup); err != nil {
		return err
	}
	fmt.Println("assignment  PICKED_UP")
	if _, err := observeOrder(ctx, cust, order.ID); err != nil {
		fmt.Printf("order read  %s\n", codeOf(err))
	}

	drop := rider.dropoffPoint(ctx, assignmentID)
	leg := interpolate(pickup, drop, 6)
	if err := rider.walk(ctx, leg, assignmentID, 0); err != nil {
		return err
	}
	fmt.Printf("dropoff walked  %.5f,%.5f\n", drop.Lat, drop.Lng)
	if err := rider.transition(ctx, assignmentID, "EN_ROUTE_TO_DROPOFF", drop); err != nil {
		return err
	}
	fmt.Println("assignment  EN_ROUTE_TO_DROPOFF")
	if err := rider.transition(ctx, assignmentID, "ARRIVED_AT_DROPOFF", drop); err != nil {
		return err
	}
	fmt.Println("assignment  ARRIVED_AT_DROPOFF")
	if err := rider.submitProof(ctx, assignmentID, order.ID); err != nil {
		return err
	}
	if err := rider.transition(ctx, assignmentID, "DELIVERED", drop); err != nil {
		return err
	}
	fmt.Println("assignment  DELIVERED")

	_, serr := pollSettled(ctx, cust, order.ID)
	ferr := customerFollowUps(ctx, cust, kitchen, order.ID)
	return errors.Join(serr, ferr)
}

func (c *apiClient) recordSeal(ctx context.Context, order placedOrder) error {
	_, _, err := c.call(ctx, http.MethodPost, "/v1/orders/"+order.ID+"/handoff/seal", map[string]string{
		"seal_code": "DEVWORLD",
	}, true)
	if err == nil {
		fmt.Printf("seal bound  %s\n", order.Code)
		return nil
	}
	var api *apiError
	if errors.As(err, &api) {
		fmt.Printf("seal refused  http %d  %s\n", api.Status, api.Code)
		return nil
	}
	return fmt.Errorf("devworld: seal: %w", err)
}

func (c *apiClient) dropoffPoint(ctx context.Context, assignmentID string) routePoint {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/riders/me/assignments/"+assignmentID, nil, false)
	if err != nil {
		fmt.Println("dropoff read failed; using the seeded customer pin")
		return customerPoint
	}
	var asn struct {
		Dropoff struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"dropoff"`
	}
	if json.Unmarshal(data, &asn) != nil || (asn.Dropoff.Latitude == 0 && asn.Dropoff.Longitude == 0) {
		fmt.Println("dropoff pin is empty; using the seeded customer pin")
		return customerPoint
	}
	return routePoint{Lat: asn.Dropoff.Latitude, Lng: asn.Dropoff.Longitude}
}

type presignedPut struct {
	UploadID        string            `json:"upload_id"`
	URL             string            `json:"url"`
	Method          string            `json:"method"`
	RequiredHeaders map[string]string `json:"required_headers"`
}

func (c *apiClient) submitProof(ctx context.Context, assignmentID, orderID string) error {
	jpegBytes, sum, err := proofJPEG()
	if err != nil {
		return err
	}
	_, data, err := c.call(ctx, http.MethodPost, "/v1/uploads", map[string]any{
		"purpose":      "POD",
		"content_type": "image/jpeg",
		"byte_size":    len(jpegBytes),
		"sha256":       hex.EncodeToString(sum[:]),
		"order_id":     orderID,
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: pod upload: %w", err)
	}
	var put presignedPut
	if json.Unmarshal(data, &put) != nil || put.URL == "" || put.UploadID == "" {
		return errors.New("devworld: pod upload returned no url")
	}
	if err := putPresigned(ctx, put, jpegBytes); err != nil {
		return err
	}
	_, confirmed, err := c.call(ctx, http.MethodPost, "/v1/uploads/"+put.UploadID+"/confirm", map[string]any{}, true)
	if err != nil {
		return fmt.Errorf("devworld: pod confirm: %w", err)
	}
	var stored struct {
		ID    string `json:"id"`
		State string `json:"state"`
	}
	_ = json.Unmarshal(confirmed, &stored)
	objectID := stored.ID
	if objectID == "" {
		objectID = put.UploadID
	}
	if stored.State == "" {
		fmt.Println("pod photo  confirmed")
	} else {
		fmt.Printf("pod photo  %s\n", stored.State)
	}
	body := map[string]any{"method": "PHOTO", "photo_object_id": objectID}
	_, _, err = c.call(ctx, http.MethodPost, "/v1/riders/me/assignments/"+assignmentID+"/proof-of-delivery", body, true)
	if isCode(err, "POD_METHOD_MISMATCH") {
		body = map[string]any{
			"method":             "PHOTO_WITH_ATTESTATION",
			"photo_object_id":    objectID,
			"attestation_reason": "Door delivery photographed at the drop-off.",
		}
		_, _, err = c.call(ctx, http.MethodPost, "/v1/riders/me/assignments/"+assignmentID+"/proof-of-delivery", body, true)
	}
	if err != nil {
		return fmt.Errorf("devworld: proof of delivery: %w", err)
	}
	fmt.Println("proof recorded")
	return nil
}

func putPresigned(ctx context.Context, put presignedPut, body []byte) error {
	method := put.Method
	if method == "" {
		method = http.MethodPut
	}
	req, err := http.NewRequestWithContext(ctx, method, put.URL, bytes.NewReader(body))
	if err != nil {
		return errors.New("devworld: pod put: bad upload url")
	}
	req.ContentLength = int64(len(body))
	for k, v := range put.RequiredHeaders {
		req.Header.Set(k, v)
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("devworld: pod put: %s", redactSecrets(err.Error()))
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("devworld: pod put http %d", res.StatusCode)
	}
	return nil
}

// proofJPEG returns a JPEG large enough for the upload check. Bytes after the
// end of the image pad it to 1024 without changing the picture.
func proofJPEG() ([]byte, [32]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	green := color.RGBA{R: 0x2E, G: 0x7D, B: 0x32, A: 0xFF}
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			img.SetRGBA(x, y, green)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 80}); err != nil {
		return nil, [32]byte{}, fmt.Errorf("devworld: proof jpeg: %w", err)
	}
	raw := buf.Bytes()
	if len(raw) < 1024 {
		raw = append(raw, make([]byte, 1024-len(raw))...)
	}
	return raw, sha256.Sum256(raw), nil
}

type orderView struct {
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	State       string  `json:"state"`
	StateSince  string  `json:"state_since"`
	PlacedAt    string  `json:"placed_at"`
	AcceptedAt  *string `json:"accepted_at"`
	ReadyAt     *string `json:"ready_at"`
	PickedUpAt  *string `json:"picked_up_at"`
	DeliveredAt *string `json:"delivered_at"`
	CompletedAt *string `json:"completed_at"`
}

func (c *apiClient) getOrder(ctx context.Context, id string) (orderView, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders/"+id, nil, false)
	if err != nil {
		return orderView{}, fmt.Errorf("devworld: get order: %w", err)
	}
	var v orderView
	if jerr := json.Unmarshal(data, &v); jerr != nil {
		return orderView{}, jerr
	}
	return v, nil
}

func observeOrder(ctx context.Context, cust *apiClient, id string) (orderView, error) {
	v, err := cust.getOrder(ctx, id)
	if err != nil {
		return orderView{}, err
	}
	printOrderView(v)
	return v, nil
}

func printOrderView(v orderView) {
	fmt.Printf("state  %s  %s  state_since %s", v.Code, v.State, v.StateSince)
	for _, ts := range []struct{ name, val string }{
		{"placed_at", v.PlacedAt},
		{"accepted_at", deref(v.AcceptedAt)},
		{"ready_at", deref(v.ReadyAt)},
		{"picked_up_at", deref(v.PickedUpAt)},
		{"delivered_at", deref(v.DeliveredAt)},
		{"completed_at", deref(v.CompletedAt)},
	} {
		if ts.val != "" {
			fmt.Printf("  %s %s", ts.name, ts.val)
		}
	}
	fmt.Println()
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func pollSettled(ctx context.Context, cust *apiClient, orderID string) (orderView, error) {
	var view orderView
	last := ""
	var deliveredSince time.Time
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		next, err := cust.getOrder(ctx, orderID)
		if err != nil {
			return view, err
		}
		view = next
		if view.State != last {
			printOrderView(view)
			last = view.State
		}
		if view.State == "COMPLETED" {
			return view, nil
		}
		if view.State == "DELIVERED" {
			if deliveredSince.IsZero() {
				deliveredSince = time.Now()
			}
			if time.Since(deliveredSince) >= settleWindow {
				fmt.Println("order stayed DELIVERED after the settle window")
				return view, errors.New("devworld: order stayed DELIVERED after the settle window")
			}
		}
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < followUpReserve {
			fmt.Printf("settle poll stopped  %s\n", view.State)
			if view.State != "COMPLETED" {
				return view, fmt.Errorf("devworld: settle poll stopped with %s; context nearly spent", view.State)
			}
		}
		select {
		case <-ctx.Done():
			return view, ctx.Err()
		case <-tick.C:
		}
	}
}

func customerFollowUps(ctx context.Context, cust, kitchen *apiClient, orderID string) error {
	return errors.Join(
		readReceipt(ctx, cust, orderID),
		rateOrder(ctx, cust, orderID),
		readRestaurantOrder(ctx, kitchen, orderID),
		requestRefund(ctx, cust, orderID),
	)
}

func readReceipt(ctx context.Context, cust *apiClient, orderID string) error {
	status, _, err := cust.call(ctx, http.MethodGet, "/v1/orders/"+orderID+"/receipt", nil, false)
	if err != nil {
		fmt.Printf("receipt  http %d  %s\n", status, codeOf(err))
		return fmt.Errorf("devworld: receipt: %w", err)
	}
	fmt.Printf("receipt  http %d\n", status)
	return nil
}

func rateOrder(ctx context.Context, cust *apiClient, orderID string) error {
	food := map[string]any{"score": 5, "tags": []any{}}
	rider := map[string]any{"score": 5, "tags": []any{}}
	status, _, err := cust.call(ctx, http.MethodPut, "/v1/orders/"+orderID+"/rating", map[string]any{
		"food":  food,
		"rider": rider,
	}, true)
	if err == nil {
		fmt.Printf("rating  http %d\n", status)
		return nil
	}
	fmt.Printf("rating  http %d  %s\n", status, codeOf(err))
	status, _, foodErr := cust.call(ctx, http.MethodPut, "/v1/orders/"+orderID+"/rating", map[string]any{
		"food": food,
	}, true)
	if foodErr != nil {
		fmt.Printf("rating food  http %d  %s\n", status, codeOf(foodErr))
		return errors.Join(
			fmt.Errorf("devworld: rating: %w", err),
			fmt.Errorf("devworld: rating food: %w", foodErr),
		)
	}
	fmt.Printf("rating food  http %d\n", status)
	return fmt.Errorf("devworld: rating rider: %w", err)
}

func readRestaurantOrder(ctx context.Context, kitchen *apiClient, orderID string) error {
	if kitchen == nil {
		fmt.Println("restaurant  skipped")
		return errors.New("devworld: restaurant read skipped")
	}
	status, data, err := kitchen.call(ctx, http.MethodGet, "/v1/restaurant/orders/"+orderID, nil, false)
	if err != nil {
		fmt.Printf("restaurant  http %d  %s\n", status, codeOf(err))
		return fmt.Errorf("devworld: restaurant order: %w", err)
	}
	var body struct {
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &body)
	fmt.Printf("restaurant  http %d  %s\n", status, body.State)
	if body.State != "COMPLETED" {
		return fmt.Errorf("devworld: restaurant order is %s", body.State)
	}
	return nil
}

func requestRefund(ctx context.Context, cust *apiClient, orderID string) error {
	status, data, err := cust.call(ctx, http.MethodPost, "/v1/refunds", map[string]any{
		"order_id":    orderID,
		"kind":        "FULL",
		"reason_code": "ITEM_MISSING",
	}, true)
	if err != nil {
		fmt.Printf("refund  http %d  %s\n", status, codeOf(err))
		return fmt.Errorf("devworld: refund: %w", err)
	}
	var body struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(data, &body)
	if body.ID == "" {
		fmt.Printf("refund  http %d\n", status)
	} else {
		fmt.Printf("refund  http %d  %s\n", status, body.ID)
	}
	return nil
}

func codeOf(err error) string {
	var api *apiError
	if errors.As(err, &api) {
		if api.Code != "" {
			return api.Code
		}
		return fmt.Sprintf("http %d", api.Status)
	}
	return "transport"
}

// confirmTestCard confirms a created order's test-card PaymentIntent. It does
// nothing when no test secret is in the process environment. It never prints
// the secret, the client secret, or the intent id.
func confirmTestCard(ctx context.Context, clientSecret string) error {
	key := stripeTestKey()
	if key == "" {
		fmt.Println("card confirm skipped")
		return nil
	}
	if strings.Contains(key, "_live_") {
		return errors.New("devworld: refusing a live stripe key")
	}
	intentID, err := paymentIntentID(clientSecret)
	if err != nil {
		return err
	}
	form := url.Values{}
	form.Set("payment_method", "pm_card_visa")
	// The intent allows redirect-based methods, so Stripe refuses a confirm
	// that has no return URL. The test card does not redirect.
	form.Set("return_url", "http://127.0.0.1:8080/pay/return")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.stripe.com/v1/payment_intents/"+intentID+"/confirm",
		strings.NewReader(form.Encode()))
	if err != nil {
		return errors.New("devworld: card confirm: bad request")
	}
	req.SetBasicAuth(key, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("devworld: card confirm: %s", redactSecrets(err.Error()))
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("devworld: card confirm http %d", res.StatusCode)
	}
	var parsed struct {
		Status string `json:"status"`
		Error  *struct {
			Code    string `json:"code"`
			Type    string `json:"type"`
			Param   string `json:"param"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &parsed)
	if res.StatusCode >= 300 {
		detail := ""
		if parsed.Error != nil {
			detail = strings.TrimSpace(strings.Join([]string{parsed.Error.Type, parsed.Error.Code, parsed.Error.Param, parsed.Error.Message}, " "))
		}
		detail = redactSecrets(detail)
		if len(detail) > 180 {
			detail = detail[:180]
		}
		return fmt.Errorf("devworld: card confirm http %d %s", res.StatusCode, detail)
	}
	status := parsed.Status
	if !statusWord.MatchString(status) {
		status = "unreadable"
	}
	fmt.Printf("card confirmed  %s\n", status)
	return nil
}

func stripeTestKey() string {
	for _, name := range []string{"HG_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY"} {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v
		}
	}
	return ""
}

func paymentIntentID(clientSecret string) (string, error) {
	if !strings.HasPrefix(clientSecret, "pi_") {
		return "", errors.New("devworld: card confirm: client secret is not a payment intent secret")
	}
	// Stripe's own client secret is pi_<id>_secret_<tail>. This API instead
	// returns the intent id with a _secret suffix (cmd/hg/main.go).
	if i := strings.Index(clientSecret, "_secret_"); i >= 4 {
		return clientSecret[:i], nil
	}
	const suffix = "_secret"
	if strings.HasSuffix(clientSecret, suffix) && len(clientSecret) > len("pi_")+len(suffix) {
		return strings.TrimSuffix(clientSecret, suffix), nil
	}
	return "", errors.New("devworld: card confirm: client secret is not a payment intent secret")
}

var (
	secretRE   = regexp.MustCompile(`(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+|pi_[A-Za-z0-9]+`)
	statusWord = regexp.MustCompile(`^[a-z_]{1,40}$`)
)

func redactSecrets(s string) string {
	return secretRE.ReplaceAllString(s, "[redacted]")
}
