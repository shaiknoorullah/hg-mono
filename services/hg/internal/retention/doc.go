// Package retention deletes rows that have outlived their purpose from the
// tables that would otherwise only grow: published outbox messages and the
// realtime events behind them, socket and ticket records, login attempts, OTP
// challenges, expired idempotency records, dead sessions, processed Stripe
// webhooks, the search log, notifications and their delivery attempts, and
// quotes no order was placed from.
//
// Spec: docs/spec/01-platform.md, "P-39 — Background runtime (deadline runner,
// outbox relay, schedulers)", which lists an hourly expiry sweep. Each table's
// retention period, and the spec section it comes from, is written next to its
// rule in rules.go, and all of them are recorded in
// docs/decisions/data-retention-periods.md. Where a spec gives no period, the
// rule says so and the period chosen is the conservative one. Issue: #221,
// https://github.com/shaiknoorullah/hg-mono/issues/221.
//
// How it runs:
//
//   - Every replica runs a Sweeper, but a pass runs on one replica at a time:
//     a pass starts by claiming a job_run row for the hour, under a
//     transaction-scoped advisory lock, so two replicas cannot both claim it.
//   - Each rule deletes in small batches, each batch its own statement, with a
//     pause between batches, so no long transaction holds locks or bloats WAL.
//   - Postgres is the clock: the cutoff for every rule is computed from the
//     job_run row's started_at, not from the replica's wall clock.
//
// What it never touches: the ledger, orders, the audit trail and KYC records.
// Those are kept for years by law (docs/spec/01-platform.md, "P-13 — The
// ledger and the zero-residual invariant" and "P-35 — Append-only audit
// trail"; KYC in "P-29 — Document lifecycle, review and retention"), and
// rules_test.go fails if a rule ever names one of them. The ledger and audit
// tables also refuse DELETE to the application role outright
// (migrations/00023_grants_and_lints.sql).
package retention
