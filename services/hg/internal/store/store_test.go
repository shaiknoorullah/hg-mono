package store

import (
	"context"
	"net"
	"os"
	"testing"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestAddrRecorderReportsTheSocketNotTheConfiguration is the unit-level proof of
// the mechanism behind /debug/deps, and it needs no container.
//
// It configures the string "localhost:PORT" and asserts that what gets reported
// is "127.0.0.1:PORT" — the peer of the socket the kernel actually opened. Those
// two strings differing is the entire point: a report that echoed configuration
// back could never have caught a cache pointed at the wrong host, because
// configuration is exactly the thing that was wrong.
func TestAddrRecorderReportsTheSocketNotTheConfiguration(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	configured := net.JoinHostPort("localhost", port)

	rec := newAddrRecorder()
	if got := rec.get(); got != "" {
		t.Errorf("recorder reported %q before anything connected, want empty", got)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := rec.DialContext(ctx, "tcp", configured)
	if err != nil {
		t.Fatalf("dial %s: %v", configured, err)
	}
	defer func() { _ = conn.Close() }()

	got := rec.get()
	if got == "" {
		t.Fatal("recorder reported no address after a successful dial")
	}
	if got == configured {
		t.Errorf("recorder echoed the configured string %q instead of the connected peer", configured)
	}
	wantHost, wantPort, _ := net.SplitHostPort(ln.Addr().String())
	gotHost, gotPort, err := net.SplitHostPort(got)
	if err != nil {
		t.Fatalf("recorded address %q is not host:port: %v", got, err)
	}
	if gotHost != wantHost || gotPort != wantPort {
		t.Errorf("recorded %s:%s, want the listener's %s:%s", gotHost, gotPort, wantHost, wantPort)
	}
}

// TestPostgresReportsARealConnection is the integration half: a real Postgres,
// a real query through pgx, and a resolved address that came off the wire.
//
// It uses an explicit DSN when HG_TEST_POSTGRES_DSN is set, otherwise a
// testcontainer, otherwise it skips with a reason. It never fails for the
// absence of Docker — a skipped integration test is information; a red suite on
// a machine without a daemon is noise.
func TestPostgresReportsARealConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		dsn = startPostgresContainer(ctx, t) // skips when Docker is unavailable
	}

	cfg := config.Postgres{
		DSN:         dsn,
		MaxConns:    4,
		MinConns:    1,
		ConnTimeout: 10 * time.Second,
	}

	pg, err := openPostgres(ctx, cfg)
	if err != nil {
		t.Fatalf("openPostgres: %v", err)
	}
	defer pg.close()

	dep := pg.check(ctx, cfg)

	if !dep.Connected {
		t.Fatalf("dependency reported not connected: %s", dep.Detail)
	}
	if dep.Name != DepPostgres {
		t.Errorf("name = %q, want %q", dep.Name, DepPostgres)
	}
	if dep.ConfiguredAddress == "" {
		t.Error("configured address is empty; the report must show what was configured")
	}
	if dep.ResolvedAddress == "" {
		t.Fatal("resolved address is empty — the report is not reading the live socket")
	}
	if _, _, err := net.SplitHostPort(dep.ResolvedAddress); err != nil {
		t.Errorf("resolved address %q is not host:port: %v", dep.ResolvedAddress, err)
	}
	if dep.Latency <= 0 {
		t.Error("latency was not measured")
	}

	// The PostGIS probe must give an honest answer either way: passed with a
	// version when the extension is present, failed with a reason when it is not.
	probe := pg.probePostGIS(ctx)
	if probe.Name != ProbePostGIS {
		t.Errorf("probe name = %q, want %q", probe.Name, ProbePostGIS)
	}
	if probe.Detail == "" {
		t.Error("the probe reported neither a version nor a reason")
	}
	t.Logf("postgres configured=%s connected=%s latency=%s postgis_passed=%v (%s)",
		dep.ConfiguredAddress, dep.ResolvedAddress, dep.Latency, probe.Passed, probe.Detail)
}

// startPostgresContainer brings up PostGIS 17 for the duration of the test, or
// skips when there is no Docker daemon to talk to.
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

// dockerAvailable is a cheap pre-check so an absent daemon costs a skip rather
// than a multi-minute timeout inside the container library.
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
