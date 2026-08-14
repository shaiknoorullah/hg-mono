package conformance

// Conformance gap-closing — class: gaps.
//
// This file closes the last seven uncovered operations in COVERAGE.md. Each one
// was uncovered not because it is unreachable, but because it needs more harness
// setup than the read-only base harness provides:
//
//   - createQuote / createOrder / cancelOrder — the base harness wires a NIL
//     payment gateway ("503 on the money path"), so createOrder could never reach
//     201. This file stands up an orders harness wired with the LOCAL FAKE Stripe
//     gateway exactly as cmd/hg/main.go does (payments.NewFakeStripe + the
//     orderPaymentGateway bridge with advanceLocal), then drives the real
//     checkout: seed a cart line → createQuote (201) → createOrder (201) →
//     cancelOrder (200). All three 2xx bodies are validated against the contract.
//
//   - acceptOffer / getAssignment — need a live PENDING dispatch offer for a real
//     rider. This file seeds an order in READY_FOR_PICKUP with a dispatch in
//     SEARCHING and a PENDING offer (the shape internal/dispatch's seedFixture
//     uses), then accepts it and reads the resulting assignment.
//
//   - createRealtimeTicket — the handler binds the minted ticket to the
//     principal's session_id (a UUID FK to session). The shared testAuthenticator
//     now injects a valid fixed UUID SessionID, so this file seeds a matching
//     session row and the ticket mints and validates.
//
//   - receiveStripeWebhook — the fake Stripe's VerifyWebhook refuses (no signing
//     secret). This file wires the payments module with the REAL stripe-go
//     verifier (payments.NewLiveStripe with a dev whsec_ secret, no network on the
//     webhook path) and constructs a correctly-signed Stripe event the real
//     verifier accepts, then validates the AcknowledgementResponse.
//
// Nothing here weakens the oracle: every 2xx body still goes through
// ValidateResponse, and write bodies are proven contract-valid with
// ValidateRequest before they are issued.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	stripe "github.com/stripe/stripe-go/v79"
	stripewebhook "github.com/stripe/stripe-go/v79/webhook"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
)

// ─── orders harness wired with the local fake payment gateway ────────────────

// gapsOrderGateway is a faithful copy of cmd/hg/main.go's orderPaymentGateway in
// its local/fake-Stripe configuration: it authorises a manual-capture
// PaymentIntent through the payments service (fake Stripe), then — because the
// fake client cannot send the Stripe webhook that would advance the order in
// production — synchronously advances CREATED→AUTHORIZED→RESTAURANT_PENDING, so
// createOrder returns a live order and cancelOrder has a cancellable state.
type gapsOrderGateway struct {
	svc   *payments.Service
	store *orders.Store
}

func (g gapsOrderGateway) CreateOrderIntent(ctx context.Context, in orders.CreateIntentInput) (orders.CreateIntentResult, error) {
	method := ""
	if in.PaymentMethodID != nil {
		method = *in.PaymentMethodID
	}
	row, err := g.svc.Authorise(ctx, payments.AuthoriseInput{
		OrderID:        in.OrderID,
		AmountCents:    in.AmountCents,
		Currency:       in.Currency,
		StripeMethod:   method,
		IdempotencyKey: "order:" + in.OrderID,
	})
	if err != nil {
		return orders.CreateIntentResult{}, err
	}
	// advanceLocal: no real webhook in fake mode, so drive the two SYSTEM
	// transitions the webhook would otherwise trigger.
	_ = g.store.Transition(ctx, orders.TransitionRequest{
		OrderID: in.OrderID, To: machine.StateAuthorized, Actor: machine.ActorSystem,
		Reason: "payment authorised (local fake)",
	})
	_ = g.store.Transition(ctx, orders.TransitionRequest{
		OrderID: in.OrderID, To: machine.StateRestaurantPending, Actor: machine.ActorSystem,
		Reason: "presented to restaurant",
	})
	return orders.CreateIntentResult{ClientSecret: row.StripePaymentIntentID + "_secret"}, nil
}

