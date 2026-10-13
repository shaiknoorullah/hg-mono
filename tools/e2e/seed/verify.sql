-- Fails the seed when the world is not what the flows expect, with the reason, before any app
-- is opened. Run by tools/e2e/seed/seed.sh after world.sql and the sign-in secrets.
\set ON_ERROR_STOP on
DO $$
DECLARE
  problems text[] := '{}';
BEGIN
  IF (SELECT halal_status::text FROM restaurant WHERE id = 'e2e00000-0000-4000-8000-0000000000a1') IS DISTINCT FROM 'CERTIFIED' THEN
    problems := array_append(problems, 'Bismillah Grill is not CERTIFIED');
  END IF;
  IF (SELECT halal_status::text FROM restaurant WHERE id = 'e2e00000-0000-4000-8000-0000000000a2') IS DISTINCT FROM 'EXPIRED' THEN
    problems := array_append(problems, 'Crescent Kitchen is not EXPIRED');
  END IF;
  IF (SELECT count(*) FROM menu_item
       WHERE restaurant_id = 'e2e00000-0000-4000-8000-0000000000a1'
         AND live_version_id IS NOT NULL AND availability_state = 'AVAILABLE' AND deleted_at IS NULL) <> 3 THEN
    problems := array_append(problems, 'Bismillah Grill does not have 3 orderable dishes');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account
                  WHERE email = 'owner@bismillah-grill.e2e.halalgoes.test'
                    AND password_hash IS NOT NULL AND email_verified_at IS NOT NULL) THEN
    problems := array_append(problems, 'the restaurant owner has no password');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM account
                  WHERE email = 'admin@e2e.halalgoes.test'
                    AND password_hash IS NOT NULL AND totp_secret_enc IS NOT NULL) THEN
    problems := array_append(problems, 'the admin has no password or TOTP secret');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rider_profile rp
                   JOIN connect_account ca ON ca.owner_type = 'RIDER' AND ca.owner_id = rp.account_id
                  WHERE rp.account_id = 'e2e00000-0000-4000-8000-00000000d001'
                    AND rp.onboarding_state = 'ACTIVE' AND rp.account_status = 'ACTIVE' AND ca.payouts_enabled) THEN
    problems := array_append(problems, 'the rider is not approved with payouts set up');
  END IF;
  IF (SELECT count(*) FROM address
       WHERE account_id IN ('e2e00000-0000-4000-8000-00000000c001', 'e2e00000-0000-4000-8000-00000000c002')
         AND is_default AND deleted_at IS NULL) <> 2 THEN
    problems := array_append(problems, 'a customer has no default address');
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'the end-to-end world is not as expected: %', array_to_string(problems, '; ');
  END IF;
  RAISE NOTICE 'world verified: 2 restaurants (certified, expired), 2 customers, 1 rider, 1 admin';
END
$$;
