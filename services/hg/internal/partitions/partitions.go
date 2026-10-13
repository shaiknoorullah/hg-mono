// Package partitions keeps the time-partitioned tables healthy: it creates
// partitions ahead of the clock, drops the ones past their retention, and
// raises an alert when a row lands in a table's catch-all default partition.
//
// It is the "Partition maintenance" loop of the background runtime
// (docs/spec/01-platform.md, "P-39 — Background runtime"). The migrations only
// create three partitions per table plus a default (00019_realtime_outbox.sql,
// 00015_rider.sql, 00021_audit.sql); without this loop every row written after
// the third period lands in the default, where a partition drop can never
// reach it, and creating the missing partition later fails because the default
// already holds rows in its range.
//
// One pass is idempotent and safe on any number of replicas: a session
// advisory lock (the lease) lets one replica work at a time, and every step
// re-reads the catalogue before it acts.
//
// The API logs in as hg_app, which owns nothing and may run no DDL
// (https://github.com/shaiknoorullah/hg-mono/issues/215). It creates and drops
// partitions only through hg_partition_ensure and hg_partition_drop_before,
// SECURITY DEFINER functions owned by the migration role
// (migrations/00032_least_privilege.sql). They refuse any other table, any
// range that is not one whole period, and any drop inside a table's retention,
// all by the database's clock, so a pass reads its clock from the database too.
package partitions

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Interval is how often the loop runs after its start-up pass. Hourly rather
// than daily so a failed pass (a lock timeout, a restart) is retried long
// before the partitions created ahead run out.
const Interval = time.Hour

// period is a partition's width.
type period int

const (
	daily period = iota
	monthly
)