// newGapsOrdersHarness stands up an in-process server wired with the orders
// module and the LOCAL FAKE payment gateway (the exact wiring cmd/hg/main.go
// selects in local env with no Stripe key). It returns a *Harness so all the
// shared request/validate/coverage helpers apply unchanged.
func newGapsOrdersHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	cfg := &config.Config{Env: config.EnvLocal}
	paySvc := payments.NewService(payments.NewRepo(pool), payments.NewFakeStripe(), cfg.Stripe, slog.Default())

	ordersStore := orders.NewStore(pool)
	gateway := gapsOrderGateway{svc: paySvc, store: ordersStore}
	orders.Routes(router, orders.NewHandler(ordersStore, gateway, slog.Default()))

	if err := router.Verify(); err != nil {
		t.Fatalf("gaps orders harness router verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// gapsSeedCustomerWithAddress seeds a fresh ACTIVE customer (CUSTOMER role +
// profile) and one Ontario ('ON') delivery address in a served province, and
// registers cleanup. It returns (accountID, addressID).
func gapsSeedCustomerWithAddress(t *testing.T, pool *pgxpool.Pool) (accountID, addressID string) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, phone_e164, phone_verified_at, status)
		VALUES ('gaps-'||substr(md5(random()::text),1,8)||'@hg.test',
		        '+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'),
		        now(), 'ACTIVE')
		RETURNING id`).Scan(&accountID); err != nil {
		t.Fatalf("gapsSeedCustomer account: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'CUSTOMER','GLOBAL')`, accountID); err != nil {
		t.Fatalf("gapsSeedCustomer role: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO customer_profile (account_id, first_name) VALUES ($1,'GapsUser')
		 ON CONFLICT (account_id) DO NOTHING`, accountID); err != nil {
		t.Fatalf("gapsSeedCustomer profile: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '20 Gaps St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, accountID).Scan(&addressID); err != nil {
		t.Fatalf("gapsSeedCustomer address: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		// Orders and their whole dependency chain created during the test.
		_, _ = pool.Exec(bg, `DELETE FROM payment_intent WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM order_line_addon WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM order_line WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM order_transition WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM "order" WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM quote_tax_line WHERE quote_id IN (SELECT id FROM quote WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM quote_line WHERE quote_id IN (SELECT id FROM quote WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM quote WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM cart_line_addon WHERE cart_line_id IN (SELECT cl.id FROM cart_line cl JOIN cart c ON c.id=cl.cart_id WHERE c.account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM cart_line WHERE cart_id IN (SELECT id FROM cart WHERE account_id=$1)`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM cart WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM address WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM customer_profile WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, accountID)
		_, _ = pool.Exec(bg, `DELETE FROM account WHERE id=$1`, accountID)
	})
	return accountID, addressID
}

// TestConformance_Gaps_OrderLifecycle drives the whole money path end-to-end
// against the fake payment gateway: addCartLine → createQuote (201) → createOrder
// (201) → cancelOrder (200). createQuote and cancelOrder bodies are proven
// contract-valid with ValidateRequest first; every 2xx body is validated against
// the contract with ValidateResponse.
func TestConformance_Gaps_OrderLifecycle(t *testing.T) {
	pool := openPool(t)
	h := newGapsOrdersHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	acct, addr := gapsSeedCustomerWithAddress(t, pool)

	// Seed the cart via the real addCartLine handler: one unit of the fixture
	// restaurant's AVAILABLE menu item (5555…), which binds the cart to the
	// served, LIVE, accepting restaurant (3333…).
	h.CheckResponse(t, Request{Method: "POST", Path: "/v1/cart/lines",
		AccountID: acct, Roles: []string{roleCustomer}, IdemKey: "gaps-cartline-0001",
		Body: map[string]any{"menu_item_id": "55555555-5555-4555-8555-555555555555", "quantity": 2}}, 200)

	// createQuote (MONEY, Idempotency-Key required). A served-province address is
	// provided, so it prices rather than 422 TAX_PROFILE_MISSING.
	quoteBody := map[string]any{
		"cart_id":             cartIDForAccount(t, pool, acct),
		"delivery_address_id": addr,
		"fulfilment":          "DELIVERY",
		"tip_cents":           500,
	}
	var quoteID string
	t.Run("createQuote", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/quotes",
			AccountID: acct, Roles: []string{roleCustomer}, IdemKey: "gaps-quote-00000001",
			Body: quoteBody}
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("createQuote body is not contract-valid (fix the test, not the server): %v", verr)
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("createQuote: status = %d, want 201 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		quoteID, _ = dataObject(t, resp)["id"].(string)
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (createQuote): %v", err)
		} else {
			h.MarkCovered("createQuote")
		}
	})
	if quoteID == "" {
		t.Fatalf("createQuote did not yield a quote id; cannot proceed to createOrder")
	}

	// createOrder (MONEY, Idempotency-Key required). The server re-executes the
	// quote from the unchanged cart, so it matches (no QUOTE_STALE) and the fake
	// gateway authorises → 201 OrderCreated.
	var orderID string
	t.Run("createOrder", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/orders",
			AccountID: acct, Roles: []string{roleCustomer}, IdemKey: "gaps-order-00000001",
			Body: map[string]any{"quote_id": quoteID}}
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("createOrder body is not contract-valid (fix the test, not the server): %v", verr)
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("createOrder: status = %d, want 201 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		if order, ok := dataObject(t, resp)["order"].(map[string]any); ok {
			orderID, _ = order["id"].(string)
		}
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (createOrder): %v", err)
		} else {
			h.MarkCovered("createOrder")
		}
	})
	if orderID == "" {
		t.Fatalf("createOrder did not yield an order id; cannot proceed to cancelOrder")
	}

	// cancelOrder (MONEY, Idempotency-Key required). advanceLocal left the order in
	// RESTAURANT_PENDING, which is inside the free cancellation window → 200
	// OrderCustomerView.
	t.Run("cancelOrder", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/orders/" + orderID + "/cancel",
			AccountID: acct, Roles: []string{roleCustomer}, IdemKey: "gaps-cancel-0000001",
			Body: map[string]any{"reason_code": "CHANGED_MIND"}}
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("cancelOrder body is not contract-valid (fix the test, not the server): %v", verr)
		}
		h.CheckResponse(t, rq, 200)
	})
}

// cartIDForAccount returns the open cart id for the account (created by
// addCartLine), failing the test if none exists.
func cartIDForAccount(t *testing.T, pool *pgxpool.Pool, accountID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text FROM cart WHERE account_id=$1 AND deleted_at IS NULL`, accountID).Scan(&id); err != nil {
		t.Fatalf("no open cart for account %s: %v", accountID, err)
	}
	return id
}

// ─── dispatch: acceptOffer + getAssignment ───────────────────────────────────

// gapsSeedDispatchOffer replicates internal/dispatch's seedFixture for a single
// rider: an order in READY_FOR_PICKUP, a dispatch in SEARCHING, one wave, and one
// PENDING offer for a fresh ONLINE rider. It returns the rider account id and the
// offer id, and registers full cleanup.
func gapsSeedDispatchOffer(t *testing.T, pool *pgxpool.Pool) (riderAccountID, offerID string) {
	t.Helper()
	expires := time.Now().UTC().Add(5 * time.Minute)

	const e164 = `'+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0')`

	var custAccount, restaurantID string
	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164+`) RETURNING id`, &custAccount)
	mustScan(t, pool, `
		INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
		VALUES (uuid_generate_v7(), 'gaps-'||substr(md5(random()::text),1,10), 'Gaps Co', 'Gaps Kitchen',
		        '1 Main St', 'Toronto', 'ON', 'M4J1M4',
		        ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 'America/Toronto')
		RETURNING id`, &restaurantID)

	var addressID, cartID, pricingConfigID, taxJurisdiction, quoteID, orderID, waveID string
	mustScan(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustScan(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustScan(t, pool, `
		INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
		VALUES (uuid_generate_v7(), $1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.381, 43.6412),4326)::geography, 'America/Toronto')
		RETURNING id`, &addressID, custAccount)
	mustScan(t, pool, `
		INSERT INTO cart (id, account_id, restaurant_id, delivery_address_id, fulfilment)
		VALUES (uuid_generate_v7(), $1, $2, $3, 'DELIVERY') RETURNING id`, &cartID, custAccount, restaurantID, addressID)
	mustScan(t, pool, `
		INSERT INTO quote (id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
		                   pricing_config_id, tax_jurisdiction_code,
		                   subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                   input_hash, state_hash, created_at, expires_at)
		VALUES (uuid_generate_v7(), $1, $2, $3, $4, 'DELIVERY', 'CAD', $5, $6,
		        1000, 449, 0, 1449,
		        sha256('gaps'::bytea), sha256('gaps'::bytea), now(), now()+interval '1 hour')
		RETURNING id`, &quoteID, custAccount, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)
	mustScan(t, pool, `
		INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
		                     deadline_at, deadline_action,
		                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
		VALUES (uuid_generate_v7(), 'GP-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
		        now()+interval '15 min', 'PICKUP_OVERDUE', 1000, 449, 0, 1449)
		RETURNING id`, &orderID, quoteID, custAccount, restaurantID, addressID)
	mustExecGaps(t, pool, `
		INSERT INTO dispatch (order_id, state, deadline_at, deadline_action)
		VALUES ($1, 'SEARCHING', now()+interval '20 s', 'NEXT_WAVE')`, orderID)
	mustScan(t, pool, `
		INSERT INTO dispatch_wave (order_id, wave_no, radius_m, expires_at)
		VALUES ($1, 1, 3000, $2) RETURNING id`, &waveID, orderID, expires)

	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164+`) RETURNING id`, &riderAccountID)
	mustExecGaps(t, pool, `
		INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, riderAccountID)
	mustExecGaps(t, pool, `
		INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
		                           onboarding_state, account_status, availability_state, is_online, approved_at)
		VALUES ($1, 'Gaps', 'Rider', '1990-01-01', 'ACTIVE', 'ACTIVE', 'ONLINE_IDLE', true, now())`, riderAccountID)
	mustExecGaps(t, pool, `
		INSERT INTO rider_position (account_id, location, accuracy_m, recorded_at, received_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 10, now(), now())`, riderAccountID)
	mustScan(t, pool, `
		INSERT INTO dispatch_offer (order_id, dispatch_wave_id, rider_account_id, wave, distance_m,
		                            earnings_cents, tip_estimate_cents, state, expires_at)
		VALUES ($1, $2, $3, 1, 100, 449, 0, 'PENDING', $4) RETURNING id`, &offerID, orderID, waveID, riderAccountID, expires)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM assignment WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch_offer WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch_wave WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM dispatch WHERE order_id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_availability_event WHERE account_id=$1`, riderAccountID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_position WHERE account_id=$1`, riderAccountID)
		_, _ = pool.Exec(bg, `DELETE FROM rider_profile WHERE account_id=$1`, riderAccountID)
		_, _ = pool.Exec(bg, `DELETE FROM "order" WHERE id=$1`, orderID)
		_, _ = pool.Exec(bg, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(bg, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(bg, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(bg, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, riderAccountID)
		_, _ = pool.Exec(bg, `DELETE FROM account WHERE id IN ($1,$2)`, riderAccountID, custAccount)
	})
	return riderAccountID, offerID
}

// TestConformance_Gaps_DispatchAccept covers acceptOffer (POST accept → 200
// Assignment) and getAssignment (GET the resulting assignment → 200 Assignment).
func TestConformance_Gaps_DispatchAccept(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool) // wires the dispatch module
	t.Cleanup(func() { writeCoverage(t, h) })

	riderID, offerID := gapsSeedDispatchOffer(t, pool)

	// acceptOffer → 200 Assignment (race-free accept path, D-16).
	var assignmentID string
	t.Run("acceptOffer", func(t *testing.T) {
		rq := Request{Method: "POST", Path: "/v1/riders/me/offers/" + offerID + "/accept",
			AccountID: riderID, Roles: []string{roleRider}, IdemKey: "gaps-accept-0000001"}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("acceptOffer: status = %d, want 200 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		assignmentID, _ = dataObject(t, resp)["id"].(string)
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (acceptOffer): %v", err)
		} else {
			h.MarkCovered("acceptOffer")
		}
	})
	if assignmentID == "" {
		t.Fatalf("acceptOffer did not yield an assignment id; cannot read getAssignment")
	}

	// getAssignment → 200 Assignment.
	t.Run("getAssignment", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/riders/me/assignments/" + assignmentID,
			AccountID: riderID, Roles: []string{roleRider}}, 200)
	})
}

// ─── realtime: createRealtimeTicket ──────────────────────────────────────────

// gapsSeedSession seeds a session row whose id equals the fixed UUID the shared
// testAuthenticator injects, owned by the given account, so MintTicket's
// realtime_ticket INSERT (session_id FK → session) succeeds. Registers cleanup of
// the session and any tickets minted against it.
func gapsSeedSession(t *testing.T, pool *pgxpool.Pool, accountID string) {
	t.Helper()
	ctx := context.Background()
	const sessionID = "00000000-0000-4000-8000-0000c0f0face"
	if _, err := pool.Exec(ctx, `
		INSERT INTO session (id, family_id, account_id, amr, roles_snapshot, client,
		                     refresh_hash, idle_expires_at, absolute_expires_at)
		VALUES ($1, uuid_generate_v7(), $2, 'pwd+totp', '["CUSTOMER"]'::jsonb, 'customer-app',
		        digest('gaps-realtime-refresh-session', 'sha256'),
		        now()+interval '1 hour', now()+interval '1 day')
		ON CONFLICT (id) DO NOTHING`, sessionID, accountID); err != nil {
		t.Fatalf("gapsSeedSession: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM realtime_ticket WHERE session_id=$1`, sessionID)
		_, _ = pool.Exec(bg, `DELETE FROM session WHERE id=$1`, sessionID)
	})
}

