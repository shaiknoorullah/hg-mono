package testseed

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// MigratedDatabase creates a new, empty database for one test, migrates it with
// goose and returns a pool on it, for a suite that must not share a database
// with any other package's tests. The database lives on HG_TEST_POSTGRES_DSN's
// server or, when that is unset and Docker is available, in a throwaway PostGIS
// container; with neither, the test is skipped. It is dropped when the test
// ends. prefix starts the database's name, so a leftover one says whose it is.
//
// The migrations are found at ../../migrations from the test's working
// directory, so the calling package must sit directly under
// services/hg/internal.
func MigratedDatabase(t testing.TB, prefix string) *pgxpool.Pool {
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

	u, err := url.Parse(server)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dsn := u.String()

	dir, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	goose := exec.Command("go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3", "-dir", dir, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("migrate: %v\n%s", err, out)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
