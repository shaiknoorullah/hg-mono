-- Grants, the append-only REVOKEs, and the schema lints as a migration gate.
--
-- This migration is deliberately last. It runs the money and geography lints
-- against the finished schema and RAISES on any violation, so a migration that
-- introduces `numeric` money or a second location column fails at apply time —
-- not at review time, and not in production.

-- +goose Up

-- Default grants for the application role.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hg_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hg_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO hg_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hg_readonly;

-- I-13.6 / I-35.1 — the financial and audit records are append-only at the
-- privilege level, not merely by convention. The triggers in 00017/00021 are
-- the second layer; this is the first.
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entry FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_batch FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON order_transition FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON assignment_transition FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON restaurant_onboarding_transition FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON rider_availability_event FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON deadline_audit FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_chain_seal FROM hg_app;

-- A payout run stamps payout_id on the entries it claims; that single column is
-- the only mutation the ledger permits (guarded by the trigger in 00018).
GRANT UPDATE (payout_id) ON ledger_entry TO hg_app;
-- Retention/PIPEDA tombstoning nulls the payloads and sets redacted_at only.
GRANT UPDATE (before, after, redacted_at) ON audit_event TO hg_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO hg_readonly;

-- =========================================================================
-- The gate. Money columns and location columns, checked against the finished
-- schema. Any violation aborts the migration.
-- =========================================================================
SELECT assert_schema_lints();

-- +goose Down
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM hg_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM hg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM hg_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hg_readonly;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM hg_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hg_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hg_app;
