-- Standalone schema lint. Runs the same two checks the final migration gates
-- on, against whatever database you point it at:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lint/schema_lint.sql
--
-- Exit 0 = clean. Non-zero = a violation, named and explained.
--
-- RULE 1 — money (G-2 / P-08)
--   * every column named *_cents is BIGINT, in tables AND in views (sum(bigint)
--     returns numeric unless it is cast back, which is exactly how a float
--     sneaks into a money path);
--   * the Postgres `money` type is banned outright;
--   * numeric / double precision / real are permitted only for named
--     non-monetary uses: exact rates read into money.Rate, ratings, and GPS
--     accuracy/heading/speed sensor readings.
--
-- RULE 2 — geography (P-30 / I-30.1)
--   * exactly one location column per entity;
--   * always geography(Point,4326), never geometry and never a bare `point`;
--   * no column named `coords` — the name the legacy second location column
--     used, which disagreed with the PostGIS one and broke dispatch for every
--     normally onboarded restaurant.

\set ON_ERROR_STOP on

\echo '== money =='
SELECT table_name, column_name, data_type, rule FROM lint_money_columns();

\echo '== geography =='
SELECT table_name, detail, rule FROM lint_location_columns();

\echo '== verdict =='
SELECT assert_schema_lints();
\echo 'schema lint: clean'