// TestConformance_Gaps_RealtimeTicket covers createRealtimeTicket: with a seeded
// session matching the principal's SessionID, MintTicket inserts the ticket and
// the RealtimeTicket 2xx body is validated against the contract.
func TestConformance_Gaps_RealtimeTicket(t *testing.T) {
	h := newRealtimeHarness(t)
	pool := openPool(t)
	gapsSeedSession(t, pool, fxCustomerID)

	req, err := http.NewRequest(http.MethodPost, h.server.URL+"/v1/realtime/ticket", bytes.NewReader(nil))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-Test-Account-ID", fxCustomerID)
	req.Header.Set("X-Test-Roles", roleCustomer)
	req.Header.Set("X-HG-Client", "customer-app")

	resp := doRealtime(t, h, req)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("createRealtimeTicket: status %d (body: %s)", resp.StatusCode, truncate(string(body), 400))
	}
	opID, verr := ValidateResponse(t, h.spec, req, resp)
	if opID != "createRealtimeTicket" {
		t.Errorf("matched operationId = %q, want createRealtimeTicket", opID)
	}
	if verr != nil {
		t.Errorf("CONFORMANCE FAIL (createRealtimeTicket): %v", verr)
	} else {
		writeRealtimeCoverage(t, h.spec, "createRealtimeTicket")
	}
}

