package orders

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
)

// One active order per customer, narrowed by the owner on 1 Oct 2026: "an order
// under review does not count as active"
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01,
// issue https://github.com/shaiknoorullah/hg-mono/issues/260). Under review is
// the DISPUTED state, which every problem report moves an order into.

// seedCart puts one item in the customer's cart. One cart can be priced into any
// number of quotes, and each quote places at most one order.
func seedCart(t *testing.T, st *Store, b basics) string {
	t.Helper()
	cart, err := st.AddCartLine(context.Background(), b.accountID, b.restaurantID,
		CartLineInput{MenuItemID: b.menuItemID, Quantity: 1}, false)
	if err != nil {
		t.Fatalf("add cart line: %v", err)
	}
	return cart.ID
}

// anotherCustomer returns b with a new customer (account and Ontario address) at
// the same restaurant. seedBasics cannot be called twice in one test: its
// restaurant slug comes from the time-ordered head of a UUIDv7 and collides.
func anotherCustomer(t *testing.T, pool *pgxpool.Pool, b basics) basics {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('it-'||uuid_generate_v7()::text||'@test.local', 'ACTIVE') RETURNING id`).Scan(&b.accountID); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone, is_default)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.3810, 43.6420), 4326)::geography, 'America/Toronto', true)
		RETURNING id`, b.accountID).Scan(&b.addressID); err != nil {
		t.Fatalf("seed address: %v", err)
	}
	accountID := b.accountID
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM order_line_addon WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`,
			`DELETE FROM order_line WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`,
			`DELETE FROM order_transition WHERE order_id IN (SELECT id FROM "order" WHERE account_id=$1)`,
			`DELETE FROM deadline_audit WHERE subject_id IN (SELECT id FROM "order" WHERE account_id=$1)`,
			`DELETE FROM "order" WHERE account_id=$1`,
			`DELETE FROM quote WHERE account_id=$1`,
			`DELETE FROM cart_line_addon WHERE cart_line_id IN (SELECT cl.id FROM cart_line cl JOIN cart c ON c.id=cl.cart_id WHERE c.account_id=$1)`,
			`DELETE FROM cart_line WHERE cart_id IN (SELECT id FROM cart WHERE account_id=$1)`,
			`DELETE FROM cart WHERE account_id=$1`,
			`DELETE FROM address WHERE account_id=$1`,
			`DELETE FROM account WHERE id=$1`,
		} {
			_, _ = pool.Exec(ctx, q, accountID)
		}
	})
	return b
}

func newQuote(t *testing.T, st *Store, b basics, cartID string) *Quote {
	t.Helper()
	q, err := st.CreateQuote(context.Background(), QuoteRequest{
		AccountID: b.accountID, CartID: cartID, DeliveryAddressID: &b.addressID, Fulfilment: "DELIVERY",
	})
	if err != nil {
		t.Fatalf("create quote: %v", err)
	}
	return q
}

// tryOrder places an order from a fresh quote and returns its id, or the error. Placing an
// order consumes the cart (C-23 rule 1), so each attempt quotes the customer's current cart,
// adding a line to start one when the last order took the previous cart.
func tryOrder(t *testing.T, st *Store, b basics, _ string) (string, error) {
	t.Helper()
	var fresh *Quote
	p, err := st.CreateOrder(context.Background(), OrderInput{AccountID: b.accountID, QuoteID: newQuote(t, st, b, seedCart(t, st, b)).ID}, &fresh)
	if err != nil {
		return "", err
	}
	return p.OrderID, nil
}

func mustOrder(t *testing.T, st *Store, b basics, cartID string) string {
	t.Helper()
	id, err := tryOrder(t, st, b, cartID)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	return id
}

// move drives an order one step through Transition, the order's only writer.
func move(t *testing.T, st *Store, orderID string, to machine.State, actor machine.ActorKind) {
	t.Helper()
	req := TransitionRequest{OrderID: orderID, To: to, Actor: actor, Reason: "test"}
	if to == machine.StatePreparing {
		req.PrepEtaMinutes = 20
	}
	if err := st.Transition(context.Background(), req); err != nil {
		t.Fatalf("transition to %s: %v", to, err)
	}
}

func activeOrderID(t *testing.T, st *Store, b basics) string {
	t.Helper()
	v, err := st.GetActiveOrder(context.Background(), b.accountID)
	if err != nil {
		t.Fatalf("get active order: %v", err)
	}
	if v == nil {
		return ""
	}
	return v.ID
}

// A customer whose only order is under review can order again, and the new
// order, not the one under review, is the active order the app resumes.
func TestIntegrationUnderReviewOrderDoesNotBlockANewOrder(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	b := seedBasics(t, pool)
	cartID := seedCart(t, st, b)

	// The restaurant reports a problem while preparing (the "restaurant
	// reports an unrecoverable problem" edge into DISPUTED).
	first := mustOrder(t, st, b, cartID)
	move(t, st, first, machine.StateAuthorized, machine.ActorSystem)
	move(t, st, first, machine.StateRestaurantPending, machine.ActorSystem)
	move(t, st, first, machine.StatePreparing, machine.ActorRestaurant)
	move(t, st, first, machine.StateDisputed, machine.ActorRestaurant)

	if got := activeOrderID(t, st, b); got != "" {
		t.Fatalf("active order = %s, want none: an order under review is not the active order", got)
	}

	second, err := tryOrder(t, st, b, cartID)
	if err != nil {
		t.Fatalf("new order while the only other one is under review: %v, want it placed", err)
	}
	if got := activeOrderID(t, st, b); got != second {
		t.Errorf("active order = %q, want the new order %q", got, second)
	}

	// The order history is unchanged: its Active section is every unfinished
	// order (the contract's OrderStatusGroup), so it lists both.
	rows, _, err := st.ListOrders(context.Background(), b.accountID, "ACTIVE", 20, nil)
	if err != nil {
		t.Fatalf("list active orders: %v", err)
	}
	if len(rows) != 2 {
		t.Errorf("history Active section has %d orders, want 2 (the new one and the one under review)", len(rows))
	}
}

// The boundary, walked along the whole delivery: every step before review
// blocks a second order; the step into review frees the slot; the new order
// then holds it; and leaving review (only ever to RESOLVED, which is finished)
// changes nothing.
func TestIntegrationActiveOrderBlocksUntilTheMomentItEntersReview(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	b := seedBasics(t, pool)
	cartID := seedCart(t, st, b)

	first := mustOrder(t, st, b, cartID)
	steps := []struct {
		to    machine.State
		actor machine.ActorKind
	}{
		{"", ""}, // CREATED, as placed
		{machine.StateAuthorized, machine.ActorSystem},
		{machine.StateRestaurantPending, machine.ActorSystem},
		{machine.StatePreparing, machine.ActorRestaurant},
		{machine.StateReadyForPickup, machine.ActorRestaurant},
		{machine.StatePickedUp, machine.ActorRider},
		{machine.StateArrived, machine.ActorRider},
		{machine.StateDelivered, machine.ActorRider},
	}
	for _, s := range steps {
		if s.to != "" {
			move(t, st, first, s.to, s.actor)
		}
		if _, err := tryOrder(t, st, b, cartID); !errors.Is(err, ErrActiveOrderExists) {
			t.Fatalf("second order while the first is %v: err = %v, want ErrActiveOrderExists", stateName(s.to), err)
		}
		if got := activeOrderID(t, st, b); got != first {
			t.Fatalf("active order while the first is %v = %q, want %q", stateName(s.to), got, first)
		}
	}

	// The customer reports a problem with the delivered order: the moment it is
	// under review, a new order is allowed.
	move(t, st, first, machine.StateDisputed, machine.ActorCustomer)
	second, err := tryOrder(t, st, b, cartID)
	if err != nil {
		t.Fatalf("new order the moment the first entered review: %v, want it placed", err)
	}

	// The new order is genuinely active, so it blocks a third.
	if _, err := tryOrder(t, st, b, cartID); !errors.Is(err, ErrActiveOrderExists) {
		t.Fatalf("third order: err = %v, want ErrActiveOrderExists", err)
	}

	// Review ends. The machine's only way out of DISPUTED is RESOLVED, a
	// finished state, so the reviewed order never counts again: the new order is
	// still the one active order and a third is still refused.
	move(t, st, first, machine.StateResolved, machine.ActorSupport)
	if got := activeOrderID(t, st, b); got != second {
		t.Errorf("active order after review ended = %q, want %q", got, second)
	}
	if _, err := tryOrder(t, st, b, cartID); !errors.Is(err, ErrActiveOrderExists) {
		t.Errorf("third order after review ended: err = %v, want ErrActiveOrderExists", err)
	}
}

func stateName(s machine.State) machine.State {
	if s == "" {
		return machine.StateCreated
	}
	return s
}

// Two checkouts racing for a customer with no active order: exactly one wins and
// the other is told an active order exists. Half the rounds start with an order
// under review, which must not open room for two.
func TestIntegrationConcurrentOrdersOnlyOneIsPlaced(t *testing.T) {
	pool := testPool(t)
	st := NewStore(pool)
	ctx := context.Background()
	restaurant := seedBasics(t, pool)

	for round := 0; round < 6; round++ {
		b := anotherCustomer(t, pool, restaurant)
		cartID := seedCart(t, st, b)
		if round%2 == 1 {
			reviewed := mustOrder(t, st, b, cartID)
			move(t, st, reviewed, machine.StateAuthorized, machine.ActorSystem)
			move(t, st, reviewed, machine.StateRestaurantPending, machine.ActorSystem)
			move(t, st, reviewed, machine.StatePreparing, machine.ActorRestaurant)
			move(t, st, reviewed, machine.StateDisputed, machine.ActorRestaurant)
			cartID = seedCart(t, st, b) // that order consumed the cart
		}
		quotes := []*Quote{newQuote(t, st, b, cartID), newQuote(t, st, b, cartID)}

		start := make(chan struct{})
		errs := make([]error, len(quotes))
		var wg sync.WaitGroup
		for i, q := range quotes {
			wg.Add(1)
			go func(i int, quoteID string) {
				defer wg.Done()
				<-start
				var fresh *Quote
				_, errs[i] = st.CreateOrder(ctx, OrderInput{AccountID: b.accountID, QuoteID: quoteID}, &fresh)
			}(i, q.ID)
		}
		close(start)
		wg.Wait()

		placed, refused := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				placed++
			case errors.Is(err, ErrActiveOrderExists):
				refused++
			default:
				t.Errorf("round %d: unexpected error %v", round, err)
			}
		}
		if placed != 1 || refused != 1 {
			t.Errorf("round %d: %d placed and %d refused, want exactly 1 and 1", round, placed, refused)
		}
		if n := countActive(t, pool, b.accountID); n != 1 {
			t.Errorf("round %d: %d orders count as active, want 1", round, n)
		}
	}
}

func countActive(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM "order" WHERE account_id = $1 AND state::text = ANY($2)`,
		accountID, machine.ActiveStates()).Scan(&n); err != nil {
		t.Fatalf("count active: %v", err)
	}
	return n
}
