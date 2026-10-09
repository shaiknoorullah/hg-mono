-- The second active rider for the offer scenarios (offer-reject,
-- offer-ignored, offer-race; issue #684). Not a goose migration. ApplyPersonas
-- loads it after 001_personas.sql, which creates devworld_persona. One
-- transaction, and idempotent like 001.
--
-- rider-sim-2 is rider-sim's twin: ACTIVE, a bicycle, a payout account
-- stand-in that is not a real Stripe account, and offline until a scenario
-- puts it online. Its phone is in the local fixed-code range, below the
-- numbers onboard-rider signs up with (+15550100160 to 199).

BEGIN;

INSERT INTO account (id, email, phone_e164, email_verified_at, phone_verified_at, status, timezone)
VALUES ('a0000000-0000-4000-8000-000000000155', NULL, '+15550100155', NULL, now(), 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES ('a0000000-0000-4000-8000-000000000155', 'RIDER', 'GLOBAL')
ON CONFLICT DO NOTHING;

INSERT INTO rider_profile (
  account_id, first_name, last_name, date_of_birth,
  onboarding_state, account_status, availability_state, is_online, approved_at, approved_by
) VALUES (
  'a0000000-0000-4000-8000-000000000155', 'Second', 'Rider', '1995-03-20',
  'ACTIVE', 'ACTIVE', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO rider_vehicle (id, account_id, vehicle_type, is_active)
VALUES ('c2000000-0000-4000-8000-000000000155', 'a0000000-0000-4000-8000-000000000155', 'BICYCLE', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO connect_account (
  id, owner_type, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted
) VALUES (
  'c1000000-0000-4000-8000-000000000155', 'RIDER', 'a0000000-0000-4000-8000-000000000155',
  'acct_test_devworld_ridersim2', true, true, true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO devworld_persona (
  slug, account_id, restaurant_id, email, phone_e164,
  expect_email_verified, expect_password,
  expect_onboarding, expect_account_state, expect_halal, expect_accepting,
  expect_rider_onboarding, expect_rider_availability, expect_rider_status
) VALUES (
  'rider-sim-2', 'a0000000-0000-4000-8000-000000000155', NULL, NULL, '+15550100155',
  NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'ACTIVE'
)
ON CONFLICT (slug) DO UPDATE SET
  account_id = EXCLUDED.account_id,
  phone_e164 = EXCLUDED.phone_e164,
  expect_rider_onboarding = EXCLUDED.expect_rider_onboarding,
  expect_rider_availability = EXCLUDED.expect_rider_availability,
  expect_rider_status = EXCLUDED.expect_rider_status;

COMMIT;
