-- A minimal but complete end-to-end order, used by the invariant tests.
--
-- One customer, one restaurant, one address, one cart, one quote (with a tax
-- line that sums), one order in PREPARING with a live deadline, and a balanced
-- CAPTURE ledger batch. Fixed UUIDs so tests can reference rows by name.
--
-- Idempotent: safe to re-run.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO account (id, phone_e164, status, timezone)
VALUES ('11111111-1111-4111-8111-111111111111', '+14165550123', 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customer_profile (account_id, first_name, last_name)
VALUES ('11111111-1111-4111-8111-111111111111', 'Test', 'Customer')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES ('11111111-1111-4111-8111-111111111111', 'CUSTOMER', 'GLOBAL')
ON CONFLICT DO NOTHING;

-- The ACTIVE rider fxRiderID references from the COMPLETED dispatch below (and
-- that the conformance harness drives as an assigned rider). Self-contained so
-- fixtures.sql loads on a clean DB — the FK to account(id) must resolve without
-- relying on any prior rider registration having polluted the database.
INSERT INTO account (id, phone_e164, status, timezone)
VALUES ('019ffe57-fbd0-7355-ade8-b03ea7943578', '+14165550188', 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES ('019ffe57-fbd0-7355-ade8-b03ea7943578', 'RIDER', 'GLOBAL')
ON CONFLICT DO NOTHING;

INSERT INTO rider_profile (account_id, first_name, last_name, date_of_birth,
                           onboarding_state, account_status, availability_state,
                           is_online, approved_at)
VALUES ('019ffe57-fbd0-7355-ade8-b03ea7943578', 'Test', 'Rider', '1995-05-01',
        'ACTIVE', 'ACTIVE', 'OFFLINE', false, now() - interval '30 days')
ON CONFLICT (account_id) DO NOTHING;

-- fxRiderID's Stripe Connect account: a fully-enabled RIDER connect_account.
-- The payments conformance reads (getConnectStatus, listRiderPayouts, and the
-- earning/payout seed helper's connect-account lookup) all resolve this exact
-- row (owner_type RIDER, owner_id = fxRiderID). On a clean DB it does not exist
-- until POST /v1/connect/account runs — so on a first pass the read tests were
-- red and only went green once a later write test had created it. Seeding it
-- here makes the rider payout/earnings reads self-contained on a fresh DB, and
-- keeps createConnectAccount's (owner_type, owner_id) idempotency intact.
INSERT INTO connect_account (id, owner_type, owner_id, stripe_account_id, country,
                             default_currency, charges_enabled, payouts_enabled, details_submitted)
VALUES ('0a333333-0000-4000-8000-00000000c001', 'RIDER', '019ffe57-fbd0-7355-ade8-b03ea7943578',
        'acct_test_fixture_rider01', 'CA', 'CAD', true, true, true)
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- The RESTAURANT_MANAGER (fxRestaurantManagerID) the conformance harness
-- authenticates as for every restaurant-portal read/write. The catalog scope
-- resolver (RestaurantForPrincipal, P-07) answers "which restaurant may this
-- principal act for" from a RESTAURANT-scoped account_role — with no such grant
-- every portal endpoint is a 404. Self-contained so this resolves on a clean DB
-- rather than relying on a manager registered in a prior session.
INSERT INTO account (id, phone_e164, status, timezone)
VALUES ('77777777-7777-4777-8777-777777777777', '+14165550170', 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type, scope_id)
VALUES ('77777777-7777-4777-8777-777777777777', 'RESTAURANT_MANAGER', 'RESTAURANT',
        '33333333-3333-4333-8333-333333333333')
ON CONFLICT DO NOTHING;

-- The SUPER_ADMIN (fxSuperAdminID) the harness authenticates as for admin
-- writes. Admin authorisation itself is header-driven in the test server, but
-- admin write paths persist the actor as an FK — a refund's audit_event actor,
-- an issuing-body decided_by, a certificate verified_by. Without this account
-- those writes 500 on the FK, so it must exist for admin conformance to pass on
-- a clean DB.
INSERT INTO account (id, phone_e164, status, timezone)
VALUES ('019ff68d-af0f-7e5b-a1ab-25bfa033f6f5', '+14165550101', 'ACTIVE', 'America/Toronto')
ON CONFLICT (id) DO NOTHING;

INSERT INTO account_role (account_id, role, scope_type)
VALUES ('019ff68d-af0f-7e5b-a1ab-25bfa033f6f5', 'SUPER_ADMIN', 'GLOBAL')
ON CONFLICT DO NOTHING;

INSERT INTO address (id, account_id, label, line1, city, province, postal_code, location, timezone, is_default)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
        'Home', '1245 Danforth Avenue', 'Toronto', 'ON', 'M4J 1M4',
        ST_SetSRID(ST_MakePoint(-79.3282, 43.6820), 4326)::geography, 'America/Toronto', true)
ON CONFLICT (id) DO NOTHING;

-- halal_status CERTIFIED so the customer-facing halal gate (catalog
-- visiblePredicate: account_state='LIVE' AND halal_status IN
-- ('CERTIFIED','EXPIRING_SOON')) makes this restaurant discoverable. Without it
-- every customer read is a C-13 404, and the conformance floor's restaurant ops
-- only pass against a database already polluted with a halal-visible row.
INSERT INTO restaurant (id, slug, legal_name, display_name, line1, city, province, postal_code,
                        location, timezone, onboarding_state, account_state, is_accepting_orders,
                        commission_rate_bps, halal_status)
VALUES ('33333333-3333-4333-8333-333333333333', 'karachi-kitchen', 'Karachi Kitchen Inc.',
        'Karachi Kitchen', '1180 Danforth Avenue', 'Toronto', 'ON', 'M4J 1M1',
        ST_SetSRID(ST_MakePoint(-79.3332, 43.6810), 4326)::geography, 'America/Toronto',
        'ACTIVE', 'LIVE', true, 0, 'CERTIFIED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_category (id, restaurant_id, name)
VALUES ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'Biryani')
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_item (id, restaurant_id, category_id, price_cents, tax_category)
VALUES ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444', 1500, 'PREPARED_FOOD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cart (id, account_id, restaurant_id, delivery_address_id)
VALUES ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;

-- Quote: subtotal $30.00, delivery $4.19, service $0.00, HST 13% on $34.19 =
-- $4.44 (half-up), tip $5.00 => total $43.63. The tip is absent from the tax
-- base, which is what quote_tip_taxed checks.
INSERT INTO quote (
  id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
  pricing_config_id, tax_jurisdiction_code,
  subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
  commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
  billable_km, route_meters, input_hash, state_hash, expires_at)
SELECT '77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111',
       '66666666-6666-4666-8666-666666666666', '33333333-3333-4333-8333-333333333333',
       '22222222-2222-4222-8222-222222222222', 'DELIVERY',
       pc.id, 'CA-ON',
       3000, 419, 0, 444, 500, 4363,
       0, 3000, 919, 0,
       2, 1900, digest('input', 'sha256'), digest('state', 'sha256'), now() + interval '10 minutes'
  FROM pricing_config pc WHERE pc.version = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO quote_line (quote_id, line_no, menu_item_id, menu_item_name, quantity,
                        base_price_cents, variant_part_cents, addons_part_cents,
                        line_unit_cents, line_total_cents, tax_category)
VALUES ('77777777-7777-4777-8777-777777777777', 1, '55555555-5555-4555-8555-555555555555',
        'Chicken Biryani', 2, 1500, 1500, 0, 1500, 3000, 'PREPARED_FOOD')
ON CONFLICT DO NOTHING;

INSERT INTO quote_tax_line (quote_id, seq, jurisdiction_code, tax_kind, statutory_label,
                            rate, base_cents, amount_cents, remittable_by)
VALUES ('77777777-7777-4777-8777-777777777777', 1, 'CA-ON', 'HST', 'HST',
        0.13000000, 3419, 444, 'PLATFORM')
ON CONFLICT DO NOTHING;

-- Order in PREPARING, with a live deadline and a named action.
INSERT INTO "order" (
  id, code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
  state, deadline_at, deadline_action,
  subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
  tax_total_cents, tip_cents, total_cents,
  commission_cents, restaurant_net_cents, rider_earnings_cents, platform_gross_cents,
  accepted_at)
VALUES ('88888888-8888-4888-8888-888888888888', 'HG-TEST01',
        '77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'DELIVERY',
        'PREPARING', now() + interval '30 minutes', 'PREP_OVERDUE',
        3000, 0, 419, 0, 444, 500, 4363,
        0, 3000, 919, 0, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_line (order_id, line_no, menu_item_id, name_snapshot, quantity,
                        base_price_cents, variant_part_cents, addons_part_cents,
                        line_unit_cents, line_total_cents, tax_category)
VALUES ('88888888-8888-4888-8888-888888888888', 1, '55555555-5555-4555-8555-555555555555',
        'Chicken Biryani', 2, 1500, 1500, 0, 1500, 3000, 'PREPARED_FOOD')
ON CONFLICT DO NOTHING;

INSERT INTO payment_intent (id, order_id, stripe_payment_intent_id, state,
                            amount_authorized_cents, amount_captured_cents, captured_at)
VALUES ('99999999-9999-4999-8999-999999999999', '88888888-8888-4888-8888-888888888888',
        'pi_test_fixture_0001', 'SUCCEEDED', 4363, 4363, now())
ON CONFLICT (id) DO NOTHING;

-- Balanced CAPTURE batch: the customer's charge against the PSP clearing account.
INSERT INTO ledger_batch (id, kind, order_id, idempotency_key, posted_by)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'CAPTURE',
        '88888888-8888-4888-8888-888888888888', 'cap:88888888-8888-4888-8888-888888888888',
        'system:capture')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entry (batch_id, order_id, account, counterparty_type, counterparty_id,
                          amount_cents, component, memo)
SELECT * FROM (VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '88888888-8888-4888-8888-888888888888'::uuid,
   'CUSTOMER_CHARGES'::ledger_account, 'CUSTOMER'::ledger_counterparty_type,
   '11111111-1111-4111-8111-111111111111'::uuid, -4363::bigint, 'SUBTOTAL'::ledger_component, 'capture'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '88888888-8888-4888-8888-888888888888'::uuid,
   'PSP_CLEARING'::ledger_account, 'PLATFORM'::ledger_counterparty_type,
   NULL::uuid, 4363::bigint, 'SUBTOTAL'::ledger_component, 'capture')
) AS v
WHERE NOT EXISTS (
  SELECT 1 FROM ledger_entry WHERE batch_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');


-- Two further quote+order pairs, so tests that need an order of their own do
-- not fight the one-order-per-quote index.
INSERT INTO quote (
  id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
  pricing_config_id, tax_jurisdiction_code,
  subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
  input_hash, state_hash, expires_at)
SELECT q.id, '11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666',
       '33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'DELIVERY',
       pc.id, 'CA-ON', 3000, 419, 0, 0, 500, 3919,
       digest(q.id::text, 'sha256'), digest(q.id::text, 'sha256'), now() + interval '10 minutes'
  FROM pricing_config pc,
       (VALUES ('7a000000-0000-4000-8000-000000000002'::uuid),
               ('7a000000-0000-4000-8000-000000000003'::uuid)) AS q(id)
 WHERE pc.version = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO "order" (
  id, code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
  state, deadline_at, deadline_action,
  subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
  tax_total_cents, tip_cents, total_cents)
VALUES
  ('13000000-0000-4000-8000-000000000001', 'HG-TEST02', '7a000000-0000-4000-8000-000000000002',
   '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
   '22222222-2222-4222-8222-222222222222', 'DELIVERY', 'PREPARING',
   now() + interval '30 minutes', 'PREP_OVERDUE', 3000, 0, 419, 0, 0, 500, 3919),
  ('13000000-0000-4000-8000-000000000002', 'HG-TEST03', '7a000000-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
   '22222222-2222-4222-8222-222222222222', 'DELIVERY', 'PREPARING',
   now() + interval '30 minutes', 'PREP_OVERDUE', 3000, 0, 419, 0, 0, 500, 3919)
ON CONFLICT (id) DO NOTHING;

-- A DELIVERED order (fxCustomerID, fxRestaurantID, fxRiderID) inside the
-- 14-day review window, for getOrderRating/submitOrderRating (C-38, scoped).
-- Terminal state ⇒ deadline_at/deadline_action are NULL (order_deadline_required).
INSERT INTO quote (
  id, account_id, cart_id, restaurant_id, delivery_address_id, fulfilment,
  pricing_config_id, tax_jurisdiction_code,
  subtotal_cents, delivery_fee_cents, service_fee_cents, tax_total_cents, tip_cents, total_cents,
  input_hash, state_hash, expires_at)
SELECT '7a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
       '66666666-6666-4666-8666-666666666666', '33333333-3333-4333-8333-333333333333',
       '22222222-2222-4222-8222-222222222222', 'DELIVERY',
       pc.id, 'CA-ON', 3000, 419, 0, 0, 500, 3919,
       digest('7a000000-0000-4000-8000-000000000004', 'sha256'),
       digest('7a000000-0000-4000-8000-000000000004', 'sha256'), now() + interval '10 minutes'
  FROM pricing_config pc WHERE pc.version = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO "order" (
  id, code, quote_id, account_id, restaurant_id, delivery_address_id, fulfilment,
  state, deadline_at, deadline_action,
  subtotal_cents, discount_cents, delivery_fee_cents, service_fee_cents,
  tax_total_cents, tip_cents, total_cents, delivered_at)
VALUES
  ('14000000-0000-4000-8000-000000000001', 'HG-TEST04', '7a000000-0000-4000-8000-000000000004',
   '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
   '22222222-2222-4222-8222-222222222222', 'DELIVERY', 'COMPLETED', NULL, NULL,
   3000, 0, 419, 0, 0, 500, 3919, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO dispatch (order_id, state, deadline_at, deadline_action, rider_account_id, assigned_at)
VALUES ('14000000-0000-4000-8000-000000000001', 'COMPLETED', NULL, NULL,
        '019ffe57-fbd0-7355-ade8-b03ea7943578', now() - interval '2 days')
ON CONFLICT (order_id) DO NOTHING;

COMMIT;
