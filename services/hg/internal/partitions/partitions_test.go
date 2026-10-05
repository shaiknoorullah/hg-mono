package partitions

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The loop runs as hg_app, the API's role, on a database migrated the way
// production is: goose as hg_migrator, the schema's owner. The partition
// functions check retention against the database's own clock, so the clock
// cannot be faked; partitions an earlier pass would have left behind are made
// by the owner instead. A pass must create partitions ahead of the clock, drop
// expired ones, move rows out of a default (or expire them with it), never
// drop an audit partition, and leave hg_app owning nothing.
func TestMaintenanceAsTheAppRole(t *testing.T) {
	db := freshDatabase(t)
	m := New(db.app, slog.New(slog.NewTextHandler(io.Discard, nil)))
	now := dbNow(t, db.app)
	day := daily.start(now)
	month := monthly.start(now)

	// What earlier passes left: partitions now past retention, and an audit
	// month that must outlive them.
	for _, d := range []int{-20, -8} {
		db.asOwner(t, `SELECT realtime_event_ensure_partition($1::date)`, day.AddDate(0, 0, d))
	}
	db.asOwner(t, `SELECT ensure_monthly_partition('rider_position_history', $1::date)`, month.AddDate(0, -3, 0))
	db.asOwner(t, `SELECT audit_event_ensure_partition($1::date)`, month.AddDate(0, -3, 0))

	// Rows written while nothing kept partitions ahead; all four land in a
	// default partition. Written as the API writes them, as hg_app.
	insertEvent(t, db.app, day.AddDate(0, 0, 5).Add(time.Hour), 1)   // its partition is made: moves
	insertEvent(t, db.app, day.AddDate(0, 0, -30), 2)                // past retention: expires
	insertPosition(t, db.app, month.AddDate(0, 2, 0).Add(time.Hour)) // its partition is made: moves
	insertPosition(t, db.app, month.AddDate(0, 3, 0).Add(time.Hour)) // past the window: stays, alerts

	rep := pass(t, m)
	for d := -7; d <= 7; d++ {
		mustHavePartitionAt(t, db.app, "realtime_event", day.AddDate(0, 0, d))
	}
	mustNotHavePartitionAt(t, db.app, "realtime_event", day.AddDate(0, 0, -8))
	mustNotHavePartitionAt(t, db.app, "realtime_event", day.AddDate(0, 0, -20))
	for mo := 0; mo <= 2; mo++ {
		mustHavePartitionAt(t, db.app, "rider_position_history", month.AddDate(0, mo, 0))
		mustHavePartitionAt(t, db.app, "audit_event", month.AddDate(0, mo, 0))
	}
	mustNotHavePartitionAt(t, db.app, "rider_position_history", month.AddDate(0, -3, 0))
	mustHavePartitionAt(t, db.app, "audit_event", month.AddDate(0, -3, 0))

	for _, want := range []string{
		"realtime_event_p" + day.AddDate(0, 0, -20).Format("20060102"),
		"realtime_event_p" + day.AddDate(0, 0, -8).Format("20060102"),
		"rider_position_history_p" + month.AddDate(0, -3, 0).Format("200601"),
	} {
		if !slices.Contains(rep.Dropped, want) {
			t.Errorf("dropped %v, want %s among them", rep.Dropped, want)
		}
	}
	if rep.Moved != 2 || rep.Expired != 1 {
		t.Errorf("moved %d, expired %d from the defaults; want 2 and 1", rep.Moved, rep.Expired)
	}
	if n := rep.DefaultRows["realtime_event_default"]; n != 0 {
		t.Errorf("realtime_event_default holds %d rows after the pass, want 0", n)
	}
	if n := rep.DefaultRows["rider_position_history_default"]; n != 1 {
		t.Errorf("rider_position_history_default reports %d rows, want 1 (the alert)", n)
	}
	if got := countRows(t, db.app, "realtime_event"); got != 1 {
		t.Errorf("realtime_event has %d rows, want the 1 moved row", got)
	}
	if got := countRows(t, db.app, "rider_position_history"); got != 2 {
		t.Errorf("rider_position_history has %d rows, want 2", got)
	}

	// Everything the pass made belongs to the schema's owner.
	var owned int
	if err := db.app.QueryRow(context.Background(),
		`SELECT count(*) FROM pg_class WHERE relowner = 'hg_app'::regrole`).Scan(&owned); err != nil || owned != 0 {
		t.Errorf("hg_app owns %d relations (%v), want 0", owned, err)
	}

	// A second pass changes nothing.
	if rep = pass(t, m); len(rep.Created)+len(rep.Dropped) != 0 || rep.Moved+rep.Expired != 0 {
		t.Errorf("a repeated pass created %v, dropped %v, moved %d, expired %d; want nothing",
			rep.Created, rep.Dropped, rep.Moved, rep.Expired)
	}
}

