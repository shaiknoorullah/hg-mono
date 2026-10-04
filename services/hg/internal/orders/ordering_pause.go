package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// The platform-wide pause on new orders, for use during an incident
// (https://github.com/shaiknoorullah/hg-mono/issues/244). Staff turn it on and
// off from Admin (the admin module's setOrderingPause, which audits the change
// in the same transaction). While it is on, CreateQuote and CreateOrder refuse
// with ErrOrderingPaused and the cart says it cannot be quoted. Nothing else in
// this package reads it: every order already placed carries on to the end.
//
// The switch is one row in Postgres (migration 00041_ordering_pause.sql). It is
// read on every quote, order and cart, with no cache in front of it, so every
// API replica sees a change on its next request and flushing Redis can never
// make it wrong (AGENTS.md, "Architecture in one picture").

// ErrOrderingPaused is returned by CreateQuote and CreateOrder while new orders
// are paused platform-wide. The handler maps it to 409 ORDERING_PAUSED.
var ErrOrderingPaused = errors.New("orders: new orders are paused platform-wide")

// OrderingPause is the switch as it stands.
type OrderingPause struct {
	Paused bool
	// PausedSince is when the current pause began; nil while ordering is open.
	PausedSince *time.Time
	// Reason is the reason given with the latest change, pause or resume.
	Reason *string
	// ChangedAt and ChangedBy describe the latest change; nil before the first.
	ChangedAt *time.Time
	ChangedBy *string
}

const selectOrderingPause = `
SELECT paused, paused_at, reason, changed_at, changed_by::text
  FROM ordering_pause
 WHERE id`

func scanOrderingPause(row pgx.Row) (OrderingPause, error) {
	var p OrderingPause
	err := row.Scan(&p.Paused, &p.PausedSince, &p.Reason, &p.ChangedAt, &p.ChangedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		// The migration inserts the row and the application role may not delete
		// it. If it is gone anyway, refuse loudly rather than guess "open".
		return p, fmt.Errorf("orders: the ordering_pause row is missing")
	}
	if err != nil {
		return p, fmt.Errorf("read ordering pause: %w", err)
	}
	return p, nil
}

// requireOrderingOpen returns ErrOrderingPaused when new orders are paused.
//
// With lock set it reads the row FOR SHARE, which CreateOrder needs: the lock
// is held until tx ends, and setOrderingPause's UPDATE cannot take the row
// until then. A pause that commits while an order is being created therefore
// either waits for the order to commit first, or (if it got the row first)
// makes this read wait and then see the pause. No order commits after the
// pause did. CreateQuote and the cart only need the current value, so they
// read without the lock and never hold up a pause.
func requireOrderingOpen(ctx context.Context, tx pgx.Tx, lock bool) error {
	q := `SELECT paused FROM ordering_pause WHERE id`
	if lock {
		q += ` FOR SHARE`
	}
	var paused bool
	err := tx.QueryRow(ctx, q).Scan(&paused)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("orders: the ordering_pause row is missing")
	}
	if err != nil {
		return fmt.Errorf("read ordering pause: %w", err)
	}
	if paused {
		return ErrOrderingPaused
	}
	return nil
}

// OrderingPause reads the switch for staff (getOrderingPause).
func (s *Store) OrderingPause(ctx context.Context) (OrderingPause, error) {
	return scanOrderingPause(s.pool.QueryRow(ctx, selectOrderingPause))
}

// OrderingStatus reads the customer-facing half of the switch (the `ordering`
// object of getPublicConfig): whether new orders are paused, and since when.
func (s *Store) OrderingStatus(ctx context.Context) (paused bool, since *time.Time, err error) {
	p, err := s.OrderingPause(ctx)
	if err != nil {
		return false, nil, err
	}
	return p.Paused, p.PausedSince, nil
}

// SetOrderingPauseTx turns the switch on or off inside the caller's
// transaction and returns the state before and after. The caller (the admin
// module) writes the audit row in the same transaction, so the change and its
// record commit together or not at all.
//
// The UPDATE takes the row exclusively, so it waits for any CreateOrder that
// holds it FOR SHARE (see requireOrderingOpen). Re-stating the current value is
// allowed: it records the new reason, and a pause keeps its paused_at.
func SetOrderingPauseTx(ctx context.Context, tx pgx.Tx, paused bool, reason, actorAccountID string) (before, after OrderingPause, err error) {
	before, err = scanOrderingPause(tx.QueryRow(ctx, selectOrderingPause+` FOR UPDATE`))
	if err != nil {
		return before, after, err
	}
	var actor any
	if actorAccountID != "" {
		actor = actorAccountID
	}
	after, err = scanOrderingPause(tx.QueryRow(ctx, `
UPDATE ordering_pause
   SET paused     = $1,
       paused_at  = CASE WHEN NOT $1 THEN NULL
                         WHEN paused THEN paused_at
                         ELSE now() END,
       reason     = $2,
       changed_by = $3,
       changed_at = now()
 WHERE id
RETURNING paused, paused_at, reason, changed_at, changed_by::text`, paused, reason, actor))
	return before, after, err
}
