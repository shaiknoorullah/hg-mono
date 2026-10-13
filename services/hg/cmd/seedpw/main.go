// Throwaway dev helper: set a known password on the seeded restaurant/admin
// account so the operator apps can log in against the real backend. Not built
// into the server; delete after use.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
)

func main() {
	email := os.Getenv("SEED_EMAIL")
	password := os.Getenv("SEED_PASSWORD")
	if email == "" || password == "" {
		fmt.Println("SEED_EMAIL and SEED_PASSWORD required")
		os.Exit(1)
	}
	hash, err := auth.HashPassword(context.Background(), password)
	if err != nil {
		panic(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("HG_POSTGRES_DSN"))
	if err != nil {
		panic(err)
	}
	defer pool.Close()
	tag, err := pool.Exec(ctx, `
		UPDATE account
		   SET password_hash = $2,
		       password_set_at = now(),
		       email_verified_at = COALESCE(email_verified_at, now())
		 WHERE email = $1`, email, hash)
	if err != nil {
		panic(err)
	}
	fmt.Printf("updated %d account(s) for %s\n", tag.RowsAffected(), email)
}
