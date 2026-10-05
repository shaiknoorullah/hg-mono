package dispatch

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The two rider availability sweeps of docs/spec/04-rider.md, "D-10 —
// Availability: online / offline"
// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/04-rider.md#d-10--availability-online--offline),
// wired by https://github.com/shaiknoorullah/hg-mono/issues/255:
//
//   - The stale-location sweep moves an ONLINE_IDLE rider whose last location
//     reached the server more than StaleAfter ago to ONLINE_STALE: still online
//     in the app, but offered no work until their next location update
//     (Store.SweepStaleOnline). The spec sets 120 s, swept every 15 s.
//   - Reconciliation returns a rider still ON_DELIVERY with no live assignment
//     to ONLINE_IDLE, or OFFLINE if they asked to stop after the delivery
//     (Store.ReconcileAvailability). The spec runs it every 60 s. It is the
//     backstop, not the mechanism: an assignment's own terminal step restores
//     the rider in the same transaction, so every rider it moves is an anomaly
//     and is logged as one.
//
// Both read and write Postgres only. Flushing Redis changes nothing they do.
//
// Every replica runs the loop. Each sweep first takes its own lease: a session
// advisory lock, the same lease the partition maintenance loop takes
// (internal/partitions). One replica sweeps at a time, and a replica that finds
// the lease taken skips that tick. Even without the lease neither sweep could
// apply twice: each is one conditional UPDATE whose WHERE no longer matches a
// rider it has moved, and reconciliation logs only the riders that UPDATE
// returned.
//
// The rider app learns of either change on its next read of the rider's
// availability. The contract's push for it, rider.availability_changed
// (contracts/websocket.md, "Event catalogue"), has no emitter in dispatch yet:
// https://github.com/shaiknoorullah/hg-mono/pull/378 adds one, including for
// the stale-location sweep, and
// https://github.com/shaiknoorullah/hg-mono/issues/379 tracks it for
// reconciliation.

// Lease and job_run names of the two sweeps.
const (
	staleSweepJob = "rider_stale_sweep"
	reconcileJob  = "rider_availability_reconcile"
)

// AvailabilitySweepConfig sets the sweeps' threshold and schedule.
type AvailabilitySweepConfig struct {
	// StaleAfter is how old a rider's last location may be before the rider is
	// moved to ONLINE_STALE. The spec sets 120 s.
	StaleAfter time.Duration
	// StaleEvery is how often the stale-location sweep runs. The spec sets 15 s.
	StaleEvery time.Duration
	// ReconcileEvery is how often reconciliation runs. The spec sets 60 s.
	ReconcileEvery time.Duration
}

// DefaultAvailabilitySweepConfig is the spec's threshold and schedule.
func DefaultAvailabilitySweepConfig() AvailabilitySweepConfig {
	return AvailabilitySweepConfig{
		StaleAfter:     120 * time.Second,
		StaleEvery:     15 * time.Second,
		ReconcileEvery: 60 * time.Second,
	}
}

// AvailabilitySweeper runs the two rider availability sweeps on their schedule.
type AvailabilitySweeper struct {
	svc *Service
	log *slog.Logger
	cfg AvailabilitySweepConfig
}

// NewAvailabilitySweeper builds a sweeper. A zero field in cfg takes the
// spec's value.
func NewAvailabilitySweeper(svc *Service, log *slog.Logger, cfg AvailabilitySweepConfig) *AvailabilitySweeper {
	def := DefaultAvailabilitySweepConfig()
	if cfg.StaleAfter <= 0 {
		cfg.StaleAfter = def.StaleAfter
	}
	if cfg.StaleEvery <= 0 {
		cfg.StaleEvery = def.StaleEvery
	}
	if cfg.ReconcileEvery <= 0 {
		cfg.ReconcileEvery = def.ReconcileEvery
	}
	if log == nil {
		log = slog.Default()
	}
	return &AvailabilitySweeper{svc: svc, log: log, cfg: cfg}
}

