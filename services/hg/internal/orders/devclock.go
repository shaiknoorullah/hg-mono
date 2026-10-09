package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// RowQuerier is the one method BringDeadlineForward needs; *pgx.Conn,
// *pgxpool.Pool and pgx.Tx all satisfy it.
type RowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ErrDeadlineNotMoved is returned when the order is no longer in the state and
// deadline action the caller expected, so nothing was changed.
var ErrDeadlineNotMoved = errors.New("orders: the order is no longer where the caller expected; its deadline was not moved")

// BringDeadlineForward is the local developer clock: the dev world
// (internal/devworld, `make dev-scenario`) uses it to make a deadline fall due
// now instead of minutes from now, so the deadline runner fires the real
// action (a restaurant timeout, a pickup escalation, a settle) through the one
// transition function. The server never calls it.
//
// It only ever brings a deadline earlier, to now()+in, and only while the
// order is still in state with action, so it cannot postpone a timeout or
// move an order that has moved on; the order keeps a deadline, as the
// order_deadline_required CHECK demands. The lease is cleared so the next
// sweep claims the row at once, as reArm does. A deadline already due by then
// is left as it is and returned.
func BringDeadlineForward(ctx context.Context, q RowQuerier, orderID, state, action string, in time.Duration) (time.Time, error) {
	if in < 0 {
		return time.Time{}, errors.New("orders: a deadline is only ever brought forward to now or later")
	}
	var at time.Time
	err := q.QueryRow(ctx, `
		UPDATE "order"
		   SET deadline_at = now() + make_interval(secs => $4),
		       lease_until = NULL, lease_owner = NULL
		 WHERE id = $1 AND state::text = $2 AND deadline_action = $3
		   AND deadline_at > now() + make_interval(secs => $4)
		RETURNING deadline_at`, orderID, state, action, in.Seconds()).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		var cur, curAction string
		var curAt *time.Time
		if rerr := q.QueryRow(ctx, `SELECT state::text, COALESCE(deadline_action, ''), deadline_at FROM "order" WHERE id = $1`, orderID).
			Scan(&cur, &curAction, &curAt); rerr == nil && cur == state && curAction == action && curAt != nil {
			return *curAt, nil
		}
		return time.Time{}, ErrDeadlineNotMoved
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("orders: bring deadline forward: %w", err)
	}
	return at, nil
}
