package restaurant

import (
	"context"
	"encoding/json"
	"errors"
	"time"

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
// When it reaches ACTIVE the restaurant leaves PENDING in the same row update
// ("becomes ACTIVE exactly when onboarding_state becomes ACTIVE"). It does so as
// the ONBOARDING system principal (accountstate.SystemOnboarding), whose one
// transition is leaving PENDING, decided by accountstate.GoLive: LIVE only with a
// current, admin-verified halal certificate and no delisting reason, otherwise
// DELISTED with the reason, exactly as an admin reinstating it would. A certificate
// can lapse between the application's approval and the last onboarding gate; the
// restaurant is then delisted, not listed with a lapsed certificate. A restaurant
// that is not PENDING keeps its account state: completing onboarding never lifts
// a suspension or a ban. Migration 00035 refuses any other change of account_state
// made here.
//
// It is monotonic and idempotent: it reads the current state and the three gating
// conditions, computes the furthest reachable state, and only moves forward and
// only while inside the band. So it is safe to call — repeatedly — from any event
// that can satisfy a gate: admin document approval, Connect payouts-enabled, or
// menu-version approval. The caller passes its own transaction; the restaurant row
// is locked FOR UPDATE so concurrent gate events serialise.
func RecomputeOnboarding(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	var cur, account, timezone, halal string
	var delist []string
	var now time.Time
	var payoutReady, hasLiveItem, hasHours bool
	if err := tx.QueryRow(ctx, `
SELECT r.onboarding_state::text, r.account_state::text, r.delist_reasons, r.timezone,
       r.halal_status::text, now(),
       EXISTS (SELECT 1 FROM connect_account ca
                WHERE ca.owner_type = 'RESTAURANT' AND ca.owner_id = r.id
                  AND ca.payouts_enabled AND ca.details_submitted),
       EXISTS (SELECT 1 FROM menu_item mi
                WHERE mi.restaurant_id = r.id AND mi.live_version_id IS NOT NULL
                  AND mi.deleted_at IS NULL),
       EXISTS (SELECT 1 FROM restaurant_hours h WHERE h.restaurant_id = r.id)
  FROM restaurant r
 WHERE r.id = $1
   FOR UPDATE OF r`, restaurantID).Scan(&cur, &account, &delist, &timezone, &halal, &now,
		&payoutReady, &hasLiveItem, &hasHours); err != nil {
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

	golive := false
	var to string
	var reasons []string
	if target == "ACTIVE" {
		cert, err := HalalCertificateTx(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		certState := accountstate.CertificationState(cert, accountstate.LocalDate(timezone, now))
		to, reasons, golive = accountstate.GoLive(account, certState, delist)
	}

	if golive {
		// One row update: the database recognises completing onboarding only when
		// the account leaves PENDING together with onboarding_state reaching ACTIVE.
		if _, err := tx.Exec(ctx, `
UPDATE restaurant
   SET onboarding_state = 'ACTIVE', account_state = $2::restaurant_account_state,
       delist_reasons = $3, updated_at = now()
 WHERE id = $1`, restaurantID, to, reasons); err != nil {
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
	if !golive {
		return nil
	}
	return auditGoLive(ctx, tx, restaurantID, account, to, delist, reasons, halal)
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

// HalalCertificateTx reads the restaurant's admin-verified halal certificate the
// way the order path does
// (https://github.com/shaiknoorullah/hg-mono/pull/298, halal_certification_at):
// APPROVED, or later moved to EXPIRED, verified by an admin, from an ACCEPTED
// issuing body, not deleted; an APPROVED one wins over an EXPIRED one, and the
// later expiry within each. Nothing a request carries, and no pending upload,
// ever counts. Every path that lists a restaurant (an admin reinstating it, and
// onboarding completing) reads it here.
func HalalCertificateTx(ctx context.Context, tx pgx.Tx, restaurantID string) (accountstate.HalalCertificate, error) {
	var c accountstate.HalalCertificate
	err := tx.QueryRow(ctx, `
SELECT hc.status::text, hc.expires_on, hc.grace_until
  FROM halal_certificate hc
  JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
 WHERE hc.restaurant_id = $1
   AND hc.status IN ('APPROVED', 'EXPIRED')
   AND hc.verified_by IS NOT NULL
   AND hc.verified_at IS NOT NULL
   AND b.status = 'ACCEPTED'
   AND hc.deleted_at IS NULL
 ORDER BY (hc.status = 'APPROVED') DESC, hc.expires_on DESC, hc.id DESC
 LIMIT 1`, restaurantID).Scan(&c.Status, &c.ExpiresOn, &c.GraceUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return accountstate.HalalCertificate{}, nil
	}
	return c, err
}
