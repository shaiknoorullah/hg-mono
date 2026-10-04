-- The API runs as hg_app: it reads and writes rows, and nothing else.
--
-- roles/roles.sql (run by the superuser before goose) creates hg_migrator, which
-- owns the schema and runs goose, and gives hg_app a login. This migration is
-- the part that lives inside the database. Together they mean hg_app cannot:
--
--   * disable or drop a trigger, or ALTER / DROP any table — only an owner can,
--     and hg_app owns nothing. The ledger's append-only trigger and its deferred
--     zero-sum check stay on (AGENTS.md "Non-negotiable invariants": every
--     order's money decomposes to zero residual);
--   * replace a trigger function's body — that also takes ownership;
--   * CREATE anything in the schema, or TRUNCATE, or add a TRIGGER — none of
--     those privileges is granted;
--   * SET session_replication_role = replica, which skips every trigger — that
--     takes a superuser;
--   * hide a table from a trigger function behind a temporary table of the same
--     name — roles.sql withholds TEMPORARY on the database, and this migration
--     pins the search_path of the ledger and audit trigger functions so the
--     temporary schema is searched last even if that grant ever comes back.
--
-- test/run_invariant_tests.sh section 12 tries each of these as hg_app.

-- +goose Up

-- Postgres 15+ already withholds CREATE on `public` from PUBLIC; say so here so
-- the schema does not depend on the server's default.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 00023 set default privileges for whichever role ran it. On a database that
-- the superuser migrated before hg_migrator existed, that was the superuser, so
-- tables hg_migrator creates from now on would reach hg_app with no grants at
-- all. Set them for the role running goose now. Re-running them is harmless.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO hg_readonly;

-- River's maintenance loop rebuilds river_job's indexes once a day with
-- REINDEX INDEX CONCURRENTLY, which takes ownership or MAINTAIN (Postgres 17).
-- MAINTAIN allows VACUUM, ANALYZE, REINDEX, CLUSTER and LOCK on that one table.
-- It allows no DDL and does not touch triggers.
GRANT MAINTAIN ON river_job TO hg_app;

-- The trigger functions behind the ledger's zero-sum check and append-only rule
-- (00017_ledger.sql) and the audit hash chain (00021_audit.sql) name their
-- tables without a schema and run with the caller's rights. By default the
-- caller's temporary schema is searched first, so a temp table called
-- ledger_entry or audit_event would stand in for the real one. Naming pg_temp
-- last puts it after `public`.
ALTER FUNCTION ledger_assert_batch_balanced() SET search_path = public, pg_temp;
ALTER FUNCTION ledger_assert_batch_nonempty() SET search_path = public, pg_temp;
ALTER FUNCTION ledger_reject_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION audit_event_chain() SET search_path = public, pg_temp;
ALTER FUNCTION audit_reject_mutation() SET search_path = public, pg_temp;

-- +goose Down
ALTER FUNCTION audit_reject_mutation() RESET search_path;
ALTER FUNCTION audit_event_chain() RESET search_path;
ALTER FUNCTION ledger_reject_mutation() RESET search_path;
ALTER FUNCTION ledger_assert_batch_nonempty() RESET search_path;
ALTER FUNCTION ledger_assert_batch_balanced() RESET search_path;
-- The default privileges stay: they are the same ones 00023 sets, and when one
-- role runs both migrations, revoking them here would undo 00023's as well.
-- CREATE on `public` stays withheld from PUBLIC, as Postgres 15+ ships it.
REVOKE MAINTAIN ON river_job FROM hg_app;
