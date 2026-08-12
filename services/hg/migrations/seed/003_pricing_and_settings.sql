-- Launch money configuration.
--
--   Platform commission   0%          (S-01 / R-01 — the field exists per
--                                      restaurant and is switchable without a
--                                      release)
--   Delivery fee          $2.99 + $1.00/km, charged to the customer (S-02)
--   Rider earnings        = delivery fee, pass-through, plus 100% of tips
--                          (S-03 / R-02 — no rate card, no floor)
--   Service fee           $0.00        (R-07 — mechanism built and wired, set
--                                      to zero so it is correctable by
--                                      configuration rather than by release)
--   Payouts               weekly, Monday, automatic, no minimum (S-04 / R-03)
--
-- Known and accepted: at 0% commission with a $0 service fee the platform has
-- no revenue line while Stripe still charges ~2.9% + $0.30, roughly -$1.30 per
-- order. That is a launch-time acquisition cost, not an oversight, and these
-- rows are how it gets corrected.
--
-- Idempotent: safe to re-run.

INSERT INTO pricing_config (
  version, effective_from,
  base_delivery_fee_cents, included_km, per_km_cents,
  min_delivery_fee_cents, max_delivery_fee_cents,
  small_order_threshold_cents, small_order_surcharge_cents,
  service_fee_rate, service_fee_min_cents, service_fee_max_cents,
  default_commission_rate,
  rider_base_cents, rider_per_km_cents, rider_minimum_cents,
  max_tip_cents, quote_ttl_seconds, restaurant_response_window_seconds
) VALUES (
  1, TIMESTAMPTZ '2026-08-10 00:00:00+00',
  299, 0, 100,                 -- $2.99 base, billed from the first km at $1.00/km
  299, 1500,                   -- floor at the base fee; cap at $15.00
  0, 0,                        -- small-order surcharge mechanism present, disabled
  0.00000000, 0, 0,            -- service fee 0%, clamped to [$0.00, $0.00]
  0.00000000,                  -- default commission 0%
  299, 100, 0,                 -- rider earnings mirror the delivery fee exactly
  20000,                       -- tip ceiling $200.00
  600,                         -- quote honoured 10 minutes
  180                          -- restaurant acceptance window 180 s (R-04)
)
ON CONFLICT (version) DO NOTHING;

INSERT INTO discovery_config (version, effective_from) VALUES
  (1, TIMESTAMPTZ '2026-08-10 00:00:00+00')
ON CONFLICT (version) DO NOTHING;

INSERT INTO dispatch_config (version, effective_from, wave_radii_m, wave_timeout_s, offer_ttl_s, offers_per_wave)
VALUES (1, TIMESTAMPTZ '2026-08-10 00:00:00+00', ARRAY[3000, 6000, 10000], 20, 30, 8)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Runtime settings. Money-affecting keys are PRICING/PAYOUT class and normally
-- require four-eyes approval; these bootstrap rows carry created_by IS NULL,
-- which is what marks them as system-authored rather than approved-by-nobody.
-- ---------------------------------------------------------------------------

INSERT INTO platform_setting (key, class, value_type, description) VALUES
  ('currency',                     'CORE',    'ENUM',   'Trading currency. CAD only in V1.'),
  ('served_provinces',             'CORE',    'JSON',   'Provinces that accept orders. Ontario only at launch (O-05).'),
  ('platform_commission_bps',      'PRICING', 'INT',    'Default platform commission in basis points. 0 at launch (S-01).'),
  ('delivery_fee_base_cents',      'PRICING', 'INT',    'Delivery fee base, charged to the customer (S-02).'),
  ('delivery_fee_per_km_cents',    'PRICING', 'INT',    'Delivery fee per billable kilometre (S-02).'),
  ('delivery_fee_cap_cents',       'PRICING', 'INT',    'Maximum delivery fee.'),
  ('service_fee_bps',              'PRICING', 'INT',    'Customer-facing service fee in basis points. 0 at launch (R-07).'),
  ('service_fee_min_cents',        'PRICING', 'INT',    'Service fee floor.'),
  ('service_fee_max_cents',        'PRICING', 'INT',    'Service fee ceiling.'),
  ('rider_pay_model',              'PAYOUT',  'ENUM',   'DELIVERY_FEE_PASSTHROUGH at launch (S-03 / R-02).'),
  ('payout_cadence',               'PAYOUT',  'ENUM',   'WEEKLY (S-04).'),
  ('payout_anchor_dow',            'PAYOUT',  'INT',    'Day of week for the payout run. 1 = Monday (S-04).'),
  ('payout_minimum_cents',         'PAYOUT',  'INT',    'Payout floor. 0 = no minimum (R-03).'),
  ('quote_ttl_seconds',            'PRICING', 'INT',    'How long a quoted price is honoured.'),
  ('restaurant_response_window_seconds', 'DISPATCH', 'INT', 'Restaurant acceptance window (R-04).'),
  ('halal_default_filter',         'CORE',    'ENUM',   'CERTIFIED_ONLY. Relaxing it is an explicit user action.'),
  ('halal_cert_min_remaining_days','CORE',    'INT',    'Minimum remaining validity for check H5_DATES_VALID.'),
  ('max_tip_cents',                'PRICING', 'INT',    'Tip ceiling — the one monetary value a customer supplies.')
ON CONFLICT (key) DO NOTHING;

-- +--------------------------------------------------------------------------
-- One ACTIVE version per key, effective at the launch epoch.
-- --------------------------------------------------------------------------+
INSERT INTO platform_setting_version (key, value_json, effective_from, status, reason_code, reason_text)
SELECT v.key, v.value_json, TIMESTAMPTZ '2026-08-10 00:00:00+00', 'ACTIVE',
       'LAUNCH_BOOTSTRAP', 'Initial launch values seeded with the schema.'
  FROM (VALUES
    ('currency',                     '"CAD"'::jsonb),
    ('served_provinces',             '["ON"]'::jsonb),
    ('platform_commission_bps',      '0'::jsonb),
    ('delivery_fee_base_cents',      '299'::jsonb),
    ('delivery_fee_per_km_cents',    '100'::jsonb),
    ('delivery_fee_cap_cents',       '1500'::jsonb),
    ('service_fee_bps',              '0'::jsonb),
    ('service_fee_min_cents',        '0'::jsonb),
    ('service_fee_max_cents',        '0'::jsonb),
    ('rider_pay_model',              '"DELIVERY_FEE_PASSTHROUGH"'::jsonb),
    ('payout_cadence',               '"WEEKLY"'::jsonb),
    ('payout_anchor_dow',            '1'::jsonb),
    ('payout_minimum_cents',         '0'::jsonb),
    ('quote_ttl_seconds',            '600'::jsonb),
    ('restaurant_response_window_seconds', '180'::jsonb),
    ('halal_default_filter',         '"CERTIFIED_ONLY"'::jsonb),
    ('halal_cert_min_remaining_days','30'::jsonb),
    ('max_tip_cents',                '20000'::jsonb)
  ) AS v(key, value_json)
 WHERE NOT EXISTS (
   SELECT 1 FROM platform_setting_version p WHERE p.key = v.key AND p.status = 'ACTIVE');

UPDATE platform_setting s
   SET current_version_id = v.id
  FROM platform_setting_version v
 WHERE v.key = s.key AND v.status = 'ACTIVE' AND s.current_version_id IS NULL;
