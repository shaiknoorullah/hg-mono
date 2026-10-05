package testseed

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// FreshDatabase creates a new, empty database of its own, migrates it, loads
// the reference data (Seed without fixtures) and returns its DSN. The database
// is dropped when the test ends.
//
// It is for tests that change state the whole platform reads, such as the
// pause on new orders (https://github.com/shaiknoorullah/hg-mono/issues/244):
// on the shared HG_TEST_POSTGRES_DSN database such a test would refuse the
// orders of another package's tests running at the same time.
//
// The server is HG_TEST_POSTGRES_DSN's, or a throwaway container when that is
// unset and Docker is reachable; with neither, the test skips.
func FreshDatabase(t testing.TB, prefix string) string {
	t.Helper()
	if !regexp.MustCompile(`^[a-z_][a-z0-9_]{0,30}$`).MatchString(prefix) {
		t.Fatalf("testseed.FreshDatabase: prefix %q must be a short lower-case identifier", prefix)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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
		t.Fatalf("testseed.FreshDatabase: connect: %v", err)
	}
	defer admin.Close(ctx)
	name := fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatalf("testseed.FreshDatabase: create database: %v", err)
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

	dir, err := findMigrationsRoot()
	if err != nil {
		t.Fatal(err)
	}
	goose := exec.Command("go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3", "-dir", dir, "postgres", dsn, "up")
	if out, err := goose.CombinedOutput(); err != nil {
		t.Fatalf("testseed.FreshDatabase: migrate: %v\n%s", err, out)
	}
	if err := Seed(dsn, false); err != nil {
		t.Fatalf("testseed.FreshDatabase: %v", err)
	}
	return dsn
}
