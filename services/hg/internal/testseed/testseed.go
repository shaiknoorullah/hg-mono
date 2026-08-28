// Package testseed loads the reference data and fixtures that the integration
// and conformance test suites depend on into a freshly-migrated Postgres, so
// those suites are self-contained on a CLEAN database rather than silently
// riding on a long-lived dev database that prior sessions happened to pollute.
//
// A production deploy is validated against a clean DB. A test suite that only
// passes because pricing_config / tax_jurisdiction / the fixture accounts were
// left behind by an earlier run is a false green: green on pollution, red on an
// empty volume. This package closes that gap from one authoritative place.
//
// Every statement in the underlying SQL files is idempotent (ON CONFLICT DO
// NOTHING / WHERE NOT EXISTS), so Seed is safe to run against a clean and an
// already-seeded DB alike, and safe to run repeatedly.
package testseed

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// referenceFiles are the launch reference-data seed files (the same ones
// migrations/seed/seed.sql loads via psql), in FK order. Every integration
// suite that prices an order reads pricing_config and tax_jurisdiction from
// these.
var referenceFiles = []string{
	filepath.Join("seed", "001_tax.sql"),
	filepath.Join("seed", "002_halal_issuing_bodies.sql"),
	filepath.Join("seed", "003_pricing_and_settings.sql"),
	filepath.Join("seed", "004_reference_data.sql"),
}

// fixturesFile is the fixed-UUID base data (accounts, roles, a certified
// restaurant + menu, orders, the ratable DELIVERED order, a rider Connect
// account) the conformance harness references by the fx* constants. It depends
// on the reference data, so it is loaded last.
var fixturesFile = filepath.Join("test", "fixtures.sql")

// Seed loads the reference data into the DSN-backed database, and — when
// includeFixtures is true — the conformance fixtures on top. It is idempotent.
func Seed(dsn string, includeFixtures bool) error {
	root, err := findMigrationsRoot()
	if err != nil {
		return err
	}

	files := append([]string{}, referenceFiles...)
	if includeFixtures {
		files = append(files, fixturesFile)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("testseed: connect: %w", err)
	}
	defer conn.Close(ctx)

	for _, rel := range files {
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return fmt.Errorf("testseed: read %s: %w", rel, err)
		}
		script := stripPsqlMeta(string(raw))
		if strings.TrimSpace(script) == "" {
			continue
		}
		// Simple query protocol: runs the whole multi-statement script
		// server-side, honouring any BEGIN/COMMIT the file wraps itself in.
		// (pgxpool.Exec's extended protocol cannot run multi-statement scripts.)
		if _, err := conn.PgConn().Exec(ctx, script).ReadAll(); err != nil {
			return fmt.Errorf("testseed: exec %s: %w", rel, err)
		}
	}
	return nil
}

// stripPsqlMeta removes psql client meta-commands — lines whose first
// non-whitespace character is a backslash (\set, \echo, \ir, \gset …). Those
// are interpreted by the psql client, not the server, so they must not reach
// PgConn().Exec. Everything else — including BEGIN/COMMIT and dollar-quoted
// bodies — is left untouched.
func stripPsqlMeta(sql string) string {
	var b strings.Builder
	sc := bufio.NewScanner(strings.NewReader(sql))
	sc.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(strings.TrimSpace(line), `\`) {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}

// findMigrationsRoot walks up from the test working directory (the package dir
// under test, e.g. services/hg/internal/dispatch) until it finds
// services/hg/migrations, identified by the fixtures file it must contain.
func findMigrationsRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	start := dir
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "migrations")
		if _, err := os.Stat(filepath.Join(candidate, "test", "fixtures.sql")); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("testseed: could not locate migrations/test/fixtures.sql walking up from %s", start)
}
