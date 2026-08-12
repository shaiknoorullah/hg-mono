package realtime

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Relay is the outbox → Redis publisher (§6.1 step 2). It claims unpublished
// REALTIME outbox rows with FOR UPDATE SKIP LOCKED, publishes each to
// rt:{channel}, and marks it published. It never writes events — those are
// written in the state-change transaction via EmitInTx — so a Redis outage costs
// only fan-out latency: the rows accumulate and publish when Redis returns
// (§6.2).
type Relay struct {
	pool  *pgxpool.Pool
	rdb   *redis.Client
	log   *slog.Logger
	owner string

	// batchSize bounds one claim; interval is the idle poll cadence.
	batchSize int
	interval  time.Duration
}

// NewRelay builds a Relay. owner names this replica in the lease columns.
func NewRelay(pool *pgxpool.Pool, rdb *redis.Client, log *slog.Logger, owner string) *Relay {
	return &Relay{
		pool:      pool,
		rdb:       rdb,
		log:       log,
		owner:     owner,
		batchSize: 256,
		interval:  250 * time.Millisecond,
	}
}

// Run pumps the outbox until ctx is cancelled. Between drains it sleeps
// interval; a full batch is drained again immediately so a burst does not wait a
// whole tick.
func (r *Relay) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		n, err := r.drain(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			r.log.Warn("outbox drain failed; will retry", slog.String("error", err.Error()))
		}
		if n == r.batchSize {
			// More may be waiting; do not sleep a whole tick behind a backlog.
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// drain claims and publishes one batch. Publishing happens after the row is
// claimed but the published_at flag is only set once PUBLISH succeeds, so a
// crash mid-publish re-publishes rather than dropping — at-least-once, which the
// client's dedup-on-id handles (§6).
func (r *Relay) drain(ctx context.Context) (int, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, channel, payload
		  FROM outbox_message
		 WHERE kind = 'REALTIME' AND published_at IS NULL AND available_at <= now()
		 ORDER BY id ASC
		 LIMIT $1
		 FOR UPDATE SKIP LOCKED`,
		r.batchSize)
	if err != nil {
		return 0, err
	}

	type claim struct {
		id      int64
		channel string
		payload []byte
	}
	var claims []claim
	for rows.Next() {
		var cl claim
		if err := rows.Scan(&cl.id, &cl.channel, &cl.payload); err != nil {
			rows.Close()
			return 0, err
		}
		claims = append(claims, cl)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(claims) == 0 {
		return 0, tx.Commit(ctx)
	}

	published := make([]int64, 0, len(claims))
	for _, cl := range claims {
		if cl.channel == "" {
			// A REALTIME outbox row must name a channel; skip and flag it so it
			// does not spin. This should never happen given EmitInTx.
			published = append(published, cl.id)
			continue
		}
		if err := r.rdb.Publish(ctx, "rt:"+cl.channel, cl.payload).Err(); err != nil {
			// Redis is down. Leave every remaining row unpublished — they will be
			// retried — and commit only what we managed. Rolling the whole batch
			// back is equivalent here since nothing was marked yet.
			r.log.Warn("redis publish failed; backing off", slog.String("error", err.Error()))
			break
		}
		published = append(published, cl.id)
	}

	if len(published) > 0 {
		_, err = tx.Exec(ctx, `
			UPDATE outbox_message
			   SET published_at = now(), attempts = attempts + 1, lease_owner = $2
			 WHERE id = ANY($1)`,
			published, r.owner)
		if err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(published), nil
}
