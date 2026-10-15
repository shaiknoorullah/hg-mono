-- bismillah-grill's staff and dated hours overrides, so the restaurant role
-- matrix and a holiday closure can be checked locally:
--   bismillah-manager   RESTAURANT_MANAGER, ACTIVE, signs in
--   bismillah-staff     RESTAURANT_STAFF, ACTIVE, signs in
--   bismillah-invited   RESTAURANT_STAFF, INVITED, no password yet
--   bismillah-suspended RESTAURANT_STAFF, SUSPENDED, its account cannot sign in
-- Two overrides, dated from today in Toronto: opening late in 3 days and closed
-- all day in 7. internal/devworld/restaurant_staff.go verifies all of it.
-- Not a goose migration. Loaded after 001_personas.sql, in one transaction.

BEGIN;

-- Today in Toronto, the restaurant's timezone, as the halal state and the
-- hours check read it; current_date is the server's UTC date.
CREATE OR REPLACE FUNCTION devworld_staff_local_date() RETURNS date LANGUAGE sql STABLE AS $dw$
  SELECT halal_local_date('America/Toronto', now())
$dw$;

INSERT INTO account (id, email, email_verified_at, status, timezone)
VALUES
  ('a0000000-0000-4000-8000-000000000281', 'bismillah-manager@seed.hg', now(), 'ACTIVE', 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000282', 'bismillah-staff@seed.hg', now(), 'ACTIVE', 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000283', 'bismillah-invited@seed.hg', NULL, 'ACTIVE', 'America/Toronto'),
  ('a0000000-0000-4000-8000-000000000284', 'bismillah-suspended@seed.hg', now(), 'SUSPENDED', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type, scope_id, granted_by)
VALUES
  ('a0000000-0000-4000-8000-000000000281', 'RESTAURANT_MANAGER', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000208', 'a0000000-0000-4000-8000-000000000208'),
  ('a0000000-0000-4000-8000-000000000282', 'RESTAURANT_STAFF', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000208', 'a0000000-0000-4000-8000-000000000208'),
  ('a0000000-0000-4000-8000-000000000283', 'RESTAURANT_STAFF', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000208', 'a0000000-0000-4000-8000-000000000208'),
  ('a0000000-0000-4000-8000-000000000284', 'RESTAURANT_STAFF', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000208', 'a0000000-0000-4000-8000-000000000208')
ON CONFLICT DO NOTHING;

-- Created a minute apart so the staff list, oldest first, reads in this order.
INSERT INTO restaurant_staff_profile (account_id, full_name, status, created_by, created_at)
VALUES
  ('a0000000-0000-4000-8000-000000000281', 'Yusuf Karim', 'ACTIVE', 'a0000000-0000-4000-8000-000000000208', now() - interval '4 minutes'),
  ('a0000000-0000-4000-8000-000000000282', 'Layla Haddad', 'ACTIVE', 'a0000000-0000-4000-8000-000000000208', now() - interval '3 minutes'),
  ('a0000000-0000-4000-8000-000000000283', 'Omar Siddiqui', 'INVITED', 'a0000000-0000-4000-8000-000000000208', now() - interval '2 minutes'),
  ('a0000000-0000-4000-8000-000000000284', 'Sana Mirza', 'SUSPENDED', 'a0000000-0000-4000-8000-000000000208', now() - interval '1 minute')
ON CONFLICT (account_id) DO NOTHING;

-- A seed on a later day replaces the two overrides rather than adding two more.
DELETE FROM restaurant_hours_override
 WHERE restaurant_id = 'b0000000-0000-4000-8000-000000000208'
   AND reason IN ('Opening late: staff training', 'Closed: family holiday');

INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed, opens_at, closes_at, reason)
VALUES
  ('b0000000-0000-4000-8000-000000000208', devworld_staff_local_date() + 3, false, time '14:00', time '23:45', 'Opening late: staff training'),
  ('b0000000-0000-4000-8000-000000000208', devworld_staff_local_date() + 7, true, NULL, NULL, 'Closed: family holiday')
ON CONFLICT (restaurant_id, on_date) DO NOTHING;

INSERT INTO devworld_persona (slug, account_id, email, expect_email_verified, expect_password)
VALUES
  ('bismillah-manager', 'a0000000-0000-4000-8000-000000000281', 'bismillah-manager@seed.hg', true, true),
  ('bismillah-staff', 'a0000000-0000-4000-8000-000000000282', 'bismillah-staff@seed.hg', true, true),
  ('bismillah-invited', 'a0000000-0000-4000-8000-000000000283', 'bismillah-invited@seed.hg', false, false),
  ('bismillah-suspended', 'a0000000-0000-4000-8000-000000000284', 'bismillah-suspended@seed.hg', true, true)
ON CONFLICT (slug) DO UPDATE SET
  account_id = EXCLUDED.account_id,
  email = EXCLUDED.email,
  expect_email_verified = EXCLUDED.expect_email_verified,
  expect_password = EXCLUDED.expect_password;

DROP FUNCTION devworld_staff_local_date();

COMMIT;
