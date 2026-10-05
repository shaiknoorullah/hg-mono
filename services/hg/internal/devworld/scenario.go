package devworld

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

// Scenario catalogue. Each one calls the running API. None of them writes a
// row. The journey, which moves a rider along a route, is a separate command.

const (
	itemChickenKarahi = "f0000000-0000-4000-8000-000000000281"
	itemDraftStew     = "f0000000-0000-4000-8000-000000000271"
	versionDraftStew  = "f0000000-0000-4000-8000-000000000371"
	addressAminaNear  = "c0000000-0000-4000-8000-000000000101"
	docInReview       = "d0000000-0000-4000-8000-000000000304"
	restaurantDocs    = "b0000000-0000-4000-8000-000000000204"
)

// ScenarioNames is the catalogue `devworld scenario` accepts, in run order.
var ScenarioNames = []string{
	"new-order",
	"rush",
	"order-preparing",
	"order-ready",
	"customer-cancels",
	"restaurant-rejected",
	"docs-approve",
	"docs-reject",
	"menu-approve",
	"menu-reject",
}

// RunScenario signs in as the personas the scenario needs and calls the API
// at baseURL. It prints each step. A non-nil error means the scenario did
// not reach the state the current API can produce.
func RunScenario(ctx context.Context, baseURL, name string) error {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return errors.New("devworld: scenario requires an API base URL")
	}
	if !knownScenario(name) {
		return fmt.Errorf("devworld: unknown scenario %q", name)
	}
	fmt.Printf("scenario %s  api %s\n", name, baseURL)
	switch name {
	case "new-order":
		return scenarioNewOrder(ctx, baseURL)
	case "rush":
		return scenarioRush(ctx, baseURL)
	case "order-preparing":
		return scenarioPreparing(ctx, baseURL)
	case "order-ready":
		return scenarioReady(ctx, baseURL)
	case "customer-cancels":
		return scenarioCustomerCancels(ctx, baseURL)
	case "restaurant-rejected":
		return scenarioRestaurantRejected(ctx, baseURL)
	case "docs-approve":
		return scenarioDocs(ctx, baseURL, "APPROVE", "")
	case "docs-reject":
		return scenarioDocs(ctx, baseURL, "REJECT", "ILLEGIBLE")
	case "menu-approve":
		return scenarioMenu(ctx, baseURL, "APPROVE", "")
	case "menu-reject":
		return scenarioMenu(ctx, baseURL, "REJECT", "MISLEADING_DESCRIPTION")
	default:
		return fmt.Errorf("devworld: unknown scenario %q", name)
	}
}

// PrintScenarios writes the catalogue to stdout.
func PrintScenarios() {
	for _, name := range ScenarioNames {
		fmt.Println(name)
	}
}

func knownScenario(name string) bool {
	for _, n := range ScenarioNames {
		if n == name {
			return true
		}
	}
	return false
}

type placedOrder struct {
	ID    string
	Code  string
	State string
}

func scenarioNewOrder(ctx context.Context, base string) error {
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	order, err := cust.place(ctx)
	if err != nil {
		if existing, ok := cust.activeIfConflict(ctx, err); ok && existing.State == "RESTAURANT_PENDING" {
			fmt.Printf("already  %s  %s\n", existing.Code, existing.State)
			return nil
		}
		return err
	}
	if order.State != "RESTAURANT_PENDING" {
		return fmt.Errorf("devworld: new-order left %s in %s", order.Code, order.State)
	}
	fmt.Printf("order %s  %s\n", order.Code, order.State)
	return nil
}

func scenarioPreparing(ctx context.Context, base string) error {
	order, err := orderAt(ctx, base, "RESTAURANT_PENDING")
	if err != nil {
		return err
	}
	if order.State == "PREPARING" {
		fmt.Printf("already  %s  %s\n", order.Code, order.State)
		return nil
	}
	rest, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	got, err := rest.accept(ctx, order.ID)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", got.Code, got.State)
	if got.State != "PREPARING" {
		return fmt.Errorf("devworld: accept left %s in %s", got.Code, got.State)
	}
	return nil
}

