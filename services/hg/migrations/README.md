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
  roles/roles.sql    the database roles; the superuser runs it before goose
  seed/              launch data — tax table, halal issuing bodies, fee config
  lint/schema_lint.sql   the money + geography lints, runnable standalone
  test/              invariant tests: @N@ assertions about what the DB refuses
  tools/             contract-enum generator and checker
```

## Running

```sh
export DATABASE_URL='postgres://hg:hg@localhost:5432/hg?sslmode=disable'   # the superuser
export HG_DB_MIGRATOR_PASSWORD=migrator HG_DB_APP_PASSWORD=app

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f roles/roles.sql    # as the superuser
goose -dir . postgres 'postgres://hg_migrator:migrator@localhost:5432/hg?sslmode=disable' up
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/seed.sql
./test/run_invariant_tests.sh
```

`make up` and `make migrate` in `services/hg` do the same through compose: the
`pgroles` service runs [`roles/roles.sql`](roles/roles.sql) first.

### Who connects as whom

| Role | Logs in | May |
|---|---|---|
| the Postgres superuser (`POSTGRES_USER`) | only to run [`roles/roles.sql`](roles/roles.sql), the seed and the tests | everything |
| `hg_migrator` | goose | own schema `public` and everything in it; no superuser, no roles, no databases |
| `hg_app` | the API (`HG_POSTGRES_DSN`) | read and write rows. No DDL, no `TRUNCATE`, no `TRIGGER`, owns nothing, cannot set `session_replication_role`. Partition upkeep only through `hg_partition_ensure` and `hg_partition_drop_before` (below) |

Two roles because an owner or a superuser can switch the ledger's append-only
trigger and its zero-sum check off with one `ALTER TABLE … DISABLE TRIGGER`.
The API is neither, so it cannot. Roles live in the cluster, not the database,
and creating them takes a superuser, so `roles/roles.sql` is a plain `psql`
script and not a goose migration; the in-database half is
[`00032_least_privilege.sql`](00032_least_privilege.sql).

A full rollback (`goose … reset`) runs as the superuser: `00001`'s down drops
extensions and the roles' grants, which `hg_migrator` may not do.

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
| 2 | A non-terminal order carries a deadline and an action; a terminal one carries neither. | `order_deadline_required` CHECK on `"order"`, `dispatch_deadline_required` on `dispatch`, and the same shape on `payment_intent`, `refund`, `payout`, `kyc_document`, `stored_object`, `webhook_event` and `chargeback` (on its evidence deadline until Stripe closes the dispute, `00034`). A Stripe webhook set aside after eight failed attempts is the one unprocessed row with no clock: it must carry the error that put it there, and it paged on-call when it was set aside (`00034`, [#231](https://github.com/shaiknoorullah/hg-mono/issues/231)). "An order waits forever" is unrepresentable, not merely unlikely. |
| 3 | Every ledger batch sums to zero; `ledger_entry` is append-only. | Deferred constraint trigger `ledger_entry_batch_balanced` (fires at COMMIT, so rows may be written in any order) + `REVOKE UPDATE, DELETE, TRUNCATE` from `hg_app` + a `BEFORE UPDATE OR DELETE` trigger. Corrections are new `ADJUSTMENT` batches. |
| 4 | The decomposition invariant is one query returning zero rows. | `SELECT * FROM ledger_order_residual;` — plus `ledger_batch_imbalance`, `ledger_global_residual`, `ledger_charge_identity_breach`, `ledger_tip_passthrough_breach`, and `assert_ledger_invariants()` which raises on any of them. |
| 5 | The audit log is append-only and hash-chained, written in the same transaction as the change. | `audit_event_chain()` computes `seq`, `prev_hash` and `hash = sha256(prev_hash ‖ canonical_json(row))` in a `BEFORE INSERT` trigger — the application supplies none of them and cannot forge them. `verify_audit_chain(day)` returns the first broken link. |
| 6 | One canonical location column per entity, `geography(Point,4326)`, with the GiST indexes dispatch needs. | `lint_location_columns()`. A second location column, a `geometry`, a bare `point`, or a column named `coords` all fail the gate. |
| 7 | A rider's uploaded file is attached once per document type, so two attaches of one file at once cannot make two review items ([#229](https://github.com/shaiknoorullah/hg-mono/issues/229)). | `kyc_document_rider_file_once` unique index (`00038`) on rider, document type and file, over rows that are not soft-deleted. The attach inserts with `ON CONFLICT` on it and returns the existing row. |
| 8 | The API cannot switch any of the above off. | The API logs in as `hg_app`, which owns nothing and holds no `TRUNCATE`, `TRIGGER`, `CREATE` or `TEMPORARY` privilege (a temp table named `ledger_entry` would otherwise hide the real one from the zero-sum check); the ledger and audit trigger functions search `public` before the temporary schema; `hg_migrator` owns the schema ([`roles/roles.sql`](roles/roles.sql), `00032`). The hourly partition upkeep, the API's only DDL, goes through two `SECURITY DEFINER` functions owned by `hg_migrator` (`hg_partition_ensure`, `hg_partition_drop_before`, also `00032`): only the three partitioned tables, one whole UTC period per call, at most 400 days ahead, never a drop inside a table's retention by the database's clock, and never an `audit_event` partition. Section 12 of the invariant tests tries each way out as `hg_app`. |
| 9 | A refund moves money only once a named member of staff approved it, and a goodwill refund above CAD 50 only once a second person did. A refund recorded as at Stripe carries Stripe's id. | `refund_money_needs_approver`, `refund_goodwill_second_approver` ([goodwill approval decision](../../../docs/decisions/README.md#settled--redesign-decisions-owner-2026-09-28)), `refund_at_stripe_has_id` and `refund_approval_names_role` CHECKs on `refund` (`00035`, [#318](https://github.com/shaiknoorullah/hg-mono/issues/318)). A customer's request and an approval request carry no approver, so the refund sender can never send one. |

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
- **Tested**: 93 invariant assertions pass (`test/run_invariant_tests.sh`).
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
