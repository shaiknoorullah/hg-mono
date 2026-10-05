-- The database roles: one that may change the schema, one that may only use it,
-- and one that may only watch the server.
--
--   hg_migrator  owns schema `public` and everything goose creates in it. Only
--                goose logs in as this role.
--   hg_app       the role the API logs in as. Not a superuser, not an owner, no
--                DDL. Its grants are in 00023_grants_and_lints.sql and
--                00032_least_privilege.sql; nothing else.
--   hg_monitor   for the metrics exporter: the built-in pg_monitor role and no
--                access to any table. It may log in only when
--                HG_DB_MONITOR_PASSWORD is set (the exporter is
--                https://github.com/shaiknoorullah/hg-mono/issues/65).
--
-- Why two roles: the ledger's append-only trigger and its deferred zero-sum
-- check are what make every order's money decompose to zero residual (AGENTS.md
-- "Non-negotiable invariants"). An owner or a superuser can switch both off with
-- one ALTER TABLE. The API therefore must be neither.
--
-- This file is NOT a goose migration. Roles live in the cluster, not in the
-- database, and creating them takes a superuser — which is exactly what goose no
-- longer runs as. So the Postgres superuser runs this file first, then goose runs
-- as hg_migrator. It is idempotent and runs on every `make up` (the `pgroles`
-- service in deploy/docker-compose.yml) and before every `make migrate`.
--
--   HG_DB_MIGRATOR_PASSWORD=… HG_DB_APP_PASSWORD=… [HG_DB_MONITOR_PASSWORD=…] \
--     psql "$SUPERUSER_DATABASE_URL" -v ON_ERROR_STOP=1 -f roles/roles.sql

\set ON_ERROR_STOP on
\set QUIET on
-- Re-runs are the normal case; "already exists, skipping" is not news.
SET client_min_messages = warning;

\getenv migrator_password HG_DB_MIGRATOR_PASSWORD
\getenv app_password HG_DB_APP_PASSWORD
\getenv monitor_password HG_DB_MONITOR_PASSWORD

\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'HG_DB_MIGRATOR_PASSWORD is not set'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'HG_DB_APP_PASSWORD is not set'; END $$;
\endif

-- ---------------------------------------------------------------------------
-- Roles. ALTER ROLE runs every time, so a role that someone widened by hand is
-- put back, and a changed password in .env takes effect on the next run.
-- ---------------------------------------------------------------------------
SELECT 'CREATE ROLE hg_migrator'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_migrator') \gexec
SELECT 'CREATE ROLE hg_app'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_app') \gexec
SELECT 'CREATE ROLE hg_monitor'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_monitor') \gexec
-- Created here as well as in 00001, because 00001 now runs as hg_migrator,
-- which may not create roles; its IF NOT EXISTS guard then skips.
SELECT 'CREATE ROLE hg_readonly'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_readonly') \gexec

-- Connection limits keep one role from taking every slot (production runs
-- max_connections=60, https://github.com/shaiknoorullah/hg-mono/issues/215).
-- hg_app: two replicas of HG_POSTGRES_MAX_CONNS (10 by default), doubled while a
-- rolling deploy runs old and new side by side. The superuser has no limit and
-- keeps Postgres's reserved slots for itself.
ALTER ROLE hg_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD :'migrator_password';
ALTER ROLE hg_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40 PASSWORD :'app_password';
ALTER ROLE hg_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE hg_monitor WITH NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
-- Compose passes the variable through even when .env leaves it empty.
\if :{?monitor_password}
  SELECT :'monitor_password' <> '' AS monitor_login \gset
\else
  \set monitor_login false
\endif
\if :monitor_login
  ALTER ROLE hg_monitor WITH LOGIN PASSWORD :'monitor_password';
\else
  ALTER ROLE hg_monitor WITH NOLOGIN PASSWORD NULL;
\endif
SELECT 'GRANT pg_monitor TO hg_monitor'
 WHERE NOT EXISTS (SELECT 1 FROM pg_auth_members
                    WHERE roleid = 'pg_monitor'::regrole
                      AND member = 'hg_monitor'::regrole) \gexec

-- hg_app must not inherit an owner's rights through membership.
SELECT format('REVOKE %I FROM hg_app', r.rolname)
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
 WHERE m.member = 'hg_app'::regrole \gexec

-- No temporary tables. Postgres grants TEMPORARY on every database to PUBLIC,
-- and the temporary schema is searched before `public`. A role that may create
-- a temp table called ledger_entry hides the real one from any function that
-- names the table without a schema, so the ledger's zero-sum check would sum
-- the fake rows and pass an unbalanced batch; the audit hash chain could be fed
-- a fake head the same way. Neither the API, River nor goose uses temp tables.
-- 00032_least_privilege.sql also pins those functions' search_path.
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE TEMPORARY ON DATABASE %I FROM hg_app', current_database()) \gexec

-- ---------------------------------------------------------------------------
-- Extensions need a superuser (PostGIS is not a trusted extension), so they are
-- created here; the CREATE EXTENSION IF NOT EXISTS lines in 00001 then skip.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- hg_migrator owns the schema, so goose can create in it and grant on it.
-- ---------------------------------------------------------------------------
ALTER SCHEMA public OWNER TO hg_migrator;

-- A database migrated before these roles existed has every object owned by the
-- superuser, and hg_migrator could neither alter those tables nor record a
-- migration in goose_db_version. Hand them over. On a database goose built as
-- hg_migrator this finds nothing. Extension members (spatial_ref_sys, the
-- PostGIS functions) stay with the extension.
SELECT format('ALTER %s %s OWNER TO hg_migrator',
              CASE c.relkind WHEN 'v' THEN 'VIEW'
                             WHEN 'm' THEN 'MATERIALIZED VIEW'
                             WHEN 'S' THEN 'SEQUENCE'
                             WHEN 'f' THEN 'FOREIGN TABLE'
                             WHEN 'c' THEN 'TYPE'
                             ELSE 'TABLE' END,
              c.oid::regclass)
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
   AND c.relowner <> 'hg_migrator'::regrole
   -- a sequence that belongs to a column moves with its table
   AND NOT (c.relkind = 'S' AND EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
            AND d.deptype IN ('a', 'i')))
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
            AND d.deptype = 'e') \gexec

SELECT format('ALTER TYPE %s OWNER TO hg_migrator', t.oid::regtype)
  FROM pg_type t
 WHERE t.typnamespace = 'public'::regnamespace
   AND t.typtype IN ('e', 'd', 'r')
   AND t.typowner <> 'hg_migrator'::regrole
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid
            AND d.deptype = 'e') \gexec

SELECT format('ALTER ROUTINE %s OWNER TO hg_migrator', p.oid::regprocedure)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prokind IN ('f', 'p')
   AND p.proowner <> 'hg_migrator'::regrole
   AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
            AND d.deptype = 'e') \gexec

\echo 'roles ready: hg_migrator owns schema public; hg_app may log in'