func scenarioReady(ctx context.Context, base string) error {
	order, err := orderAt(ctx, base, "PREPARING")
	if err != nil {
		return err
	}
	rest, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	if order.State == "RESTAURANT_PENDING" {
		order, err = rest.accept(ctx, order.ID)
		if err != nil {
			return err
		}
		fmt.Printf("accepted  %s  %s\n", order.Code, order.State)
	}
	if order.State == "READY_FOR_PICKUP" {
		fmt.Printf("already  %s  %s\n", order.Code, order.State)
		return nil
	}
	got, err := rest.ready(ctx, order.ID)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", got.Code, got.State)
	if got.State != "READY_FOR_PICKUP" {
		return fmt.Errorf("devworld: ready left %s in %s", got.Code, got.State)
	}
	return nil
}

func scenarioCustomerCancels(ctx context.Context, base string) error {
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	order, err := pendingOrPlace(ctx, cust)
	if err != nil {
		return err
	}
	got, err := cust.cancel(ctx, order.ID)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", got.Code, got.State)
	if got.State != "CANCELLED" {
		return fmt.Errorf("devworld: cancel left %s in %s", got.Code, got.State)
	}
	return nil
}

func scenarioRestaurantRejected(ctx context.Context, base string) error {
	order, err := orderAt(ctx, base, "RESTAURANT_PENDING")
	if err != nil {
		return err
	}
	if order.State != "RESTAURANT_PENDING" {
		return fmt.Errorf("devworld: restaurant-rejected needs a pending order, found %s in %s", order.Code, order.State)
	}
	rest, err := restaurant(ctx, base, "bismillah-grill")
	if err != nil {
		return err
	}
	got, err := rest.reject(ctx, order.ID)
	if err != nil {
		return err
	}
	fmt.Printf("order %s  %s\n", got.Code, got.State)
	if got.State != "REJECTED" {
		return fmt.Errorf("devworld: reject left %s in %s", got.Code, got.State)
	}
	return nil
}

func scenarioRush(ctx context.Context, base string) error {
	amina, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	nour, err := customer(ctx, base, "nour")
	if err != nil {
		return err
	}
	first, err := amina.place(ctx)
	if err != nil {
		if existing, ok := amina.activeIfConflict(ctx, err); ok {
			first = existing
			fmt.Printf("amina already  %s  %s\n", existing.Code, existing.State)
		} else {
			return err
		}
	} else {
		fmt.Printf("amina  %s  %s\n", first.Code, first.State)
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(2 * time.Second):
	}
	second, err := nour.place(ctx)
	if err != nil {
		if existing, ok := nour.activeIfConflict(ctx, err); ok {
			second = existing
			fmt.Printf("nour already  %s  %s\n", existing.Code, existing.State)
		} else {
			return err
		}
	} else {
		fmt.Printf("nour  %s  %s\n", second.Code, second.State)
	}
	again, err := amina.place(ctx)
	if err == nil {
		return fmt.Errorf("devworld: rush placed a second active order for amina (%s %s)", again.Code, again.State)
	}
	if !isConflict(err, "ACTIVE_ORDER_EXISTS") {
		return err
	}
	fmt.Printf("rush placed 2 orders; a further order for amina was refused (%s)\n", err.Error())
	return nil
}

