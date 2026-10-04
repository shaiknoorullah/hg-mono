package retention

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

// jobName is this sweep's name in job_run, and the key of the advisory lock
// that serialises claiming a pass.
const jobName = "retention"

// Sweeper runs the retention rules. Every replica may run one; job_run makes
// sure a pass runs on only one of them per period.
type Sweeper struct {
	pool *pgxpool.Pool
	log  *slog.Logger

	// every is how often a pass runs across the whole fleet; check is how often
	// each replica asks whether one is due. maxPass bounds one pass so it ends
	// well inside its period.
	every   time.Duration
	check   time.Duration
	maxPass time.Duration

	// batch is the most rows one statement deletes; pause is the gap between
	// batches, which leaves room for the live workload.
	batch int
	pause time.Duration

	rules []rule
}

// New builds a Sweeper with the production settings: a pass every hour
// (docs/spec/01-platform.md, "P-39 — Background runtime": expiry sweeps run
// hourly), batches of 2,000 rows (#221 asks for a few thousand per statement),
// 50 ms apart.
func New(pool *pgxpool.Pool, log *slog.Logger) *Sweeper {
	return &Sweeper{
		pool:    pool,
		log:     log,
		every:   time.Hour,
		check:   5 * time.Minute,
		maxPass: 30 * time.Minute,
		batch:   2000,
		pause:   50 * time.Millisecond,
		rules:   rules,
	}
}

// Run asks whether a pass is due straight away and then every few minutes,
// and runs one when this replica wins the claim. It returns when ctx is
// cancelled.
func (s *Sweeper) Run(ctx context.Context) {
	t := time.NewTicker(s.check)
	defer t.Stop()
	for {
		if _, err := s.Pass(ctx); err != nil && !errors.Is(err, context.Canceled) {
			s.log.Warn("retention pass failed", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Report is what one pass did.
type Report struct {
	// Ran is false when another replica holds this period's claim, in which
	// case nothing was deleted.
	Ran bool
	// Deleted counts the rows deleted per table, including rows whose rule
	// failed part-way (earlier batches stay deleted).
	Deleted map[string]int64
	// Failed names the tables whose rule returned an error.
	Failed []string
}

// Pass claims this period's pass and, if it won the claim, runs every rule
// once. A failing rule is logged and recorded, and the remaining rules still
// run: one broken table must not stop the others from being cleaned. The
// error is non-nil only when the claim or the bookkeeping itself failed.
func (s *Sweeper) Pass(ctx context.Context) (Report, error) {
	runID, startedAt, ok, err := s.claim(ctx)
	if err != nil || !ok {
		return Report{}, err
	}

	passCtx, cancel := context.WithTimeout(ctx, s.maxPass)
	defer cancel()

	rep := Report{Ran: true, Deleted: make(map[string]int64, len(s.rules))}
	var failures []string
	for _, r := range s.rules {
		n, err := s.sweep(passCtx, r, startedAt.Add(-r.keep))
		rep.Deleted[r.table] = n
		if err != nil {
			rep.Failed = append(rep.Failed, r.table)
			failures = append(failures, r.table+": "+err.Error())
			s.log.Warn("retention rule failed",
				slog.String("table", r.table), slog.Int64("deleted", n), slog.String("error", err.Error()))
			continue
		}
		if n > 0 {
			s.log.Info("retention", slog.String("table", r.table), slog.Int64("deleted", n))
		}
	}

	// The pass context may have run out; the bookkeeping still gets written.
	finCtx, finCancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer finCancel()
	var errText *string
	if len(failures) > 0 {
		joined := strings.Join(failures, "; ")
		errText = &joined
	}
	if _, err := s.pool.Exec(finCtx, `
		UPDATE job_run
		   SET finished_at = now(), claimed = $2, succeeded = $3, failed = $4, error = $5
		 WHERE id = $1`,
		runID, len(s.rules), len(s.rules)-len(rep.Failed), len(rep.Failed), errText); err != nil {
		return rep, fmt.Errorf("retention: record pass %d: %w", runID, err)
	}
	return rep, nil
}

// claim starts a pass unless one started within the last period, anywhere in
// the fleet. The advisory lock makes check-then-insert atomic across replicas;
// it is released when the transaction ends, so a replica that dies mid-pass
// holds nothing, and the next period's pass simply runs elsewhere. In job_run,
// claimed/succeeded/failed count rules, not rows.
func (s *Sweeper) claim(ctx context.Context) (id int64, startedAt time.Time, ok bool, err error) {
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, jobName); err != nil {
			return err
		}
		err := tx.QueryRow(ctx, `
			INSERT INTO job_run (job)
			SELECT $1
			 WHERE NOT EXISTS (
			       SELECT 1 FROM job_run
			        WHERE job = $1 AND started_at > now() - make_interval(secs => $2))
			RETURNING id, started_at`,
			jobName, s.every.Seconds()).Scan(&id, &startedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		ok = true
		return nil
	})
	if err != nil {
		return 0, time.Time{}, false, fmt.Errorf("retention: claim pass: %w", err)
	}
	return id, startedAt, ok, nil
}

// sweep deletes one rule's rows older than cutoff, a batch at a time, until a
// batch comes back short or ctx ends. It returns how many rows it deleted.
func (s *Sweeper) sweep(ctx context.Context, r rule, cutoff time.Time) (int64, error) {
	var total int64
	for {
		tag, err := s.pool.Exec(ctx, r.sql, cutoff, s.batch)
		if err != nil {
			return total, err
		}
		n := tag.RowsAffected()
		total += n
		if n < int64(s.batch) {
			return total, nil
		}
		if s.pause > 0 {
			select {
			case <-ctx.Done():
				return total, ctx.Err()
			case <-time.After(s.pause):
			}
		}
	}
}
