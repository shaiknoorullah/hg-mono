package dispatch

import (
	"fmt"
	"os"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// TestMain seeds the launch reference data (pricing_config, tax_jurisdiction,
// halal issuing bodies, platform settings, cuisines) once before any dispatch
// integration test runs. The seedFixture helpers here price an order and so
// read `SELECT id FROM pricing_config LIMIT 1` and `SELECT code FROM
// tax_jurisdiction LIMIT 1`; on a freshly-migrated (clean) DB those rows do not
// exist until something seeds them, so the tests were a false green — green
// only against a database a prior `make seed` or another package's run had
// already populated. Seeding here makes the dispatch suite self-contained on an
// empty volume, exactly the state a production deploy is validated against.
//
// The load is idempotent, so it is a no-op against an already-seeded DB. When
// HG_TEST_POSTGRES_DSN is unset every integration test skips, so there is
// nothing to seed.
func TestMain(m *testing.M) {
	if dsn := os.Getenv("HG_TEST_POSTGRES_DSN"); dsn != "" {
		if err := testseed.Seed(dsn, false /* reference data only */); err != nil {
			fmt.Fprintf(os.Stderr, "dispatch TestMain: reference seed: %v\n", err)
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}