// SweepResult is what one sweep did.
type SweepResult struct {
	// Ran is false when another replica held the sweep's lease, in which case
	// this one moved nobody.
	Ran bool
	// Moved is how many riders the sweep moved.
	Moved int64
	// Riders names the riders reconciliation restored. The stale-location
	// sweep reports a count only.
	Riders []string
}

// AvailabilitySweepReport is what RunOnce did.
type AvailabilitySweepReport struct {
	Stale     SweepResult
	Reconcile SweepResult
}

// Run sweeps once at start-up, which also repairs riders stranded across a
// restart, then on each sweep's own schedule until ctx is cancelled.
func (s *AvailabilitySweeper) Run(ctx context.Context) {
	stale := time.NewTicker(s.cfg.StaleEvery)
	defer stale.Stop()
	reconcile := time.NewTicker(s.cfg.ReconcileEvery)
	defer reconcile.Stop()

	s.logStale(s.sweepStale(ctx, false))
	s.logReconcile(s.reconcile(ctx, false))
	for {
		select {
		case <-ctx.Done():
			return
		case <-stale.C:
			s.logStale(s.sweepStale(ctx, false))
		case <-reconcile.C:
			s.logReconcile(s.reconcile(ctx, false))
		}
	}
}

// RunOnce runs both sweeps now and reports what they did. It is the hook for
// the dev environment's "run the sweeps now" control
// (https://github.com/shaiknoorullah/hg-mono/issues/235). Unlike a scheduled
// tick it waits for a lease another replica holds instead of skipping, so a
// caller that has just changed a rider always gets a sweep that sees the
// change. ctx bounds the wait. Both sweeps are attempted even if the first
// fails; the first error is returned.
func (s *AvailabilitySweeper) RunOnce(ctx context.Context) (AvailabilitySweepReport, error) {
	var rep AvailabilitySweepReport
	var staleErr, reconcileErr error
	rep.Stale, staleErr = s.sweepStale(ctx, true)
	s.logStale(rep.Stale, staleErr)
	rep.Reconcile, reconcileErr = s.reconcile(ctx, true)
	s.logReconcile(rep.Reconcile, reconcileErr)
	if staleErr != nil {
		return rep, staleErr
	}
	return rep, reconcileErr
}

// sweepStale runs the stale-location sweep under its lease. wait queues for a
// lease another replica holds; without it the sweep is skipped.
func (s *AvailabilitySweeper) sweepStale(ctx context.Context, wait bool) (SweepResult, error) {
	var res SweepResult
	ran, err := s.withLease(ctx, staleSweepJob, wait, func() (int64, error) {
		n, err := s.svc.store.SweepStaleOnline(ctx, s.cfg.StaleAfter, s.svc.now())
		res.Moved = n
		return n, err
	})
	res.Ran = ran
	return res, err
}

// reconcile runs reconciliation under its lease, as sweepStale does.
func (s *AvailabilitySweeper) reconcile(ctx context.Context, wait bool) (SweepResult, error) {
	var res SweepResult
	ran, err := s.withLease(ctx, reconcileJob, wait, func() (int64, error) {
		ids, err := s.svc.Reconcile(ctx)
		res.Riders = ids
		res.Moved = int64(len(ids))
		return res.Moved, err
	})
	res.Ran = ran
	return res, err
}

func (s *AvailabilitySweeper) logStale(res SweepResult, err error) {
	switch {
	case err != nil:
		s.log.Warn("rider stale-location sweep failed", slog.String("error", err.Error()))
	case !res.Ran:
		s.log.Debug("rider stale-location sweep skipped: another replica holds the lease")
	case res.Moved > 0:
		s.log.Info("rider stale-location sweep: riders with no recent location moved to ONLINE_STALE",
			slog.Int64("riders", res.Moved), slog.Duration("stale_after", s.cfg.StaleAfter))
	}
}

