package halalexpiry

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	_ "time/tzdata" // the midnight wake-up must not depend on the image's zoneinfo

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// JobName names this loop in job_run and keys its advisory lock.
const JobName = "halal_certificate_expiry"

// Interval is the longest gap between passes. Run also wakes just after local
// midnight, which is when a certificate lapses.
const Interval = time.Hour

// retrySoon is the wait after a pass that skipped a restaurant because another
// transaction held its row.
const retrySoon = time.Minute

// ReminderDays are the renewal reminders, in days before expiry: the owner's
// decision, docs/decisions/README.md, "Settled — redesign decisions (owner,
// 2026-09-28)", row "Certificate renewal reminders to restaurants".
var ReminderDays = []int{30, 14, 7, 1}

// wakeZone is where midnight is computed for the wake-up. The launch is Ontario
// only (docs/decisions/README.md, "Settled — launch decisions"); a restaurant in
// another zone still lapses on its own local date, at most Interval late.
var wakeZone = mustZone("America/Toronto")

// Config holds the settings that are policy rather than mechanism.
type Config struct {
	// SuspendAfterExpiredDays, when above zero, moves a restaurant that is
	// DELISTED for a lapsed certificate to SUSPENDED once its certificate has
	// been expired for that many days. A suspended restaurant is not relisted
	// automatically when a renewal is approved; staff reinstate it.
	//
	// Zero, the default, never suspends: the specification documents "delisted,
	// not suspended" (docs/spec/05-admin.md, "A-17 — Halal certificate expiry
	// monitoring and lapse handling"), which is also the recommended answer to
	// the delist-or-suspend conflict (https://github.com/shaiknoorullah/hg-mono/issues/269):
	// a delisted restaurant is hidden but not locked, so it can keep its menu
	// ready while it renews. Suspending 14 days after expiry is an open owner
	// question: https://github.com/shaiknoorullah/hg-mono/issues/164.
	SuspendAfterExpiredDays int
}

// Enqueuer is the write side of the notification outbox (*notify.Enqueuer): it
// writes the notification row and its delivery job in the caller's transaction.
type Enqueuer interface {
	Enqueue(ctx context.Context, tx pgx.Tx, n notify.New) (notify.EnqueueResult, error)
}

// Job is the certificate expiry loop.
type Job struct {
	pool   *pgxpool.Pool
	notify Enqueuer
	log    *slog.Logger
	cfg    Config
	now    func() time.Time
}

// New builds the job. It does nothing until Run or RunAt is called.
func New(pool *pgxpool.Pool, enq Enqueuer, log *slog.Logger, cfg Config) *Job {
	if log == nil {
		log = slog.Default()
	}
	return &Job{pool: pool, notify: enq, log: log, cfg: cfg, now: time.Now}
}

// WithClock replaces the clock Run reads, for tests and the dev controls.
func (j *Job) WithClock(now func() time.Time) *Job {
	j.now = now
	return j
}

// Report is what one pass did.
type Report struct {
	Evaluated int // restaurants looked at
	Skipped   int // restaurants whose row another transaction held; retried soon
	Expired   int // certificates moved from APPROVED to EXPIRED
	Delisted  int
	Relisted  int
	Suspended int
	Reminders int // reminder thresholds recorded (each notifies every recipient)
	Errors    []error
}

func (r Report) changed() bool {
	return r.Expired+r.Delisted+r.Relisted+r.Suspended+r.Reminders > 0
}

