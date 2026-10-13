package conformance

// Handoff conformance — class: handoff.
//
// Closes the four operations internal/handoff adds (bindPackageSeal, scanPickup,
// scanDelivery, reportTamper) by driving the real end-to-end chain of custody
// against a live migrated Postgres (migration 00027_handoff.sql):
//
//   1. Seed a restaurant + staff account, a customer, an order in
//      READY_FOR_PICKUP, a live rider assignment for it, and an ISSUED
//      package_seal for the restaurant.
//   2. bindPackageSeal (restaurant) — ISSUED → BOUND, mints the signed token.
//   3. scanPickup (rider), presenting that token — the order advances
//      READY_FOR_PICKUP → PICKED_UP through the real OrderLifecycle bridge to
//      orders.Store.Transition, not a fake.
//   4. scanDelivery (rider), the same physical token — PICKED_UP → DELIVERED.
//      Proves the per-proof-type nonce scoping: the identical qr_token that
//      already cleared scanPickup is accepted again for the DELIVERY proof
//      without tripping handoff_event_nonce_unique as a false replay.
//   5. reportTamper (customer) — DELIVERED → DISPUTED, the dispute-flow bridge.
//
// Every 2xx body is validated against contracts/openapi.yaml exactly like every
// other conformance test in this package; nothing here weakens the oracle.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handoff"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// handoffLifecycleAdapter is a faithful copy of cmd/hg/main.go's
// orderLifecycleAdapter (unexported there, so duplicated here rather than
// exported for a test) — it is the same bridge, calling the same
// orders.Store.Transition, so a passing test here proves the real bridge works.
type handoffLifecycleAdapter struct{ store *orders.Store }

func (a handoffLifecycleAdapter) ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StatePickedUp, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider confirmed pickup",
	})
}

func (a handoffLifecycleAdapter) CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDelivered, Actor: machine.ActorRider,
		ActorAccountID: riderAccountID, Reason: "rider completed delivery",
	})
}

func (a handoffLifecycleAdapter) OpenDispute(ctx context.Context, orderID, customerAccountID, reason string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID: orderID, To: machine.StateDisputed, Actor: machine.ActorCustomer,
		ActorAccountID: customerAccountID, Reason: reason,
	})
}

// newHandoffHarness wires orders (with a REAL lifecycle bridge, unlike
// newARWHarness's nil one — the whole point of these four routes is that they
// gate a real order transition) and handoff over a fresh Ed25519 test key pair.
func newHandoffHarness(t *testing.T, pool *pgxpool.Pool) (*Harness, ed25519.PublicKey) {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	ordersStore := orders.NewStore(pool)
	orders.Routes(router, orders.NewHandler(ordersStore, nil, nil))

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate test signing key: %v", err)
	}
	handoffStore := handoff.NewStore(pool)
	handoffSvc := handoff.NewService(handoffStore, handoffLifecycleAdapter{store: ordersStore}, priv, pub, nil)
	handoff.Routes(router, handoff.NewHandler(handoffSvc))

	if err := router.Verify(); err != nil {
		t.Fatalf("handoff harness router verify: %v", err)
	}
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}, pub
}

// handoffFixture is everything TestConformance_Handoff needs seeded.
type handoffFixture struct {
	restaurantStaffID string
	riderID           string
	customerID        string
	orderID           string
	sealCode          string
	podPhotoObjectID  string // the rider's photo
	tamperPhotoID     string // the customer's photo
}