// start is the first instant of the period containing t, in UTC: partition
// bounds are UTC midnights, the same calendar the audit chain's day uses.
func (p period) start(t time.Time) time.Time {
	t = t.UTC()
	if p == daily {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func (p period) next(t time.Time) time.Time {
	if p == daily {
		return t.AddDate(0, 0, 1)
	}
	return t.AddDate(0, 1, 0)
}

// table describes one partitioned table.
type table struct {
	parent string
	key    string // the partition key column
	period period
	// ahead is how many periods past the current one are kept created.
	ahead int
	// dropAfter is the retention: a partition is dropped once its newest
	// possible row is older than this. Zero means rows are never removed —
	// no partition drop, and no row moved or deleted from the default. Zero is
	// the value a forgotten field gets, so forgetting it can never lose data.
	dropAfter time.Duration
}

// tables is every partitioned table in the schema, with the retention its spec
// sets (all in docs/spec/01-platform.md). The database holds the same list,
// and the same retentions, in hg_partition_policy
// (migrations/00032_least_privilege.sql); a table or a shorter retention that
// is only here is refused there.
var tables = []table{
	{
		// "P-22 — Event catalogue and envelope": realtime events are kept 7
		// days, one partition per day.
		parent: "realtime_event", key: "created_at", period: daily,
		ahead:     7,
		dropAfter: 7 * 24 * time.Hour,
	},
	{
		// "P-30 — Canonical geography schema": a rider's GPS track is kept 30
		// days. Partitions are monthly, so a month is dropped once its last
		// day is 30 days old; no point is dropped younger than 30 days.
		parent: "rider_position_history", key: "recorded_at", period: monthly,
		ahead:     2,
		dropAfter: 30 * 24 * time.Hour,
	},
	{
		// "P-35 — Append-only audit trail": audit rows are never deleted (past
		// retention their payloads are redacted and the hash chain stays
		// whole), so audit partitions are never dropped and no audit row is
		// ever moved.
		parent: "audit_event", key: "at", period: monthly,
		ahead: 2,
	},
}

// leaseSQL is the key of the session advisory lock one pass holds. A replica
// that cannot take it skips the pass; a crashed holder's lock is released with
// its connection.
const leaseSQL = `hashtextextended('hg.partition_maintenance', 0)`

// Report is what one pass did.
type Report struct {
	Created []string // partitions created
	Dropped []string // partitions dropped for retention
	// Moved counts rows moved out of a default into a partition created for
	// their range; Expired counts rows past retention deleted from a default.
	Moved, Expired int64
	// DefaultRows is the number of rows left in each default partition after
	// the pass. Anything above zero is an alert: those rows sit outside every
	// partition, so retention cannot reach them.
	DefaultRows map[string]int64
	Errors      []error
}

// Maintainer runs partition maintenance.
type Maintainer struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// New builds a Maintainer.
func New(pool *pgxpool.Pool, log *slog.Logger) *Maintainer {
	return &Maintainer{pool: pool, log: log}
}

// Run makes one pass at once, then one every Interval, until ctx is cancelled.
func (m *Maintainer) Run(ctx context.Context) {
	t := time.NewTicker(Interval)
	defer t.Stop()
	for {
		m.pass(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (m *Maintainer) pass(ctx context.Context) {
	rep, ran, err := m.RunOnce(ctx)
	switch {
	case err != nil:
		m.log.Error("partition maintenance failed", slog.String("error", err.Error()))
		return
	case !ran:
		m.log.Debug("partition maintenance skipped: another replica holds the lease")
		return
	}
	for _, e := range rep.Errors {
		m.log.Error("partition maintenance step failed", slog.String("error", e.Error()))
	}
	for name, n := range rep.DefaultRows {
		if n > 0 {
			m.log.Error("rows in a default partition: no partition covers their range, so retention cannot drop them",
				slog.String("partition", name), slog.Int64("rows", n))
		}
	}
	if len(rep.Created)+len(rep.Dropped) > 0 || rep.Moved+rep.Expired > 0 {
		m.log.Info("partition maintenance",
			slog.Any("created", rep.Created), slog.Any("dropped", rep.Dropped),
			slog.Int64("moved_from_default", rep.Moved), slog.Int64("expired_from_default", rep.Expired))
	}
}

// RunOnce takes the lease and makes one pass. ran is false when another
// replica holds the lease. The pass is recorded in job_run.
func (m *Maintainer) RunOnce(ctx context.Context) (rep Report, ran bool, err error) {
	c, err := m.pool.Acquire(ctx)
	if err != nil {
		return rep, false, err
	}
	conn := c.Conn()
	defer func() {
		// The lock belongs to the session, so a connection that could not
		// unlock must not go back to the pool still holding it.
		if ran {
			if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(`+leaseSQL+`)`); uerr != nil {
				_ = conn.Close(context.WithoutCancel(ctx))
			}
		}
		c.Release()
	}()

	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(`+leaseSQL+`)`).Scan(&ran); err != nil || !ran {
		return rep, false, err
	}

	// The database's clock, not this host's: the partition functions check
	// retention against now(), and a cutoff a millisecond ahead of it would be
	// refused. Each step's transaction starts later, so its now() is never
	// earlier than this.
	var now time.Time
	if err := conn.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return rep, true, err
	}

	var runID int64
	if err := conn.QueryRow(ctx, `INSERT INTO job_run (job) VALUES ('partition_maintenance') RETURNING id`).Scan(&runID); err != nil {
		m.log.Warn("partition maintenance: job_run not recorded", slog.String("error", err.Error()))
	}
	rep = m.maintain(ctx, conn, now)
	if runID != 0 {
		m.finish(ctx, conn, runID, rep)
	}
	return rep, true, nil
}

// finish closes the job_run row. claimed counts the changes made; failed
// counts failed steps plus default partitions holding rows, so a non-zero
// failed is the alert whether or not anyone reads the logs.
func (m *Maintainer) finish(ctx context.Context, conn *pgx.Conn, runID int64, rep Report) {
	problems := make([]string, 0, len(rep.Errors))
	for _, e := range rep.Errors {
		problems = append(problems, e.Error())
	}
	for name, n := range rep.DefaultRows {
		if n > 0 {
			problems = append(problems, fmt.Sprintf("%s holds %d row(s)", name, n))
		}
	}
	var errText *string
	if len(problems) > 0 {
		s := strings.Join(problems, "; ")
		errText = &s
	}
	changes := len(rep.Created) + len(rep.Dropped)
	if _, err := conn.Exec(ctx, `
		UPDATE job_run SET finished_at = now(), claimed = $2, succeeded = $3, failed = $4, error = $5
		 WHERE id = $1`, runID, changes, changes, len(problems), errText); err != nil {
		m.log.Warn("partition maintenance: job_run not closed", slog.String("error", err.Error()))
	}
}

// maintain makes one pass over every table at clock now. Each step is its own
// short transaction, so one failure (typically a lock timeout behind a long
// query) costs only that step until the next pass.
func (m *Maintainer) maintain(ctx context.Context, conn *pgx.Conn, now time.Time) Report {
	rep := Report{DefaultRows: map[string]int64{}}
	fail := func(t table, what string, err error) {
		rep.Errors = append(rep.Errors, fmt.Errorf("%s: %s: %w", t.parent, what, err))
	}
	for _, t := range tables {
		def, err := defaultPartition(ctx, conn, t)
		if err != nil {
			fail(t, "find default partition", err)
			continue
		}
		cutoff := now.Add(-t.dropAfter)

		// 1. Drop partitions wholly past retention: every one that ends at or
		// before the cutoff.
		if t.dropAfter > 0 {
			var dropped []string
			err := inTx(ctx, conn, func(tx pgx.Tx) error {
				rows, err := tx.Query(ctx, `SELECT hg_partition_drop_before($1::regclass, $2)`, t.parent, cutoff)
				if err != nil {
					return err
				}
				dropped, err = pgx.CollectRows(rows, pgx.RowTo[string])
				return err
			})
			if err != nil {
				// The transaction rolled back: nothing was dropped.
				fail(t, "drop partitions ending by "+cutoff.Format(time.RFC3339), err)
			} else {
				rep.Dropped = append(rep.Dropped, dropped...)
			}
		}
		parts, err := partitionsOf(ctx, conn, t)
		if err != nil {
			fail(t, "list partitions", err)
			continue
		}

		// 2. Create every period from the oldest still retained (for a table
		// with retention) or the current one, through `ahead` periods on.
		from := t.period.start(now)
		if t.dropAfter > 0 {
			from = t.period.start(cutoff)
		}
		until := t.period.start(now)
		for i := 0; i < t.ahead; i++ {
			until = t.period.next(until)
		}
		for lo := from; !lo.After(until); lo = t.period.next(lo) {
			if covered(parts, lo) {
				continue
			}
			created, moved, err := create(ctx, conn, t, lo)
			if err != nil {
				fail(t, "create partition from "+lo.Format("2006-01-02"), err)
				continue
			}
			if created {
				rep.Created = append(rep.Created, fmt.Sprintf("%s from %s", t.parent, lo.Format("2006-01-02")))
			}
			rep.Moved += moved
		}

		// 3. Rows in the default older than retention would have been in a
		// dropped partition: delete them the same way.
		if def != "" && t.dropAfter > 0 {
			err := inTx(ctx, conn, func(tx pgx.Tx) error {
				tag, err := tx.Exec(ctx, `DELETE FROM `+pgx.Identifier{def}.Sanitize()+
					` WHERE `+pgx.Identifier{t.key}.Sanitize()+` < $1`, cutoff)
				rep.Expired += tag.RowsAffected()
				return err
			})
			if err != nil {
				fail(t, "expire rows in "+def, err)
			}
		}

		// 4. Count what is left in the default: it should be nothing.
		if def != "" {
			var n int64
			err := inTx(ctx, conn, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `SELECT count(*) FROM `+pgx.Identifier{def}.Sanitize()).Scan(&n)
			})
			if err != nil {
				fail(t, "count rows in "+def, err)
				continue
			}
			rep.DefaultRows[def] = n
		}
	}
	return rep
}

// create makes the partition for the period starting at lo, through
// hg_partition_ensure. Rows already in the default for its range would make
// the create fail, so for a table whose rows may be removed the function takes
// them out first and puts them back through the parent, which routes them into
// the new partition; moved counts them. An append-only table's rows are never
// moved: its create fails, and the default count raises the alert. created is
// false when the partition already existed.
func create(ctx context.Context, conn *pgx.Conn, t table, lo time.Time) (created bool, moved int64, err error) {
	err = inTx(ctx, conn, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT created, moved FROM hg_partition_ensure($1::regclass, $2, $3)`,
			t.parent, lo, t.period.next(lo)).Scan(&created, &moved)
	})
	return created, moved, err
}

// inTx runs fn in a transaction with UTC as the session time zone (partition
// bounds are written and read back as timestamps, so every step must agree on
// the zone) and a short lock timeout, so maintenance gives way to traffic
// rather than queueing it behind an exclusive lock.
func inTx(ctx context.Context, conn *pgx.Conn, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT set_config('TimeZone', 'UTC', true),
		                                   set_config('lock_timeout', '5s', true),
		                                   set_config('statement_timeout', '120s', true)`); err != nil {
			return err
		}
		return fn(tx)
	})
}

// partition is one range partition and its bounds, [lo, hi).
type partition struct {
	name   string
	lo, hi time.Time
}

func covered(parts []partition, t time.Time) bool {
	for _, p := range parts {
		if !t.Before(p.lo) && t.Before(p.hi) {
			return true
		}
	}
	return false
}

// partitionsOf lists t's range partitions with their bounds, read from the
// catalogue. The default partition, and any bound that is not a plain
// timestamp range, does not match and is never dropped.
func partitionsOf(ctx context.Context, conn *pgx.Conn, t table) ([]partition, error) {
	var parts []partition
	err := inTx(ctx, conn, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT c.relname::text, b[1]::timestamptz, b[2]::timestamptz
			  FROM pg_inherits i
			  JOIN pg_class c ON c.oid = i.inhrelid
			 CROSS JOIN LATERAL regexp_match(pg_get_expr(c.relpartbound, c.oid),
			         '^FOR VALUES FROM \(''([^'']+)''\) TO \(''([^'']+)''\)$') AS b
			 WHERE i.inhparent = $1::regclass AND b IS NOT NULL
			 ORDER BY 2`, t.parent)
		if err != nil {
			return err
		}
		parts, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (partition, error) {
			var p partition
			err := r.Scan(&p.name, &p.lo, &p.hi)
			return p, err
		})
		return err
	})
	return parts, err
}

// defaultPartition names t's default partition, or "" when it has none.
func defaultPartition(ctx context.Context, conn *pgx.Conn, t table) (string, error) {
	var name string
	err := inTx(ctx, conn, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT c.relname::text
			  FROM pg_partitioned_table p
			  JOIN pg_class c ON c.oid = p.partdefid
			 WHERE p.partrelid = $1::regclass`, t.parent).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	return name, err
}