func (s *AvailabilitySweeper) logReconcile(res SweepResult, err error) {
	switch {
	case err != nil:
		s.log.Warn("rider availability reconciliation failed", slog.String("error", err.Error()))
	case !res.Ran:
		s.log.Debug("rider availability reconciliation skipped: another replica holds the lease")
	case res.Moved > 0:
		// An anomaly: the assignment's terminal step should already have
		// restored these riders (restoreAvailabilityTx).
		s.log.Warn("rider availability reconciliation: riders stuck ON_DELIVERY with no live assignment restored",
			slog.Int64("riders", res.Moved), slog.Any("rider_account_ids", res.Riders))
	}
}

// leasePollEvery is how long a "sweep now" call waits between attempts at a
// lease another replica holds. It holds no connection while it waits.
const leasePollEvery = 50 * time.Millisecond

// withLease runs sweep while this replica holds the job's lease: a session
// advisory lock on a pooled connection of its own, taken and released exactly
// as internal/partitions takes its lease. A crashed holder's lock goes with its
// connection. With wait false a lease held elsewhere skips the sweep (ran is
// false); with wait true the call retries until it gets the lease, bounded by
// ctx.
//
// The lease is only ever tried (pg_try_advisory_lock), never queued for
// (pg_advisory_lock): a waiter gives its connection back to the pool between
// attempts. The sweep itself runs on a second pooled connection, so a waiter
// blocking on the server while holding one would let enough concurrent "sweep
// now" callers take every connection and leave the holder none to sweep with
// (https://github.com/shaiknoorullah/hg-mono/issues/525).
//
// A pass that moved a rider or failed is recorded in job_run, the background
// runtime's observability table (docs/spec/01-platform.md, "P-39 — Background
// runtime"). Passes that moved nobody are not: at four a minute they would only
// bury the ones that matter, and nothing prunes another job's rows.
func (s *AvailabilitySweeper) withLease(ctx context.Context, job string, wait bool, sweep func() (int64, error)) (ran bool, err error) {
	key := "hg." + job
	c, err := s.tryLease(ctx, key)
	for err == nil && c == nil && wait {
		t := time.NewTimer(leasePollEvery)
		select {
		case <-ctx.Done():
			t.Stop()
			return false, ctx.Err()
		case <-t.C:
		}
		c, err = s.tryLease(ctx, key)
	}
	if err != nil || c == nil {
		return false, err
	}
	conn := c.Conn()
	defer func() {
		// The lock belongs to the session, so a connection that could not
		// unlock must not go back to the pool still holding it.
		if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, key); uerr != nil {
			_ = conn.Close(context.WithoutCancel(ctx))
		}
		c.Release()
	}()

	started := time.Now()
	moved, err := sweep()
	if moved > 0 || (err != nil && ctx.Err() == nil) {
		var errText *string
		failed := 0
		if err != nil {
			e := err.Error()
			errText, failed = &e, 1
		}
		if _, rerr := conn.Exec(ctx, `
			INSERT INTO job_run (job, started_at, finished_at, claimed, succeeded, failed, error)
			VALUES ($1, $2, now(), $3, $4, $5, $6)`,
			job, started, moved, moved, failed, errText); rerr != nil {
			s.log.Warn("rider availability sweep: job_run not recorded",
				slog.String("job", job), slog.String("error", rerr.Error()))
		}
	}
	return true, err
}

// tryLease makes one attempt at the lease named key. It returns the pooled
// connection holding the lock, or nil (and no connection held) when another
// session holds it.
func (s *AvailabilitySweeper) tryLease(ctx context.Context, key string) (*pgxpool.Conn, error) {
	c, err := s.svc.store.db.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	var got bool
	if err := c.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1, 0))`, key).Scan(&got); err != nil {
		// A call cut short (by ctx, say) may still have been granted the lock
		// on the server; closing the session guarantees it is not kept.
		_ = c.Conn().Close(context.WithoutCancel(ctx))
		c.Release()
		return nil, err
	}
	if !got {
		c.Release()
		return nil, nil
	}
	return c, nil
}
