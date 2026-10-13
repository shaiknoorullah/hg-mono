package orders

// open_now.go decides whether a restaurant can take an order now: inside its
// trading hours in its own timezone, not on a closed day, its accepting-orders
// toggle on, not paused, its order screen seen in the last 5 minutes, and no
// open payout collection blocking it. The rule is internal/openhours, the same
// one the customer card shows (C-14), so a card that reads CLOSED_HOURS or
// PAUSED is never quotable.
//
// Adding a cart line, quoting and placing the order each call
// refuseClosedRestaurant right after LockOrderableRestaurant, in the same
// transaction and under the same FOR SHARE lock, and refuse with
// ErrRestaurantClosed (409 RESTAURANT_CLOSED). The saved cart is kept, and says
// RESTAURANT_CLOSED in its blocking reasons. The restaurant accepting an order
// does not call it: an order placed inside the hours can still be accepted
// after closing (docs/spec/03-restaurant.md, R-22 rule 3).
// Issue: https://github.com/shaiknoorullah/hg-mono/issues/648

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/openhours"
)

// restaurantOpenState reads the restaurant's open state inside tx, at the
// transaction's own clock (now(), the clock the halal gate reads by too). A
// missing restaurant reads as suspended.
func restaurantOpenState(ctx context.Context, tx pgx.Tx, restaurantID string) (string, openhours.Verdict, error) {
	var r openhours.Restaurant
	var now time.Time
	err := tx.QueryRow(ctx, `SELECT now(), r.timezone, `+openhours.Columns+`
		  FROM restaurant r WHERE r.id = $1`, restaurantID).
		Scan(append([]any{&now, &r.Timezone}, r.ScanTargets()...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return openhours.StateClosedSuspended, openhours.Verdict{}, nil
	}
	if err != nil {
		return "", openhours.Verdict{}, fmt.Errorf("read restaurant open state: %w", err)
	}
	state, hv := r.State(now)
	return state, hv, nil
}

// cartRestaurantOpen reports whether the cart's restaurant can take an order
// now, and sets the C-14 state its restaurant card shows. A restaurant that is
// not orderable (orderable.go) reads CLOSED_HOURS, as the catalog card has it.
func cartRestaurantOpen(ctx context.Context, tx pgx.Tx, c *Cart, restaurantID string, orderable bool) (bool, error) {
	state, hours, err := restaurantOpenState(ctx, tx, restaurantID)
	if err != nil {
		return false, err
	}
	c.RestaurantAvailability = openhours.CustomerState(state, hours)
	if !orderable {
		c.RestaurantAvailability = openhours.CustomerClosedHours
	}
	return state == openhours.StateOpen, nil
}

// refuseClosedRestaurant returns ErrRestaurantClosed unless the restaurant can
// take an order now. Call it after LockOrderableRestaurant, in the same
// transaction, so the row it reads is the one locked FOR SHARE.
func refuseClosedRestaurant(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	state, _, err := restaurantOpenState(ctx, tx, restaurantID)
	if err != nil {
		return err
	}
	if state != openhours.StateOpen {
		return ErrRestaurantClosed
	}
	return nil
}
