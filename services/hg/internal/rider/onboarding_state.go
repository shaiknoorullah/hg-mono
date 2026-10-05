package rider

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// RecomputeOnboarding moves an approved rider from PAYOUT_PENDING to ACTIVE once
// their Stripe Connect account reports payouts_enabled. Going online requires
// ACTIVE (and an ACTIVE account_status, which a PENDING rider gets here), so without this an approved rider can never work. It is idempotent and
// only ever moves a rider forward from PAYOUT_PENDING; call it in the caller's
// transaction from every event that can satisfy the gate (admin approval,
// Connect account updates).
func RecomputeOnboarding(ctx context.Context, tx pgx.Tx, accountID string) error {
	_, err := tx.Exec(ctx, `
UPDATE rider_profile rp
   SET onboarding_state = 'ACTIVE',
       account_status = CASE WHEN account_status = 'PENDING' THEN 'ACTIVE' ELSE account_status END,
       updated_at = now()
 WHERE rp.account_id = $1
   AND rp.onboarding_state = 'PAYOUT_PENDING'
   AND EXISTS (SELECT 1 FROM connect_account ca
                WHERE ca.owner_type = 'RIDER' AND ca.owner_id = rp.account_id
                  AND ca.payouts_enabled)`, accountID)
	return err
}
