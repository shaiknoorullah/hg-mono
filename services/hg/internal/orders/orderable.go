package orders

// orderable.go decides whether a restaurant can take a new order. The product's
// single claim is halal verification
// (https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#1-what-this-is), so a client
// that still holds a menu item id, a cart or a quote cannot order from a
// restaurant the platform can no longer vouch for: adding a line, quoting and
// placing the order each refuse with 409 RESTAURANT_UNAVAILABLE, the code the
// contract documents for a restaurant that is no longer visible. The saved cart
// is kept, and is not quotable: the halal display spec, rule 3
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/02-customer.md#c-12--halal-certification-display-and-verification--critical).
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/292
//
// The check holds under concurrency. Every path that lets a restaurant take an
// order (adding a cart line, quoting, placing the order, and the restaurant
// accepting it) calls LockOrderableRestaurant, which locks the restaurant row
// FOR SHARE until its transaction ends and only then reads whether the
// restaurant can take orders. A suspension, ban, delisting or certificate
// expiry writes that same row, so it either commits before the lock is granted
// and is seen, or waits until the order's transaction has committed and then
// finds the order and settles it. Without the lock, an order whose transaction
// read LIVE just before a suspension committed was written after the
// suspension had already cancelled the restaurant's open orders.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/328

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
)

// ErrRestaurantUnavailable: the restaurant is not listed and LIVE, or the
// platform cannot vouch for its halal certificate right now. The handler maps it
// to 409 RESTAURANT_UNAVAILABLE.
var ErrRestaurantUnavailable = errors.New("restaurant cannot take orders: not listed, or its halal certificate is not current")

// restaurantGate is what the order path reads about a restaurant before it
// lets an order through. It is read inside the transaction that adds the line,
// prices the quote or creates the order, never in an earlier request. Every
// field a database NULL can reach is a pointer, so a missing value is visible
// and refuses.
type restaurantGate struct {
	// Listed is restaurant.deleted_at IS NULL.
	Listed bool
	// AccountState is restaurant.account_state. Only LIVE takes orders:
	// DELISTED, SUSPENDED, BANNED and the rest do not.
	AccountState *string
	// StoredHalal is restaurant.halal_status, the state the catalog lists by.
	// It is derived when a certificate row is written, so it can be stale as
	// dates pass (https://github.com/shaiknoorullah/hg-mono/issues/252). It
	// can refuse an order but never admit one on its own.
	StoredHalal *string
	// HalalNow is halal_certification_at(restaurant, now()).halal_status: the
	// halal state as of this transaction, from admin-verified certificate data
	// only (migration 00033_halal_certified_now.sql). An expired certificate
	// refuses here even when no job has derived the stored state again.
	HalalNow *string
}

// restaurantGateColumns reads a restaurantGate from a `restaurant` aliased r,
// in the order scanTargets expects.
const restaurantGateColumns = `r.deleted_at IS NULL, r.account_state::text, r.halal_status::text,
	(halal_certification_at(r.id, now())).halal_status::text`

func (g *restaurantGate) scanTargets() []any {
	return []any{&g.Listed, &g.AccountState, &g.StoredHalal, &g.HalalNow}
}

// orderable reports whether the restaurant can take a new order: listed, LIVE,
// and vouched for by both the catalog's state and the state as of now. The
// halal states that vouch are the catalog's (catalog.IsHalalVisible: CERTIFIED
// and EXPIRING_SOON), so a customer can never order from a restaurant they
// cannot see. Fail closed: a NULL, empty or unknown value is not orderable.
func (g restaurantGate) orderable() bool {
	return g.Listed &&
		g.AccountState != nil && *g.AccountState == "LIVE" &&
		vouches(g.StoredHalal) && vouches(g.HalalNow)
}

// refuseUnorderable returns ErrRestaurantUnavailable unless the restaurant is
// orderable.
func (g restaurantGate) refuseUnorderable() error {
	if !g.orderable() {
		return ErrRestaurantUnavailable
	}
	return nil
}

func vouches(halalState *string) bool {
	return halalState != nil && catalog.IsHalalVisible(*halalState)
}

// LockOrderableRestaurant locks the restaurant row FOR SHARE until tx ends, then
// returns ErrRestaurantUnavailable unless the restaurant can take an order
// (restaurantGate.orderable). A missing restaurant refuses too. Lock order:
// call it before locking any of the restaurant's orders, because an
// account-state action locks the restaurant first and its orders second; and
// after locking any of its menu items, because an admin approving a menu item
// updates the item first and locks the restaurant second. In the same order,
// none of them can deadlock with an order.
//
// Why FOR SHARE and not FOR KEY SHARE: FOR KEY SHARE does not conflict with a
// plain UPDATE that leaves the key alone, and two writers of what the gate reads
// do exactly that. The certificate trigger, halal_refresh_restaurant_status in
// migration 00009_halal.sql, runs on every write to halal_certificate and
// updates the restaurant row without locking it first, and any future writer
// of account_state may forget to lock it. FOR SHARE conflicts with every UPDATE
// of the row, so none of them can commit between this read and the order's
// commit. Holders of FOR SHARE do not block each other, so orders at the same
// restaurant still run side by side. Only writes to the restaurant row wait,
// for a few milliseconds.
//
// The lock is its own statement, taken before the gate is read. The service
// runs transactions at READ COMMITTED, where each statement reads a new
// snapshot, so the read below sees everything a writer committed while this
// transaction waited for the lock.
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/328
func LockOrderableRestaurant(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM restaurant WHERE id = $1 FOR SHARE`, restaurantID); err != nil {
		return fmt.Errorf("lock restaurant: %w", err)
	}
	var gate restaurantGate
	err := tx.QueryRow(ctx, `SELECT `+restaurantGateColumns+` FROM restaurant r WHERE r.id = $1`,
		restaurantID).Scan(gate.scanTargets()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRestaurantUnavailable
	}
	if err != nil {
		return fmt.Errorf("read restaurant gate: %w", err)
	}
	return gate.refuseUnorderable()
}
