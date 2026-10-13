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
-- Partition upkeep is DDL, and the API runs it every hour
-- (internal/partitions). The last section below gives hg_app exactly that much
-- DDL and no more: two SECURITY DEFINER functions, owned by hg_migrator, that
-- create or drop partitions of the three partitioned tables only, one whole
-- period at a time, within a bounded horizon, and never inside a table's
-- retention.
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

-- ---------------------------------------------------------------------------
-- Partition upkeep, as hg_app, without DDL rights.
--
-- internal/partitions creates partitions ahead of the clock and drops the ones
-- past retention (https://github.com/shaiknoorullah/hg-mono/issues/220).
-- Creating or dropping a partition takes ownership of its parent, which hg_app
-- must never have. These functions do it for hg_app as hg_migrator (SECURITY
-- DEFINER), and refuse anything but:
--
--   * the three partitioned tables, matched by OID: realtime_event (daily),
--     rider_position_history and audit_event (monthly);
--   * one whole UTC period per call, from one period before the oldest row the
--     table keeps up to 400 days ahead, so a caller can add a few hundred
--     partitions at most, never thousands;
--   * a drop only of partitions that end at or before now() minus the table's
--     retention, by the database's own clock: 7 days for realtime_event, 30 for
--     rider_position_history (docs/spec/01-platform.md, "P-22 — Event
--     catalogue and envelope" and "P-30 — Canonical geography schema").
--     audit_event's partitions are never dropped ("P-35 — Append-only audit
--     trail"). hg_app may DELETE the first two tables' rows anyway, so a drop
--     gives it nothing new; it may not delete audit rows, and these functions
--     keep it that way.
--
-- Each pins search_path to `public, pg_temp`. pg_catalog is searched first
-- whether named or not; naming it first would make the partition helpers in
-- 00003, which CREATE TABLE without a schema, create in pg_catalog. pg_temp is
-- named last because Postgres otherwise searches the temporary schema first.
-- Each also pins TimeZone to UTC (those helpers write their bounds as dates,
-- read in the session's zone) and DateStyle, so the bounds read back from
-- pg_get_expr() parse the same whatever the caller's session sets.
-- Identifiers are quoted with format('%I'). Only hg_app may call the two entry
-- points; hg_partition_policy is theirs alone.
-- ---------------------------------------------------------------------------

-- The allow-list. keep is the retention: no partition is dropped while it could
-- hold a row younger than that. NULL: never dropped. internal/partitions holds
-- the same list; these values are the ones that bind.
-- +goose StatementBegin
CREATE FUNCTION hg_partition_policy(parent regclass,
                                    OUT unit text, OUT step interval, OUT keep interval)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  CASE parent
    WHEN 'public.realtime_event'::regclass THEN
      unit := 'day';   step := interval '1 day';   keep := interval '7 days';
    WHEN 'public.rider_position_history'::regclass THEN
      unit := 'month'; step := interval '1 month'; keep := interval '30 days';
    WHEN 'public.audit_event'::regclass THEN
      unit := 'month'; step := interval '1 month'; keep := NULL;
    ELSE
      RAISE EXCEPTION 'partition upkeep: % is not a partitioned table it maintains', parent
        USING ERRCODE = 'insufficient_privilege';
  END CASE;
END
$$;
-- +goose StatementEnd

-- Creates parent's partition for [from_ts, to_ts), which must be one whole UTC
-- period. created is false when that partition already exists; moved counts the
-- rows taken out of the default partition and routed into the new one.
-- +goose StatementBegin
CREATE FUNCTION hg_partition_ensure(parent regclass, from_ts timestamptz, to_ts timestamptz,
                                    OUT created boolean, OUT moved bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
SET DateStyle = 'ISO, MDY'
AS $$
DECLARE
  pol     record;
  lo      timestamp := from_ts AT TIME ZONE 'UTC';
  tbl     text;  -- the parent, schema-qualified and quoted
  dflt    text;  -- its default partition, likewise; NULL when it has none
  key     text;  -- the partition key column, quoted
  scratch text;  -- where rows from the default wait while the partition is made
  waiting boolean := false;
BEGIN
  created := false;
  moved := 0;
  SELECT * INTO pol FROM hg_partition_policy(parent);  -- refuses any other table

  IF from_ts IS NULL OR to_ts IS NULL
     OR lo <> date_trunc(pol.unit, lo)
     OR to_ts AT TIME ZONE 'UTC' <> lo + pol.step THEN
    RAISE EXCEPTION 'partition upkeep: [%, %) is not one whole UTC % of %',
      from_ts, to_ts, pol.unit, parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF from_ts > now() + interval '400 days' THEN
    RAISE EXCEPTION 'partition upkeep: % starts more than 400 days ahead', from_ts
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF to_ts <= now() - coalesce(pol.keep, interval '0') - pol.step THEN
    RAISE EXCEPTION 'partition upkeep: [%, %) of % ended before the oldest row it keeps',
      from_ts, to_ts, parent
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
      SELECT 1
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
       CROSS JOIN LATERAL regexp_match(pg_get_expr(c.relpartbound, c.oid),
               '^FOR VALUES FROM \(''([^'']+)''\) TO \(''([^'']+)''\)$') AS b
       WHERE i.inhparent = parent
         AND b[1]::timestamptz = from_ts AND b[2]::timestamptz = to_ts) THEN
    RETURN;
  END IF;

  SELECT format('%I.%I', n.nspname, c.relname),
         format('%I', a.attname),
         (SELECT format('%I.%I', dn.nspname, d.relname)
            FROM pg_class d JOIN pg_namespace dn ON dn.oid = d.relnamespace
           WHERE d.oid = p.partdefid),
         format('%I.%I', n.nspname, 'hg_partition_move_' || c.relname)
    INTO tbl, key, dflt, scratch
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_partitioned_table p ON p.partrelid = c.oid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]
   WHERE c.oid = parent;

  -- A row written while no partition covered its range sits in the default and
  -- makes creating that partition fail. For a table whose rows may be removed
  -- anyway, take them out, create the partition, and put them back through the
  -- parent, which routes them into it. audit_event's rows are never moved: its
  -- create fails, and the loop's count of the default raises the alert.
  IF pol.keep IS NOT NULL AND dflt IS NOT NULL THEN
    -- Writers wait for this short transaction instead of putting a new row into
    -- the default between the move and the create.
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', tbl);
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %s >= $1 AND %s < $2)', dflt, key, key)
       INTO waiting USING from_ts, to_ts;
    IF waiting THEN
      -- A plain table, not a temporary one: roles/roles.sql withholds TEMPORARY
      -- on this database. It is created and dropped inside this transaction.
      EXECUTE format('CREATE TABLE %s (LIKE %s)', scratch, tbl);
      EXECUTE format('WITH m AS (DELETE FROM %s WHERE %s >= $1 AND %s < $2 RETURNING *)
                      INSERT INTO %s SELECT * FROM m', dflt, key, key, scratch)
        USING from_ts, to_ts;
      GET DIAGNOSTICS moved = ROW_COUNT;
    END IF;
  END IF;

  CASE parent
    WHEN 'public.realtime_event'::regclass THEN
      PERFORM realtime_event_ensure_partition(lo::date);
    WHEN 'public.rider_position_history'::regclass THEN
      PERFORM ensure_monthly_partition('rider_position_history', lo::date);
    WHEN 'public.audit_event'::regclass THEN
      PERFORM audit_event_ensure_partition(lo::date);
  END CASE;
  created := true;

  IF waiting THEN
    -- OVERRIDING SYSTEM VALUE keeps each row's own identity value.
    EXECUTE format('INSERT INTO %s OVERRIDING SYSTEM VALUE SELECT * FROM %s', tbl, scratch);
    EXECUTE format('DROP TABLE %s', scratch);
  END IF;
END
$$;
-- +goose StatementEnd

-- Drops every partition of parent that ends at or before before_ts, and returns
-- their names. before_ts may be no later than now() minus parent's retention.
-- +goose StatementBegin
CREATE FUNCTION hg_partition_drop_before(parent regclass, before_ts timestamptz)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
SET DateStyle = 'ISO, MDY'
AS $$
DECLARE
  pol  record;
  part record;
BEGIN
  SELECT * INTO pol FROM hg_partition_policy(parent);  -- refuses any other table
  IF pol.keep IS NULL THEN
    RAISE EXCEPTION 'partition upkeep: % keeps every row, so its partitions are never dropped', parent
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF before_ts IS NULL OR before_ts > now() - pol.keep THEN
    RAISE EXCEPTION 'partition upkeep: % keeps rows for %, so nothing after % may be dropped (asked: before %)',
      parent, pol.keep, now() - pol.keep, before_ts
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The default partition, and any bound that is not a plain range, does not
  -- match and is never dropped.
  FOR part IN
    SELECT n.nspname, c.relname
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL regexp_match(pg_get_expr(c.relpartbound, c.oid),
             '^FOR VALUES FROM \(''([^'']+)''\) TO \(''([^'']+)''\)$') AS b
     WHERE i.inhparent = parent
       AND b[2]::timestamptz <= before_ts
     ORDER BY b[2]::timestamptz
  LOOP
    EXECUTE format('DROP TABLE %I.%I', part.nspname, part.relname);
    RETURN NEXT part.relname;
  END LOOP;
END
$$;
-- +goose StatementEnd

-- Owned by hg_migrator, the schema's owner, so they run with its rights and no
-- more: never a superuser's, even when goose itself ran as one. A database that
-- roles/roles.sql never touched (a throwaway test database) has no hg_migrator,
-- and there the API logs in as the role that ran goose anyway.
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_migrator') THEN
    ALTER FUNCTION hg_partition_policy(regclass) OWNER TO hg_migrator;
    ALTER FUNCTION hg_partition_ensure(regclass, timestamptz, timestamptz) OWNER TO hg_migrator;
    ALTER FUNCTION hg_partition_drop_before(regclass, timestamptz) OWNER TO hg_migrator;
  END IF;
END
$$;
-- +goose StatementEnd

-- New functions are executable by PUBLIC unless revoked.
REVOKE ALL ON FUNCTION hg_partition_policy(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION hg_partition_ensure(regclass, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION hg_partition_drop_before(regclass, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hg_partition_ensure(regclass, timestamptz, timestamptz) TO hg_app;
GRANT EXECUTE ON FUNCTION hg_partition_drop_before(regclass, timestamptz) TO hg_app;

-- +goose Down
DROP FUNCTION hg_partition_drop_before(regclass, timestamptz);
DROP FUNCTION hg_partition_ensure(regclass, timestamptz, timestamptz);
DROP FUNCTION hg_partition_policy(regclass);
ALTER FUNCTION audit_reject_mutation() RESET search_path;
ALTER FUNCTION audit_event_chain() RESET search_path;
ALTER FUNCTION ledger_reject_mutation() RESET search_path;
ALTER FUNCTION ledger_assert_batch_nonempty() RESET search_path;
ALTER FUNCTION ledger_assert_batch_balanced() RESET search_path;
-- The default privileges stay: they are the same ones 00023 sets, and when one
-- role runs both migrations, revoking them here would undo 00023's as well.
-- CREATE on `public` stays withheld from PUBLIC, as Postgres 15+ ships it.
REVOKE MAINTAIN ON river_job FROM hg_app;
