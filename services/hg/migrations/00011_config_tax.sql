-- Runtime configuration and the Canadian tax table.
--
-- Every fee parameter is data (P-09): the launch values live in
-- `pricing_config`, not in a Go constant, so changing commission from 0% or
-- turning the service fee on is a config edit rather than a deploy (S-01, R-07).
--
-- Tax rates are effective-dated and province-keyed (P-11). A quote for a
-- province with no effective row fails loudly with tax_profile_missing; it
-- never silently defaults to zero.

-- +goose Up

CREATE TABLE tax_jurisdiction (
  code         text PRIMARY KEY,                     -- 'CA-ON'
  country      char(2) NOT NULL DEFAULT 'CA',
  province     province NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('tax_jurisdiction');
CREATE UNIQUE INDEX tax_jurisdiction_province ON tax_jurisdiction (province);

CREATE TABLE tax_rate (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  jurisdiction_code text NOT NULL REFERENCES tax_jurisdiction(code),
  tax_kind          tax_kind NOT NULL,
  tax_category      tax_category NOT NULL,
  rate              numeric(12, 8) NOT NULL,          -- exact; read into money.Rate, never a float
  effective_from    date NOT NULL,
  effective_to      date,
  statutory_label   text NOT NULL,                    -- what the receipt prints
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rate_non_negative CHECK (rate >= 0),
  CONSTRAINT tax_rate_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);
SELECT attach_updated_at('tax_rate');
CREATE UNIQUE INDEX tax_rate_unique
  ON tax_rate (jurisdiction_code, tax_kind, tax_category, effective_from);
CREATE INDEX tax_rate_lookup ON tax_rate (jurisdiction_code, tax_category, effective_from DESC);

-- P-09 — the versioned, effective-dated fee parameter set. The quote records
-- which row it used, so a later config change cannot alter a historical price.
CREATE TABLE pricing_config (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version                     int NOT NULL UNIQUE,
  effective_from              timestamptz NOT NULL,
  effective_to                timestamptz,
  base_delivery_fee_cents     bigint NOT NULL,
  included_km                 int NOT NULL,
  per_km_cents                bigint NOT NULL,
  min_delivery_fee_cents      bigint NOT NULL,
  max_delivery_fee_cents      bigint NOT NULL,
  small_order_threshold_cents bigint NOT NULL,
  small_order_surcharge_cents bigint NOT NULL,
  service_fee_rate            numeric(12, 8) NOT NULL,
  service_fee_min_cents       bigint NOT NULL,
  service_fee_max_cents       bigint NOT NULL,
  default_commission_rate     numeric(12, 8) NOT NULL,
  rider_base_cents            bigint NOT NULL,
  rider_per_km_cents          bigint NOT NULL,
  rider_minimum_cents         bigint NOT NULL DEFAULT 0,
  max_tip_cents               bigint NOT NULL DEFAULT 20000,
  quote_ttl_seconds           int NOT NULL DEFAULT 600,
  restaurant_response_window_seconds int NOT NULL DEFAULT 180,
  created_by                  uuid REFERENCES account(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_config_non_negative CHECK (
    base_delivery_fee_cents >= 0 AND per_km_cents >= 0 AND min_delivery_fee_cents >= 0
    AND max_delivery_fee_cents >= min_delivery_fee_cents
    AND small_order_threshold_cents >= 0 AND small_order_surcharge_cents >= 0
    AND service_fee_min_cents >= 0 AND service_fee_max_cents >= service_fee_min_cents
    AND rider_base_cents >= 0 AND rider_per_km_cents >= 0 AND rider_minimum_cents >= 0
    AND included_km >= 0 AND quote_ttl_seconds > 0
  ),
  CONSTRAINT pricing_config_rates CHECK (
    service_fee_rate >= 0 AND default_commission_rate >= 0
  ),
  CONSTRAINT pricing_config_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);
SELECT attach_updated_at('pricing_config');
CREATE INDEX pricing_config_effective ON pricing_config (effective_from DESC);

-- A-31 — typed, versioned settings with four-eyes approval on money-affecting
-- classes. Values are never applied retroactively: the order binds the version.
CREATE TABLE platform_setting (
  key                text PRIMARY KEY,
  class              text NOT NULL CHECK (class IN ('CORE', 'PRICING', 'PAYOUT', 'DISPATCH', 'CONTENT', 'OPS')),
  value_type         text NOT NULL CHECK (value_type IN ('INT', 'DECIMAL', 'BOOL', 'STRING', 'ENUM', 'JSON')),
  description        text,
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('platform_setting');

CREATE TABLE platform_setting_version (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  key            text NOT NULL REFERENCES platform_setting(key),
  value_json     jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  reason_code    text,
  reason_text    text,
  created_by     uuid REFERENCES account(id),
  approved_by    uuid REFERENCES account(id),
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- four-eyes: the approver is never the author.
  CONSTRAINT platform_setting_version_four_eyes CHECK (
    approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by
  ),
  -- A human-authored version needs a second pair of eyes before it can go
  -- live. `created_by IS NULL` marks a system bootstrap row (the launch values
  -- written by seed/), which has no author to second.
  CONSTRAINT platform_setting_version_active_is_approved CHECK (
    status NOT IN ('SCHEDULED', 'ACTIVE') OR approved_by IS NOT NULL OR created_by IS NULL
  )
);
SELECT attach_updated_at('platform_setting_version');
CREATE INDEX platform_setting_version_key ON platform_setting_version (key, effective_from DESC);

ALTER TABLE platform_setting
  ADD CONSTRAINT platform_setting_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES platform_setting_version(id);

-- P-33 — discovery rails are configured, not hardcoded (the old feed pinned
-- 10 km / 3 months / top 8-10-6 in source).
CREATE TABLE discovery_config (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version                int NOT NULL UNIQUE,
  effective_from         timestamptz NOT NULL,
  nearby_radius_m        int NOT NULL DEFAULT 10000,
  trending_window_days   int NOT NULL DEFAULT 7,
  rail_size              int NOT NULL DEFAULT 10,
  max_page_size          int NOT NULL DEFAULT 50,
  search_cache_ttl_s     int NOT NULL DEFAULT 60,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('discovery_config');

CREATE TABLE dispatch_config (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version             int NOT NULL UNIQUE,
  effective_from      timestamptz NOT NULL,
  wave_radii_m        int[] NOT NULL DEFAULT '{3000,6000,10000}',
  wave_timeout_s      int NOT NULL DEFAULT 20,
  offer_ttl_s         int NOT NULL DEFAULT 30,
  offers_per_wave     int NOT NULL DEFAULT 8,
  position_max_age_s  int NOT NULL DEFAULT 90,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_config_bounds CHECK (
    wave_timeout_s > 0 AND offer_ttl_s > 0 AND offers_per_wave > 0 AND position_max_age_s > 0
  )
);
SELECT attach_updated_at('dispatch_config');

-- +goose Down
DROP TABLE IF EXISTS dispatch_config;
DROP TABLE IF EXISTS discovery_config;
ALTER TABLE platform_setting DROP CONSTRAINT IF EXISTS platform_setting_current_version_fk;
DROP TABLE IF EXISTS platform_setting_version;
DROP TABLE IF EXISTS platform_setting;
DROP TABLE IF EXISTS pricing_config;
DROP TABLE IF EXISTS tax_rate;
DROP TABLE IF EXISTS tax_jurisdiction;