func scenarioDocs(ctx context.Context, base, decision, reason string) error {
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	body := map[string]any{"decision": decision}
	if reason != "" {
		body["rejection_reason_code"] = reason
	}
	status, data, callErr := admin.call(ctx, http.MethodPost, "/v1/admin/restaurant-documents/"+docInReview+"/review", body, true)
	if callErr != nil {
		return callErr
	}
	var doc struct {
		State string `json:"state"`
	}
	_ = json.Unmarshal(data, &doc)
	fmt.Printf("document %s  http %d  state %s\n", docInReview, status, doc.State)
	appStatus, appData, appErr := admin.call(ctx, http.MethodGet, "/v1/admin/restaurant-applications/"+restaurantDocs, nil, false)
	if appErr == nil {
		var app struct {
			OnboardingState string `json:"onboarding_state"`
		}
		_ = json.Unmarshal(appData, &app)
		fmt.Printf("onboarding  http %d  state %s\n", appStatus, app.OnboardingState)
	} else {
		fmt.Printf("onboarding  %s\n", appErr.Error())
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("devworld: document %s was not decided (http %d)", decision, status)
	}
	return nil
}

func scenarioMenu(ctx context.Context, base, decision, reason string) error {
	owner, err := staff(ctx, base, "menu", "restaurant-web")
	if err != nil {
		return err
	}
	desc := "Lentil stew, saved by the scenario so a reviewer can decide it."
	status, data, callErr := owner.call(ctx, http.MethodPatch, "/v1/restaurant/menu/items/"+itemDraftStew, map[string]any{
		"description": desc,
	}, true)
	versionID, reviewStatus := "", ""
	if callErr == nil {
		var item struct {
			LiveVersion *struct {
				ID           string `json:"id"`
				ReviewStatus string `json:"review_status"`
			} `json:"live_version"`
			PendingVersion *struct {
				ID           string `json:"id"`
				ReviewStatus string `json:"review_status"`
			} `json:"pending_version"`
		}
		_ = json.Unmarshal(data, &item)
		if item.LiveVersion != nil {
			versionID, reviewStatus = item.LiveVersion.ID, item.LiveVersion.ReviewStatus
		}
		if item.PendingVersion != nil && item.PendingVersion.ReviewStatus != "" {
			versionID, reviewStatus = item.PendingVersion.ID, item.PendingVersion.ReviewStatus
		}
	}
	fmt.Printf("menu save  http %d  version %s  review %s\n", status, versionID, reviewStatus)
	if versionID == "" {
		versionID = versionDraftStew
		fmt.Printf("menu save returned no version; deciding the seeded draft %s\n", versionID)
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	body := map[string]any{"decision": decision}
	if reason != "" {
		body["reason_code"] = reason
	}
	decStatus, _, decErr := admin.call(ctx, http.MethodPost, "/v1/admin/menu-reviews/"+versionID+"/decision", body, true)
	if decErr != nil && decStatus == 0 {
		return decErr
	}
	fmt.Printf("menu decision %s  http %d\n", decision, decStatus)
	if decErr != nil {
		fmt.Printf("menu decision error  %s\n", decErr.Error())
	}
	if status >= 200 && status < 300 && decStatus >= 200 && decStatus < 300 {
		fmt.Println("menu decision accepted")
		return nil
	}
	if decStatus == http.StatusConflict {
		return fmt.Errorf("devworld: menu %s blocked: restaurant save returned http %d (review %s) and the decision was refused (http %d)", decision, status, reviewStatus, decStatus)
	}
	if callErr != nil {
		return fmt.Errorf("devworld: menu save: %w", callErr)
	}
	if decErr != nil {
		return decErr
	}
	return fmt.Errorf("devworld: menu %s failed (save http %d, decision http %d)", decision, status, decStatus)
}

// orderAt returns amina's active order when it is already at want or earlier
// in the accept path, and otherwise places a new one.
func orderAt(ctx context.Context, base, want string) (placedOrder, error) {
	cust, err := customer(ctx, base, "amina")
	if err != nil {
		return placedOrder{}, err
	}
	active, err := cust.active(ctx)
	if err != nil {
		return placedOrder{}, err
	}
	if active.ID != "" {
		switch want {
		case "RESTAURANT_PENDING":
			if active.State == "RESTAURANT_PENDING" || active.State == "PREPARING" {
				fmt.Printf("using  %s  %s\n", active.Code, active.State)
				return active, nil
			}
		case "PREPARING":
			if active.State == "RESTAURANT_PENDING" || active.State == "PREPARING" || active.State == "READY_FOR_PICKUP" {
				fmt.Printf("using  %s  %s\n", active.Code, active.State)
				return active, nil
			}
		}
		return placedOrder{}, fmt.Errorf("devworld: amina already has %s in %s", active.Code, active.State)
	}
	return cust.place(ctx)
}

func pendingOrPlace(ctx context.Context, cust *apiClient) (placedOrder, error) {
	active, err := cust.active(ctx)
	if err != nil {
		return placedOrder{}, err
	}
	if active.ID == "" {
		return cust.place(ctx)
	}
	if active.State != "RESTAURANT_PENDING" {
		return placedOrder{}, fmt.Errorf("devworld: %s is %s; a customer can cancel only while the restaurant has not accepted", active.Code, active.State)
	}
	fmt.Printf("using  %s  %s\n", active.Code, active.State)
	return active, nil
}

func customer(ctx context.Context, base, slug string) (*apiClient, error) {
	who, err := identity(slug)
	if err != nil {
		return nil, err
	}
	c := newAPI(base, "customer-app")
	if err := c.signInPhone(ctx, who.Phone); err != nil {
		return nil, err
	}
	if slug == "amina" {
		c.addressID = addressAminaNear
	} else if err := c.ensureAddress(ctx); err != nil {
		return nil, err
	}
	fmt.Printf("signed in  %s\n", slug)
	return c, nil
}

func restaurant(ctx context.Context, base, slug string) (*apiClient, error) {
	return staff(ctx, base, slug, "restaurant-web")
}

func staff(ctx context.Context, base, slug, surface string) (*apiClient, error) {
	who, err := identity(slug)
	if err != nil {
		return nil, err
	}
	c := newAPI(base, surface)
	if err := c.signInEmail(ctx, who.Email); err != nil {
		return nil, err
	}
	fmt.Printf("signed in  %s\n", slug)
	return c, nil
}

func identity(slug string) (Identity, error) {
	for _, id := range World {
		if id.Slug == slug {
			return id, nil
		}
	}
	return Identity{}, fmt.Errorf("devworld: no persona %s", slug)
}

type apiClient struct {
	base              string
	surface           string
	token             string
	addressID         string
	http              *http.Client
	positionNotBefore time.Time
}

func newAPI(base, surface string) *apiClient {
	return &apiClient{
		base:    base,
		surface: surface,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("http %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("http %d %s: %s", e.Status, e.Code, e.Message)
}

func isConflict(err error, code string) bool {
	var api *apiError
	return errors.As(err, &api) && api.Status == http.StatusConflict && api.Code == code
}

func (c *apiClient) activeIfConflict(ctx context.Context, err error) (placedOrder, bool) {
	if !isConflict(err, "ACTIVE_ORDER_EXISTS") {
		return placedOrder{}, false
	}
	order, aerr := c.active(ctx)
	if aerr != nil || order.ID == "" {
		return placedOrder{}, false
	}
	return order, true
}

func (c *apiClient) signInPhone(ctx context.Context, phone string) error {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/auth/otp/request", map[string]string{
		"phone_e164": phone,
		"purpose":    "SIGN_IN",
	}, false)
	if err != nil {
		return fmt.Errorf("devworld: otp request: %w", err)
	}
	var ch struct {
		ChallengeID string `json:"challenge_id"`
	}
	if jerr := json.Unmarshal(data, &ch); jerr != nil || ch.ChallengeID == "" {
		return fmt.Errorf("devworld: otp request returned no challenge")
	}
	_, data, err = c.call(ctx, http.MethodPost, "/v1/auth/otp/verify", map[string]string{
		"challenge_id": ch.ChallengeID,
		"code":         auth.TestSignInCode,
	}, false)
	if err != nil {
		return fmt.Errorf("devworld: otp verify: %w", err)
	}
	return c.keepToken(data)
}

func (c *apiClient) signInEmail(ctx context.Context, email string) error {
	body := map[string]string{"email": email, "password": PersonaPassword}
	status, data, err := c.call(ctx, http.MethodPost, "/v1/auth/login", body, false)
	if err != nil && status == http.StatusForbidden && isCode(err, "MFA_REQUIRED") {
		secret, serr := AdminTOTPSecret(email)
		if serr != nil {
			return serr
		}
		code, cerr := totp.GenerateCode(secret, time.Now())
		if cerr != nil {
			return cerr
		}
		body["totp_code"] = code
		_, data, err = c.call(ctx, http.MethodPost, "/v1/auth/login", body, false)
	}
	if err != nil {
		return fmt.Errorf("devworld: login %s: %w", email, err)
	}
	return c.keepToken(data)
}

func isCode(err error, code string) bool {
	var api *apiError
	return errors.As(err, &api) && api.Code == code
}

func (c *apiClient) keepToken(data json.RawMessage) error {
	var grant struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(data, &grant); err != nil || grant.AccessToken == "" {
		return errors.New("devworld: sign-in returned no access token")
	}
	c.token = grant.AccessToken
	return nil
}

func (c *apiClient) place(ctx context.Context) (placedOrder, error) {
	_, cartData, err := c.call(ctx, http.MethodPost, "/v1/cart/lines?replace=true", map[string]any{
		"menu_item_id": itemChickenKarahi,
		"quantity":     1,
		"addons":       []any{},
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: cart: %w", err)
	}
	var cart struct {
		ID string `json:"id"`
	}
	if jerr := json.Unmarshal(cartData, &cart); jerr != nil || cart.ID == "" {
		return placedOrder{}, errors.New("devworld: cart returned no id")
	}
	if c.addressID == "" {
		return placedOrder{}, errors.New("devworld: customer has no delivery address")
	}
	_, quoteData, err := c.call(ctx, http.MethodPost, "/v1/quotes", map[string]any{
		"cart_id":             cart.ID,
		"delivery_address_id": c.addressID,
		"fulfilment":          "DELIVERY",
		"tip_cents":           0,
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: quote: %w", err)
	}
	var quote struct {
		ID string `json:"id"`
	}
	if jerr := json.Unmarshal(quoteData, &quote); jerr != nil || quote.ID == "" {
		return placedOrder{}, errors.New("devworld: quote returned no id")
	}
	_, orderData, err := c.call(ctx, http.MethodPost, "/v1/orders", map[string]any{
		"quote_id": quote.ID,
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: order: %w", err)
	}
	var created struct {
		Order        placedOrder `json:"order"`
		ClientSecret string      `json:"client_secret"`
	}
	if jerr := json.Unmarshal(orderData, &created); jerr != nil || created.Order.ID == "" {
		return placedOrder{}, errors.New("devworld: order returned no id")
	}
	fmt.Printf("placed  %s  %s\n", created.Order.Code, created.Order.State)
	if created.Order.State == "CREATED" {
		secret := created.ClientSecret
		created.ClientSecret = ""
		if secret == "" {
			fmt.Println("card confirm skipped  no client secret")
		} else if err := confirmTestCard(ctx, secret); err != nil {
			return placedOrder{}, err
		}
	}
	return created.Order, nil
}

func (c *apiClient) active(ctx context.Context) (placedOrder, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/orders/active", nil, false)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: active order: %w", err)
	}
	if len(data) == 0 || string(data) == "null" {
		return placedOrder{}, nil
	}
	var order placedOrder
	if jerr := json.Unmarshal(data, &order); jerr != nil {
		return placedOrder{}, jerr
	}
	return order, nil
}

func (c *apiClient) cancel(ctx context.Context, orderID string) (placedOrder, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/orders/"+orderID+"/cancel", map[string]string{
		"reason_code": "CHANGED_MIND",
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: cancel: %w", err)
	}
	return decodeOrder(data)
}

func (c *apiClient) accept(ctx context.Context, orderID string) (placedOrder, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/restaurant/orders/"+orderID+"/accept", map[string]any{
		"prep_eta_minutes": 20,
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: accept: %w", err)
	}
	return decodeOrder(data)
}

