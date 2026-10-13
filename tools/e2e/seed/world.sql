-- The end-to-end world: the people and places the flows use, on top of the reference seed
-- (services/hg/migrations/seed). Small and fixed on purpose: every id carries the e2e00000 prefix,
-- every phone is in the +1 416 555 01xx test range, and dates are relative to today.
--
--   Bismillah Grill   LIVE, halal certificate approved (HMA Canada, expires in 200 days),
--                     open around the clock, three dishes; owner signs in by email
--   Crescent Kitchen  LIVE, but its certificate expired 7 days ago: hidden from customers
--   customer Amina    +1 416 555 0110, home 900 m north of the grill   (the Android app)
--   customer Omar     +1 416 555 0111, home 900 m south of the grill   (orders placed through the API)
--   rider Bilal       +1 416 555 0161, approved, payouts set up, offline (the Android app)
--   admin             super admin, email + password + TOTP
--
-- Passwords and the admin's TOTP secret are set afterwards through the API's own code
-- (cmd/seedpw, cmd/seedtotp), by tools/e2e/seed/seed.sh. Orders, going online and every other
-- thing that happens is done through the API by the flows, never written here.
-- One transaction: an approved certificate's seven checks are verified at commit
-- (services/hg/migrations/00009_halal.sql). Safe to run again.

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
INSERT INTO account (id, email, email_verified_at, status, timezone) VALUES
  ('e2e00000-0000-4000-8000-00000000ad01', 'admin@e2e.halalgoes.test', now(), 'ACTIVE', 'America/Toronto'),
  ('e2e00000-0000-4000-8000-00000000b001', 'owner@bismillah-grill.e2e.halalgoes.test', now(), 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account (id, phone_e164, phone_verified_at, status, timezone) VALUES
  ('e2e00000-0000-4000-8000-00000000c001', '+14165550110', now(), 'ACTIVE', 'America/Toronto'),
  ('e2e00000-0000-4000-8000-00000000c002', '+14165550111', now(), 'ACTIVE', 'America/Toronto'),
  ('e2e00000-0000-4000-8000-00000000d001', '+14165550161', now(), 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_profile (account_id, first_name, last_name) VALUES
  ('e2e00000-0000-4000-8000-00000000c001', 'Amina', 'Test'),
  ('e2e00000-0000-4000-8000-00000000c002', 'Omar', 'Test')
ON CONFLICT (account_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Restaurants. LIVE needs a location, a province and finished onboarding
-- (00008_restaurant.sql); halal_status is left to the certificate trigger.
-- ---------------------------------------------------------------------------
INSERT INTO restaurant (id, slug, legal_name, display_name, email, description, line1, city, province,
                        postal_code, location, timezone, onboarding_state, account_state,
                        is_accepting_orders, commission_rate_bps, cuisine_text, approved_at, approved_by)
VALUES
  ('e2e00000-0000-4000-8000-0000000000a1', 'bismillah-grill', 'Bismillah Grill Inc.', 'Bismillah Grill',
   'owner@bismillah-grill.e2e.halalgoes.test', 'Charcoal grill and biryani.', '100 Queen St W', 'Toronto', 'ON',
   'M5H 2N2', ST_SetSRID(ST_MakePoint(-79.3832, 43.6532), 4326)::geography, 'America/Toronto',
   'ACTIVE', 'LIVE', true, 0, 'Pakistani', now(), 'e2e00000-0000-4000-8000-00000000ad01'),
  ('e2e00000-0000-4000-8000-0000000000a2', 'crescent-kitchen', 'Crescent Kitchen Ltd.', 'Crescent Kitchen',
   NULL, 'Home-style Levantine.', '200 King St W', 'Toronto', 'ON',
   'M5H 3T4', ST_SetSRID(ST_MakePoint(-79.3870, 43.6475), 4326)::geography, 'America/Toronto',
   'ACTIVE', 'LIVE', true, 0, 'Levantine', now(), 'e2e00000-0000-4000-8000-00000000ad01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES
  ('e2e00000-0000-4000-8000-00000000ad01', 'SUPER_ADMIN', 'GLOBAL', NULL),
  ('e2e00000-0000-4000-8000-00000000b001', 'RESTAURANT_OWNER', 'RESTAURANT', 'e2e00000-0000-4000-8000-0000000000a1'),
  ('e2e00000-0000-4000-8000-00000000c001', 'CUSTOMER', 'GLOBAL', NULL),
  ('e2e00000-0000-4000-8000-00000000c002', 'CUSTOMER', 'GLOBAL', NULL),
  ('e2e00000-0000-4000-8000-00000000d001', 'RIDER', 'GLOBAL', NULL)
ON CONFLICT DO NOTHING;

-- Open around the clock (0 = Sunday). Hours have no unique key, hence NOT EXISTS.
INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
SELECT 'e2e00000-0000-4000-8000-0000000000a1', d, '00:00', '23:59'
  FROM generate_series(0, 6) AS d
 WHERE NOT EXISTS (SELECT 1 FROM restaurant_hours
                    WHERE restaurant_id = 'e2e00000-0000-4000-8000-0000000000a1');

-- Payouts set up (the fake payment client's accounts are always enabled).
INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted)
VALUES ('RESTAURANT', 'e2e00000-0000-4000-8000-0000000000a1', 'acct_e2e_bismillah', true, true, true),
       ('RIDER', 'e2e00000-0000-4000-8000-00000000d001', 'acct_e2e_rider_bilal', true, true, true)
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Halal certificates: the scanned document, the reviewed KYC record, the certificate and its
-- seven checks, all PASS. Bismillah Grill's runs 200 more days (CERTIFIED); Crescent Kitchen's
-- ended 7 days ago (EXPIRED, so customers never see it).
-- ---------------------------------------------------------------------------
INSERT INTO stored_object (id, bucket, object_key, purpose, restaurant_id, content_type, byte_size, sha256,
                           state, virus_scan_state, uploaded_by, confirmed_at)
VALUES
  ('e2e00000-0000-4000-8000-0000000001a1', 'hg-kyc',
   'RESTAURANT/e2e00000-0000-4000-8000-0000000000a1/HALAL_CERTIFICATE/e2e.pdf', 'KYC_DOCUMENT',
   'e2e00000-0000-4000-8000-0000000000a1', 'application/pdf', 2048, decode(repeat('e1', 32), 'hex'),
   'READY', 'CLEAN', 'e2e00000-0000-4000-8000-00000000ad01', now()),
  ('e2e00000-0000-4000-8000-0000000001a2', 'hg-kyc',
   'RESTAURANT/e2e00000-0000-4000-8000-0000000000a2/HALAL_CERTIFICATE/e2e.pdf', 'KYC_DOCUMENT',
   'e2e00000-0000-4000-8000-0000000000a2', 'application/pdf', 2048, decode(repeat('e2', 32), 'hex'),
   'READY', 'CLEAN', 'e2e00000-0000-4000-8000-00000000ad01', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO kyc_document (id, subject_type, subject_id, restaurant_doc_type, stored_object_id, state, issuer,
                          halal_issuing_body_id, certificate_number, issued_on, valid_until,
                          reviewed_by, reviewed_at)
SELECT v.id::uuid, 'RESTAURANT', v.restaurant_id::uuid, 'HALAL_CERTIFICATE', v.object_id::uuid, 'APPROVED', b.name,
       b.id, v.number, v.issued_on, v.expires_on, 'e2e00000-0000-4000-8000-00000000ad01', now()
  FROM (VALUES
          ('e2e00000-0000-4000-8000-0000000002a1', 'e2e00000-0000-4000-8000-0000000000a1',
           'e2e00000-0000-4000-8000-0000000001a1', 'E2E-HMA-0001', current_date - 165, current_date + 200),
          ('e2e00000-0000-4000-8000-0000000002a2', 'e2e00000-0000-4000-8000-0000000000a2',
           'e2e00000-0000-4000-8000-0000000001a2', 'E2E-HMA-0002', current_date - 372, current_date - 7)
       ) AS v(id, restaurant_id, object_id, number, issued_on, expires_on)
  JOIN halal_issuing_body b ON b.name = 'Halal Monitoring Authority (HMA Canada)' AND b.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO halal_certificate (id, restaurant_id, document_id, certificate_number, issuing_body_id,
                               certified_legal_name, certified_address, scope, issued_on, expires_on,
                               status, checklist_version, verified_by, verified_at)
SELECT v.id::uuid, d.subject_id, d.id, d.certificate_number, d.halal_issuing_body_id,
       r.legal_name, r.line1 || ', ' || r.city, 'WHOLE_ESTABLISHMENT', d.issued_on, d.valid_until,
       'APPROVED', 1, 'e2e00000-0000-4000-8000-00000000ad01', now()
  FROM (VALUES ('e2e00000-0000-4000-8000-0000000003a1', 'e2e00000-0000-4000-8000-0000000002a1'),
               ('e2e00000-0000-4000-8000-0000000003a2', 'e2e00000-0000-4000-8000-0000000002a2')
       ) AS v(id, document_id)
  JOIN kyc_document d ON d.id = v.document_id::uuid
  JOIN restaurant r ON r.id = d.subject_id
ON CONFLICT (id) DO NOTHING;

-- H5 (dates) and H7 (not reused) are computed by the server and cannot be overridden.
INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result, overridable,
                                     checked_by, checked_at)
SELECT c.id::uuid, k, 'PASS', 'PASS', k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'),
       'e2e00000-0000-4000-8000-00000000ad01', now()
  FROM (VALUES ('e2e00000-0000-4000-8000-0000000003a1'), ('e2e00000-0000-4000-8000-0000000003a2')) AS c(id)
 CROSS JOIN unnest(enum_range(NULL::halal_check_key)) AS k
ON CONFLICT (halal_certificate_id, check_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Bismillah Grill's menu: two categories, three approved, available dishes. The item comes
-- first, then its approved version, then the link (00010_menu.sql).
-- ---------------------------------------------------------------------------
INSERT INTO menu_category (id, restaurant_id, name, sort_order) VALUES
  ('e2e00000-0000-4000-8000-0000000004a1', 'e2e00000-0000-4000-8000-0000000000a1', 'Rice', 10),
  ('e2e00000-0000-4000-8000-0000000004a2', 'e2e00000-0000-4000-8000-0000000000a1', 'Grill', 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_item (id, restaurant_id, category_id, price_cents, tax_category, sort_order) VALUES
  ('e2e00000-0000-4000-8000-0000000005a1', 'e2e00000-0000-4000-8000-0000000000a1',
   'e2e00000-0000-4000-8000-0000000004a1', 1500, 'PREPARED_FOOD', 10),
  ('e2e00000-0000-4000-8000-0000000005a2', 'e2e00000-0000-4000-8000-0000000000a1',
   'e2e00000-0000-4000-8000-0000000004a2', 1200, 'PREPARED_FOOD', 10),
  ('e2e00000-0000-4000-8000-0000000005a3', 'e2e00000-0000-4000-8000-0000000000a1',
   'e2e00000-0000-4000-8000-0000000004a2', 1800, 'PREPARED_FOOD', 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_item_version (id, menu_item_id, restaurant_id, version, name, description, review_status,
                               submitted_at, reviewed_by, reviewed_at) VALUES
  ('e2e00000-0000-4000-8000-0000000006a1', 'e2e00000-0000-4000-8000-0000000005a1',
   'e2e00000-0000-4000-8000-0000000000a1', 1, 'Chicken Biryani', 'Basmati rice, slow-cooked chicken.',
   'APPROVED', now(), 'e2e00000-0000-4000-8000-00000000ad01', now()),
  ('e2e00000-0000-4000-8000-0000000006a2', 'e2e00000-0000-4000-8000-0000000005a2',
   'e2e00000-0000-4000-8000-0000000000a1', 1, 'Seekh Kebab', 'Two minced-beef skewers.',
   'APPROVED', now(), 'e2e00000-0000-4000-8000-00000000ad01', now()),
  ('e2e00000-0000-4000-8000-0000000006a3', 'e2e00000-0000-4000-8000-0000000005a3',
   'e2e00000-0000-4000-8000-0000000000a1', 1, 'Lamb Chops', 'Four chops, charcoal-grilled.',
   'APPROVED', now(), 'e2e00000-0000-4000-8000-00000000ad01', now())
ON CONFLICT (id) DO NOTHING;

UPDATE menu_item AS mi
   SET live_version_id = x.version_id::uuid, availability_state = 'AVAILABLE', out_of_stock_until = NULL
  FROM (VALUES ('e2e00000-0000-4000-8000-0000000005a1', 'e2e00000-0000-4000-8000-0000000006a1'),
               ('e2e00000-0000-4000-8000-0000000005a2', 'e2e00000-0000-4000-8000-0000000006a2'),
               ('e2e00000-0000-4000-8000-0000000005a3', 'e2e00000-0000-4000-8000-0000000006a3')
       ) AS x(item_id, version_id)
 WHERE mi.id = x.item_id::uuid;

-- ---------------------------------------------------------------------------
-- Customers' homes, about 900 m from the grill (one billable kilometre).
-- ---------------------------------------------------------------------------
INSERT INTO address (id, account_id, label, line1, city, province, postal_code, location, timezone, is_default)
VALUES
  ('e2e00000-0000-4000-8000-0000000007c1', 'e2e00000-0000-4000-8000-00000000c001', 'Home', '1 Dundas St W',
   'Toronto', 'ON', 'M5G 1Z3', ST_SetSRID(ST_MakePoint(-79.3832, 43.6613), 4326)::geography, 'America/Toronto', true),
  ('e2e00000-0000-4000-8000-0000000007c2', 'e2e00000-0000-4000-8000-00000000c002', 'Home', '200 Front St W',
   'Toronto', 'ON', 'M5V 3K2', ST_SetSRID(ST_MakePoint(-79.3832, 43.6451), 4326)::geography, 'America/Toronto', true)
ON CONFLICT (id) DO NOTHING;

UPDATE customer_profile AS cp SET default_address_id = x.address_id::uuid
  FROM (VALUES ('e2e00000-0000-4000-8000-00000000c001', 'e2e00000-0000-4000-8000-0000000007c1'),
               ('e2e00000-0000-4000-8000-00000000c002', 'e2e00000-0000-4000-8000-0000000007c2')
       ) AS x(account_id, address_id)
 WHERE cp.account_id = x.account_id::uuid AND cp.default_address_id IS NULL;

-- ---------------------------------------------------------------------------
-- The rider: approved and able to take payouts, offline with no position. The flow goes online
-- from the app, which sends the emulator's location.
-- ---------------------------------------------------------------------------
INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth, onboarding_state, account_status,
                           availability_state, is_online, approved_at, approved_by)
VALUES ('e2e00000-0000-4000-8000-00000000d001', 'Bilal', 'Test', '1996-03-14', 'ACTIVE', 'ACTIVE',
        'OFFLINE', false, now(), 'e2e00000-0000-4000-8000-00000000ad01')
ON CONFLICT (account_id) DO NOTHING;

-- halal_status depends on today's date; recompute it on every run.
SELECT halal_refresh_restaurant_status(id)
  FROM restaurant
 WHERE id IN ('e2e00000-0000-4000-8000-0000000000a1', 'e2e00000-0000-4000-8000-0000000000a2');

COMMIT;
