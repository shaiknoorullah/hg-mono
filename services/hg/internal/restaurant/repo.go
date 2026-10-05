package restaurant

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// Repo is the data layer for the restaurant package. It is the only place that
// touches the database; handlers hold a *Repo and call it. Nil repo is accepted
// for unit tests that never reach the DB.
type Repo struct {
	db *pgxpool.Pool
	// orders owns every change of an order's state. Accept, reject and
	// mark-ready move the order through it, so each move arms its deadline,
	// writes its order_transition row and emits its realtime event and
	// notification in one transaction (docs/spec/01-platform.md, "P-14 —
	// Order lifecycle states and transitions";
	// https://github.com/shaiknoorullah/hg-mono/issues/337).
	orders *orders.Store
}

// NewRepo builds a Repo over the given pool. ordersStore is the orders
// module's store, wired with its realtime and notification emitter in
// cmd/hg/main.go. Without it the Repo uses a store with no emitter: the order
// still moves through the one transition function, but no realtime event or
// notification is sent, which is right only for tests.
func NewRepo(pool *pgxpool.Pool, ordersStore ...*orders.Store) *Repo {
	r := &Repo{db: pool}
	if len(ordersStore) > 0 && ordersStore[0] != nil {
		r.orders = ordersStore[0]
	} else {
		r.orders = orders.NewStore(pool)
	}
	return r
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
