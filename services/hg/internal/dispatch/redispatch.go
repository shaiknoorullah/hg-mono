package dispatch

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// SearchStatus says where an order's search for a rider stood when its pickup
// deadline lapsed, and what ResumeSearchTx did about it.
type SearchStatus string

const (
	// SearchReopened: the search had ended with no rider found; it is
	// searching again, from the nearest radius, with a fresh wave budget.
	SearchReopened SearchStatus = "REOPENED"
	// SearchRunning: the search is still offering waves; nothing to do.
	SearchRunning SearchStatus = "SEARCHING"
	// SearchAssigned: a rider holds the order but has not picked it up.
	SearchAssigned SearchStatus = "ASSIGNED"
	// SearchNotStarted: no search exists yet. The dispatch runner's backstop
	// sweep starts one for every ready order without one.
	SearchNotStarted SearchStatus = "NOT_STARTED"
)

// ResumeSearchTx is the dispatch half of a lapsed pickup deadline, run inside
// the deadline runner's transaction: the spec's action for a ready order
// nobody has collected starts with "escalate dispatch (widen radius / manual
// assign)" (docs/spec/01-platform.md, "P-15 — Deadlines and timeout
// actions"; https://github.com/shaiknoorullah/hg-mono/issues/293).
//
// A search that ended in NO_RIDER_FOUND is re-opened: SEARCHING again, due at
// once and free of any escalation lease, from the first radius of the ladder,
// and with a fresh wave and time budget counted from now (state_since), so the
// dispatch runner widens the radius again for riders who came online since.
// The round's first wave searches the first radius whatever the round before
// ended on: the runner counts waves, and asks whether the last one was empty,
// only since state_since (ClaimWavesToEscalate). Riders who already turned the
// order down or let an offer lapse are never offered it again (the candidate
// query excludes them). A search still running, or a rider already assigned,
// is left alone; ops get the alert either way. Assigning a rider by hand has
// no endpoint yet (https://github.com/shaiknoorullah/hg-mono/issues/336).
//
// The re-opened search ends in NO_RIDER_FOUND again if nobody takes it, and
// the next lapse re-opens it: one round of waves per 10-minute lapse.
func ResumeSearchTx(ctx context.Context, tx pgx.Tx, orderID string) (SearchStatus, error) {
	var state string
	var assigned bool
	err := tx.QueryRow(ctx, `
SELECT state::text, rider_account_id IS NOT NULL
  FROM dispatch WHERE order_id = $1
   FOR UPDATE`, orderID).Scan(&state, &assigned)
	if errors.Is(err, pgx.ErrNoRows) {
		return SearchNotStarted, nil
	}
	if err != nil {
		return "", fmt.Errorf("lock dispatch: %w", err)
	}
	switch {
	case assigned:
		return SearchAssigned, nil
	case state != "NO_RIDER_FOUND":
		return SearchRunning, nil
	}
	if _, err := tx.Exec(ctx, `
UPDATE dispatch
   SET state = 'SEARCHING', state_since = now(), radius_m = $2,
       deadline_at = now(), deadline_action = 'NEXT_WAVE',
       lease_until = NULL, lease_owner = NULL
 WHERE order_id = $1`, orderID, radiusLadderM[0]); err != nil {
		return "", fmt.Errorf("re-open search: %w", err)
	}
	return SearchReopened, nil
}

// EndSearchTx closes an order's search for a rider because the order is being
// cancelled at the pickup escalation cap, inside the caller's transaction
// (https://github.com/shaiknoorullah/hg-mono/issues/336). The dispatch ends in
// NO_RIDER_FOUND with no deadline, so the dispatch runner never offers the
// order again, and every offer still waiting for an answer is withdrawn and
// its rider told. It reports false, and changes nothing, when a rider holds
// the order: someone may be at the counter, so a person decides
// (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions": the
// cancel is for a ready order with no rider).
func EndSearchTx(ctx context.Context, tx pgx.Tx, orderID string) (bool, error) {
	var state string
	var assigned bool
	err := tx.QueryRow(ctx, `
SELECT state::text, rider_account_id IS NOT NULL
  FROM dispatch WHERE order_id = $1
   FOR UPDATE`, orderID).Scan(&state, &assigned)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("lock dispatch: %w", err)
	}
	if assigned {
		return false, nil
	}
	if state != "NO_RIDER_FOUND" && state != "COMPLETED" {
		var at time.Time
		if err := tx.QueryRow(ctx, `
UPDATE dispatch
   SET state = 'NO_RIDER_FOUND', state_since = now(), deadline_at = NULL, deadline_action = NULL,
       lease_until = NULL, lease_owner = NULL
 WHERE order_id = $1
RETURNING state_since`, orderID).Scan(&at); err != nil {
			return false, fmt.Errorf("end search: %w", err)
		}
		if err := emitDispatchState(ctx, tx, orderID, state, "NO_RIDER_FOUND", at); err != nil {
			return false, err
		}
	}
	rows, err := tx.Query(ctx, `
UPDATE dispatch_offer
   SET state = 'WITHDRAWN', outcome = 'WITHDRAWN', outcome_at = now()
 WHERE order_id = $1 AND state = 'PENDING'
RETURNING id::text, order_id::text, rider_account_id::text`, orderID)
	if err != nil {
		return false, fmt.Errorf("withdraw offers: %w", err)
	}
	withdrawn, err := scanWithdrawn(rows)
	if err != nil {
		return false, err
	}
	return true, emitWithdrawn(ctx, tx, withdrawn, realtime.DispatchWithdrawnCancelled)
}
