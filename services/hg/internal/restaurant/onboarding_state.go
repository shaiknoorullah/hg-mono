package restaurant

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/accountstate"
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
// account_state_complete_onboarding() (migration 00035): the ONBOARDING system
// principal (accountstate.SystemOnboarding). It checks the three gates and the
// halal certificate itself and takes the restaurant out of PENDING in the same row
// update ("becomes ACTIVE exactly when onboarding_state becomes ACTIVE"): to LIVE
// only with a current, admin-verified certificate and no delisting reason,
// otherwise to DELISTED with the certificate's reason, the rule an admin
// reinstating it follows (accountstate.ReinstatedState). A certificate can lapse
// between the application's approval and the last gate; the restaurant is then
// delisted, not listed. A restaurant that is not PENDING keeps its account state:
// completing onboarding never lifts a suspension or a ban. The database refuses
// any other way out of PENDING, so this code cannot list a restaurant by itself.
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

	var from, to, halal string
	var fromReasons, toReasons []string
	if target == "ACTIVE" {
		if err := tx.QueryRow(ctx, `
SELECT from_state, to_state, delist_before, delist_after, halal_status
  FROM account_state_complete_onboarding($1)`, restaurantID).Scan(&from, &to, &fromReasons, &toReasons, &halal); err != nil {
			return err
		}
	} else if _, err := tx.Exec(ctx, `
UPDATE restaurant SET onboarding_state = $2::restaurant_onboarding_state, updated_at = now()
 WHERE id = $1`, restaurantID, target); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO restaurant_onboarding_transition
  (restaurant_id, from_state, to_state, actor_kind, reason)
VALUES ($1, $2::restaurant_onboarding_state, $3::restaurant_onboarding_state, 'SYSTEM', 'auto-advance')`,
		restaurantID, cur, target); err != nil {
		return err
	}
	if target != "ACTIVE" || from == to {
		return nil
	}
	return auditGoLive(ctx, tx, restaurantID, from, to, fromReasons, toReasons, halal)
}

// auditGoLive records the ONBOARDING principal's change in the audit log: no
// person, the principal named as the actor's only role.
func auditGoLive(ctx context.Context, tx pgx.Tx, restaurantID, from, to string, fromReasons, toReasons []string, halal string) error {
	roles, err := json.Marshal([]string{string(accountstate.SystemPrincipal(accountstate.SystemOnboarding))})
	if err != nil {
		return err
	}
	before, err := json.Marshal(map[string]any{"account_state": from, "delist_reasons": nonNil(fromReasons)})
	if err != nil {
		return err
	}
	after, err := json.Marshal(map[string]any{
		"account_state": to, "delist_reasons": nonNil(toReasons), "halal_status": halal,
		"onboarding_state": "ACTIVE",
	})
	if err != nil {
		return err
	}
	action := "restaurant.listed"
	if to != accountstate.StateLive {
		action = "restaurant.delisted"
	}
	_, err = tx.Exec(ctx, `
INSERT INTO audit_event
  (actor_kind, actor_roles, action, subject_type, subject_id, outcome, reason, before, after,
   day, seq, prev_hash, hash)
VALUES ('SYSTEM', $1, $2, 'RESTAURANT', $3, 'SUCCESS', 'onboarding completed', $4, $5,
        current_date, 0, '\x00'::bytea, '\x00'::bytea)`,
		string(roles), action, restaurantID, string(before), string(after))
	return err
}

func nonNil(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}
