package testseed

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// MigratedDatabase creates a new, empty database for one test, migrates it the
// way production is (see MigratedDatabaseDSN) and returns a superuser pool on
// it, for a suite that must not share a database with any other package's
// tests.
func MigratedDatabase(t testing.TB, prefix string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), MigratedDatabaseDSN(t, prefix))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// MigratedDatabaseDSN creates a new, empty database for one test, migrates it
// the way production is — goose as hg_migrator, the schema's owner — and
// returns a superuser DSN for it; AsRole turns that into a connection as one of
// the database roles. The database lives on HG_TEST_POSTGRES_DSN's server or,
// when that is unset and Docker is available, in a throwaway PostGIS container;
// with neither, the test is skipped. It is dropped when the test ends. prefix
// starts the database's name, so a leftover one says whose it is.
//
// The server's DSN must name a superuser: it creates the roles and the
// extensions, as migrations/roles/roles.sql does. The migrations are found at
// ../../migrations from the test's working directory, so the calling package
// must sit directly under services/hg/internal.
func MigratedDatabaseDSN(t testing.TB, prefix string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	server := os.Getenv("HG_TEST_POSTGRES_DSN")
	if server == "" {
		if _, err := os.Stat("/var/run/docker.sock"); err != nil && os.Getenv("DOCKER_HOST") == "" {
			t.Skip("no Docker and no HG_TEST_POSTGRES_DSN: skipping")
		}
		ctr, err := tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
			tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
			testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(2*time.Minute)))
		if err != nil {
			t.Skipf("postgres container did not start: %v", err)
		}
		t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })
		if server, err = ctr.ConnectionString(ctx, "sslmode=disable"); err != nil {
			t.Fatal(err)
		}
	}

	admin, err := pgx.Connect(ctx, server)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	name := fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), server)
		if err == nil {
			_, _ = c.Exec(context.Background(), `DROP DATABASE IF EXISTS `+name+` WITH (FORCE)`)
			_ = c.Close(context.Background())
		}
	})
	// Roles belong to the cluster. Create the ones roles/roles.sql would, with
	// no login (each connection is the superuser's, taking on a role), and
	// leave any that exist as they are. Another test may race this one.
	for _, role := range []string{"hg_migrator", "hg_app", "hg_readonly"} {
		_, err := admin.Exec(ctx, `CREATE ROLE `+role+` NOLOGIN`)
		var pgErr *pgconn.PgError
		if err != nil && !(errors.As(err, &pgErr) && (pgErr.Code == "42710" || pgErr.Code == "23505")) {
			t.Fatal(err)
		}
	}

	u, err := url.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dsn := u.String()

	// The in-database half of roles/roles.sql: the superuser creates the
	// extensions, hands the schema to hg_migrator and withholds TEMPORARY.
	super, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer super.Close(ctx)
	for _, sql := range []string{
		`CREATE EXTENSION IF NOT EXISTS postgis`,
		`CREATE EXTENSION IF NOT EXISTS citext`,
		`CREATE EXTENSION IF NOT EXISTS pg_trgm`,
		`CREATE EXTENSION IF NOT EXISTS unaccent`,
		`CREATE EXTENSION IF NOT EXISTS pgcrypto`,
		`ALTER SCHEMA public OWNER TO hg_migrator`,
		`REVOKE TEMPORARY ON DATABASE ` + name + ` FROM PUBLIC`,
	} {
		if _, err := super.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	dir, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	// goose as hg_migrator, as in production; UTC, as the Postgres image runs.
	goose := exec.Command("go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3", "-dir", dir, "postgres",
		AsRole(t, dsn, "hg_migrator"), "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out)
	}
	return dsn
}

// AsRole is dsn with the session taking on role from its first statement, and
// in UTC.
func AsRole(t testing.TB, dsn, role string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("options", "-c role="+role+" -c TimeZone=UTC")
	u.RawQuery = q.Encode()
	return u.String()
}
