package account

import "github.com/jackc/pgx/v5/pgxpool"

// Repo is the account data-access layer. All queries are scoped to the
// caller's account_id (P-07 / IDOR ownership enforced in SQL).
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo creates a Repo backed by the given connection pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}
