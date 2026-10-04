package partitions

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The clock is advanced by days and then months over a freshly migrated
// database. At every step the partitions must run ahead of the clock, expired
// ones must be gone, rows that landed in a default must end up in a partition
// (or be expired with it), and audit partitions must never be dropped.
func TestMaintenanceFollowsTheClock(t *testing.T) {
	pool := freshDatabase(t)
	m := New(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	t0 := time.Now().UTC()
	day := daily.start(t0)
	month := monthly.start(t0)

	// Rows written while nothing kept partitions ahead: one realtime event
	// five days out, one 30 days old, and a GPS point three months out. All
	// three land in a default partition today.
	insertEvent(t, pool, day.AddDate(0, 0, 5).Add(time.Hour), 1)
	insertEvent(t, pool, day.AddDate(0, 0, -30), 2)
	insertPosition(t, pool, month.AddDate(0, 3, 0).Add(time.Hour))

	rep := pass(t, m, t0)
	for d := 0; d <= 7; d++ {
		mustHavePartitionAt(t, pool, "realtime_event", day.AddDate(0, 0, d))
	}
	for mo := 0; mo <= 2; mo++ {
		mustHavePartitionAt(t, pool, "rider_position_history", month.AddDate(0, mo, 0))
		mustHavePartitionAt(t, pool, "audit_event", month.AddDate(0, mo, 0))
	}
	if rep.Moved != 1 || rep.Expired != 1 {
		t.Errorf("moved %d, expired %d from realtime_event_default; want 1 and 1", rep.Moved, rep.Expired)
	}
	if n := rep.DefaultRows["realtime_event_default"]; n != 0 {
		t.Errorf("realtime_event_default holds %d rows after the pass, want 0", n)
	}
	// The GPS point is past the window created ahead: it stays and alerts.
	if n := rep.DefaultRows["rider_position_history_default"]; n != 1 {
		t.Errorf("rider_position_history_default reports %d rows, want 1 (the alert)", n)
	}
	if got := countRows(t, pool, "realtime_event"); got != 1 {
		t.Errorf("realtime_event has %d rows, want the 1 moved row", got)
	}

	// Ten days on: the migration's daily partitions are past 7 days.
	pass(t, m, t0.AddDate(0, 0, 10))
	mustNotHavePartitionAt(t, pool, "realtime_event", day.AddDate(0, 0, -1))
	mustHavePartitionAt(t, pool, "realtime_event", day.AddDate(0, 0, 17))

	// Mid-way through the GPS point's month: its partition now exists, so the
	// point has moved out of the default; months whose last day is more than
	// 30 days gone are dropped; audit keeps every month.
	t2 := month.AddDate(0, 3, 15)
	rep = pass(t, m, t2)
	for name, n := range rep.DefaultRows {
		if n != 0 {
			t.Errorf("%s holds %d rows after the pass, want 0", name, n)
		}
	}
	if got := countRows(t, pool, "rider_position_history"); got != 1 {
		t.Errorf("rider_position_history has %d rows, want the 1 moved point", got)
	}
	mustNotHavePartitionAt(t, pool, "rider_position_history", month.AddDate(0, -1, 0))
	mustNotHavePartitionAt(t, pool, "rider_position_history", month.AddDate(0, 1, 0))
	mustHavePartitionAt(t, pool, "rider_position_history", month.AddDate(0, 5, 0))
	mustHavePartitionAt(t, pool, "audit_event", month.AddDate(0, -1, 0))
	mustHavePartitionAt(t, pool, "audit_event", month.AddDate(0, 5, 0))

	// A second pass at the same instant changes nothing.
	if rep = pass(t, m, t2); len(rep.Created)+len(rep.Dropped) != 0 {
		t.Errorf("a repeated pass created %v and dropped %v, want nothing", rep.Created, rep.Dropped)
	}
}

// Two replicas run the loop; only the one holding the lease makes a pass.
func TestOnlyTheLeaseHolderRuns(t *testing.T) {
	ctx := context.Background()
	pool := freshDatabase(t)
	m := New(pool, slog.New(slog.NewTextHandler(io.Discard, nil)))

	other, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.Exec(ctx, `SELECT pg_advisory_lock(`+leaseSQL+`)`); err != nil {
		t.Fatal(err)
	}
	if _, ran, err := m.RunOnce(ctx); err != nil || ran {
		t.Fatalf("RunOnce while another replica holds the lease: ran=%v err=%v, want a skip", ran, err)
	}
	if _, err := other.Exec(ctx, `SELECT pg_advisory_unlock(`+leaseSQL+`)`); err != nil {
		t.Fatal(err)
	}
	other.Release()

	rep, ran, err := m.RunOnce(ctx)
	if err != nil || !ran {
		t.Fatalf("RunOnce with the lease free: ran=%v err=%v", ran, err)
	}
	if len(rep.Errors) > 0 {
		t.Fatalf("pass errors: %v", rep.Errors)
	}
	var runs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_run WHERE job = 'partition_maintenance' AND finished_at IS NOT NULL`).Scan(&runs); err != nil || runs != 1 {
		t.Fatalf("job_run rows: %d (%v), want 1", runs, err)
	}
}

func pass(t *testing.T, m *Maintainer, now time.Time) Report {
	t.Helper()
	m.now = func() time.Time { return now }
	rep, ran, err := m.RunOnce(context.Background())
	if err != nil || !ran {
		t.Fatalf("RunOnce at %s: ran=%v err=%v", now, ran, err)
	}
	if len(rep.Errors) > 0 {
		t.Fatalf("pass at %s: %v", now, rep.Errors)
	}
	return rep
}

func partitionAt(t *testing.T, pool *pgxpool.Pool, parent string, at time.Time) string {
	t.Helper()
	c, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Release()
	parts, err := partitionsOf(context.Background(), c.Conn(), table{parent: parent})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range parts {
		if covered([]partition{p}, at) {
			return p.name
		}
	}
	return ""
}

func mustHavePartitionAt(t *testing.T, pool *pgxpool.Pool, parent string, at time.Time) {
	t.Helper()
	if partitionAt(t, pool, parent, at) == "" {
		t.Errorf("%s has no partition covering %s", parent, at.Format(time.DateOnly))
	}
}

func mustNotHavePartitionAt(t *testing.T, pool *pgxpool.Pool, parent string, at time.Time) {
	t.Helper()
	if name := partitionAt(t, pool, parent, at); name != "" {
		t.Errorf("%s still has %s covering %s, want it dropped", parent, name, at.Format(time.DateOnly))
	}
}

func insertEvent(t *testing.T, pool *pgxpool.Pool, at time.Time, seq int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO realtime_event (ulid, channel, seq, type, payload, created_at)
		VALUES ($1, 'test', $2, 'test.event', '{}', $3)`, fmt.Sprintf("ulid-%d", seq), seq, at); err != nil {
		t.Fatal(err)
	}
}

func insertPosition(t *testing.T, pool *pgxpool.Pool, at time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO rider_position_history (account_id, location, recorded_at)
		VALUES (gen_random_uuid(), 'SRID=4326;POINT(-79.38 43.65)', $1)`, at); err != nil {
		t.Fatal(err)
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM `+pgx.Identifier{table}.Sanitize()).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// freshDatabase migrates a new, empty database of its own and returns a pool
// on it. Partition maintenance creates and drops tables, so it never shares a
// database with another package's tests. The server is HG_TEST_POSTGRES_DSN's,
// or a throwaway container; with neither available the test skips.
func freshDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return testseed.MigratedDatabase(t, "hg_partitions")
}
