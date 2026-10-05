package devworld

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/redis/go-redis/v9"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// Reset wipes the public schema, reapplies goose migrations, the reference
// seed and the personas, then checks the result. It refuses anything that is
// not a local development database.
func Reset(ctx context.Context, env, dsn string) error {
	if err := AllowReset(env, dsn); err != nil {
		return err
	}
	if err := recreatePublic(ctx, dsn); err != nil {
		return err
	}
	if err := migrateAndSeed(ctx, dsn); err != nil {
		return err
	}
	flushLocalRedis(ctx)
	return Verify(ctx, dsn)
}

// Seed reapplies the reference data and the personas without dropping the
// schema. Migrations must already be applied. It is idempotent.
func Seed(ctx context.Context, env, dsn string) error {
	if err := AllowReset(env, dsn); err != nil {
		return err
	}
	if err := migrateAndSeed(ctx, dsn); err != nil {
		return err
	}
	return Verify(ctx, dsn)
}

func migrateAndSeed(ctx context.Context, dsn string) error {
	root, err := migrationsRoot()
	if err != nil {
		return err
	}
	if err := gooseUp(ctx, root, dsn); err != nil {
		return err
	}
	if err := testseed.Seed(dsn, false); err != nil {
		return fmt.Errorf("devworld: reference seed: %w", err)
	}
	if err := ApplyPersonas(ctx, dsn); err != nil {
		return err
	}
	return ApplyCredentials(ctx, dsn)
}

func recreatePublic(ctx context.Context, dsn string) error {
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	// Topology extensions on the PostGIS image pin objects in public. Drop
	// them first so the schema drop can finish. Goose creates postgis again.
	script := `
DROP EXTENSION IF EXISTS postgis_tiger_geocoder CASCADE;
DROP EXTENSION IF EXISTS postgis_topology CASCADE;
DROP EXTENSION IF EXISTS postgis CASCADE;
DROP SCHEMA IF EXISTS tiger CASCADE;
DROP SCHEMA IF EXISTS tiger_data CASCADE;
DROP SCHEMA IF EXISTS topology CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
`
	if _, err := conn.PgConn().Exec(ctx, script).ReadAll(); err != nil {
		return fmt.Errorf("devworld: could not recreate the public schema: %w", err)
	}
	fmt.Fprintln(os.Stderr, "devworld: public schema recreated")
	return nil
}

func gooseUp(ctx context.Context, migrationsDir, dsn string) error {
	var cmd *exec.Cmd
	if bin, err := exec.LookPath("goose"); err == nil {
		cmd = exec.CommandContext(ctx, bin, "-dir", migrationsDir, "postgres", dsn, "up")
	} else {
		cmd = exec.CommandContext(ctx, "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
			"-dir", migrationsDir, "postgres", dsn, "up")
	}
	cmd.Dir = filepath.Dir(migrationsDir)
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := string(out)
		if cfg, perr := pgconn.ParseConfig(dsn); perr == nil && cfg.Password != "" {
			msg = strings.ReplaceAll(msg, cfg.Password, "redacted")
		}
		return fmt.Errorf("devworld: goose up failed: %s", msg)
	}
	fmt.Fprintln(os.Stderr, "devworld: migrations applied")
	return nil
}

func flushLocalRedis(ctx context.Context) {
	addr := os.Getenv("HG_REDIS_ADDR")
	if addr == "" {
		return
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil || !LocalDBHost(host) {
		fmt.Fprintln(os.Stderr, "devworld: redis flush skipped (address is not local)")
		return
	}
	db := 0
	if raw := os.Getenv("HG_REDIS_DB"); raw != "" {
		if n, nerr := strconv.Atoi(raw); nerr == nil {
			db = n
		}
	}
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: os.Getenv("HG_REDIS_PASSWORD"),
		DB:       db,
	})
	defer rdb.Close()
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := rdb.FlushDB(pingCtx).Err(); err != nil {
		fmt.Fprintf(os.Stderr, "devworld: redis flush skipped (%v)\n", err)
		return
	}
	fmt.Fprintln(os.Stderr, "devworld: flushed the local redis database")
}
