-- Local personas for `devworld reset`. Not a goose migration.
-- make migrate, the deploy, and the test suites do not load this file.
-- One transaction so a certificate and its seven checks commit together.
-- Halal display is left to the certificate trigger. Nothing here writes it.

BEGIN;

CREATE TABLE IF NOT EXISTS devworld_persona (
  slug text PRIMARY KEY,
  account_id uuid NOT NULL,
  restaurant_id uuid,
  email citext,
  phone_e164 text,
  expect_email_verified boolean,
  expect_password boolean NOT NULL,
  expect_onboarding text,
  expect_account_state text,
  expect_halal text,
  expect_accepting boolean,
  expect_rider_onboarding text,
  expect_rider_availability text,
  expect_rider_status text
);

CREATE OR REPLACE FUNCTION devworld_account(p_id uuid, p_email text, p_phone text, p_verified boolean)
RETURNS void LANGUAGE plpgsql AS $dw$
BEGIN
  INSERT INTO account (id, email, phone_e164, email_verified_at, phone_verified_at, status, timezone)
  VALUES (
    p_id,
    p_email,
    p_phone,
    CASE WHEN p_email IS NOT NULL AND p_verified THEN now() END,
    CASE WHEN p_phone IS NOT NULL THEN now() END,
    'ACTIVE',
    'America/Toronto'
  )
  ON CONFLICT (id) DO NOTHING;
END
$dw$;

CREATE OR REPLACE FUNCTION devworld_restaurant(
  p_id uuid,
  p_slug text,
  p_legal text,
  p_display text,
  p_email text,
  p_onboarding restaurant_onboarding_state,
  p_account restaurant_account_state,
  p_accepting boolean,
  p_pause timestamptz,
  p_address boolean
) RETURNS void LANGUAGE plpgsql AS $dw$
BEGIN
  INSERT INTO restaurant (
    id, slug, legal_name, display_name, email,
    line1, city, province, postal_code, location, timezone,
    onboarding_state, account_state, is_accepting_orders, pause_until, last_heartbeat_at,
    approved_at, approved_by
  ) VALUES (
    p_id, p_slug, p_legal, p_display, p_email,
    CASE WHEN p_address THEN '1240 Danforth Avenue' END,
    CASE WHEN p_address THEN 'Toronto' END,
    CASE WHEN p_address THEN 'ON'::province END,
    CASE WHEN p_address THEN 'M4J 1M6' END,
    CASE WHEN p_address THEN ST_SetSRID(ST_MakePoint(-79.3310, 43.6815), 4326)::geography END,
    'America/Toronto',
    p_onboarding, p_account, p_accepting, p_pause,
    CASE WHEN p_accepting THEN now() END,
    CASE WHEN p_onboarding = 'ACTIVE' THEN now() END,
    CASE WHEN p_onboarding = 'ACTIVE' THEN 'a0000000-0000-4000-8000-000000000001'::uuid END
  )
  ON CONFLICT (id) DO NOTHING;
END
$dw$;

-- The approval trigger only requires seven PASS rows. Date display is computed
-- by the refresh trigger from expires_on, including a certificate that has
-- already passed its expiry date.
CREATE OR REPLACE FUNCTION devworld_certificate(
  p_cert uuid,
  p_doc uuid,
  p_obj uuid,
  p_restaurant uuid,
  p_number text,
  p_legal text,
  p_address text,
  p_expires date,
  p_admin uuid
) RETURNS void LANGUAGE plpgsql AS $dw$
DECLARE
  body uuid;
