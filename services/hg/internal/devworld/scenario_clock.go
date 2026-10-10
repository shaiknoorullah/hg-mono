package devworld

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// The clock. A few redesign states only exist once time has passed: a
// restaurant that let an offer lapse, a ready order nobody collected, a
// certificate past its last valid day. Waiting for real time would take
// minutes or days, so these scenarios move one row's clock instead, the way
// the server's own timers read it, and let the running API act:
//
//   - an order's deadline_at, which the deadline ticker (orders.DeadlineRunner)
//     sweeps every second with "deadline_at <= now()". Only ever earlier, never
//     later, and only while the order is still in the state and action the
//     scenario expects. The ticker then fires the real action (timeout,
//     escalation, settle) through the one transition function.
//   - a halal certificate's expires_on, which the certificate trigger and the
//     expiry job (internal/halalexpiry) read against the restaurant's local
//     date. Moved to yesterday, only for an approved certificate.
//
// Nothing else is written: no state, no money, no ledger row. Both refuse a
// database that is not this machine's, exactly as reset does (AllowReset).

// localDB opens the local database for a clock move. It refuses an
// environment other than local and any database host not on this machine.
func localDB(ctx context.Context) (*pgx.Conn, error) {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if err := AllowReset(os.Getenv("HG_ENV"), dsn); err != nil {
		return nil, fmt.Errorf("devworld: this scenario moves a clock in the local database (%w); run it through make dev-scenario", err)
	}
	return connect(ctx, dsn)
}

// clockGuard checks, before the first API request, that both the API and the
// database are this machine's. A scenario that moves a clock calls it first,
// so a refused database never leaves a half-built order behind.
func clockGuard(base string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if err := AllowReset(os.Getenv("HG_ENV"), dsn); err != nil {
		return fmt.Errorf("devworld: this scenario moves a clock in the local database (%w); run it through make dev-scenario", err)
	}
	return nil
}

// bringDeadlineForward moves orderID's deadline to now()+in through the orders
// module's developer clock (orders.BringDeadlineForward): only earlier, and
// only while the order is still in state with action.
func bringDeadlineForward(ctx context.Context, orderID, state, action string, in time.Duration) (time.Time, error) {
	if in < 0 {
		return time.Time{}, errors.New("devworld: a deadline is only ever brought forward to now or later")
	}
	conn, err := localDB(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer conn.Close(ctx)
	at, err := orders.BringDeadlineForward(ctx, conn, orderID, state, action, in)
	if errors.Is(err, orders.ErrDeadlineNotMoved) {
		return time.Time{}, errors.New("devworld: the order moved on before its deadline could be brought forward; nothing was changed")
	}
	return at, err
}

// orderClock is what the deadline ticker sees on one order.
type orderClock struct {
	State       string
	Action      string
	Escalations int
	DeadlineAt  *time.Time
	CancelledAs string
}

func readOrderClock(ctx context.Context, orderID string) (orderClock, error) {
	conn, err := localDB(ctx)
	if err != nil {
		return orderClock{}, err
	}
	defer conn.Close(ctx)
	var c orderClock
	err = conn.QueryRow(ctx, `
		SELECT state::text, COALESCE(deadline_action, ''), deadline_escalations, deadline_at,
		       COALESCE(cancel_reason::text, '')
		  FROM "order" WHERE id = $1`, orderID).
		Scan(&c.State, &c.Action, &c.Escalations, &c.DeadlineAt, &c.CancelledAs)
	if err != nil {
		return orderClock{}, fmt.Errorf("devworld: read order clock: %w", err)
	}
	return c, nil
}

// waitClock polls the order until done reports true or window passes.
func waitClock(ctx context.Context, orderID string, window time.Duration, done func(orderClock) bool) (orderClock, error) {
	deadline := time.Now().Add(window)
	for {
		c, err := readOrderClock(ctx, orderID)
		if err != nil {
			return c, err
		}
		if done(c) {
			return c, nil
		}
		if !time.Now().Before(deadline) {
			return c, fmt.Errorf("devworld: the deadline ticker did not act within %s (order %s, action %s, escalations %d); is the API running against this database?",
				window, c.State, c.Action, c.Escalations)
		}
		if err := sleepCtx(ctx, time.Second); err != nil {
			return c, err
		}
	}
}

// lapseCertificate moves an approved certificate's expiry to the day before
// the restaurant's own local date, so it has lapsed now. The certificate
// trigger re-derives the restaurant's halal state in the same statement
// (EXPIRED, and a LIVE restaurant is delisted), as the expiry job would at
// local midnight. It reports false when the certificate had already lapsed.
func lapseCertificate(ctx context.Context, certID string) (bool, error) {
	conn, err := localDB(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Close(ctx)
	ct, err := conn.Exec(ctx, `
		UPDATE halal_certificate hc
		   SET expires_on = halal_local_date(r.timezone, now()) - 1
		  FROM restaurant r
		 WHERE hc.id = $1 AND r.id = hc.restaurant_id
		   AND hc.status = 'APPROVED'
		   AND COALESCE(hc.grace_until, hc.expires_on) >= halal_local_date(r.timezone, now())`, certID)
	if err != nil {
		return false, fmt.Errorf("devworld: lapse certificate: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// readRestaurantHalal reads the halal state and listing the certificate
// trigger derived for a restaurant. Read only.
func readRestaurantHalal(ctx context.Context, restaurantID string) (halal, listing string, err error) {
	conn, err := localDB(ctx)
	if err != nil {
		return "", "", err
	}
	defer conn.Close(ctx)
	err = conn.QueryRow(ctx, `SELECT halal_status::text, account_state::text FROM restaurant WHERE id = $1`, restaurantID).
		Scan(&halal, &listing)
	if err != nil {
		return "", "", fmt.Errorf("devworld: read restaurant halal state: %w", err)
	}
	return halal, listing, nil
}