// Run makes a pass at once, then again just after each Toronto midnight and at
// least every Interval, until ctx is cancelled.
func (j *Job) Run(ctx context.Context) {
	for {
		rep, ran, err := j.RunAt(ctx, j.now())
		switch {
		case err != nil:
			j.log.Error("halal expiry pass failed", slog.String("error", err.Error()))
		case !ran:
			j.log.Debug("halal expiry pass skipped: another replica holds the lease")
		default:
			for _, e := range rep.Errors {
				j.log.Error("halal expiry: restaurant not evaluated", slog.String("error", e.Error()))
			}
			if rep.changed() {
				j.log.Info("halal expiry pass",
					slog.Int("evaluated", rep.Evaluated), slog.Int("expired", rep.Expired),
					slog.Int("delisted", rep.Delisted), slog.Int("relisted", rep.Relisted),
					slog.Int("suspended", rep.Suspended), slog.Int("reminders", rep.Reminders))
			}
		}
		wait := untilNextPass(j.now())
		if rep.Skipped > 0 || len(rep.Errors) > 0 || err != nil {
			wait = min(wait, retrySoon)
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// untilNextPass is the wait until one second past the next Toronto midnight,
// or Interval, whichever comes first.
func untilNextPass(now time.Time) time.Duration {
	local := now.In(wakeZone)
	midnight := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 1, 0, wakeZone)
	return min(midnight.Sub(now), Interval)
}

// RunAt makes one pass as of the instant at: every date is the restaurant's
// local date at that instant. ran is false when another replica holds the
// lease. The pass is recorded in job_run.
func (j *Job) RunAt(ctx context.Context, at time.Time) (rep Report, ran bool, err error) {
	c, err := j.pool.Acquire(ctx)
	if err != nil {
		return rep, false, err
	}
	conn := c.Conn()
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1, 0))`, JobName).Scan(&ran); err != nil || !ran {
		c.Release()
		return rep, false, err
	}
	defer func() {
		// The lock belongs to the session: a connection that cannot unlock must
		// not go back to the pool still holding it.
		bg := context.WithoutCancel(ctx)
		if _, uerr := conn.Exec(bg, `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, JobName); uerr != nil {
			_ = conn.Close(bg)
		}
		c.Release()
	}()

	var runID int64
	if err := conn.QueryRow(ctx, `INSERT INTO job_run (job) VALUES ($1) RETURNING id`, JobName).Scan(&runID); err != nil {
		j.log.Warn("halal expiry: job_run not recorded", slog.String("error", err.Error()))
	}

	ids, err := candidates(ctx, conn)
	if err != nil {
		return rep, true, err
	}
	for _, id := range ids {
		if err := j.evaluate(ctx, conn, id, at, &rep); err != nil {
			rep.Errors = append(rep.Errors, fmt.Errorf("restaurant %s: %w", id, err))
		}
	}
	rep.Evaluated = len(ids)

	if runID != 0 {
		var errText *string
		if len(rep.Errors) > 0 {
			msgs := make([]string, len(rep.Errors))
			for i, e := range rep.Errors {
				msgs[i] = e.Error()
			}
			s := strings.Join(msgs, "; ")
			errText = &s
		}
		if _, err := conn.Exec(ctx, `
			UPDATE job_run SET finished_at = now(), claimed = $2, succeeded = $3, failed = $4, error = $5
			 WHERE id = $1`,
			runID, rep.Evaluated, rep.Evaluated-len(rep.Errors)-rep.Skipped, len(rep.Errors), errText); err != nil {
			j.log.Warn("halal expiry: job_run not closed", slog.String("error", err.Error()))
		}
	}
	return rep, true, nil
}

