package realtime

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Producers' helpers for the account channel (contracts/websocket.md section
// 4.6): who an account-scoped event about a restaurant or a rider goes to.
// Each writes inside the caller's transaction, like every Emit.

// RestaurantAccounts lists the accounts that answer for a restaurant's
// onboarding and money: its live owners and managers. Other staff are not
// told about the application or the payout account.
func RestaurantAccounts(ctx context.Context, tx pgx.Tx, restaurantID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT account_id::text
		  FROM account_role
		 WHERE scope_type = 'RESTAURANT' AND scope_id = $1
		   AND role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER')
		   AND revoked_at IS NULL
		 ORDER BY 1`, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("realtime: owners and managers of %s: %w", restaurantID, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("realtime: owners and managers of %s: %w", restaurantID, err)
	}
	return ids, nil
}

// SubjectAccounts is who hears about a restaurant or a rider on their own
// account channel: the restaurant's owners and managers, or the rider.
func SubjectAccounts(ctx context.Context, tx pgx.Tx, subject OnboardingSubject, subjectID string) ([]string, error) {
	if subject == OnboardingRider {
		return []string{subjectID}, nil
	}
	return RestaurantAccounts(ctx, tx, subjectID)
}

// EmitOnboardingChanged writes onboarding.state_changed to everyone who
// answers for the subject, when its onboarding state moved from from to to.
// It writes nothing when the state did not change. from is empty for a
// subject that had no state before.
func EmitOnboardingChanged(ctx context.Context, tx pgx.Tx, subject OnboardingSubject, subjectID, from, to string) error {
	if from == to {
		return nil
	}
	accounts, err := SubjectAccounts(ctx, tx, subject, subjectID)
	if err != nil {
		return err
	}
	ev := OnboardingStateChanged{SubjectType: subject, SubjectID: subjectID, To: to}
	if from != "" {
		f := from
		ev.From = &f
	}
	for _, a := range accounts {
		if err := EmitAccount(ctx, tx, a, ev); err != nil {
			return err
		}
	}
	return nil
}
