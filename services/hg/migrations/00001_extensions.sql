-- Extensions and database roles.
--
-- PostGIS is not optional: the previous system carried a legacy `POINT` column
-- beside a PostGIS column and dispatch read the wrong one, so every normally
-- onboarded restaurant failed rider assignment. There is one geography column
-- per locatable entity in this schema and 00025 asserts it.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Application role. `ledger_entry` and `audit_event` deliberately withhold
-- UPDATE/DELETE from this role (00019, 00023); triggers are the second layer.
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_app') THEN
    CREATE ROLE hg_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_readonly') THEN
    CREATE ROLE hg_readonly NOLOGIN;
  END IF;
END
$$;
-- +goose StatementEnd

GRANT USAGE ON SCHEMA public TO hg_app, hg_readonly;

-- +goose Down
-- Down revokes this database's grants but deliberately does NOT drop the roles.
-- Roles are cluster-wide: another database on the same cluster may hold grants
-- and default privileges referencing them, and DROP OWNED BY only reaches the
-- current database. Rolling this migration back must not reach outside the
-- database it is rolling back.
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_app') THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM hg_app';
    EXECUTE 'DROP OWNED BY hg_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_readonly') THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM hg_readonly';
    EXECUTE 'DROP OWNED BY hg_readonly';
  END IF;
END
$$;
-- +goose StatementEnd
DROP EXTENSION IF EXISTS pgcrypto;
DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
-- PostGIS is dropped only if nothing else depends on it. The postgis/postgis
-- image (compose and CI) installs postgis_topology and postgis_tiger_geocoder
-- on top of it; those are the image's, not this migration's, and for the same
-- reason as the roles above a rollback must not reach past what it created.
-- +goose StatementBegin
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_depend d
      JOIN pg_extension postgis ON postgis.oid = d.refobjid
     WHERE d.classid = 'pg_extension'::regclass
       AND d.refclassid = 'pg_extension'::regclass
       AND postgis.extname = 'postgis'
  ) THEN
    DROP EXTENSION IF EXISTS postgis;
  END IF;
END
$$;
-- +goose StatementEnd