// candidates are the restaurants whose halal state can change with the date:
// any with an approved certificate, any showing a halal state, and any still
// carrying the lapse reason.
func candidates(ctx context.Context, conn *pgx.Conn) ([]uuid.UUID, error) {
	rows, err := conn.Query(ctx, `
		SELECT r.id FROM restaurant r
		 WHERE r.deleted_at IS NULL
		   AND (r.halal_status <> 'UNVERIFIED'
		        OR 'HALAL_CERTIFICATE_EXPIRED' = ANY (r.delist_reasons)
		        OR EXISTS (SELECT 1 FROM halal_certificate hc
		                    WHERE hc.restaurant_id = r.id AND hc.status = 'APPROVED' AND hc.deleted_at IS NULL))
		 ORDER BY r.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// lapsedCert is a certificate this pass moved to EXPIRED.
type lapsedCert struct {
	id             uuid.UUID
	expiresOn      time.Time
	body           string
	restaurantName string
}

// evaluate brings one restaurant up to date as of at, in one transaction.
func (j *Job) evaluate(ctx context.Context, conn *pgx.Conn, restaurantID uuid.UUID, at time.Time, rep *Report) error {
	var out Report
	err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		out = Report{}
		var before string
		err := tx.QueryRow(ctx, `
			SELECT account_state::text FROM restaurant
			 WHERE id = $1 AND deleted_at IS NULL
			 FOR UPDATE SKIP LOCKED`, restaurantID).Scan(&before)
		if errors.Is(err, pgx.ErrNoRows) {
			out.Skipped = 1
			return nil
		}
		if err != nil {
			return err
		}

		lapsed, err := expireLapsed(ctx, tx, restaurantID, at)
		if err != nil {
			return fmt.Errorf("expire lapsed certificates: %w", err)
		}
		out.Expired = len(lapsed)

		if _, err := tx.Exec(ctx, `SELECT halal_refresh_restaurant_status($1, $2)`, restaurantID, at); err != nil {
			return fmt.Errorf("refresh halal status: %w", err)
		}

		if j.cfg.SuspendAfterExpiredDays > 0 {
			n, err := suspendLongLapsed(ctx, tx, restaurantID, at, j.cfg.SuspendAfterExpiredDays)
			if err != nil {
				return fmt.Errorf("suspend after lapse: %w", err)
			}
			out.Suspended = n
		}

		var after string
		if err := tx.QueryRow(ctx, `SELECT account_state::text FROM restaurant WHERE id = $1`, restaurantID).Scan(&after); err != nil {
			return err
		}
		if after != before {
			switch {
			case after == "DELISTED":
				out.Delisted = 1
			case before == "DELISTED" && after == "LIVE":
				out.Relisted = 1
			}
		}
		if quiet(after) {
			return nil
		}

		recipients, err := staffToTell(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		for _, lc := range lapsed {
			for _, acct := range recipients {
				if _, err := j.notify.Enqueue(ctx, tx, expiredMessage(acct, restaurantID, lc)); err != nil {
					return fmt.Errorf("enqueue expiry notice: %w", err)
				}
			}
		}

		sent, err := j.remind(ctx, tx, restaurantID, at, recipients)
		if err != nil {
			return fmt.Errorf("renewal reminder: %w", err)
		}
		out.Reminders = sent
		return nil
	})
	if err != nil {
		return err
	}
	rep.Skipped += out.Skipped
	rep.Expired += out.Expired
	rep.Delisted += out.Delisted
	rep.Relisted += out.Relisted
	rep.Suspended += out.Suspended
	rep.Reminders += out.Reminders
	return nil
}

// quiet reports whether a restaurant in this account state gets no halal
// messages: it is not trading and is not coming back on its own.
func quiet(accountState string) bool {
	switch accountState {
	case "BANNED", "DEACTIVATED", "CLOSED":
		return true
	}
	return false
}

// expireLapsed moves the restaurant's APPROVED certificates whose last valid
// day is before the restaurant's local date at `at` to EXPIRED. A certificate
// moves once, so the rows it returns are each told about once.
func expireLapsed(ctx context.Context, tx pgx.Tx, restaurantID uuid.UUID, at time.Time) ([]lapsedCert, error) {
	rows, err := tx.Query(ctx, `
		UPDATE halal_certificate hc
		   SET status = 'EXPIRED'
		  FROM restaurant r, halal_issuing_body b
		 WHERE hc.restaurant_id = $1
		   AND r.id = hc.restaurant_id
		   AND b.id = hc.issuing_body_id
		   AND hc.status = 'APPROVED'
		   AND hc.deleted_at IS NULL
		   AND COALESCE(hc.grace_until, hc.expires_on) < ($2::timestamptz AT TIME ZONE r.timezone)::date
		RETURNING hc.id, hc.expires_on, b.name, r.display_name`, restaurantID, at)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (lapsedCert, error) {
		var lc lapsedCert
		err := row.Scan(&lc.id, &lc.expiresOn, &lc.body, &lc.restaurantName)
		return lc, err
	})
}

// suspendLongLapsed is the switched-off answer to the open owner question
// (https://github.com/shaiknoorullah/hg-mono/issues/164): a restaurant delisted
// for a certificate that has been expired for `after` days becomes SUSPENDED.
func suspendLongLapsed(ctx context.Context, tx pgx.Tx, restaurantID uuid.UUID, at time.Time, after int) (int, error) {
	tag, err := tx.Exec(ctx, `
		WITH s AS (
		  UPDATE restaurant r
		     SET account_state = 'SUSPENDED'
		    FROM halal_certificate hc
		   WHERE r.id = $1
		     AND hc.id = r.halal_certificate_id
		     AND r.account_state = 'DELISTED'
		     AND r.halal_status = 'EXPIRED'
		     AND COALESCE(hc.grace_until, hc.expires_on) + $3::int < ($2::timestamptz AT TIME ZONE r.timezone)::date
		  RETURNING r.id, r.delist_reasons
		)
		INSERT INTO audit_event
		  (actor_kind, action, subject_type, subject_id, outcome, reason_code, before, after,
		   day, seq, prev_hash, hash)
		SELECT 'SYSTEM', 'restaurant.suspended', 'RESTAURANT', s.id, 'SUCCESS', 'HALAL_CERTIFICATE_EXPIRED',
		       jsonb_build_object('account_state', 'DELISTED', 'delist_reasons', to_jsonb(s.delist_reasons)),
		       jsonb_build_object('account_state', 'SUSPENDED', 'delist_reasons', to_jsonb(s.delist_reasons),
		                          'suspend_after_expired_days', $3::int),
		       current_date, 0, '\x00'::bytea, '\x00'::bytea
		  FROM s`, restaurantID, at, after)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// staffToTell is who hears about the restaurant's certificate: its live owner
// and manager accounts. Front-of-house staff do not manage documents.
func staffToTell(ctx context.Context, tx pgx.Tx, restaurantID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT account_id FROM account_role
		 WHERE scope_type = 'RESTAURANT' AND scope_id = $1 AND revoked_at IS NULL
		   AND role IN ('RESTAURANT_OWNER', 'RESTAURANT_MANAGER')
		 ORDER BY account_id`, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("load restaurant owners and managers: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// remind sends the renewal reminder that is due for the restaurant's current
// certificate, if it has not been sent. It returns 1 when it recorded one.
func (j *Job) remind(ctx context.Context, tx pgx.Tx, restaurantID uuid.UUID, at time.Time, recipients []uuid.UUID) (int, error) {
	var c reminderCert
	err := tx.QueryRow(ctx, `
		SELECT hc.id, hc.expires_on, ($2::timestamptz AT TIME ZONE r.timezone)::date, b.name, r.display_name
		  FROM restaurant r
		  JOIN halal_certificate hc ON hc.id = r.halal_certificate_id
		  JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
		 WHERE r.id = $1 AND hc.status = 'APPROVED'`, restaurantID, at).
		Scan(&c.id, &c.expiresOn, &c.today, &c.body, &c.restaurantName)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	daysLeft := int(c.expiresOn.Sub(c.today).Hours() / 24)
	threshold, due := dueThreshold(daysLeft)
	if !due {
		return 0, nil
	}

	var reminderID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO halal_certificate_reminder
		  (halal_certificate_id, restaurant_id, days_before, expires_on, sent_on, recipients)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT ON CONSTRAINT halal_certificate_reminder_once DO NOTHING
		RETURNING id`,
		c.id, restaurantID, threshold, c.expiresOn, c.today, len(recipients)).Scan(&reminderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil // already sent for this threshold
	}
	if err != nil {
		return 0, err
	}
	if len(recipients) == 0 {
		j.log.Warn("halal expiry: renewal reminder has no owner or manager to go to",
			slog.String("restaurant_id", restaurantID.String()), slog.Int("days_before", threshold))
	}
	for _, acct := range recipients {
		if _, err := j.notify.Enqueue(ctx, tx, reminderMessage(acct, restaurantID, c, threshold, daysLeft)); err != nil {
			return 0, err
		}
	}
	return 1, nil
}

// dueThreshold is the reminder due with daysLeft days to go (0 on the expiry
// day itself): the nearest threshold at or above daysLeft. Thresholds further
// out that were never sent stay unsent; their wording would be wrong now.
func dueThreshold(daysLeft int) (int, bool) {
	best, due := 0, false
	for _, n := range ReminderDays {
		if n >= daysLeft && daysLeft >= 0 && (!due || n < best) {
			best, due = n, true
		}
	}
	return best, due
}

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("halalexpiry: load %s: %v", name, err))
	}
	return loc
}
