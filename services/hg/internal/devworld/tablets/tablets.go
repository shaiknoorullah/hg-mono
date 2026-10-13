// Package tablets stands in for the restaurant order screens of the local dev
// world. Customer discovery reads a restaurant whose heartbeat is older than
// five minutes as not taking orders, and the restaurant web app is what sends
// that heartbeat. Without it, every seeded restaurant would stop reading OPEN
// five minutes after `make dev-reset` unless someone kept a restaurant console
// open. The ticker here touches last_heartbeat_at for the dev world's own
// restaurants once a minute, as their tablets would.
//
// It runs only inside the API process, only when HG_ENV is local and
// HG_DEVWORLD_TABLETS is on (config refuses that switch anywhere else), and it
// reads and writes Postgres alone, so it works with Redis flushed or absent.
//
// This package is separate from internal/devworld so the API binary does not
// link the reset tool, its embedded catalogue and its test helpers.
package tablets

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Every is how often the simulated tablets beat, the same cadence as the
// restaurant web app.
const Every = 60 * time.Second

// SeedDomain marks the dev world's accounts and restaurants: every owner
// account and every restaurant it seeds has an e-mail at this domain, and
// nothing outside the dev world does.
const SeedDomain = "@seed.hg"

// beatSQL touches the heartbeat of each restaurant the dev world seeded that
// is LIVE and has its order toggle on, as a connected order screen would. A
// restaurant seeded paused, toggled off, suspended or not yet live is left
// alone, so its edge state stays what the dev world made it. A restaurant
// closed by its hours is touched, but its hours still close it: the heartbeat
// only matters inside them. Both the restaurant and its owner account must
// carry the seed domain.
const beatSQL = `
	UPDATE restaurant r
	   SET last_heartbeat_at = now()
	 WHERE r.deleted_at IS NULL
	   AND r.account_state = 'LIVE'
	   AND r.is_accepting_orders
	   AND r.email LIKE '%' || $1
	   AND EXISTS (
	         SELECT 1
	           FROM account_role ar
	           JOIN account a ON a.id = ar.account_id
	          WHERE ar.role = 'RESTAURANT_OWNER'
	            AND ar.scope_type = 'RESTAURANT'
	            AND ar.scope_id = r.id
	            AND a.email LIKE '%' || $1)`

// Allow reports whether the simulated tablets may run. The environment must be
// exactly "local", as the dev world reset requires (devworld.AllowReset), and
// the switch must be on. Staging, production and an empty environment are
// refused whatever the switch says.
func Allow(env string, on bool) error {
	if !on {
		return fmt.Errorf("devworld tablets are off; HG_DEVWORLD_TABLETS=on turns them on")
	}
	if env != "local" {
		return fmt.Errorf("devworld tablets refuse HG_ENV=%q; they run only when HG_ENV is local", env)
	}
	return nil
}

// DB is the slice of a pgx pool the ticker uses.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Ticker beats the dev world's restaurants until its context ends.
type Ticker struct {
	db    DB
	log   *slog.Logger
	every time.Duration
}

// New returns a ticker, or the reason it may not run (Allow).
func New(env string, on bool, db DB, log *slog.Logger) (*Ticker, error) {
	if err := Allow(env, on); err != nil {
		return nil, err
	}
	return &Ticker{db: db, log: log, every: Every}, nil
}

// Beat touches the heartbeat of the dev world's live restaurants once and
// returns how many it touched.
func Beat(ctx context.Context, db DB) (int64, error) {
	tag, err := db.Exec(ctx, beatSQL, SeedDomain)
	if err != nil {
		return 0, fmt.Errorf("devworld tablets: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Run beats at once, then every minute. A failed beat is logged and the next
// one tries again; a reset that drops the schema under it heals the same way.
func (t *Ticker) Run(ctx context.Context) {
	t.log.Info("devworld tablets: simulating the seeded restaurants' order screens", "every", t.every.String())
	tick := time.NewTicker(t.every)
	defer tick.Stop()
	for {
		if n, err := Beat(ctx, t.db); err != nil {
			t.log.Warn("devworld tablets: heartbeat failed", "error", err.Error())
		} else {
			t.log.Debug("devworld tablets: heartbeat", "restaurants", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