func (c *apiClient) reject(ctx context.Context, orderID string) (placedOrder, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/restaurant/orders/"+orderID+"/reject", map[string]string{
		"reason_code": "KITCHEN_AT_CAPACITY",
	}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: reject: %w", err)
	}
	return decodeOrder(data)
}

func (c *apiClient) ready(ctx context.Context, orderID string) (placedOrder, error) {
	_, data, err := c.call(ctx, http.MethodPost, "/v1/restaurant/orders/"+orderID+"/ready", map[string]any{}, true)
	if err != nil {
		return placedOrder{}, fmt.Errorf("devworld: ready: %w", err)
	}
	return decodeOrder(data)
}

func decodeOrder(data json.RawMessage) (placedOrder, error) {
	var order placedOrder
	if err := json.Unmarshal(data, &order); err != nil {
		return placedOrder{}, err
	}
	if order.ID == "" && order.Code == "" {
		return placedOrder{}, errors.New("devworld: response had no order")
	}
	return order, nil
}

func (c *apiClient) call(ctx context.Context, method, path string, body any, idem bool) (int, json.RawMessage, error) {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rdr = strings.NewReader(string(raw))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("X-HG-Client", c.surface)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if idem {
		req.Header.Set("Idempotency-Key", newIdemKey())
	}
	res, err := c.http.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return res.StatusCode, nil, err
	}
	var env struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if len(payload) > 0 {
		if jerr := json.Unmarshal(payload, &env); jerr != nil {
			return res.StatusCode, nil, fmt.Errorf("http %d: %s", res.StatusCode, trimBody(payload))
		}
	}
	if res.StatusCode >= 400 {
		msg := trimBody(payload)
		code := ""
		if env.Error != nil {
			code = env.Error.Code
			if env.Error.Message != "" {
				msg = env.Error.Message
			}
		}
		return res.StatusCode, env.Data, &apiError{Status: res.StatusCode, Code: code, Message: msg}
	}
	return res.StatusCode, env.Data, nil
}

func newIdemKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func trimBody(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		return s[:300]
	}
	return s
}

// ensureAddress reuses the customer's first saved address, or creates one
// beside the seeded restaurant. Amina keeps the address the world SQL inserts.
func (c *apiClient) ensureAddress(ctx context.Context) error {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/addresses", nil, false)
	if err != nil {
		return fmt.Errorf("devworld: list addresses: %w", err)
	}
	var list []struct {
		ID string `json:"id"`
	}
	if len(data) > 0 && string(data) != "null" {
		if jerr := json.Unmarshal(data, &list); jerr != nil {
			return fmt.Errorf("devworld: list addresses: %w", jerr)
		}
	}
	if len(list) > 0 && list[0].ID != "" {
		c.addressID = list[0].ID
		return nil
	}
	_, created, err := c.call(ctx, http.MethodPost, "/v1/addresses", map[string]any{
		"label":       "Home",
		"line1":       "1260 Danforth Avenue",
		"city":        "Toronto",
		"province":    "ON",
		"postal_code": "M4J 1N3",
		"latitude":    43.6820,
		"longitude":   -79.3305,
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: create address: %w", err)
	}
	var addr struct {
		ID string `json:"id"`
	}
	if jerr := json.Unmarshal(created, &addr); jerr != nil || addr.ID == "" {
		return errors.New("devworld: create address returned no id")
	}
	c.addressID = addr.ID
	fmt.Printf("address %s\n", addr.ID)
	return nil
}
