---
covers:
  - services/hg/migrations/**
reviewed: 2026-10-04
---

# HalalGoes — database schema

Postgres 17 + PostGIS 3.6 (the spec target; verified locally on Postgres 16 +
PostGIS 3.4 — see *Verification* below). Numbered, forward-only migrations,
managed by [goose](https://github.com/pressly/goose).

```
migrations/
  0000N_*.sql        the migrations, in order
  seed/              launch data — tax table, halal issuing bodies, fee config
  lint/schema_lint.sql   the money + geography lints, runnable standalone
  test/              invariant tests: 77 assertions about what the DB refuses
  tools/             contract-enum generator and checker
```

## Running

```sh
export DATABASE_URL='postgres://hg:hg@localhost:5432/hg?sslmode=disable'

goose -dir . postgres "$DATABASE_URL" up
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/seed.sql
./test/run_invariant_tests.sh
```

Rollback works too: `goose … down` per step, `goose … reset` all the way to
zero. A full `up → reset → up` cycle leaves no tables, types, views or
functions behind.

### Why goose

`-- +goose Up` / `-- +goose Down` live in one file, so a migration and its
reversal are reviewed together rather than in two files that drift.
`StatementBegin/End` handles the function bodies and `DO` blocks this schema
needs (hash chains, deferred constraint triggers, partition helpers), which is
awkward under golang-migrate's split-file model. goose also embeds cleanly into
the Go binary later, so `hg migrate up` can ship in the same image as the API.

## What the database refuses

These are the invariants. Each is enforced by the schema, and each has a test in
`test/run_invariant_tests.sh` that proves it by trying and failing.

| # | Invariant | Mechanism |
|---|---|---|
| 1 | Money is `BIGINT`, named `*_cents`. No `money`, `numeric`, `double precision` or `real` in any monetary column. | `lint_money_columns()` + `assert_schema_lints()`, called by `00023`. A migration that adds a float money column **cannot apply**. |
| 2 | A non-terminal order carries a deadline and an action; a terminal one carries neither. | `order_deadline_required` CHECK on `"order"`, `dispatch_deadline_required` on `dispatch`, and the same shape on `payment_intent`, `refund`, `payout`, `kyc_document`, `stored_object`, `webhook_event`. "An order waits forever" is unrepresentable, not merely unlikely. |
| 3 | Every ledger batch sums to zero; `ledger_entry` is append-only. | Deferred constraint trigger `ledger_entry_batch_balanced` (fires at COMMIT, so rows may be written in any order) + `REVOKE UPDATE, DELETE, TRUNCATE` from `hg_app` + a `BEFORE UPDATE OR DELETE` trigger. Corrections are new `ADJUSTMENT` batches. |
| 4 | The decomposition invariant is one query returning zero rows. | `SELECT * FROM ledger_order_residual;` — plus `ledger_batch_imbalance`, `ledger_global_residual`, `ledger_charge_identity_breach`, `ledger_tip_passthrough_breach`, and `assert_ledger_invariants()` which raises on any of them. |
| 5 | The audit log is append-only and hash-chained, written in the same transaction as the change. | `audit_event_chain()` computes `seq`, `prev_hash` and `hash = sha256(prev_hash ‖ canonical_json(row))` in a `BEFORE INSERT` trigger — the application supplies none of them and cannot forge them. `verify_audit_chain(day)` returns the first broken link. |
| 6 | One canonical location column per entity, `geography(Point,4326)`, with the GiST indexes dispatch needs. | `lint_location_columns()`. A second location column, a `geometry`, a bare `point`, or a column named `coords` all fail the gate. |
| 7 | A ban needs two people, and an account's history of suspensions, reinstatements and bans is never rewritten ([#253](https://github.com/shaiknoorullah/hg-mono/issues/253)). | `00034`: a `BEFORE INSERT` trigger refuses a `CONFIRM_BAN` unless the account's latest row is a `PROPOSE_BAN` by somebody else less than 7 days old; CHECKs make `BANNED` reachable only by confirming a ban and hold each reason to its subject's vocabulary; `account_state_event` is append-only (trigger + `REVOKE`). |
| 8 | An account's state changes only through its database writer, with that writer's gates, and leaves a history row ([#335](https://github.com/shaiknoorullah/hg-mono/pull/335) security reviews). | `00035`: `hg_app` has no UPDATE on `restaurant.account_state`/`delist_reasons`, `rider_profile.account_status` or `account.status`/`status_reason` (or the tables' keys), may INSERT those rows only in their default state, may DELETE none of them, and may not write `account_state_event` or `account_state_rule`. The only writers are owner-defined `SECURITY DEFINER` functions: `account_state_apply()` for a staff action (the actor bound to the transaction with `hg.actor_id`, their grants read as they stand, the transition checked against `account_state_rule` (the same list as `accountstate.Transitions()` in Go), the own-account rule, the two-person ban, a restaurant's listing decided from its halal certificate; state, history and audit written together), and one function per system principal (onboarding, halal expiry, halal renewal, certifying body), which takes no actor or action. Every function pins `search_path` and names its tables; only the five writers are executable by `hg_app`. A listed restaurant carries no delisting reason (CHECK). A migration that adds a column to these tables calls `account_state_grant_app_columns()`. |

The two schema lints are also runnable on their own:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lint/schema_lint.sql
```

## Retention: what is deleted, and what never is

Some tables only grow: the outbox, socket and ticket records, sign-in records,
idempotency records, sessions, Stripe webhooks, the search log, notifications
and quotes. The hourly retention sweep in
[`internal/retention`](../internal/retention/rules.go) deletes their rows once
they are past a retention period, in batches of 2,000, on one replica at a time.
Each table's period, and the spec section it comes from, sits next to its rule
in `rules.go` and in the
[retention periods decision](../../../docs/decisions/data-retention-periods.md). `00028_retention_indexes.sql` adds the indexes the sweep needs:
one on each age column a rule filters by, and one on every column that holds a
foreign key to `session`, so deleting a session does not scan the tables that
point at it.

The sweep never deletes from the ledger, orders, the audit trail, KYC records,
or payments, refunds and payouts. Those are kept for years by law, and the
ledger and audit tables refuse `DELETE` to `hg_app` outright (`00023`); a test
in `internal/retention/rules_test.go` fails if a rule ever names one of them. A
quote an order was placed from is part of that order's record and is never
deleted either.

## Contract enums

`00002_enums.sql` is **generated**, never hand-edited:

```sh
python3 tools/gen_enums.py > 00002_enums.sql   # regenerate after a contract change
DATABASE_URL=… python3 tools/check_enums.py    # verify against a live database
```

Every enum in `contracts/openapi.yaml` either has a Postgres type with a
byte-identical label set, or appears in `tools/enum_map.py:EXCLUSIONS` with a
written reason. There is no third option: `check_enums.py` fails on anything
unaccounted for, and `gen_enums.py` refuses to generate.

## Verification

- **Applied**: `goose up` runs all 23 migrations against a real
  Postgres + PostGIS database. `goose reset` rolls all of them back with no
  leftovers, and `up` again succeeds.
- **Seeded**: `seed/seed.sql` applies and is idempotent.
- **Tested**: 64 invariant assertions pass (`test/run_invariant_tests.sh`).
- **Environment caveat**: Docker was not available, so this was verified
  against a locally installed **Postgres 16.13 with PostGIS 3.4.2**, not the
  spec's Postgres 17 + PostGIS 3.6. Nothing here uses a 17-only or 3.6-only
  feature — `uuid_generate_v7()` is hand-rolled precisely because 16 has no
  built-in — so the schema should apply unchanged on 17, but that has not been
  executed here and should be confirmed in CI on the real target image.

## Spec contradictions encountered, and how they were resolved

`01-platform.md` is normative and wins wherever the domain specs disagree.

1. **Restaurant location, three ways.** `03-restaurant.md` §1.2 sketches
   `lat numeric(9,6)`, `lng numeric(9,6)` **and** `coords geography(Point,4326)`
   on one row — precisely the split brain `01-platform.md` P-30 exists to
   forbid, and it would fail the money lint as well (`numeric` outside the
   allowlist). Resolved to a single `restaurant.location geography(Point,4326)`.
   The API derives lat/lng with `ST_Y`/`ST_X`.
2. **Where a restaurant's address lives.** P-30's `address` DDL comments that
   `account_id` is `NULL` for restaurant addresses, implying restaurants use the
   `address` table; but the same section adds inline address columns to
   `restaurant`. Both would give a restaurant two locations. Resolved: `address`
   is customer-only (`account_id NOT NULL`), the restaurant carries its premises
   address inline with one location column.
3. **Staff identity.** `05-admin.md` §0.3 models a standalone `staff_user` table
   with its own `password_hash`; `01-platform.md` P-01 says one `account` per
   human with roles as grants. Followed P-01: staff are accounts with
   `ADMIN`/`SUPER_ADMIN`/`SUPPORT_AGENT` grants, and `staff_profile` holds only
   the staff-specific attributes — chiefly `status`, whose `INVITED` value has no
   counterpart in `account_status`.
4. **Restaurant credentials.** Same shape: `03-restaurant.md` has a
   `restaurant_user` table. Followed P-01 — `RESTAURANT_*` grants scoped to a
   `restaurant_id` in `account_role`.
5. **Order state vocabularies.** `03-restaurant.md` §1.4 uses
   `PENDING_RESTAURANT`, `ACCEPTED`, `CANCELLED_NO_RESPONSE`;
   `01-platform.md` P-14 and `contracts/openapi.yaml` both use the 14-state
   `order_state`. Followed the contract; the restaurant spec's names are a
   presentation slice.
6. **Dispatch vs assignment.** P-14 models `dispatch` + `dispatch_offer`;
   `04-rider.md` models `offer` + `assignment` with a finer `AssignmentState`.
   The contract exposes **both** vocabularies (`DispatchState`,
   `DispatchOfferOutcome`, `OfferState`, `AssignmentState`), so both exist here:
   `dispatch` is the platform's routing state, `assignment` is the rider's leg,
   and `dispatch_offer` carries `state` and `outcome` with a CHECK keeping them
   consistent.
7. **Halal checklist version.** `05-admin.md` A-15 says
   `halal_checklist_version = 1`; every fixture in
   `contracts/fixtures/halal/` says `"checklist_version": 3`. Left as an
   un-defaulted `int NOT NULL` written by the application, so neither is baked
   into the schema. **This needs a decision** — the checklist version is what a
   historical approval is audited against.
8. **The halal seed fixture does not exist.** Decision S-11 cites
   `contracts/fixtures/halal/halal_issuing_bodies_seed.json` as the source for
   the three accepted bodies. That file is absent from the repository (the halal
   fixture directory has certificate and per-status body fixtures only). The
   seed takes the three names from the decision-log entry itself, which is what
   the fixture would have been generated from.
9. **Commission, three numbers.** Platform spec 20%, restaurant spec 18%, admin
   spec 15%. Decision R-01 overrides all three with **0%**, which is what
   `pricing_config` and `restaurant.commission_rate_bps` are seeded to.
10. **Rider pay.** `04-rider.md` D-26 describes a rate card with a guaranteed
    minimum; decision R-02 replaces it with pure delivery-fee pass-through. The
    columns for base/distance/wait/surge/guarantee still exist on
    `earning_entry` (the mechanism is built), seeded so the pass-through is what
    actually pays.
11. **Payout minimum.** P-19 specifies $25.00 and states it in
    `connect_account.minimum_payout_cents DEFAULT 2500`; decision R-03 says no
    minimum. Defaulted to `0`.

## Open decisions this schema is waiting on

Modelled so either answer is a data change, not a migration:

- **O-01** GST/HST supplier position — `restaurant.tax_role` carries both
  positions, and `quote_tax_line.remittable_by` posts the tax to whichever party
  the answer names.
- **O-04** refund liability allocation — `refund.restaurant_chargeback_cents` /
  `rider_chargeback_cents` / `platform_absorbed_cents` exist per reason code.
- **O-05** launch provinces — every province is a `tax_jurisdiction`; only
  Ontario has rates, so any other province fails loudly rather than quietly
  charging zero tax.
- **O-06** self-declared halal restaurants — `halal_status` distinguishes
  `CERTIFIED` / `EXPIRING_SOON` / `EXPIRED` / `UNVERIFIED`; whether `UNVERIFIED`
  is listed at all is a query-time policy.
