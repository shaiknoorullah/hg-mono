-- Personas the redesigned customer and rider apps test against
-- (https://github.com/shaiknoorullah/hg-mono/issues/708 and
-- https://github.com/shaiknoorullah/hg-mono/issues/720). Not a goose migration. Loaded after
-- 001_personas.sql, which creates devworld_persona. One transaction, and
-- idempotent like 001.
--
-- Customers (the fixed-code range, +15550100100 to +15550100199):
--   customer-suspended  SUSPENDED: cannot sign in, the "account suspended" screens
--   customer-banned     BANNED: cannot sign in, the "account banned" screens
--   customer-flagged    ACTIVE: the account `s=customer-suspend` suspends and
--                       `s=customer-reinstate` lifts, so nobody else is touched
-- No account exists on +15550100110 (devworld.UnregisteredPhone): the first-run
-- sign-in. Signing in there creates one; make dev-reset removes it.
--
-- Riders, all approved with a bicycle:
--   rider-payout        ACTIVE, with a payout account stand-in; `s=rider-earnings`
--                       gives it a completed delivery and its earnings
--   rider-history       ACTIVE; `s=rider-history` gives it a delivered and a
--                       platform-cancelled assignment
--   rider-suspended     SUSPENDED: the suspended screens
--   rider-flagged       ACTIVE: the rider `s=rider-suspend` suspends and
--                       `s=rider-reinstate` lifts
--
-- The two suspended customers and the suspended rider are written in their
-- state directly, like the suspended restaurant and bismillah-suspended in
-- 001 and 030: the owner role can, and an account state is only written by
-- the admin actions at run time. A seeded state has no history row. A state
-- reached through the admin actions has one: use the scenarios for that.
--
-- No order, payment, earning or ledger row is written here. Those come from the
-- API, through the scenarios.

BEGIN;

INSERT INTO account (id, email, phone_e164, email_verified_at, phone_verified_at, status, status_reason, timezone)
VALUES
  ('a0000000-0000-4000-8000-000000000103', NULL, '+15550100103', NULL, now(), 'SUSPENDED', 'Devworld seed: a suspended customer', 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000104', NULL, '+15550100104', NULL, now(), 'BANNED', 'Devworld seed: a banned customer', 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000105', NULL, '+15550100105', NULL, now(), 'ACTIVE', NULL, 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000156', NULL, '+15550100156', NULL, now(), 'ACTIVE', NULL, 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000157', NULL, '+15550100157', NULL, now(), 'ACTIVE', NULL, 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000158', NULL, '+15550100158', NULL, now(), 'ACTIVE', NULL, 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000159', NULL, '+15550100159', NULL, now(), 'ACTIVE', NULL, 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES
  ('a0000000-0000-4000-8000-000000000103', 'CUSTOMER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000104', 'CUSTOMER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000105', 'CUSTOMER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000156', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000157', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000158', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000159', 'RIDER', 'GLOBAL')
ON CONFLICT DO NOTHING;

INSERT INTO customer_profile (account_id, first_name, last_name)
VALUES
  ('a0000000-0000-4000-8000-000000000103', 'Suspended', 'Customer'),
  ('a0000000-0000-4000-8000-000000000104', 'Banned', 'Customer'),
  ('a0000000-0000-4000-8000-000000000105', 'Flagged', 'Customer')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO rider_profile (
  account_id, first_name, last_name, date_of_birth,
  onboarding_state, account_status, availability_state, is_online, approved_at, approved_by
) VALUES
  ('a0000000-0000-4000-8000-000000000156', 'Payout', 'Rider', '1993-08-09', 'ACTIVE', 'ACTIVE', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000157', 'History', 'Rider', '1992-11-02', 'ACTIVE', 'ACTIVE', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000158', 'Suspended', 'Rider', '1991-04-27', 'ACTIVE', 'SUSPENDED', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000159', 'Flagged', 'Rider', '1996-01-14', 'ACTIVE', 'ACTIVE', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO rider_vehicle (id, account_id, vehicle_type, is_active)
VALUES
  ('c2000000-0000-4000-8000-000000000156', 'a0000000-0000-4000-8000-000000000156', 'BICYCLE', true),
  ('c2000000-0000-4000-8000-000000000157', 'a0000000-0000-4000-8000-000000000157', 'BICYCLE', true),
  ('c2000000-0000-4000-8000-000000000158', 'a0000000-0000-4000-8000-000000000158', 'BICYCLE', true),
  ('c2000000-0000-4000-8000-000000000159', 'a0000000-0000-4000-8000-000000000159', 'BICYCLE', true)
ON CONFLICT (id) DO NOTHING;

-- A payout account stand-in for rider-payout, like rider-sim-2's: not a real
-- Stripe account (the local fake gateway never calls Stripe).
INSERT INTO connect_account (
  id, owner_type, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted
) VALUES (
  'c1000000-0000-4000-8000-000000000156', 'RIDER', 'a0000000-0000-4000-8000-000000000156',
  'acct_test_devworld_riderpayout', true, true, true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO devworld_persona (
  slug, account_id, restaurant_id, email, phone_e164,
  expect_email_verified, expect_password,
  expect_onboarding, expect_account_state, expect_halal, expect_accepting,
  expect_rider_onboarding, expect_rider_availability, expect_rider_status
) VALUES
  ('customer-suspended', 'a0000000-0000-4000-8000-000000000103', NULL, NULL, '+15550100103', NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('customer-banned', 'a0000000-0000-4000-8000-000000000104', NULL, NULL, '+15550100104', NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('customer-flagged', 'a0000000-0000-4000-8000-000000000105', NULL, NULL, '+15550100105', NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('rider-payout', 'a0000000-0000-4000-8000-000000000156', NULL, NULL, '+15550100156', NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'ACTIVE'),
  ('rider-history', 'a0000000-0000-4000-8000-000000000157', NULL, NULL, '+15550100157', NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'ACTIVE'),
  ('rider-suspended', 'a0000000-0000-4000-8000-000000000158', NULL, NULL, '+15550100158', NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'SUSPENDED'),
  ('rider-flagged', 'a0000000-0000-4000-8000-000000000159', NULL, NULL, '+15550100159', NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'ACTIVE')
ON CONFLICT (slug) DO UPDATE SET
  account_id = EXCLUDED.account_id,
  phone_e164 = EXCLUDED.phone_e164,
  expect_rider_onboarding = EXCLUDED.expect_rider_onboarding,
  expect_rider_availability = EXCLUDED.expect_rider_availability,
  expect_rider_status = EXCLUDED.expect_rider_status;

COMMIT;
