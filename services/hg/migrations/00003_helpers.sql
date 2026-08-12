-- Shared helpers: UUIDv7 row identifiers, updated_at maintenance, partition
-- management, and the two schema lints that make the money and geography rules
-- enforceable rather than aspirational.

-- +goose Up

-- G-8: primary keys are UUIDv7 (time-ordered, index-friendly). Postgres 16 has
-- no built-in generator, so this is the canonical one for the whole schema.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE AS $$
DECLARE
  ts_ms  bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  b      bytea;
BEGIN
  b := substring(int8send(ts_ms) FROM 3 FOR 6) || gen_random_bytes(10);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);   -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);   -- RFC 4122 variant
  RETURN encode(b, 'hex')::uuid;
END
$$;
-- +goose StatementEnd

-- `unaccent()` is only STABLE (it resolves a text-search dictionary at call
-- time), so it cannot appear in a generated column or an expression index. This
-- wrapper pins the dictionary and is therefore genuinely immutable for a fixed
-- dictionary. Caveat, recorded here rather than discovered later: changing the
-- unaccent dictionary requires reindexing the search columns.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION hg_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Attaches the updated_at trigger; every table with an updated_at column calls
-- this so nobody has to remember the DDL.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION attach_updated_at(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    'trg_' || replace(p_table::text, '"', '') || '_updated_at', p_table);
END
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- Partition management (realtime_event daily, audit_event / rider position
-- history monthly). Unique indexes on a partitioned table must contain the
-- partition key, so the genuinely global uniqueness constraints are created
-- per partition instead — correct because their scope never spans a partition
-- boundary (an audit day never spans two months; a channel's seq is allocated
-- monotonically from channel_cursor).
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ensure_daily_partition(p_parent text, p_day date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  part text := format('%s_p%s', p_parent, to_char(p_day, 'YYYYMMDD'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   part, p_parent, p_day, p_day + 1);
  END IF;
  RETURN part;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ensure_monthly_partition(p_parent text, p_month date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', p_month)::date;
  part text := format('%s_p%s', p_parent, to_char(start_d, 'YYYYMM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   part, p_parent, start_d, (start_d + interval '1 month')::date);
  END IF;
  RETURN part;
END
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- LINT 1 — money (G-2 / P-08).
--
-- Returns one row per violation. Empty result = the schema obeys the money
-- rules. 00023 calls it and raises, so a migration that introduces a float
-- money column cannot be applied, let alone merged.
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION lint_money_columns()
RETURNS TABLE (table_name text, column_name text, data_type text, rule text)
LANGUAGE sql STABLE AS $$
  WITH cols AS (
    SELECT c.relname::text AS tbl, a.attname::text AS col,
           format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       -- tables, partitioned tables, views and matviews: a derived money
       -- column in a view is money too, and sum(bigint) quietly returns
       -- numeric unless it is cast back.
       AND c.relkind IN ('r', 'p', 'v', 'm')
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND c.relname NOT IN ('goose_db_version')
  )
  -- (a) every *_cents column must be bigint
  SELECT tbl, col, typ,
         'money column must be BIGINT (G-2): columns named *_cents carry integer minor units'
    FROM cols
   WHERE col ~ '_cents$' AND typ <> 'bigint'
  UNION ALL
  -- (b) the `money` type is banned outright, everywhere
  SELECT tbl, col, typ,
         'the Postgres `money` type is banned outright (G-2)'
    FROM cols
   WHERE typ = 'money'
  UNION ALL
  -- (c) inexact numeric types are permitted only for named non-monetary uses:
  --     exact rates (read into money.Rate), ratings, and GPS sensor readings.
  SELECT tbl, col, typ,
         'inexact/decimal type outside the non-monetary allowlist '
         '(rates, ratings, GPS accuracy/heading/speed) — no money may touch it (G-2)'
    FROM cols
   WHERE (typ LIKE 'numeric%' OR typ IN ('double precision', 'real'))
     AND col !~ '(^|_)rate$|_ratio$|_pct$|_km$|rating|^accuracy_m$|^heading_deg$|^speed_mps$'
  UNION ALL
  -- (d) double precision and real are never acceptable for a rate either
  SELECT tbl, col, typ,
         'double precision / real are banned in every monetary path (G-2); '
         'exact rates use NUMERIC(12,8)'
    FROM cols
   WHERE typ IN ('double precision', 'real')
     AND col ~ '(^|_)rate$|_ratio$|_pct$'
$$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- LINT 2 — geography (P-30 / I-30.1).
--
-- Exactly one location column per locatable entity. Two disagreeing location
-- columns on `restaurant` is the specific defect this platform exists to not
-- repeat, so the schema refuses to hold a second one.
-- ---------------------------------------------------------------------------

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION lint_location_columns()
RETURNS TABLE (table_name text, detail text, rule text)
LANGUAGE sql STABLE AS $$
  WITH loc AS (
    SELECT c.relname::text AS tbl, a.attname::text AS col,
           format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (format_type(a.atttypid, a.atttypmod) LIKE 'geography%'
         OR format_type(a.atttypid, a.atttypmod) LIKE 'geometry%'
         OR format_type(a.atttypid, a.atttypmod) = 'point')
  )
  SELECT tbl, string_agg(col || ' ' || typ, ', ' ORDER BY col),
         'more than one location column on one entity — the split-brain defect (I-30.1)'
    FROM loc GROUP BY tbl HAVING count(*) > 1
  UNION ALL
  SELECT tbl, col || ' ' || typ,
         'location columns must be geography(Point,4326): ST_Distance/ST_DWithin '
         'in metres on the spheroid, never degrees x 111 (P-30)'
    FROM loc WHERE typ <> 'geography(Point,4326)'
  UNION ALL
  SELECT tbl, col,
         'a column named `coords` is banned by name — it is what the legacy '
         'second location column was called (I-30.1)'
    FROM loc WHERE col = 'coords'
$$;
-- +goose StatementEnd

-- Raises on any violation of either lint. Called by the final migration and by
-- lint/schema_lint.sql in CI.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION assert_schema_lints() RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v record;
  msg text := '';
  n int := 0;
BEGIN
  FOR v IN SELECT * FROM lint_money_columns() LOOP
    n := n + 1;
    msg := msg || format(E'\n  MONEY  %s.%s (%s): %s', v.table_name, v.column_name, v.data_type, v.rule);
  END LOOP;
  FOR v IN SELECT * FROM lint_location_columns() LOOP
    n := n + 1;
    msg := msg || format(E'\n  GEO    %s [%s]: %s', v.table_name, v.detail, v.rule);
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'schema lint failed with % violation(s):%', n, msg
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS assert_schema_lints();
DROP FUNCTION IF EXISTS lint_location_columns();
DROP FUNCTION IF EXISTS lint_money_columns();
DROP FUNCTION IF EXISTS ensure_monthly_partition(text, date);
DROP FUNCTION IF EXISTS ensure_daily_partition(text, date);
DROP FUNCTION IF EXISTS attach_updated_at(regclass);
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS hg_unaccent(text);
DROP FUNCTION IF EXISTS uuid_generate_v7();
