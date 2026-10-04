package dispatch

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
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
