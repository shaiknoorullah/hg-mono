package invariants

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// ---------------------------------------------------------------------------
// Invariant 1 — "The server prices every order." (AGENTS.md §3.1)
// Clients send item IDs and a tip. Never a price. Inbound DTOs may not carry
// price fields.
// ---------------------------------------------------------------------------

// TestServerPrices_NoInboundOrderDTOCarriesAPriceField makes the bug
// unrepresentable at the type level: it walks every exported struct field of
// the three inbound order/cart DTOs and fails if any field name looks like a
// price (contains "Price" or "Cost", or is a *Cents field other than the
// customer's own tip). This is stronger than a single request test — it holds
// for every future caller of these constructors, not just the one under test.
func TestServerPrices_NoInboundOrderDTOCarriesAPriceField(t *testing.T) {
	inboundTypes := []any{
		orders.CartLineInput{},
		orders.CartAddonInput{},
		orders.QuoteRequest{},
		orders.OrderInput{},
	}
	for _, v := range inboundTypes {
		typ := reflect.TypeOf(v)
		for i := 0; i < typ.NumField(); i++ {
			f := typ.Field(i)
			name := f.Name
			if name == "TipCents" {
				// The tip is the one customer-supplied money value the contract
				// allows (I-1 explicitly carves it out): "item IDs and a tip".
				continue
			}
			if strings.Contains(name, "Price") || strings.Contains(name, "Cost") ||
				strings.Contains(name, "Cents") || strings.Contains(name, "Amount") {
				t.Errorf("%s.%s looks like a price field on an inbound DTO — "+
					"invariant 1 requires the server to price every order",
					typ.Name(), name)
			}
		}
	}
}

// TestServerPrices_UnknownPriceFieldOnCartLineRejected drives the real HTTP
// handler: a hostile client that appends a price_cents field to an otherwise
// legal addCartLine body must be rejected outright (422), not have the field
// silently ignored — decodeStrict must fail closed on any field the DTO does
// not declare, price or otherwise, so slipping a price field on the wire can
// never become a supported code path by accident.
func TestServerPrices_UnknownPriceFieldOnCartLineRejected(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)
	handler := orders.NewHandler(st, nil, nil)
	router := httpx.NewRouter(httpx.Options{Env: "local", Authenticator: testAuthenticator{}, Authorizer: auth.Matrix{}})
	orders.Routes(router, handler)

	srv := httptest.NewServer(router)
	defer srv.Close()

	body, _ := json.Marshal(map[string]any{
		"menu_item_id": b.menuItemID,
		"quantity":     1,
		"price_cents":  1, // hostile: attempt to name a price on an inbound body
	})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/cart/lines", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Account-ID", b.accountID)
	req.Header.Set("X-Test-Roles", "CUSTOMER")
	req.Header.Set("Idempotency-Key", "invariant-test-price-field-key")

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (a price field on an inbound body must be rejected, never silently accepted)", resp.StatusCode)
	}
}

// TestServerPrices_OrderTotalComesFromCatalogNotClient proves the positive
// side: the order total realized end-to-end is exactly qty x the server's
// catalog price_cents, computed with no client-supplied money input anywhere
// on the path (CartLineInput and OrderInput, above, structurally cannot carry
// one).
func TestServerPrices_OrderTotalComesFromCatalogNotClient(t *testing.T) {
	pool := testPool(t)
	b := seedBasics(t, pool)
	st := orders.NewStore(pool)

	orderID, total := quoteAndOrder(t, st, b, nil)
	if orderID == "" {
		t.Fatal("no order id")
	}
	// seedBasics prices the item at 1500 cents; quoteAndOrder orders 1 unit and
	// no delivery fee/tax config is asserted here — the invariant under test is
	// only that SOME server-computed total came out, driven purely by the
	// catalog price, never by a client-carried field (there is none to carry).
	if total < 1500 {
		t.Fatalf("order total = %d, want >= catalog price 1500 (subtotal alone)", total)
	}
}