BEGIN
  SELECT id INTO body
    FROM halal_issuing_body
   WHERE status = 'ACCEPTED' AND deleted_at IS NULL
   ORDER BY name
   LIMIT 1;
  IF body IS NULL THEN
    RAISE EXCEPTION 'devworld: no accepted issuing body; the reference seed is missing';
  END IF;

  INSERT INTO stored_object (
    id, bucket, object_key, purpose, owner_account_id, restaurant_id,
    content_type, byte_size, sha256, state, virus_scan_state, uploaded_by, confirmed_at
  ) VALUES (
    p_obj, 'hg-kyc', 'devworld/' || p_number || '.pdf', 'KYC_DOCUMENT', p_admin, p_restaurant,
    'application/pdf', 1024, sha256(p_cert::text::bytea), 'READY', 'CLEAN', p_admin, now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO kyc_document (
    id, subject_type, subject_id, restaurant_doc_type, stored_object_id,
    halal_issuing_body_id, certificate_number, issued_on, valid_until,
    state, reviewed_by, reviewed_at
  ) VALUES (
    p_doc, 'RESTAURANT', p_restaurant, 'HALAL_CERTIFICATE', p_obj,
    body, p_number, current_date - 40, p_expires,
    'APPROVED', p_admin, now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO halal_certificate (
    id, restaurant_id, document_id, certificate_number, issuing_body_id,
    certified_legal_name, certified_address, scope, issued_on, expires_on,
    status, checklist_version, verified_by, verified_at
  ) VALUES (
    p_cert, p_restaurant, p_doc, p_number, body,
    p_legal, p_address, 'WHOLE_ESTABLISHMENT', current_date - 40, p_expires,
    'APPROVED', 1, p_admin, now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO halal_certificate_check (
    halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at
  )
  SELECT p_cert, k::halal_check_key, 'PASS', 'PASS',
         k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'),
         p_admin, now()
    FROM unnest(ARRAY[
      'H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH',
      'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED'
    ]) AS k
  ON CONFLICT DO NOTHING;
END
$dw$;

SELECT devworld_account('a0000000-0000-4000-8000-000000000001', 'admin-seed@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000002', 'support-seed@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000101', NULL, '+15550100101', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000102', NULL, '+15550100102', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000151', NULL, '+15550100151', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000152', NULL, '+15550100152', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000153', NULL, '+15550100153', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000154', NULL, '+15550100154', false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000201', 'fresh@seed.hg', NULL, false);
SELECT devworld_account('a0000000-0000-4000-8000-000000000202', 'profile@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000203', 'docs-todo@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000204', 'docs-review@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000205', 'docs-rejected@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000206', 'payout@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000207', 'menu@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000208', 'bismillah-grill@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000209', 'expiring-halal@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000210', 'expired-halal@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000211', 'paused@seed.hg', NULL, true);
SELECT devworld_account('a0000000-0000-4000-8000-000000000212', 'suspended@seed.hg', NULL, true);

INSERT INTO account_role (account_id, role, scope_type)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'SUPER_ADMIN', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000002', 'SUPPORT_AGENT', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000101', 'CUSTOMER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000102', 'CUSTOMER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000151', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000152', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000153', 'RIDER', 'GLOBAL'),
  ('a0000000-0000-4000-8000-000000000154', 'RIDER', 'GLOBAL')
ON CONFLICT DO NOTHING;

INSERT INTO customer_profile (account_id, first_name, last_name)
VALUES
  ('a0000000-0000-4000-8000-000000000101', 'Amina', 'Rahman'),
  ('a0000000-0000-4000-8000-000000000102', 'Nour', 'Hassan')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO address (id, account_id, label, line1, city, province, postal_code, location, timezone, is_default)
VALUES (
  'c0000000-0000-4000-8000-000000000101',
  'a0000000-0000-4000-8000-000000000101',
  'Home', '1250 Danforth Avenue', 'Toronto', 'ON', 'M4J 1N2',
  ST_SetSRID(ST_MakePoint(-79.3300, 43.6825), 4326)::geography,
  'America/Toronto', true
)
ON CONFLICT (id) DO NOTHING;

UPDATE customer_profile
   SET default_address_id = 'c0000000-0000-4000-8000-000000000101'
 WHERE account_id = 'a0000000-0000-4000-8000-000000000101'
   AND default_address_id IS NULL;

SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000201', 'fresh', 'Devworld Fresh Inc.', 'Devworld Fresh', 'fresh@seed.hg', 'REGISTERED', 'PENDING', false, NULL, false);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000202', 'profile', 'Devworld Profile Inc.', 'Devworld Profile', 'profile@seed.hg', 'PROFILE_PENDING', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000203', 'docs-todo', 'Devworld Docs Todo Inc.', 'Devworld Docs Todo', 'docs-todo@seed.hg', 'DOCUMENTS_PENDING', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000204', 'docs-review', 'Devworld Docs Review Inc.', 'Devworld Docs Review', 'docs-review@seed.hg', 'DOCUMENTS_REVIEW', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000205', 'docs-rejected', 'Devworld Docs Rejected Inc.', 'Devworld Docs Rejected', 'docs-rejected@seed.hg', 'DOCUMENTS_REJECTED', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000206', 'payout', 'Devworld Payout Inc.', 'Devworld Payout', 'payout@seed.hg', 'PAYOUT_PENDING', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000207', 'menu', 'Devworld Menu Inc.', 'Devworld Menu', 'menu@seed.hg', 'MENU_PENDING', 'PENDING', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000208', 'bismillah-grill', 'Bismillah Grill Inc.', 'Bismillah Grill', 'bismillah-grill@seed.hg', 'ACTIVE', 'LIVE', true, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000209', 'expiring-halal', 'Devworld Expiring Inc.', 'Devworld Expiring', 'expiring-halal@seed.hg', 'ACTIVE', 'LIVE', true, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000210', 'expired-halal', 'Devworld Expired Inc.', 'Devworld Expired', 'expired-halal@seed.hg', 'ACTIVE', 'LIVE', false, NULL, true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000211', 'paused', 'Devworld Paused Inc.', 'Devworld Paused', 'paused@seed.hg', 'ACTIVE', 'LIVE', false, now() + interval '2 days', true);
SELECT devworld_restaurant('b0000000-0000-4000-8000-000000000212', 'suspended', 'Devworld Suspended Inc.', 'Devworld Suspended', 'suspended@seed.hg', 'ACTIVE', 'SUSPENDED', false, NULL, true);

INSERT INTO account_role (account_id, role, scope_type, scope_id)
SELECT m.account_id, 'RESTAURANT_OWNER', 'RESTAURANT', m.restaurant_id
  FROM (VALUES
    ('a0000000-0000-4000-8000-000000000201'::uuid, 'b0000000-0000-4000-8000-000000000201'::uuid),
    ('a0000000-0000-4000-8000-000000000202'::uuid, 'b0000000-0000-4000-8000-000000000202'::uuid),
    ('a0000000-0000-4000-8000-000000000203'::uuid, 'b0000000-0000-4000-8000-000000000203'::uuid),
    ('a0000000-0000-4000-8000-000000000204'::uuid, 'b0000000-0000-4000-8000-000000000204'::uuid),
    ('a0000000-0000-4000-8000-000000000205'::uuid, 'b0000000-0000-4000-8000-000000000205'::uuid),
    ('a0000000-0000-4000-8000-000000000206'::uuid, 'b0000000-0000-4000-8000-000000000206'::uuid),
    ('a0000000-0000-4000-8000-000000000207'::uuid, 'b0000000-0000-4000-8000-000000000207'::uuid),
    ('a0000000-0000-4000-8000-000000000208'::uuid, 'b0000000-0000-4000-8000-000000000208'::uuid),
    ('a0000000-0000-4000-8000-000000000209'::uuid, 'b0000000-0000-4000-8000-000000000209'::uuid),
    ('a0000000-0000-4000-8000-000000000210'::uuid, 'b0000000-0000-4000-8000-000000000210'::uuid),
    ('a0000000-0000-4000-8000-000000000211'::uuid, 'b0000000-0000-4000-8000-000000000211'::uuid),
    ('a0000000-0000-4000-8000-000000000212'::uuid, 'b0000000-0000-4000-8000-000000000212'::uuid)
  ) AS m(account_id, restaurant_id)
ON CONFLICT DO NOTHING;

INSERT INTO rider_profile (
  account_id, first_name, last_name, date_of_birth,
  onboarding_state, account_status, availability_state, is_online, approved_at, approved_by
) VALUES
  ('a0000000-0000-4000-8000-000000000151', 'Sim', 'Rider', '1994-06-15', 'ACTIVE', 'ACTIVE', 'OFFLINE', false, now(), 'a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000152', 'Review', 'Rider', '1994-06-15', 'DOCUMENTS_REVIEW', 'PENDING', 'OFFLINE', false, NULL, NULL),
  ('a0000000-0000-4000-8000-000000000153', 'Rejected', 'Rider', '1994-06-15', 'DOCUMENTS_REJECTED', 'PENDING', 'OFFLINE', false, NULL, NULL),
  ('a0000000-0000-4000-8000-000000000154', 'Registered', 'Rider', '1994-06-15', 'REGISTERED', 'PENDING', 'OFFLINE', false, NULL, NULL)
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO rider_vehicle (id, account_id, vehicle_type, is_active)
VALUES ('c2000000-0000-4000-8000-000000000151', 'a0000000-0000-4000-8000-000000000151', 'BICYCLE', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stored_object (
  id, bucket, object_key, purpose, owner_account_id, content_type, byte_size, sha256,
  state, virus_scan_state, uploaded_by, confirmed_at
) VALUES
  ('d0000000-0000-4000-8000-000000000152', 'hg-kyc', 'devworld/rider-docs.pdf', 'KYC_DOCUMENT', 'a0000000-0000-4000-8000-000000000152', 'application/pdf', 1024, sha256('rider-docs'::bytea), 'READY', 'CLEAN', 'a0000000-0000-4000-8000-000000000001', now()),
  ('d0000000-0000-4000-8000-000000000153', 'hg-kyc', 'devworld/rider-rejected.pdf', 'KYC_DOCUMENT', 'a0000000-0000-4000-8000-000000000153', 'application/pdf', 1024, sha256('rider-rejected'::bytea), 'READY', 'CLEAN', 'a0000000-0000-4000-8000-000000000001', now()),
  ('d0000000-0000-4000-8000-000000000204', 'hg-kyc', 'devworld/docs-review.pdf', 'KYC_DOCUMENT', 'a0000000-0000-4000-8000-000000000204', 'application/pdf', 1024, sha256('docs-review'::bytea), 'READY', 'CLEAN', 'a0000000-0000-4000-8000-000000000001', now()),
  ('d0000000-0000-4000-8000-000000000205', 'hg-kyc', 'devworld/docs-rejected.pdf', 'KYC_DOCUMENT', 'a0000000-0000-4000-8000-000000000205', 'application/pdf', 1024, sha256('docs-rejected'::bytea), 'READY', 'CLEAN', 'a0000000-0000-4000-8000-000000000001', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO kyc_document (
  id, subject_type, subject_id, rider_doc_type, stored_object_id, state, deadline_at, deadline_action
) VALUES (
  'd0000000-0000-4000-8000-000000000252', 'RIDER', 'a0000000-0000-4000-8000-000000000152',
  'GOVERNMENT_ID', 'd0000000-0000-4000-8000-000000000152', 'IN_REVIEW', now() + interval '72 hours', 'ESCALATE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO kyc_document (
  id, subject_type, subject_id, rider_doc_type, stored_object_id, state,
  reviewed_by, reviewed_at, rejection_reason_code
) VALUES (
  'd0000000-0000-4000-8000-000000000253', 'RIDER', 'a0000000-0000-4000-8000-000000000153',
  'GOVERNMENT_ID', 'd0000000-0000-4000-8000-000000000153', 'REJECTED',
  'a0000000-0000-4000-8000-000000000001', now(), 'ILLEGIBLE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO kyc_document (
  id, subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action
) VALUES (
  'd0000000-0000-4000-8000-000000000304', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000204',
  'BUSINESS_LICENCE', 'd0000000-0000-4000-8000-000000000204', 'IN_REVIEW', now() + interval '72 hours', 'ESCALATE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO kyc_document (
  id, subject_type, subject_id, restaurant_doc_type, stored_object_id, state,
  reviewed_by, reviewed_at, rejection_reason_code
) VALUES (
  'd0000000-0000-4000-8000-000000000305', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000205',
  'BUSINESS_LICENCE', 'd0000000-0000-4000-8000-000000000205', 'REJECTED',
  'a0000000-0000-4000-8000-000000000001', now(), 'ILLEGIBLE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurant_application (restaurant_id, submission_count, submitted_at, sla_due_at)
VALUES ('b0000000-0000-4000-8000-000000000204', 1, now(), now() + interval '72 hours')
ON CONFLICT (restaurant_id) DO NOTHING;

INSERT INTO restaurant_application (
  restaurant_id, submission_count, submitted_at, decision, reject_reason_code, decided_by, decided_at
) VALUES (
  'b0000000-0000-4000-8000-000000000205', 1, now() - interval '1 day',
  'REJECT', 'DOCUMENTS_INSUFFICIENT', 'a0000000-0000-4000-8000-000000000001', now()
)
ON CONFLICT (restaurant_id) DO NOTHING;

SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000206', 'd0000000-0000-4000-8000-000000000306', 'd0000000-0000-4000-8000-000000000406',
  'b0000000-0000-4000-8000-000000000206', 'DW-PAYOUT-0001', 'Devworld Payout Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 400, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000207', 'd0000000-0000-4000-8000-000000000307', 'd0000000-0000-4000-8000-000000000407',
  'b0000000-0000-4000-8000-000000000207', 'DW-MENU-0001', 'Devworld Menu Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 400, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000208', 'd0000000-0000-4000-8000-000000000308', 'd0000000-0000-4000-8000-000000000408',
  'b0000000-0000-4000-8000-000000000208', 'DW-BISMILLAH-0001', 'Bismillah Grill Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 400, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000209', 'd0000000-0000-4000-8000-000000000309', 'd0000000-0000-4000-8000-000000000409',
  'b0000000-0000-4000-8000-000000000209', 'DW-EXPIRING-0001', 'Devworld Expiring Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 1, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000210', 'd0000000-0000-4000-8000-000000000310', 'd0000000-0000-4000-8000-000000000410',
  'b0000000-0000-4000-8000-000000000210', 'DW-EXPIRED-0001', 'Devworld Expired Inc.', '1240 Danforth Avenue, Toronto',
  current_date - 1, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000211', 'd0000000-0000-4000-8000-000000000311', 'd0000000-0000-4000-8000-000000000411',
  'b0000000-0000-4000-8000-000000000211', 'DW-PAUSED-0001', 'Devworld Paused Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 400, 'a0000000-0000-4000-8000-000000000001');
SELECT devworld_certificate(
  'd0000000-0000-4000-8000-000000000212', 'd0000000-0000-4000-8000-000000000312', 'd0000000-0000-4000-8000-000000000412',
  'b0000000-0000-4000-8000-000000000212', 'DW-SUSPENDED-0001', 'Devworld Suspended Inc.', '1240 Danforth Avenue, Toronto',
  current_date + 400, 'a0000000-0000-4000-8000-000000000001');

INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
SELECT r.id, d, time '00:00', time '23:45'
  FROM restaurant r
  CROSS JOIN generate_series(0, 6) AS d
 WHERE r.id IN (
   'b0000000-0000-4000-8000-000000000208',
   'b0000000-0000-4000-8000-000000000209',
   'b0000000-0000-4000-8000-000000000210',
   'b0000000-0000-4000-8000-000000000211'
 )
   AND NOT EXISTS (
     SELECT 1 FROM restaurant_hours h
      WHERE h.restaurant_id = r.id AND h.day_of_week = d
   );

INSERT INTO menu_category (id, restaurant_id, name, sort_order)
VALUES
  ('e0000000-0000-4000-8000-000000000207', 'b0000000-0000-4000-8000-000000000207', 'Drafts', 1),
  ('e0000000-0000-4000-8000-000000000208', 'b0000000-0000-4000-8000-000000000208', 'Mains', 1),
  ('e0000000-0000-4000-8000-000000000209', 'b0000000-0000-4000-8000-000000000209', 'Mains', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_item (id, restaurant_id, category_id, price_cents, tax_category, sort_order)
VALUES
  ('f0000000-0000-4000-8000-000000000271', 'b0000000-0000-4000-8000-000000000207', 'e0000000-0000-4000-8000-000000000207', 1200, 'PREPARED_FOOD', 1),
  ('f0000000-0000-4000-8000-000000000281', 'b0000000-0000-4000-8000-000000000208', 'e0000000-0000-4000-8000-000000000208', 1899, 'PREPARED_FOOD', 1),
  ('f0000000-0000-4000-8000-000000000282', 'b0000000-0000-4000-8000-000000000208', 'e0000000-0000-4000-8000-000000000208', 399, 'PREPARED_FOOD', 2),
  ('f0000000-0000-4000-8000-000000000291', 'b0000000-0000-4000-8000-000000000209', 'e0000000-0000-4000-8000-000000000209', 1699, 'PREPARED_FOOD', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_item_version (
  id, menu_item_id, restaurant_id, version, name, description, ingredients_text,
  allergens_declared, review_status, reviewed_by, reviewed_at
) VALUES
  ('f0000000-0000-4000-8000-000000000371', 'f0000000-0000-4000-8000-000000000271', 'b0000000-0000-4000-8000-000000000207', 1,
   'Draft Stew', 'Not reviewed yet.', 'lentils, tomato', true, 'DRAFT', NULL, NULL),
  ('f0000000-0000-4000-8000-000000000381', 'f0000000-0000-4000-8000-000000000281', 'b0000000-0000-4000-8000-000000000208', 1,
   'Chicken Karahi', 'Tomato and ginger karahi.', 'chicken, tomato, ginger, garlic', true, 'APPROVED',
   'a0000000-0000-4000-8000-000000000001', now()),
  ('f0000000-0000-4000-8000-000000000382', 'f0000000-0000-4000-8000-000000000282', 'b0000000-0000-4000-8000-000000000208', 1,
   'Garlic Naan', 'Tandoor naan.', 'wheat, garlic, yoghurt', true, 'APPROVED',
   'a0000000-0000-4000-8000-000000000001', now()),
  ('f0000000-0000-4000-8000-000000000391', 'f0000000-0000-4000-8000-000000000291', 'b0000000-0000-4000-8000-000000000209', 1,
   'Seekh Kebab', 'Minced kebab.', 'beef, onion, spice', true, 'APPROVED',
   'a0000000-0000-4000-8000-000000000001', now())
ON CONFLICT (id) DO NOTHING;

UPDATE menu_item SET pending_version_id = 'f0000000-0000-4000-8000-000000000371'
 WHERE id = 'f0000000-0000-4000-8000-000000000271' AND pending_version_id IS NULL;
UPDATE menu_item SET live_version_id = 'f0000000-0000-4000-8000-000000000381'
 WHERE id = 'f0000000-0000-4000-8000-000000000281' AND live_version_id IS NULL;
UPDATE menu_item SET live_version_id = 'f0000000-0000-4000-8000-000000000382'
 WHERE id = 'f0000000-0000-4000-8000-000000000282' AND live_version_id IS NULL;
UPDATE menu_item SET live_version_id = 'f0000000-0000-4000-8000-000000000391'
 WHERE id = 'f0000000-0000-4000-8000-000000000291' AND live_version_id IS NULL;

INSERT INTO connect_account (
  id, owner_type, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted
) VALUES
  ('c1000000-0000-4000-8000-000000000208', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000208', 'acct_test_devworld_bismillah', true, true, true),
  ('c1000000-0000-4000-8000-000000000206', 'RESTAURANT', 'b0000000-0000-4000-8000-000000000206', 'acct_test_devworld_payout', false, false, false),
  ('c1000000-0000-4000-8000-000000000151', 'RIDER', 'a0000000-0000-4000-8000-000000000151', 'acct_test_devworld_ridersim', true, true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO devworld_persona (
  slug, account_id, restaurant_id, email, phone_e164,
  expect_email_verified, expect_password,
  expect_onboarding, expect_account_state, expect_halal, expect_accepting,
  expect_rider_onboarding, expect_rider_availability, expect_rider_status
) VALUES
  ('admin-seed', 'a0000000-0000-4000-8000-000000000001', NULL, 'admin-seed@seed.hg', NULL, true, true, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('support-seed', 'a0000000-0000-4000-8000-000000000002', NULL, 'support-seed@seed.hg', NULL, true, true, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('amina', 'a0000000-0000-4000-8000-000000000101', NULL, NULL, '+15550100101', NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('nour', 'a0000000-0000-4000-8000-000000000102', NULL, NULL, '+15550100102', NULL, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('rider-sim', 'a0000000-0000-4000-8000-000000000151', NULL, NULL, '+15550100151', NULL, false, NULL, NULL, NULL, NULL, 'ACTIVE', 'OFFLINE', 'ACTIVE'),
  ('rider-docs', 'a0000000-0000-4000-8000-000000000152', NULL, NULL, '+15550100152', NULL, false, NULL, NULL, NULL, NULL, 'DOCUMENTS_REVIEW', 'OFFLINE', 'PENDING'),
  ('rider-rejected', 'a0000000-0000-4000-8000-000000000153', NULL, NULL, '+15550100153', NULL, false, NULL, NULL, NULL, NULL, 'DOCUMENTS_REJECTED', 'OFFLINE', 'PENDING'),
  ('rider-registered', 'a0000000-0000-4000-8000-000000000154', NULL, NULL, '+15550100154', NULL, false, NULL, NULL, NULL, NULL, 'REGISTERED', 'OFFLINE', 'PENDING'),
  ('fresh', 'a0000000-0000-4000-8000-000000000201', 'b0000000-0000-4000-8000-000000000201', 'fresh@seed.hg', NULL, false, true, 'REGISTERED', 'PENDING', 'UNVERIFIED', false, NULL, NULL, NULL),
  ('profile', 'a0000000-0000-4000-8000-000000000202', 'b0000000-0000-4000-8000-000000000202', 'profile@seed.hg', NULL, true, true, 'PROFILE_PENDING', 'PENDING', 'UNVERIFIED', false, NULL, NULL, NULL),
  ('docs-todo', 'a0000000-0000-4000-8000-000000000203', 'b0000000-0000-4000-8000-000000000203', 'docs-todo@seed.hg', NULL, true, true, 'DOCUMENTS_PENDING', 'PENDING', 'UNVERIFIED', false, NULL, NULL, NULL),
  ('docs-review', 'a0000000-0000-4000-8000-000000000204', 'b0000000-0000-4000-8000-000000000204', 'docs-review@seed.hg', NULL, true, true, 'DOCUMENTS_REVIEW', 'PENDING', 'UNVERIFIED', false, NULL, NULL, NULL),
  ('docs-rejected', 'a0000000-0000-4000-8000-000000000205', 'b0000000-0000-4000-8000-000000000205', 'docs-rejected@seed.hg', NULL, true, true, 'DOCUMENTS_REJECTED', 'PENDING', 'UNVERIFIED', false, NULL, NULL, NULL),
  ('payout', 'a0000000-0000-4000-8000-000000000206', 'b0000000-0000-4000-8000-000000000206', 'payout@seed.hg', NULL, true, true, 'PAYOUT_PENDING', 'PENDING', 'CERTIFIED', false, NULL, NULL, NULL),
  ('menu', 'a0000000-0000-4000-8000-000000000207', 'b0000000-0000-4000-8000-000000000207', 'menu@seed.hg', NULL, true, true, 'MENU_PENDING', 'PENDING', 'CERTIFIED', false, NULL, NULL, NULL),
  ('bismillah-grill', 'a0000000-0000-4000-8000-000000000208', 'b0000000-0000-4000-8000-000000000208', 'bismillah-grill@seed.hg', NULL, true, true, 'ACTIVE', 'LIVE', 'CERTIFIED', true, NULL, NULL, NULL),
  ('expiring-halal', 'a0000000-0000-4000-8000-000000000209', 'b0000000-0000-4000-8000-000000000209', 'expiring-halal@seed.hg', NULL, true, true, 'ACTIVE', 'LIVE', 'EXPIRING_SOON', true, NULL, NULL, NULL),
  ('expired-halal', 'a0000000-0000-4000-8000-000000000210', 'b0000000-0000-4000-8000-000000000210', 'expired-halal@seed.hg', NULL, true, true, 'ACTIVE', 'DELISTED', 'EXPIRED', false, NULL, NULL, NULL),
  ('paused', 'a0000000-0000-4000-8000-000000000211', 'b0000000-0000-4000-8000-000000000211', 'paused@seed.hg', NULL, true, true, 'ACTIVE', 'LIVE', 'CERTIFIED', false, NULL, NULL, NULL),
  ('suspended', 'a0000000-0000-4000-8000-000000000212', 'b0000000-0000-4000-8000-000000000212', 'suspended@seed.hg', NULL, true, true, 'ACTIVE', 'SUSPENDED', 'CERTIFIED', false, NULL, NULL, NULL)
ON CONFLICT (slug) DO UPDATE SET
  account_id = EXCLUDED.account_id,
  restaurant_id = EXCLUDED.restaurant_id,
  email = EXCLUDED.email,
  phone_e164 = EXCLUDED.phone_e164,
  expect_email_verified = EXCLUDED.expect_email_verified,
  expect_password = EXCLUDED.expect_password,
  expect_onboarding = EXCLUDED.expect_onboarding,
  expect_account_state = EXCLUDED.expect_account_state,
  expect_halal = EXCLUDED.expect_halal,
  expect_accepting = EXCLUDED.expect_accepting,
  expect_rider_onboarding = EXCLUDED.expect_rider_onboarding,
  expect_rider_availability = EXCLUDED.expect_rider_availability,
  expect_rider_status = EXCLUDED.expect_rider_status;

DROP FUNCTION devworld_certificate(uuid, uuid, uuid, uuid, text, text, text, date, uuid);
DROP FUNCTION devworld_restaurant(uuid, text, text, text, text, restaurant_onboarding_state, restaurant_account_state, boolean, timestamptz, boolean);
DROP FUNCTION devworld_account(uuid, text, text, boolean);

COMMIT;
