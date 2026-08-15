package invariants

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// insertNotifyAccount creates a minimal account row so notification's
// account_id FK is satisfiable, returning the id as a string (the shape the
// rest of this package's fixtures use). The phone number's digits are random
// (not a process-local counter) so re-running the suite against a long-lived
// database never collides with a previous run's uncleaned rows — the same
// reasoning internal/notify/notify_test.go documents for its own phoneSeq
// helper. account_phone_e164_shape requires E.164-shaped digits, so the
// suffix must stay numeric. The row is removed on test cleanup.
func insertNotifyAccount(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var buf [8]byte
	_, _ = rand.Read(buf[:])
	n := binary.BigEndian.Uint64(buf[:]) % 1_000_000_000
	phone := fmt.Sprintf("+1556%09d", n)
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO account (phone_e164, status) VALUES ($1, 'ACTIVE') RETURNING id`, phone).Scan(&id); err != nil {
		t.Fatalf("insert notify account: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM account WHERE id = $1`, id)
	})
	return id
}

// riverInserterFor builds an insert-only River client — river's NewClient
// explicitly supports omitting Queues for callers that only need InsertTx,
// which is all Enqueuer needs (see internal/notify/notify_test.go, the
// pattern this mirrors).
func riverInserterFor(t *testing.T, pool *pgxpool.Pool) *river.Client[pgx.Tx] {
	t.Helper()
	c, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatalf("new river client: %v", err)
	}
	return c
}

func mustUUID(s string) uuid.UUID {
	id, err := uuid.Parse(s)
	if err != nil {
		panic(err)
	}
	return id
}

func countNotifyRows(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM notification WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("count notification rows: %v", err)
	}
	return n
}

func countRiverJobRows(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM river_job WHERE kind = 'notify_deliver' AND args->>'notification_id' = $1`,
		id.String()).Scan(&n); err != nil {
		t.Fatalf("count river_job rows: %v", err)
	}
	return n
}
