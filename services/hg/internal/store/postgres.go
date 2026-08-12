package store

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Postgres is the pool plus the address it actually connected to.
type Postgres struct {
	Pool *pgxpool.Pool

	mu       sync.RWMutex
	remoteAt string
}

func openPostgres(ctx context.Context, cfg config.Postgres) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("parse DSN: %w", err)
	}
	poolCfg.MaxConns = cfg.MaxConns
	poolCfg.MinConns = cfg.MinConns
	poolCfg.ConnConfig.ConnectTimeout = cfg.ConnTimeout
	poolCfg.ConnConfig.RuntimeParams["application_name"] = "hg-api"

	p := &Postgres{}
	// The only honest source for "what are we actually connected to" is the live
	// socket. pgx hands us the underlying net.Conn on every new pool connection.
	poolCfg.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		if c := conn.PgConn().Conn(); c != nil && c.RemoteAddr() != nil {
			p.setRemote(c.RemoteAddr().String())
		}
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	dialCtx, cancel := context.WithTimeout(ctx, cfg.ConnTimeout)
	defer cancel()
	if err := pool.Ping(dialCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	p.Pool = pool
	return p, nil
}

func (p *Postgres) setRemote(addr string) {
	p.mu.Lock()
	p.remoteAt = addr
	p.mu.Unlock()
}

// RemoteAddr returns the peer address of a live pool connection.
func (p *Postgres) RemoteAddr() string {
	if p == nil {
		return ""
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.remoteAt
}

// check runs a real query through the pool. It deliberately does not use
// Pool.Ping alone: this is the readiness answer, and a pool that can open a
// socket but not execute a statement is not ready.
func (p *Postgres) check(ctx context.Context, cfg config.Postgres) Dependency {
	d := Dependency{Name: DepPostgres, ConfiguredAddress: cfg.Host()}
	if p == nil || p.Pool == nil {
		d.Detail = errNotOpen.Error()
		return d
	}

	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	start := time.Now()
	var one int
	err := p.Pool.QueryRow(ctx, "SELECT 1").Scan(&one)
	d.Latency = time.Since(start)
	d.ResolvedAddress = p.RemoteAddr()

	switch {
	case err != nil:
		d.Detail = err.Error()
	case one != 1:
		d.Detail = fmt.Sprintf("SELECT 1 returned %d", one)
	default:
		d.Connected = true
	}
	return d
}

// probePostGIS is the G-7 / P-30 startup probe: the geography(Point,4326)
// columns the whole dispatch path depends on are unusable without the extension,
// and finding that out at the first checkout is too late.
func (p *Postgres) probePostGIS(ctx context.Context) Probe {
	pr := Probe{Name: ProbePostGIS}
	if p == nil || p.Pool == nil {
		pr.Detail = errNotOpen.Error()
		return pr
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var version string
	err := p.Pool.QueryRow(ctx,
		`SELECT extversion FROM pg_extension WHERE extname = 'postgis'`).Scan(&version)
	switch {
	case err == pgx.ErrNoRows:
		pr.Detail = "postgis extension is not installed in this database — " +
			"P-30 requires geography(Point,4326) for every locatable entity"
	case err != nil:
		pr.Detail = err.Error()
	default:
		pr.Passed = true
		pr.Detail = "postgis " + version
	}
	return pr
}

func (p *Postgres) close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}
