package restaurant

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo is the data layer for the restaurant package. It is the only place that
// touches the database; handlers hold a *Repo and call it. Nil repo is accepted
// for unit tests that never reach the DB.
type Repo struct {
	db *pgxpool.Pool
}

// NewRepo builds a Repo over the given pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{db: pool}
}

// RestaurantForAccount returns the restaurant id the account is scoped to via
// an account_role RESTAURANT grant, or ("", false) when none exists.
// It always returns false for an empty accountID.
func (r *Repo) RestaurantForAccount(ctx context.Context, accountID string) (string, bool) {
	if accountID == "" {
		return "", false
	}
	const q = `
		SELECT scope_id::text
		  FROM account_role
		 WHERE account_id = $1::uuid
		   AND scope_type = 'RESTAURANT'
		   AND role::text = ANY($2)
		   AND revoked_at IS NULL
		   AND scope_id IS NOT NULL
		 ORDER BY granted_at ASC, id ASC
		 LIMIT 1`
	restaurantRoles := []string{"RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF"}
	var id string
	if err := r.db.QueryRow(ctx, q, accountID, restaurantRoles).Scan(&id); err != nil {
		return "", false
	}
	return id, true
}
