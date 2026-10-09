-- Platform staff who sign in to the admin console, one per staff role:
-- admin-seed (super admin) and support-seed come from 001_personas.sql,
-- ops-admin (admin) is added here. Reset sets the shared password and, when
-- HG_APP_DATA_KEY is set, enrols each authenticator (internal/devworld/staff.go).
-- Not a goose migration. Loaded after 001_personas.sql, in one transaction.

BEGIN;

INSERT INTO account (id, email, email_verified_at, status, timezone)
VALUES ('a0000000-0000-4000-8000-000000000003', 'ops-admin@seed.hg', now(), 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES ('a0000000-0000-4000-8000-000000000003', 'ADMIN', 'GLOBAL')
ON CONFLICT DO NOTHING;

-- The admin console's staff list reads staff_profile, so each staff persona
-- shows there as ACTIVE.
INSERT INTO staff_profile (account_id, full_name, department, status, status_changed_at)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Seed Super Admin', 'Platform', 'ACTIVE', now()),
  ('a0000000-0000-4000-8000-000000000003', 'Seed Operations Admin', 'Operations', 'ACTIVE', now()),
  ('a0000000-0000-4000-8000-000000000002', 'Seed Support Agent', 'Support', 'ACTIVE', now())
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO devworld_persona (slug, account_id, email, expect_email_verified, expect_password)
VALUES ('ops-admin', 'a0000000-0000-4000-8000-000000000003', 'ops-admin@seed.hg', true, true)
ON CONFLICT (slug) DO UPDATE SET
  account_id = EXCLUDED.account_id,
  email = EXCLUDED.email,
  expect_email_verified = EXCLUDED.expect_email_verified,
  expect_password = EXCLUDED.expect_password;

COMMIT;