// hg_app runs no DDL of its own, and the partition functions refuse any table
// but the three partitioned ones and any range outside their limits.
func TestTheAppRoleCannotStepOutside(t *testing.T) {
	ctx := context.Background()
	db := freshDatabase(t)
	now := dbNow(t, db.app)
	day := daily.start(now)
	month := monthly.start(now)
	before := partitionNames(t, db.app)

	refused := []struct {
		name string
		code string // SQLSTATE
		sql  string
		args []any
	}{
		// Directly, without the functions: hg_app owns nothing.
		{"create a partition", "42501",
			`CREATE TABLE realtime_event_p20990101 PARTITION OF realtime_event
			   FOR VALUES FROM ('2099-01-01 00:00Z') TO ('2099-01-02 00:00Z')`, nil},
		{"create one through the migration's helper", "42501",
			`SELECT realtime_event_ensure_partition('2099-01-01')`, nil},
		{"drop a partition", "42501", `DROP TABLE realtime_event_default`, nil},
		{"detach a partition", "42501", `ALTER TABLE realtime_event DETACH PARTITION realtime_event_default`, nil},

		// Through the functions, outside their limits.
		{"ensure a table not on the list", "42501",
			`SELECT * FROM hg_partition_ensure('job_run', $1, $2)`, []any{day, day.AddDate(0, 0, 1)}},
		{"drop from a table not on the list", "42501",
			`SELECT hg_partition_drop_before('ledger_entry', $1)`, []any{day.AddDate(-1, 0, 0)}},
		{"drop an audit partition", "42501",
			`SELECT hg_partition_drop_before('audit_event', '2000-01-01 00:00Z')`, nil},
		{"a day that does not start at UTC midnight", "22023",
			`SELECT * FROM hg_partition_ensure('realtime_event', $1, $2)`,
			[]any{day.Add(time.Hour), day.AddDate(0, 0, 1).Add(time.Hour)}},
		{"two days at once", "22023",
			`SELECT * FROM hg_partition_ensure('realtime_event', $1, $2)`, []any{day, day.AddDate(0, 0, 2)}},
		{"a day for a monthly table", "22023",
			`SELECT * FROM hg_partition_ensure('audit_event', $1, $2)`, []any{month, month.AddDate(0, 0, 1)}},
		{"more than 400 days ahead", "22023",
			`SELECT * FROM hg_partition_ensure('realtime_event', $1, $2)`,
			[]any{day.AddDate(0, 0, 401), day.AddDate(0, 0, 402)}},
		{"a day long past retention", "22023",
			`SELECT * FROM hg_partition_ensure('realtime_event', $1, $2)`,
			[]any{day.AddDate(0, 0, -400), day.AddDate(0, 0, -399)}},
		{"a drop inside realtime_event's 7 days", "22023",
			`SELECT hg_partition_drop_before('realtime_event', $1)`, []any{now.AddDate(0, 0, -6)}},
		{"a drop inside rider_position_history's 30 days", "22023",
			`SELECT hg_partition_drop_before('rider_position_history', $1)`, []any{now.AddDate(0, 0, -29)}},
		{"a drop of everything", "22023",
			`SELECT hg_partition_drop_before('realtime_event', $1)`, []any{now.AddDate(1, 0, 0)}},
	}
	for _, c := range refused {
		_, err := db.app.Exec(ctx, c.sql, c.args...)
		var pgErr *pgconn.PgError
		switch {
		case err == nil:
			t.Errorf("%s: accepted as hg_app; it must be refused", c.name)
		case !errors.As(err, &pgErr) || pgErr.Code != c.code:
			t.Errorf("%s: refused with %v, want SQLSTATE %s", c.name, err, c.code)
		}
	}

	if after := partitionNames(t, db.app); !slices.Equal(before, after) {
		t.Errorf("the refused calls changed the partitions:\nbefore %v\nafter  %v", before, after)
	}
}

// Two replicas run the loop; only the one holding the lease makes a pass.
func TestOnlyTheLeaseHolderRuns(t *testing.T) {
	ctx := context.Background()
	db := freshDatabase(t)
	m := New(db.app, slog.New(slog.NewTextHandler(io.Discard, nil)))

	other, err := db.app.Acquire(ctx)
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
	if err := db.app.QueryRow(ctx, `SELECT count(*) FROM job_run WHERE job = 'partition_maintenance' AND finished_at IS NOT NULL`).Scan(&runs); err != nil || runs != 1 {
		t.Fatalf("job_run rows: %d (%v), want 1", runs, err)
	}
}

func pass(t *testing.T, m *Maintainer) Report {
	t.Helper()
	rep, ran, err := m.RunOnce(context.Background())
	if err != nil || !ran {
		t.Fatalf("RunOnce: ran=%v err=%v", ran, err)
	}
	if len(rep.Errors) > 0 {
		t.Fatalf("pass: %v", rep.Errors)
	}
	return rep
}

func dbNow(t *testing.T, pool *pgxpool.Pool) time.Time {
	t.Helper()
	var now time.Time
	if err := pool.QueryRow(context.Background(), `SELECT now()`).Scan(&now); err != nil {
		t.Fatal(err)
	}
	return now
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

// partitionNames lists every partition of the three partitioned tables.
func partitionNames(t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT c.relname::text FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
		 WHERE i.inhparent IN ('realtime_event'::regclass, 'rider_position_history'::regclass, 'audit_event'::regclass)
		 ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return names
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

// testDB is one fresh database, reached as each of the roles that use it.
type testDB struct {
	app   *pgxpool.Pool // hg_app: the API
	owner *pgxpool.Pool // hg_migrator: goose, the schema's owner
}

// asOwner runs one statement as hg_migrator.
func (db testDB) asOwner(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := db.owner.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

// freshDatabase migrates a new, empty database of its own. Partition
// maintenance creates and drops tables, so it never shares a database with
// another package's tests. The server is HG_TEST_POSTGRES_DSN's, or a
// throwaway container; with neither available the test skips. The DSN must
// name a superuser: it creates the roles and the extensions, as
// migrations/roles/roles.sql does, and then connects as each role in turn.
func freshDatabase(t *testing.T) testDB {
	t.Helper()
	dsn := testseed.MigratedDatabaseDSN(t, "hg_partitions")
	db := testDB{}
	for _, p := range []struct {
		pool **pgxpool.Pool
		role string
	}{{&db.app, "hg_app"}, {&db.owner, "hg_migrator"}} {
		pool, err := pgxpool.New(context.Background(), testseed.AsRole(t, dsn, p.role))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		*p.pool = pool
	}
	return db
}