// ─── payments: receiveStripeWebhook ──────────────────────────────────────────

// gapsWebhookSecret is a dev-only Stripe webhook signing secret. It never
// authenticates against real Stripe; it is only the HMAC key the real stripe-go
// verifier (payments.NewLiveStripe) checks the Stripe-Signature header against.
const gapsWebhookSecret = "whsec_conformance_dev_secret_do_not_use_in_prod"

// newGapsWebhookHarness wires the payments module with the REAL stripe-go
// verifier (NewLiveStripe with a dev whsec_ secret and a throwaway secret key).
// The webhook path calls only VerifyWebhook (HMAC over the header — no network),
// so no live Stripe credentials are needed. envIsLive is false (EnvLocal), so the
// event's livemode:false matches.
func newGapsWebhookHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	cfg := &config.Config{Env: config.EnvLocal}
	stripeClient := payments.NewLiveStripe("sk_test_conformance_dummy", gapsWebhookSecret)
	svc := payments.NewService(payments.NewRepo(pool), stripeClient, cfg.Stripe, slog.Default())
	payments.Routes(router, payments.NewHandler(svc, cfg))

	if err := router.Verify(); err != nil {
		t.Fatalf("gaps webhook harness router verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// TestConformance_Gaps_StripeWebhook covers receiveStripeWebhook. It constructs a
// correctly-signed Stripe event (Stripe-Signature: t=<ts>,v1=<hmac>) that the
// real verifier accepts, posts it to the PUBLIC webhook route, and validates the
// AcknowledgementResponse 2xx body against the contract.
func TestConformance_Gaps_StripeWebhook(t *testing.T) {
	pool := openPool(t)
	h := newGapsWebhookHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	eventID := fmt.Sprintf("evt_conf_%d", time.Now().UnixNano())
	piID := fmt.Sprintf("pi_conf_%d", time.Now().UnixNano())
	// api_version MUST equal the stripe-go library's APIVersion or ConstructEvent
	// rejects the event; livemode:false matches EnvLocal (envIsLive=false).
	payload := []byte(fmt.Sprintf(`{"id":%q,"object":"event","api_version":%q,"created":%d,"livemode":false,"type":"payment_intent.created","data":{"object":{"id":%q,"object":"payment_intent","status":"requires_payment_method"}}}`,
		eventID, stripe.APIVersion, time.Now().Unix(), piID))

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM webhook_event WHERE provider='stripe' AND stripe_event_id=$1`, eventID)
	})

	// Sign the exact payload bytes with the dev secret using stripe-go's own
	// signer, so the header the real verifier reconstructs matches.
	signed := stripewebhook.GenerateTestSignedPayload(&stripewebhook.UnsignedPayload{
		Payload: payload,
		Secret:  gapsWebhookSecret,
	})

	req, err := http.NewRequest(http.MethodPost, h.Server.URL+"/v1/webhooks/stripe", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("new webhook request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Stripe-Signature", signed.Header)

	resp, err := h.Server.Client().Do(req)
	if err != nil {
		t.Fatalf("do webhook request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("receiveStripeWebhook: status %d, want 200 (body: %s)", resp.StatusCode, truncate(string(body), 400))
	}

	// The signed request itself must be re-issuable for ValidateResponse's route
	// match: rebuild the same request object (body already consumed by Do).
	vreq, _ := http.NewRequest(http.MethodPost, h.Server.URL+"/v1/webhooks/stripe", bytes.NewReader(payload))
	vreq.Header.Set("Content-Type", "application/json")
	vreq.Header.Set("Stripe-Signature", signed.Header)

	opID, verr := ValidateResponse(t, h.Spec, vreq, resp)
	if opID != "receiveStripeWebhook" {
		t.Errorf("matched operationId = %q, want receiveStripeWebhook", opID)
	}
	if verr != nil {
		t.Errorf("CONFORMANCE FAIL (receiveStripeWebhook): %v", verr)
	} else {
		h.MarkCovered("receiveStripeWebhook")
	}

	// Sanity: confirm the acknowledgement body says acknowledged:true.
	if d := dataObject(t, resp); d["acknowledged"] != true {
		t.Errorf("receiveStripeWebhook: acknowledged = %v, want true", d["acknowledged"])
	}
}

// ─── small SQL helpers (scoped to this file) ─────────────────────────────────

func mustScan(t *testing.T, pool *pgxpool.Pool, sql string, dst any, args ...any) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(dst); err != nil {
		t.Fatalf("query failed: %v\nSQL: %s", err, sql)
	}
}

func mustExecGaps(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec failed: %v\nSQL: %s", err, sql)
	}
}
