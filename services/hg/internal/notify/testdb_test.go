package notify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// setupTestDB brings up a throwaway Postgres (or reuses HG_TEST_POSTGRES_DSN),
// applies every migration in services/hg/migrations with the vendored goose
// CLI, and returns a connected pool. It skips (never fails) when there is no
// Docker daemon and no DSN was supplied, mirroring
// internal/store/store_test.go's rule: an integration test that can't reach a
// database is information, not a red suite.
func setupTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		dsn = startPostgresContainer(ctx, t)
	}

	migrationsDir := findMigrationsDir(t)
	runGoose(t, migrationsDir, dsn)

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func findMigrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs("../../migrations")
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("migrations dir %s: %v", dir, err)
	}
	return dir
}

func runGoose(t *testing.T, migrationsDir, dsn string) {
	t.Helper()
	cmd := exec.Command("go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
		"-dir", migrationsDir, "postgres", dsn, "up")
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("goose up failed: %v\n%s", err, out)
	}
}

func startPostgresContainer(ctx context.Context, t *testing.T) string {
	t.Helper()

	if !dockerAvailable() {
		t.Skip("skipping: no Docker daemon reachable (set DOCKER_HOST, or set " +
			"HG_TEST_POSTGRES_DSN to run this test against an existing database)")
	}

	container, err := tcpostgres.Run(ctx,
		"postgis/postgis:17-3.5",
		tcpostgres.WithDatabase("hg"),
		tcpostgres.WithUsername("hg"),
		tcpostgres.WithPassword("hg"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(2*time.Minute)),
	)
	if err != nil {
		t.Skipf("skipping: could not start the postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("terminating container: %v", err)
		}
	})

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}
	return dsn
}

func dockerAvailable() bool {
	if host := os.Getenv("DOCKER_HOST"); host != "" {
		return true
	}
	for _, sock := range []string{
		"/var/run/docker.sock",
		os.Getenv("HOME") + "/.docker/run/docker.sock",
		os.Getenv("XDG_RUNTIME_DIR") + "/docker.sock",
	} {
		if fi, err := os.Stat(sock); err == nil && fi.Mode()&os.ModeSocket != 0 {
			return true
		}
	}
	return false
}
