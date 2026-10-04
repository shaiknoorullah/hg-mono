package restaurant

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// onboardingRank orders the automatic post-approval band. RecomputeOnboarding
// only ever moves a restaurant forward within it.
var onboardingRank = map[string]int{
	"DOCUMENTS_APPROVED": 0,
	"PAYOUT_PENDING":     1,
	"MENU_PENDING":       2,
	"ACTIVE":             3,
}

// RecomputeOnboarding advances a restaurant's onboarding_state through the
// automatic post-approval band (spec 03-restaurant §R-11/R-17/R-06):
//
//	DOCUMENTS_APPROVED --automatic---------------------> PAYOUT_PENDING
//	PAYOUT_PENDING     --payout account READY (R-11)---> MENU_PENDING
//	MENU_PENDING       --≥1 LIVE item (R-17) AND hours set (R-06)--> ACTIVE
//
// The last step, to ACTIVE, is the database function
// account_state_complete_onboarding() (migration 00045): the ONBOARDING system
// principal (accountstate.SystemOnboarding), and the only way out of PENDING (the
// application role cannot write the account state). It checks the three gates and
// the halal certificate itself, records the step and its audit row, and takes the
// restaurant out of PENDING in the same row update ("becomes ACTIVE exactly when
// onboarding_state becomes ACTIVE"): to LIVE only with a current, admin-verified
// certificate and no delisting reason, otherwise to DELISTED with the
// certificate's reason, the rule an admin reinstating it follows
// (accountstate.ReinstatedState). A certificate can lapse
// between the application's approval and the last gate; the restaurant is then
// delisted, not listed. A restaurant that is not PENDING keeps its account state:
// completing onboarding never lifts a suspension or a ban.
//
// It is monotonic and idempotent: it reads the current state and the three gating
// conditions, computes the furthest reachable state, and only moves forward and
// only while inside the band. So it is safe to call — repeatedly — from any event
// that can satisfy a gate: admin document approval, Connect payouts-enabled, or
// menu-version approval. The caller passes its own transaction; the restaurant row
// is locked FOR UPDATE so concurrent gate events serialise.
func RecomputeOnboarding(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	var cur string
	var payoutReady, hasLiveItem, hasHours bool
	if err := tx.QueryRow(ctx, `
SELECT r.onboarding_state::text,
       EXISTS (SELECT 1 FROM connect_account ca
                WHERE ca.owner_type = 'RESTAURANT' AND ca.owner_id = r.id
                  AND ca.payouts_enabled AND ca.details_submitted),
       EXISTS (SELECT 1 FROM menu_item mi
                WHERE mi.restaurant_id = r.id AND mi.live_version_id IS NOT NULL
                  AND mi.deleted_at IS NULL),
       EXISTS (SELECT 1 FROM restaurant_hours h WHERE h.restaurant_id = r.id)
  FROM restaurant r
 WHERE r.id = $1
   FOR UPDATE OF r`, restaurantID).Scan(&cur, &payoutReady, &hasLiveItem, &hasHours); err != nil {
		return err
	}

	curRank, inBand := onboardingRank[cur]
	if !inBand {
		return nil // pre-approval, rejected, or withdrawn — not auto-advanceable
	}

	target := "PAYOUT_PENDING" // DOCUMENTS_APPROVED -> PAYOUT_PENDING is automatic
	if payoutReady {
		target = "MENU_PENDING"
	}
	if payoutReady && hasLiveItem && hasHours {
		target = "ACTIVE"
	}
	if onboardingRank[target] <= curRank {
		return nil // already at or beyond the furthest reachable state
	}

	if target == "ACTIVE" {
		// The last step is the ONBOARDING principal's: it moves onboarding_state,
		// the account state and the delisting reasons, and records the step and the
		// audit row, in this transaction.
		if _, err := tx.Exec(ctx, `SELECT * FROM account_state_complete_onboarding($1)`, restaurantID); err != nil {
			return err
		}
		return nil
	}
	if _, err := tx.Exec(ctx, `
UPDATE restaurant SET onboarding_state = $2::restaurant_onboarding_state, updated_at = now()
 WHERE id = $1`, restaurantID, target); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
INSERT INTO restaurant_onboarding_transition
  (restaurant_id, from_state, to_state, actor_kind, reason)
VALUES ($1, $2::restaurant_onboarding_state, $3::restaurant_onboarding_state, 'SYSTEM', 'auto-advance')`,
		restaurantID, cur, target)
	return err
}
