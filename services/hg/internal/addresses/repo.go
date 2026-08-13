package addresses

import "github.com/jackc/pgx/v5/pgxpool"

// Repo is the database access layer for the addresses package.
// All methods are stubs that panic — they are filled in during Stage 2.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo backed by the given connection pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}
