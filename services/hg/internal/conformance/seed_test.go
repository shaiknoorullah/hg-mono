package conformance

import "github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"

// The conformance harness drives real read/write handlers whose responses are
// the bytes under test. Those handlers only return contract-shaped bodies when
// the rows they read exist. On the long-lived shared dev DB those rows happened
// to be present because prior sessions polluted it; on a freshly-migrated DB
// (the state a production deploy is validated against) they are absent, and the
// gate was a FALSE GREEN — green on pollution, red on a clean database.
//
// ensureBaseSeed closes that gap: once, from TestMain, it loads every FK
// prerequisite the conformance tests reference — the reference data
// (pricing_config, tax_jurisdiction, halal issuing bodies, platform settings,
// cuisines) AND the fixed-UUID fixtures the fx* constants name — into whatever
// DB HG_TEST_POSTGRES_DSN points at. The load is idempotent, so it is safe on a
// clean and an already-seeded DB alike, and two back-to-back conformance runs
// neither accumulate nor fail on the second pass.
func ensureBaseSeed(dsn string) error {
	return testseed.Seed(dsn, true /* includeFixtures */)
}