func seedHandoffFixture(t *testing.T, pool *pgxpool.Pool) handoffFixture {
	t.Helper()
	const e164 = `'+1' || lpad((floor(random() * 1000000000))::bigint::text, 9, '0')`

	var f handoffFixture
	var restaurantID string
	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164+`) RETURNING id`, &f.customerID)
	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164+`) RETURNING id`, &f.restaurantStaffID)
	mustScan(t, pool, `INSERT INTO account (phone_e164) VALUES (`+e164+`) RETURNING id`, &f.riderID)

	mustScan(t, pool, `
		INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code, location, timezone)
		VALUES (uuid_generate_v7(), 'handoff-'||substr(md5(random()::text),1,10), 'Handoff Co', 'Handoff Kitchen',
		        '1 Seal St', 'Toronto', 'ON', 'M4J1M4',
		        ST_SetSRID(ST_MakePoint(-79.3403, 43.6817),4326)::geography, 'America/Toronto')
		RETURNING id`, &restaurantID)
	mustExecGaps(t, pool, `
		INSERT INTO account_role (account_id, role, scope_type, scope_id)
		VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`, f.restaurantStaffID, restaurantID)

	var addressID, cartID, pricingConfigID, taxJurisdiction, quoteID string
	mustScan(t, pool, `SELECT id FROM pricing_config LIMIT 1`, &pricingConfigID)
	mustScan(t, pool, `SELECT code FROM tax_jurisdiction LIMIT 1`, &taxJurisdiction)
	mustScan(t, pool, `
		INSERT INTO address (id, account_id, line1, city, province, postal_code, location, timezone)
		VALUES (uuid_generate_v7(), $1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.381, 43.6412),4326)::geography, 'America/Toronto')
		RETURNING id`, &addressID, f.customerID)
	mustScan(t, pool, `
		INSERT INTO cart (id, account_id, restaurant_id, delivery_address_id, fulfilment)
		VALUES (uuid_generate_v7(), $1, $2, $3, 'DELIVERY') RETURNING id`, &cartID, f.customerID, restaurantID, addressID)
	mustScan(t, pool, `
		INSERT INTO quote (id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
		                   pricing_config_id, tax_jurisdiction_code,
		                   subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                   input_hash, state_hash, created_at, expires_at)
		VALUES (uuid_generate_v7(), $1, $2, $3, $4, 'DELIVERY', 'CAD', $5, $6,
		        1000, 449, 0, 1449,
		        sha256('handoff'::bytea), sha256('handoff'::bytea), now(), now()+interval '1 hour')
		RETURNING id`, &quoteID, f.customerID, cartID, restaurantID, addressID, pricingConfigID, taxJurisdiction)
	mustScan(t, pool, `
		INSERT INTO "order" (id, code, quote_id, account_id, restaurant_id, delivery_address_id, state,
		                     deadline_at, deadline_action,
		                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents)
		VALUES (uuid_generate_v7(), 'HO-'||substr(md5(random()::text),1,8), $1, $2, $3, $4, 'READY_FOR_PICKUP',
		        now()+interval '15 min', 'PICKUP_OVERDUE', 1000, 449, 0, 1449)
		RETURNING id`, &f.orderID, quoteID, f.customerID, restaurantID, addressID)

	// A live (non-terminated) assignment: handoff's rider-ownership check reads
	// this exact predicate (assignment.order_id/rider_account_id/terminated_at).
	mustExecGaps(t, pool, `
		INSERT INTO assignment (order_id, rider_account_id, state, required_pod_method)
		VALUES ($1, $2, 'EN_ROUTE_TO_PICKUP', NULL)`, f.orderID, f.riderID)

	f.sealCode = "SEAL-" + f.orderID[:8]
	mustExecGaps(t, pool, `
		INSERT INTO package_seal (seal_code, restaurant_id, status)
		VALUES ($1, $2, 'ISSUED')`, f.sealCode, restaurantID)

	// A READY POD-purpose stored_object scoped to this order, standing in for a
	// photo the rider/customer already presigned+confirmed through internal/files
	// (handoff never touches MinIO itself — it only checks this row, exactly like
	// dispatch.RecordPod does for proof of delivery).
	mustScan(t, pool, `
		INSERT INTO stored_object (bucket, object_key, purpose, owner_account_id, order_id,
		                           content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		VALUES ('hg-pod', 'handoff-test/'||uuid_generate_v7(), 'POD', $1, $2,
		        'image/jpeg', 12345, sha256('handoff-photo'::bytea), 'READY', $1, now())
		RETURNING id`, &f.podPhotoObjectID, f.riderID, f.orderID)
	// The customer's own photo of the package, for the tamper report: evidence
	// is attached by the account that uploaded it, never borrowed from the
	// rider (https://github.com/shaiknoorullah/hg-mono/issues/359).
	mustScan(t, pool, `
		INSERT INTO stored_object (bucket, object_key, purpose, owner_account_id, order_id,
		                           content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		VALUES ('hg-pod', 'handoff-test/'||uuid_generate_v7(), 'POD', $1, $2,
		        'image/jpeg', 23456, sha256('handoff-tamper-photo'::bytea), 'READY', $1, now())
		RETURNING id`, &f.tamperPhotoID, f.customerID, f.orderID)

	t.Cleanup(func() {
		bg := context.Background()
		// handoff_event.photo_object_id references stored_object(id): the event
		// row must go first, or the stored_object delete silently fails (errors
		// here are swallowed like every other cleanup in this package) and
		// leaves both the object and everything upstream of it (the order, then
		// the restaurant) stranded.
		_, _ = pool.Exec(bg, `DELETE FROM handoff_event WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM stored_object WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM package_seal WHERE seal_code=$1`, f.sealCode)
		_, _ = pool.Exec(bg, `DELETE FROM order_transition WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM assignment_transition WHERE assignment_id IN (SELECT id FROM assignment WHERE order_id=$1)`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM assignment WHERE order_id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM "order" WHERE id=$1`, f.orderID)
		_, _ = pool.Exec(bg, `DELETE FROM quote WHERE id=$1`, quoteID)
		_, _ = pool.Exec(bg, `DELETE FROM cart WHERE id=$1`, cartID)
		_, _ = pool.Exec(bg, `DELETE FROM address WHERE id=$1`, addressID)
		_, _ = pool.Exec(bg, `DELETE FROM account_role WHERE account_id=$1`, f.restaurantStaffID)
		_, _ = pool.Exec(bg, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(bg, `DELETE FROM account WHERE id IN ($1,$2,$3)`, f.customerID, f.restaurantStaffID, f.riderID)
	})
	return f
}

// TestConformance_Handoff drives the full seal-bind → pickup-scan →
// delivery-scan → tamper-report chain and validates every 2xx body.
func TestConformance_Handoff(t *testing.T) {
	pool := openPool(t)
	h, _ := newHandoffHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	f := seedHandoffFixture(t, pool)

	// bindPackageSeal (restaurant) → 201 PackageSeal, ISSUED → BOUND.
	var qrToken string
	t.Run("bindPackageSeal", func(t *testing.T) {
		rq := Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/seal",
			AccountID: f.restaurantStaffID, Roles: []string{"RESTAURANT_OWNER"},
			IdemKey: "handoff-bind-0000000001",
			Body:    map[string]any{"seal_code": f.sealCode},
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("bindPackageSeal: status = %d, want 201 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		data := dataObject(t, resp)
		qrToken, _ = data["qr_token"].(string)
		if data["status"] != "BOUND" {
			t.Errorf("bindPackageSeal: status field = %v, want BOUND", data["status"])
		}
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (bindPackageSeal): %v", err)
		} else {
			h.MarkCovered("bindPackageSeal")
		}
	})
	if qrToken == "" {
		t.Fatalf("bindPackageSeal did not yield a qr_token; cannot scan")
	}

	// scanPickup (rider) → 200 HandoffScanResult, order READY_FOR_PICKUP → PICKED_UP.
	t.Run("scanPickup", func(t *testing.T) {
		rq := Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/pickup-scan",
			AccountID: f.riderID, Roles: []string{roleRider},
			IdemKey: "handoff-pickup-0000000001",
			Body: map[string]any{
				"qr_token": qrToken, "seal_intact": true,
				"latitude": 43.6817, "longitude": -79.3403,
			},
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("scanPickup: status = %d, want 200 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		data := dataObject(t, resp)
		if data["order_state"] != "PICKED_UP" {
			t.Errorf("scanPickup: order_state = %v, want PICKED_UP", data["order_state"])
		}
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (scanPickup): %v", err)
		} else {
			h.MarkCovered("scanPickup")
		}
	})

	var orderState string
	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &orderState, f.orderID)
	if orderState != "PICKED_UP" {
		t.Fatalf("order state after scanPickup = %s, want PICKED_UP — the OrderLifecycle bridge did not fire", orderState)
	}

	// scanDelivery (rider), the SAME token — proves the per-proof-type nonce
	// scoping (eventNonce) rather than a false SEAL_NONCE_REPLAYED. Order
	// PICKED_UP → DELIVERED.
	t.Run("scanDelivery", func(t *testing.T) {
		rq := Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/delivery-scan",
			AccountID: f.riderID, Roles: []string{roleRider},
			IdemKey: "handoff-delivery-0000000001",
			Body: map[string]any{
				"qr_token": qrToken, "seal_intact": true,
				"photo_object_id": f.podPhotoObjectID,
			},
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("scanDelivery: status = %d, want 200 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		data := dataObject(t, resp)
		if data["order_state"] != "DELIVERED" {
			t.Errorf("scanDelivery: order_state = %v, want DELIVERED", data["order_state"])
		}
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (scanDelivery): %v", err)
		} else {
			h.MarkCovered("scanDelivery")
		}
	})

	// reportTamper (customer) → 200 HandoffScanResult, DELIVERED → DISPUTED.
	// Never auto-fails: this is the customer opening the dispute flow, not a
	// money decision made here.
	t.Run("reportTamper", func(t *testing.T) {
		// The rider's photo is not the customer's to attach: the same 422 as a
		// missing photo, and the order is not disputed
		// (https://github.com/shaiknoorullah/hg-mono/issues/359).
		_, borrowed := h.Do(t, Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/tamper-report",
			AccountID: f.customerID, Roles: []string{"CUSTOMER"},
			IdemKey: "handoff-tamper-borrowed-001",
			Body: map[string]any{
				"photo_object_id": f.podPhotoObjectID,
				"note":            "The seal was broken when the package arrived.",
			},
		})
		borrowedBody, _ := io.ReadAll(borrowed.Body)
		borrowed.Body.Close()
		if borrowed.StatusCode != http.StatusUnprocessableEntity || !strings.Contains(string(borrowedBody), "POD_REQUIRED") {
			t.Errorf("reportTamper with the rider's photo: status = %d, want 422 POD_REQUIRED (body: %s)",
				borrowed.StatusCode, truncate(string(borrowedBody), 400))
		}
		var stateAfterBorrowed string
		mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &stateAfterBorrowed, f.orderID)
		if stateAfterBorrowed != "DELIVERED" {
			t.Fatalf("reportTamper with the rider's photo moved the order to %s", stateAfterBorrowed)
		}

		rq := Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/tamper-report",
			AccountID: f.customerID, Roles: []string{"CUSTOMER"},
			IdemKey: "handoff-tamper-0000000001",
			Body: map[string]any{
				"photo_object_id": f.tamperPhotoID,
				"note":            "The seal was broken when the package arrived.",
			},
		}
		vreq, resp := h.Do(t, rq)
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			resp.Body = io.NopCloser(bytes.NewReader(body))
			t.Fatalf("reportTamper: status = %d, want 200 (body: %s)", resp.StatusCode, truncate(string(body), 400))
		}
		data := dataObject(t, resp)
		if data["order_state"] != "DISPUTED" {
			t.Errorf("reportTamper: order_state = %v, want DISPUTED", data["order_state"])
		}
		if seal, ok := data["seal"].(map[string]any); ok && seal["status"] != "TAMPER_REPORTED" {
			t.Errorf("reportTamper: seal.status = %v, want TAMPER_REPORTED", seal["status"])
		}
		if _, err := ValidateResponse(t, h.Spec, vreq, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (reportTamper): %v", err)
		} else {
			h.MarkCovered("reportTamper")
		}
	})

	mustScan(t, pool, `SELECT state::text FROM "order" WHERE id=$1`, &orderState, f.orderID)
	if orderState != "DISPUTED" {
		t.Errorf("order state after reportTamper = %s, want DISPUTED", orderState)
	}
}

// TestConformance_Handoff_NonceReplayRejected proves the migration's core
// invariant directly: presenting the SAME token for the SAME proof step twice
// is rejected — a real Postgres UNIQUE constraint violation surfaced as
// SEAL_NONCE_REPLAYED, not a check that could be skipped.
func TestConformance_Handoff_NonceReplayRejected(t *testing.T) {
	pool := openPool(t)
	h, _ := newHandoffHarness(t, pool)
	f := seedHandoffFixture(t, pool)

	bindRq := Request{
		Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/seal",
		AccountID: f.restaurantStaffID, Roles: []string{"RESTAURANT_OWNER"},
		IdemKey: "handoff-replay-bind-000001",
		Body:    map[string]any{"seal_code": f.sealCode},
	}
	_, bindResp := h.Do(t, bindRq)
	qrToken, _ := dataObject(t, bindResp)["qr_token"].(string)
	bindResp.Body.Close()
	if qrToken == "" {
		t.Fatalf("bind did not yield a qr_token")
	}

	scan := func(idemKey string) *http.Response {
		rq := Request{
			Method: "POST", Path: "/v1/orders/" + f.orderID + "/handoff/pickup-scan",
			AccountID: f.riderID, Roles: []string{roleRider},
			IdemKey: idemKey,
			Body:    map[string]any{"qr_token": qrToken, "seal_intact": true},
		}
		_, resp := h.Do(t, rq)
		return resp
	}

	first := scan("handoff-replay-scan-0000001")
	first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first scanPickup: status = %d, want 200", first.StatusCode)
	}

	second := scan("handoff-replay-scan-0000002") // different idempotency key: a genuine second call
	defer second.Body.Close()
	body, _ := io.ReadAll(second.Body)
	if second.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("replayed scanPickup: status = %d, want 422 SEAL_NONCE_REPLAYED (body: %s)", second.StatusCode, truncate(string(body), 400))
	}
	if !bytes.Contains(body, []byte("SEAL_NONCE_REPLAYED")) {
		t.Errorf("replayed scanPickup body does not carry SEAL_NONCE_REPLAYED: %s", truncate(string(body), 400))
	}
}
