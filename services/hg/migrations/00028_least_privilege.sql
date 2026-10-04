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
--     takes a superuser.
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

-- +goose Down
-- The default privileges stay: they are the same ones 00023 sets, and when one
-- role runs both migrations, revoking them here would undo 00023's as well.
-- CREATE on `public` stays withheld from PUBLIC, as Postgres 15+ ships it.
REVOKE MAINTAIN ON river_job FROM hg_app;
